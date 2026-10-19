//? The leader-elected scheduler runtime. Composition of existing core
//? primitives — this module deliberately owns ONLY the renew loop + tick loop:
//?
//? - Leadership: core's `acquireLease`/`renewLease` (SET NX PX + owner-checked
//?   Lua). Exactly one instance holds `<project>:lease:<leaseName>` and fires
//?   jobs; the others keep trying to acquire and take over within one lease
//?   TTL of a leader dying. Single-Redis best-effort (see lease.ts header):
//?   a leader stalling past the TTL can hand over mid-run, so jobs must be
//?   idempotent / tolerate a rare double-fire.
//? - Per-run dedup: every run additionally takes a short `cron-run:<job>`
//?   lease (renewed while the handler executes), so a leader switch mid-run
//?   skips instead of double-firing in the common case.
//? - No catch-up: ticks missed while no leader was alive are skipped. On
//?   gaining leadership a cron expression resumes at its next occurrence from
//?   "now"; an interval resumes from its persisted anchor (last run start), so
//?   an overdue interval fires ONCE on the next tick — never a backlog burst —
//?   and a restart/failover does not push it a full period out.

import {
  acquireLease,
  dispatchHook,
  getLogger,
  registerHook,
  releaseLease,
  renewLease,
  tryCatch,
  tryCatchSync,
} from '@luckystack/core';
import { getCronConfig, setCronConfigChangeListener } from './cronConfig';
import { computeNextRun } from './schedule';
import { incrementSkipStat, readIntervalAnchor, writeRunStats } from './stats';
import { jobRuntimes, type JobRuntime } from './state';
import type { CronJobContext, CronJobDefinition } from './types';

interface SchedulerState {
  started: boolean;
  leaderToken: string | null;
  leaderLoop: ReturnType<typeof setInterval> | null;
  tickLoop: ReturnType<typeof setInterval> | null;
  /** Period the armed loop runs at, so a config change can tell whether to re-arm. */
  leaderLoopMs: number | null;
  tickLoopMs: number | null;
  leaderTickInFlight: boolean;
  teardownRegistered: boolean;
}

const state: SchedulerState = {
  started: false,
  leaderToken: null,
  leaderLoop: null,
  tickLoop: null,
  leaderLoopMs: null,
  tickLoopMs: null,
  leaderTickInFlight: false,
  teardownRegistered: false,
};

//? Every intentional fire-and-forget promise terminates here. Core's lease and
//? stats primitives currently resolve fail-closed, but the scheduler must keep
//? its own "never unhandled, never wedged" contract if an injected/custom
//? implementation rejects. The logger is isolated too: a broken sink must not
//? turn an observed background failure into a second unhandled exception.
const logBackgroundFailure = (label: string, error: unknown): void => {
  tryCatchSync(() => {
    getLogger().error(`[cron] ${label} failed`, error);
  });
};

const observeBackground = (promise: Promise<unknown>, label: string): void => {
  void promise.catch((error: unknown) => {
    logBackgroundFailure(label, error);
  });
};

export const isCronLeader = (): boolean => state.leaderToken !== null;

/**
 * Register the `preServerStop` teardown exactly once. Called from the
 * `/register` boot entry and from `ensureCronSchedulerStarted`, whichever
 * comes first.
 */
export const registerCronTeardown = (): void => {
  if (state.teardownRegistered) return;
  state.teardownRegistered = true;
  registerHook('preServerStop', async () => {
    await stopCronScheduler();
  });
};

//? Where a job's schedule resumes once this instance owns it. An interval
//? counts from its persisted anchor instead of "now": computing now + everyMs
//? on every restart or leader change meant a period longer than the time
//? between deploys never fired at all. `max(now, …)` makes an overdue interval
//? fire once on the next tick; the run after it counts from that fire, so
//? missed periods are never replayed. Redis unreachable → "now" (old behaviour).
const resumeSchedule = async (runtime: JobRuntime, now: number): Promise<number | null> => {
  const jitterMs = runtime.def.jitterMs ?? 0;
  if (runtime.normalized.kind === 'interval') {
    const anchor = await readIntervalAnchor(runtime.def.name, now);
    if (anchor !== null) {
      const due = computeNextRun(runtime.normalized, anchor, jitterMs);
      return due === null ? null : Math.max(now, due);
    }
  }
  return computeNextRun(runtime.normalized, now, jitterMs);
};

