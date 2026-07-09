# @luckystack/cron

Leader-elected, Redis-backed cron scheduler for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). Declarative recurring jobs that run on **exactly one instance** of a multi-instance deployment — no double-firing `setInterval`s, no hand-rolled locks.

## Install

```bash
npm i @luckystack/cron
```

That's it — `bootstrapLuckyStack` auto-detects the package at boot. Register jobs from a `luckystack/cron/*.ts` overlay file (auto-imported):

```ts
// luckystack/cron/jobs.ts
import { registerCronJob } from '@luckystack/cron';

registerCronJob({
  name: 'nightly-cleanup',
  schedule: '0 3 * * *', // croner syntax; or { everyMs: 300_000 }
  handler: async ({ jobName, scheduledFor }) => {
    // your idempotent work here
  },
});
```

## Features

- **Leader-aware** — built on `@luckystack/core`'s Redis lease primitive; one instance holds the scheduler lease and fires jobs, the rest take over within one lease TTL if it dies.
- **Cron expressions or intervals** — 5/6-field cron via [croner](https://github.com/hexagon/croner) (DST + IANA timezones), or `{ everyMs }`.
- **Overlap guard + per-run dedup lease** — a slow run skips its next tick instead of stacking; a leader switch mid-run skips instead of double-firing.
- **Per-tenant fan-out** — `perTenant: { tenants: () => [...], concurrency? }` invokes the handler once per tenant with failures isolated.
- **Jitter + runOnStart** — smooth thundering herds; warm up once on leadership gain.
- **Observability** — `getCronJobStats(name)` reads last run / duration / outcome / counters from Redis, from any instance; `preCronRun` (veto) + `postCronRun` hooks.

## Semantics (read this)

- **Jobs must be idempotent.** The lease is single-Redis best-effort (not Redlock): a leader stalling past the TTL can hand over mid-run — a rare double-fire is possible.
- **No catch-up.** Ticks missed while no leader was alive are skipped; schedules recompute from "now" when leadership is gained.
- **Not a queue.** No retries, priorities, or backoff — for that, use bullmq on the same Redis.

## Configuration

```ts
// luckystack/cron/config.ts
import { registerCronConfig } from '@luckystack/cron';

registerCronConfig({
  enabled: process.env.CRON_ENABLED !== 'false',
  timezone: 'Europe/Amsterdam',
  leaseTtlMs: 30_000,
  renewIntervalMs: 10_000,
});
```

See `CLAUDE.md` (function index) and `docs/scheduler.md` (deep dive) in this package for the full surface.

## License

MIT
