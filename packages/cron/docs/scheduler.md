# Scheduler deep dive

How `@luckystack/cron` composes core primitives into a leader-elected scheduler, and the exact semantics of a job's lifecycle.

## Architecture

```
registerCronJob(def) ──▶ registry (validates, computes nextRunAt) ──▶ ensureCronSchedulerStarted()
                                                                          │
                       ┌──────────────────────────────────────────────────┤
                       ▼                                                  ▼
              leader loop (renewIntervalMs)                    tick loop (tickIntervalMs)
              acquire/renew <project>:lease:cron-scheduler     leader only: fire due jobs
                                                                          │
                                                                          ▼
                                                     runJob: preCronRun veto → per-run lease
                                                     → handler (tryCatch, perTenant fan-out)
                                                     → stats + postCronRun
```

Both loops are `unref()`d `setInterval`s started lazily on the first registration — zero jobs = zero timers, and the process never hangs on them. Teardown runs via the core `preServerStop` hook (registered by `./register` at boot, or on first start).

## Leadership

- One lease (`cronConfig.leaseName`, default `cron-scheduler`) elects the scheduler instance; the holder runs **all** jobs. Followers retry `acquireLease` every `renewIntervalMs` and take over within one `leaseTtlMs` of a leader dying.
- Losing a renewal logs a warning and immediately demotes to follower — no job fires from this instance until re-acquisition.
- **Best-effort contract** (inherited from core `lease.ts`): single-Redis `SET NX PX`, not Redlock. An event-loop stall past the TTL hands leadership over while the old leader may still be mid-run. Two mitigations, one requirement:
  - mitigation 1: the per-run lease (below) makes the common double-fire case a skip;
  - mitigation 2: renew cadence (10s) sits well inside the TTL (30s);
  - requirement: **handlers must be idempotent** — a rare double-fire is possible by design.

## A job run, step by step

1. Tick finds `now >= nextRunAt`. `nextRunAt` is recomputed FIRST (so an overlap skip doesn't rapid-fire afterwards).
2. In-process overlap guard: still `running` from a previous tick → skip + `skipCount`.
3. `preCronRun` hook: a stop signal vetoes the run (maintenance windows).
4. Per-run lease `cron-run:<name>` (TTL `runLeaseTtlMs`, renewed at TTL/3 while running): held elsewhere → skip + `skipCount`. This is the cross-instance dedup on leader switches.
5. Handler runs inside `tryCatch` (errors auto-captured to the registered error tracker). `perTenant` jobs resolve `tenants()` fresh each run and invoke the handler per tenant (default sequential; `concurrency` for a bounded pool); per-tenant failures are isolated and the run's `error` is the first failure.
6. Release run lease → write stats hash → `postCronRun` hook → log outcome.

## Scheduling semantics

- **No catch-up**: ticks missed while no leader was alive are skipped. On leadership gain every schedule recomputes from "now" (and not-yet-fired `runOnStart` jobs arm immediately).
- **Intervals drift by design**: `{ everyMs }` anchors on "previous fire + everyMs" computed at fire time.
- **Cron expressions** are evaluated by croner with the job's `timezone` (default `cronConfig.timezone`) — DST transitions handled by Intl, which is exactly why this is a dependency and not hand-rolled.
- **Jitter** adds `0..jitterMs` to every computed fire time (thundering-herd smoothing across many deployments sharing infra).
- Tick resolution is `tickIntervalMs` (1s default); intervals have a 1000ms floor for the same reason.

## Redis footprint

| Key | Type | Purpose |
| --- | --- | --- |
| `<project>:lease:cron-scheduler` | string (PX TTL) | leader election |
| `<project>:lease:cron-run:<job>` | string (PX TTL) | per-run dedup |
| `<project>:cron:job:<job>` | hash | run stats (lastRunAt, lastDurationMs, lastStatus, lastError, runCount, failCount, skipCount) |

Everything routes through core's `formatKey` / `acquireLease`, so a registered multi-tenant Redis key formatter applies without cron knowing about it.

## Failure modes

| Failure | Behavior |
| --- | --- |
| Redis down | `acquireLease` fails safe (null) → no leadership anywhere → no runs; recovers on the next leader tick after Redis returns. |
| Handler throws | Captured by `tryCatch` (error tracker), logged, `failCount`+`lastError` recorded, `postCronRun` gets the error. The schedule continues. |
| Handler hangs forever | Its next ticks are skipped (overlap guard). The run lease keeps renewing, so other instances also skip. Fix the handler; there is no kill switch by design (see `enabled` for a manual stop). |
| Leader process killed mid-run | Run lease expires after `runLeaseTtlMs`; new leader elected within `leaseTtlMs`; job fires again at its next scheduled time. |
| Stats write fails | Swallowed (captured) — a Redis hiccup never fails the job itself. |

## Testing your jobs

`runCronJobNow(name)` fires a job immediately (bypasses schedule + leadership, keeps the per-run lease) and returns the run's error — usable from per-route tests or ops scripts. Test-only resets: `resetCronSchedulerForTests()`, `clearCronJobsForTests()`, `resetCronConfigForTests()`.