//? On gaining leadership: resume every schedule (see resumeSchedule) and arm
//? not-yet-fired `runOnStart` jobs to fire on the next tick.
const onLeadershipGained = async (): Promise<void> => {
  const now = Date.now();
  await Promise.all([...jobRuntimes.values()].map(async (runtime) => {
    runtime.nextRunAt =
      runtime.def.runOnStart && !runtime.ranOnStart
        ? now
        : await resumeSchedule(runtime, now);
  }));
};

/**
 * Internal (called by `registerCronJob`): a job registered while this process
 * already leads missed `onLeadershipGained` — e.g. an overlay file loaded after
 * the first leader tick won, or a hot-reload re-registration — so resume its
 * interval from the persisted anchor too.
 */
export const resumeJobRegisteredWhileLeader = (name: string): void => {
  if (!isCronLeader()) return;
  const runtime = jobRuntimes.get(name);
  if (runtime?.normalized.kind !== 'interval') return;
  if (runtime.def.runOnStart && !runtime.ranOnStart) return;
  observeBackground((async () => {
    const nextRunAt = await resumeSchedule(runtime, Date.now());
    //? A re-registration during the read replaced this runtime; it resumes itself.
    if (jobRuntimes.get(name) === runtime) runtime.nextRunAt = nextRunAt;
  })(), `job "${name}" schedule resume`);
};

const leaderTick = async (): Promise<void> => {
  if (state.leaderTickInFlight) return;
  state.leaderTickInFlight = true;
  try {
    const config = getCronConfig();
    if (!config.enabled) {
      if (state.leaderToken) {
        await releaseLease(config.leaseName, state.leaderToken);
        state.leaderToken = null;
      }
      return;
    }
    if (state.leaderToken) {
      const renewed = await renewLease(config.leaseName, state.leaderToken, config.leaseTtlMs);
      if (!renewed) {
        state.leaderToken = null;
        getLogger().warn('[cron] lost scheduler leadership — another instance will take over');
      }
      return;
    }
    const token = await acquireLease(config.leaseName, config.leaseTtlMs);
    if (token) {
      //? Resume the schedules BEFORE publishing leadership, so the tick loop
      //? never fires on stale nextRunAt values from an earlier leadership term.
      await onLeadershipGained();
      if (!state.started) {
        //? Stopped while the anchors were read — hand the lease straight back.
        await releaseLease(config.leaseName, token);
        return;
      }
      state.leaderToken = token;
      getLogger().info('[cron] acquired scheduler leadership on this instance');
    }
  } finally {
    //? A rejected injected lease primitive or logger must never freeze every
    //? later election tick behind a permanently-true in-flight latch.
    state.leaderTickInFlight = false;
  }
};

const runPerTenant = async (
  def: CronJobDefinition,
  perTenant: NonNullable<CronJobDefinition['perTenant']>,
  scheduledFor: number,
): Promise<Error | null> => {
  const [resolveError, tenants] = await tryCatch(async () => perTenant.tenants());
  if (resolveError || !tenants) {
    return resolveError ?? new Error(`[cron] job "${def.name}": tenants() returned nothing`);
  }
  const concurrency = Math.max(1, perTenant.concurrency ?? 1);
  let firstError: Error | null = null;
  let index = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, tenants.length) },
    async () => {
      while (index < tenants.length) {
        const tenant = tenants[index];
        index += 1;
        const context: CronJobContext = { jobName: def.name, scheduledFor, tenant };
        const [error] = await tryCatch(async () => def.handler(context));
        if (error) {
          firstError ??= error;
          getLogger().error(`[cron] job "${def.name}" failed for a tenant`, error, {
            jobName: def.name,
          });
        }
      }
    },
  );
  await Promise.all(workers);
  return firstError;
};

