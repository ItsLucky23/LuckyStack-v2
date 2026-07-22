# @luckystack/cron

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

Leader-elected, Redis-backed cron scheduler for LuckyStack. Declarative recurring jobs (`registerCronJob`) driven by cron expressions (croner — DST/timezone-correct) or plain intervals, guaranteed to fire on **exactly one instance** in a multi-instance deployment via core's Redis lease primitive (`acquireLease`/`renewLease` — no second election mechanism). Ships overlap guards, per-run dedup leases, optional jitter, per-tenant fan-out, run stats in Redis, and `preCronRun`/`postCronRun` hooks. The scheduler starts lazily on the first job registration and tears down via the core `preServerStop` hook. Every intentional background promise has a terminal observer; unexpected injected infrastructure rejections are logged and cannot leave the leadership/running latches wedged.

## When to USE this package

- Recurring background work that must run once per cluster, not once per instance: cleanup sweeps, scheduled publishing, periodic ingest, reaper jobs, housekeeping.
- Replacing ad-hoc `setInterval` loops that double-fire when a second instance starts.
- Multi-tenant apps where a job must iterate every tenant (`perTenant` fan-out; wrap your own `runInTenant` inside the handler).
- You want job observability (`getCronJobStats`) without wiring a queue system.

## When to NOT suggest this (yet)

- Task queues with retries, backoff, priorities, or fan-in — that is bullmq/agenda territory; this package schedules, it does not queue.
- Sub-second or high-frequency scheduling — the tick resolution is 1s and intervals have a 1000ms floor.
- Jobs that must NEVER double-fire: the lease is single-Redis best-effort (see core `lease.ts`) — a leader stalling past the TTL can hand over mid-run. Handlers must be idempotent.
- One-shot delayed work ("run this once in 5 minutes") — use a `setTimeout` or a DB-polled job row; cron is for recurring schedules.

## Function Index

| Function / Export | 1-line | Deep doc |
| --- | --- | --- |
| `registerCronJob(def): () => void` | Register (or replace) a recurring job; validates name/schedule eagerly, lazily starts the scheduler, returns an unregister fn. | -> docs/scheduler.md |
| `unregisterCronJob(name): boolean` | Remove a job by name. | -> docs/scheduler.md |
| `getCronJobNames(): string[]` | List registered job names in registration order. | -> docs/scheduler.md |
| `runCronJobNow(name): Promise<Error \| null>` | Fire a job immediately, bypassing schedule + leadership (per-run lease still applies). Ops/test helper. | -> docs/scheduler.md |
| `getCronJobStats(name): Promise<CronJobStats \| null>` | Read a job's Redis-backed run stats (last run/duration/status/error + run/fail/skip counters) from any instance. | -> docs/scheduler.md |
| `registerCronConfig(input): void` | Override scheduler knobs (enabled, timezone, lease timings, tick interval). | -> docs/scheduler.md |
| `getCronConfig(): CronConfig` | Read the merged active config (lazy, call-time). | -> docs/scheduler.md |
| `DEFAULT_CRON_CONFIG: CronConfig` | Defaults: enabled, UTC, lease TTL 30s / renew 10s, tick 1s, run-lease 60s. | -> docs/scheduler.md |
| `ensureCronSchedulerStarted(): void` | Idempotent manual start (normally implicit via `registerCronJob`). | -> docs/scheduler.md |
| `stopCronScheduler(): Promise<void>` | Stop the loops + release the leader lease (auto-wired to `preServerStop`). | -> docs/scheduler.md |
| `isCronLeader(): boolean` | Diagnostic — does THIS instance currently hold the scheduler lease? | -> docs/scheduler.md |
| `registerCronTeardown(): void` | Idempotent `preServerStop` teardown registration (called by `./register`). | -> docs/scheduler.md |
| `resetCronSchedulerForTests()` / `clearCronJobsForTests()` / `resetCronConfigForTests()` | Test-only state resets. | -> docs/scheduler.md |
| Type: `CronJobDefinition<TTenant>` | `{ name, schedule, handler, timezone?, jitterMs?, runOnStart?, perTenant?, runLeaseTtlMs? }`. | -> docs/scheduler.md |
| Type: `CronJobContext<TTenant>` | Handler arg: `{ jobName, scheduledFor, tenant? }`. | -> docs/scheduler.md |
| Type: `CronScheduleInput` | `string` (croner 5/6-field expression) or `{ everyMs: number }` (min 1000). | -> docs/scheduler.md |
| Type: `CronJobStats` | The stats shape returned by `getCronJobStats`. | -> docs/scheduler.md |
| Hook: `preCronRun` (`PreCronRunPayload`) | Before every run — VETO seam (return a stop signal to skip: maintenance windows). | -> docs/scheduler.md |
| Hook: `postCronRun` (`PostCronRunPayload`) | After every run with `durationMs` + `error` (null on success). | -> docs/scheduler.md |

