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
//? - No catch-up: ticks missed while no leader was alive are skipped; on
//?   gaining leadership every schedule is recomputed from "now".

import {
  acquireLease,
  dispatchHook,
  getLogger,
  registerHook,
  releaseLease,
  renewLease,
  tryCatch,
} from '@luckystack/core';
import { getCronConfig } from './cronConfig';
import { computeNextRun } from './schedule';
import { incrementSkipStat, writeRunStats } from './stats';
import { jobRuntimes, type JobRuntime } from './state';
import type { CronJobContext, CronJobDefinition } from './types';

interface SchedulerState {
  started: boolean;
  leaderToken: string | null;
  leaderLoop: ReturnType<typeof setInterval> | null;
  tickLoop: ReturnType<typeof setInterval> | null;
  leaderTickInFlight: boolean;
  teardownRegistered: boolean;
}

const state: SchedulerState = {
  started: false,
  leaderToken: null,
  leaderLoop: null,
  tickLoop: null,
  leaderTickInFlight: false,
  teardownRegistered: false,
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

//? On gaining leadership: recompute every schedule from "now" (no catch-up)
//? and arm not-yet-fired `runOnStart` jobs to fire on the next tick.
const onLeadershipGained = (): void => {
  const now = Date.now();
  for (const runtime of jobRuntimes.values()) {
    runtime.nextRunAt =
      runtime.def.runOnStart && !runtime.ranOnStart
        ? now
        : computeNextRun(runtime.normalized, now, runtime.def.jitterMs ?? 0);
  }
};

const leaderTick = async (): Promise<void> => {
  if (state.leaderTickInFlight) return;
  state.leaderTickInFlight = true;
  const config = getCronConfig();
  if (!config.enabled) {
    if (state.leaderToken) {
      await releaseLease(config.leaseName, state.leaderToken);
      state.leaderToken = null;
    }
    state.leaderTickInFlight = false;
    return;
  }
  if (state.leaderToken) {
    const renewed = await renewLease(config.leaseName, state.leaderToken, config.leaseTtlMs);
    if (!renewed) {
      state.leaderToken = null;
      getLogger().warn('[cron] lost scheduler leadership — another instance will take over');
    }
    state.leaderTickInFlight = false;
    return;
  }
  const token = await acquireLease(config.leaseName, config.leaseTtlMs);
  if (token) {
    state.leaderToken = token;
    getLogger().info('[cron] acquired scheduler leadership on this instance');
    onLeadershipGained();
  }
  state.leaderTickInFlight = false;
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
//? (tryCatch, optional tenant fan-out) → stats + postCronRun. Never throws.
const runJob = async (runtime: JobRuntime, scheduledFor: number): Promise<Error | null> => {
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
    void renewLease(runLeaseName, runToken, runLeaseTtlMs);
  }, Math.max(1000, Math.floor(runLeaseTtlMs / 3)));
  renewTimer.unref();

  const startedAt = Date.now();
  let runError: Error | null;
  if (def.perTenant) {
    runError = await runPerTenant(def, def.perTenant, scheduledFor);
  } else {
    const [error] = await tryCatch(async () => def.handler({ jobName: def.name, scheduledFor }));
    runError = error;
  }
  const durationMs = Date.now() - startedAt;

  clearInterval(renewTimer);
  runtime.running = false;
  await releaseLease(runLeaseName, runToken);
  await writeRunStats(def.name, { lastRunAt: startedAt, durationMs, error: runError });
  await dispatchHook('postCronRun', { jobName: def.name, scheduledFor, durationMs, error: runError });

  if (runError) {
    logger.error(`[cron] job "${def.name}" failed`, runError, { durationMs });
  } else {
    logger.debug(`[cron] job "${def.name}" completed in ${durationMs}ms`);
  }
  return runError;
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
      void incrementSkipStat(runtime.def.name);
      continue;
    }
    //? Fire-and-forget: runJob handles every error path itself, and awaiting
    //? here would let one slow job delay every other due job this tick.
    void runJob(runtime, scheduledFor);
  }
};

/**
 * Start the leader + tick loops (idempotent). Called lazily by
 * `registerCronJob`; both loops are `unref()`d so an otherwise-finished
 * process never hangs on them, and both re-read `cronConfig.enabled` every
 * pass so the master switch works regardless of registration order.
 */
export const ensureCronSchedulerStarted = (): void => {
  if (state.started) return;
  state.started = true;
  registerCronTeardown();
  const config = getCronConfig();
  state.leaderLoop = setInterval(() => {
    void leaderTick();
  }, config.renewIntervalMs);
  state.leaderLoop.unref();
  state.tickLoop = setInterval(schedulerTick, config.tickIntervalMs);
  state.tickLoop.unref();
  void leaderTick();
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