//? Executes one run of one job: preCronRun veto → per-run lease → handler
//? (tryCatch, optional tenant fan-out) → stats + postCronRun.
const runJobCore = async (runtime: JobRuntime, scheduledFor: number): Promise<Error | null> => {
  const { def } = runtime;
  const config = getCronConfig();
  const logger = getLogger();

  const veto = await dispatchHook('preCronRun', { jobName: def.name, scheduledFor });
  if (veto.stopped) {
    logger.debug(`[cron] job "${def.name}" vetoed by a preCronRun hook — skipped`);
    return null;
  }

  const runLeaseName = `cron-run:${def.name}`;
  const runLeaseTtlMs = def.runLeaseTtlMs ?? config.runLeaseTtlMs;
  const runToken = await acquireLease(runLeaseName, runLeaseTtlMs);
  if (!runToken) {
    logger.debug(`[cron] job "${def.name}" is already running on another instance — skipped`);
    await incrementSkipStat(def.name);
    return null;
  }

  runtime.running = true;
  runtime.ranOnStart = true;
  const renewTimer = setInterval(() => {
    observeBackground(
      renewLease(runLeaseName, runToken, runLeaseTtlMs),
      `job "${def.name}" lease renewal`,
    );
  }, Math.max(1000, Math.floor(runLeaseTtlMs / 3)));
  renewTimer.unref();

  const startedAt = Date.now();
  //? The finally owns the in-process overlap flag + timer. Even an unexpected
  //? infrastructure rejection cannot leave this runtime permanently "running"
  //? or leak a renewal interval. The outer tryCatch converts that rejection to
  //? this run's Error result, preserving runCronJobNow's documented contract.
  const [executionError, handlerError] = await tryCatch(async (): Promise<Error | null> => {
    try {
      if (def.perTenant) {
        const tenantError = await runPerTenant(def, def.perTenant, scheduledFor);
        return tenantError;
      }
      const [error] = await tryCatch(async () => def.handler({ jobName: def.name, scheduledFor }));
      return error;
    } finally {
      clearInterval(renewTimer);
      runtime.running = false;
      await releaseLease(runLeaseName, runToken);
    }
  });
  const runError = executionError ?? handlerError;
  const durationMs = Date.now() - startedAt;

  await writeRunStats(def.name, { lastRunAt: startedAt, durationMs, error: runError });
  await dispatchHook('postCronRun', { jobName: def.name, scheduledFor, durationMs, error: runError });

  if (runError) {
    logger.error(`[cron] job "${def.name}" failed`, runError, { durationMs });
  } else {
    logger.debug(`[cron] job "${def.name}" completed in ${durationMs}ms`);
  }
  return runError;
};

//? Public/internal contract: infrastructure failures become an Error result,
//? never a rejection. Scheduler calls are observed as an additional defensive
//? backstop; runCronJobNow callers get the documented Error-or-null shape too.
const runJob = async (runtime: JobRuntime, scheduledFor: number): Promise<Error | null> => {
  const [infrastructureError, result] = await tryCatch(() => runJobCore(runtime, scheduledFor));
  if (infrastructureError) {
    logBackgroundFailure(`job "${runtime.def.name}" infrastructure`, infrastructureError);
    return infrastructureError;
  }
  return result;
};

const schedulerTick = (): void => {
  const config = getCronConfig();
  if (!config.enabled || !state.leaderToken) return;
  const now = Date.now();
  for (const runtime of jobRuntimes.values()) {
    if (runtime.nextRunAt === null || now < runtime.nextRunAt) continue;
    const scheduledFor = runtime.nextRunAt;
    runtime.nextRunAt = computeNextRun(runtime.normalized, now, runtime.def.jitterMs ?? 0);
    if (runtime.running) {
      getLogger().debug(
        `[cron] job "${runtime.def.name}" still running from the previous tick — skipped (overlap guard)`,
      );
      observeBackground(incrementSkipStat(runtime.def.name), `job "${runtime.def.name}" skip stat`);
      continue;
    }
    //? Fire-and-forget: awaiting here would let one slow job delay every other
    //? due job this tick. The terminal observer is the defensive backstop for
    //? any future/injected dependency that violates runJob's no-reject contract.
    observeBackground(runJob(runtime, scheduledFor), `job "${runtime.def.name}" run`);
  }
};