## Config keys

All via `registerCronConfig(...)` (typically from a `luckystack/cron/*.ts` overlay file):

- `enabled` (default `true`) — master switch; `false` = no lease competition, no job fires (registrations still recorded). Read at every pass, so order-independent.
- `timezone` (default `'UTC'`) — default IANA timezone for cron expressions (per-job `timezone` overrides).
- `leaseName` (default `'cron-scheduler'`) — leader-lease name (`<project>:lease:<leaseName>` via `formatKey`).
- `leaseTtlMs` / `renewIntervalMs` (defaults `30_000` / `10_000`) — leader lease TTL + renew/acquire cadence.
- `tickIntervalMs` (default `1000`) — due-job check cadence.
- `runLeaseTtlMs` (default `60_000`) — per-run dedup lease TTL (renewed while the handler runs; per-job `runLeaseTtlMs` overrides).

Redis keys: leader lease `<project>:lease:cron-scheduler`, per-run lease `<project>:lease:cron-run:<job>`, stats hash `<project>:cron:job:<job>` — all through core's `formatKey`, so a registered multi-tenant key formatter applies automatically.

## Consumer quickstart

```ts
// luckystack/cron/jobs.ts — auto-imported at boot by bootstrapLuckyStack
import { registerCronJob } from '@luckystack/cron';

registerCronJob({
  name: 'nightly-cleanup',
  schedule: '0 3 * * *',          // or { everyMs: 300_000 }
  jitterMs: 30_000,
  handler: async ({ jobName, scheduledFor }) => {
    // idempotent work here — rare double-fire is possible (best-effort lease)
  },
});
```

Semantics to know: no catch-up (ticks missed while no leader was alive are skipped; schedules recompute from "now" on leadership gain); overlapping ticks are skipped (in-process guard + per-run lease); `runOnStart` fires at most once per registration/process and also arms immediately when a job is registered after this process already became leader; interval schedules anchor on "previous fire + everyMs".

## Peer dependencies

- **Required runtime dep**: `@luckystack/core` (lease, redis proxy, formatKey, hooks, tryCatch, logger, deepMerge).
- **Bundled dep**: `croner` (zero-dependency cron-expression parser; used only as a next-occurrence calculator).
- Redis must be configured (it is a hard peer of core) — the scheduler is inert without it (lease acquisition fails safe → no leadership, no runs).
- Auto-wired by `@luckystack/server` (`OPTIONAL_PACKAGES` + the `luckystack/cron/` overlay slot); no wiring needed beyond `npm i @luckystack/cron`.

## Related

- Architecture: `/docs/ARCHITECTURE_EXTENSION_POINTS.md` (Scheduled jobs section), `/docs/ARCHITECTURE_MULTI_INSTANCE.md` (why leader election), ADR 0022 (why this package exists despite the earlier "no cron" decision).
- Core primitives: `@luckystack/core` `lease.ts` (the election primitive + its best-effort contract), `hooks` (`preServerStop`).
- README (consumer quickstart): `./README.md`