//? (Re)arm both loops at the CURRENT config periods. A no-op when the periods
//? did not change, so re-registering an identical config keeps the loop phase.
const armLoops = (): void => {
  const { renewIntervalMs, tickIntervalMs } = getCronConfig();
  if (state.leaderLoopMs !== renewIntervalMs) {
    if (state.leaderLoop) clearInterval(state.leaderLoop);
    state.leaderLoop = setInterval(() => {
      observeBackground(leaderTick(), 'leader tick');
    }, renewIntervalMs);
    state.leaderLoop.unref();
    state.leaderLoopMs = renewIntervalMs;
  }
  if (state.tickLoopMs !== tickIntervalMs) {
    if (state.tickLoop) clearInterval(state.tickLoop);
    state.tickLoop = setInterval(schedulerTick, tickIntervalMs);
    state.tickLoop.unref();
    state.tickLoopMs = tickIntervalMs;
  }
};

//? A `registerCronConfig` after the first job registered (overlay load order)
//? must reach the running loops; otherwise a shorter `leaseTtlMs` keeps the old
//? renew period and the lease expires between renewals (leadership flaps).
setCronConfigChangeListener(() => {
  if (state.started) armLoops();
});

/**
 * Start the leader + tick loops (idempotent). Called lazily by
 * `registerCronJob`; both loops are `unref()`d so an otherwise-finished
 * process never hangs on them, and both re-read `cronConfig.enabled` every
 * pass so the master switch works regardless of registration order. A later
 * `registerCronConfig` re-arms them at the new periods.
 */
export const ensureCronSchedulerStarted = (): void => {
  if (state.started) return;
  state.started = true;
  registerCronTeardown();
  armLoops();
  observeBackground(leaderTick(), 'initial leader tick');
};

/**
 * Stop the loops and release the leader lease (best-effort). Registered job
 * definitions survive a stop/start cycle; an in-flight handler is not
 * interrupted (its per-run lease expires on its own if the process exits).
 */
export const stopCronScheduler = async (): Promise<void> => {
  if (state.leaderLoop) clearInterval(state.leaderLoop);
  if (state.tickLoop) clearInterval(state.tickLoop);
  state.leaderLoop = null;
  state.tickLoop = null;
  state.leaderLoopMs = null;
  state.tickLoopMs = null;
  state.started = false;
  if (state.leaderToken) {
    const token = state.leaderToken;
    state.leaderToken = null;
    await releaseLease(getCronConfig().leaseName, token);
  }
};

/** Test-only — drop every scheduler state flag without touching Redis. */
export const resetCronSchedulerForTests = (): void => {
  if (state.leaderLoop) clearInterval(state.leaderLoop);
  if (state.tickLoop) clearInterval(state.tickLoop);
  state.leaderLoop = null;
  state.tickLoop = null;
  state.leaderLoopMs = null;
  state.tickLoopMs = null;
  state.started = false;
  state.leaderToken = null;
  state.leaderTickInFlight = false;
  state.teardownRegistered = false;
};

/**
 * Fire a job immediately, bypassing schedule AND leadership (the per-run
 * lease still applies, so a concurrent scheduled run is not doubled). Returns
 * the run's error, or null on success/skip. Meant for ops tooling and tests.
 */
export const runCronJobNow = async (name: string): Promise<Error | null> => {
  const runtime = jobRuntimes.get(name);
  if (!runtime) {
    throw new Error(`[cron] runCronJobNow: no job registered under "${name}"`);
  }
  return runJob(runtime, Date.now());
};
