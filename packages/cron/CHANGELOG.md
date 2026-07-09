# Changelog

All notable changes to `@luckystack/cron` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the
monorepo's lockstep versioning.

## [0.4.1] - 2026-07-09

### Added

- Initial release: leader-elected, Redis-backed cron scheduler.
- `registerCronJob({ name, schedule, handler, ... })` — declarative recurring
  jobs with cron expressions (croner, DST/timezone-correct) or `{ everyMs }`
  intervals; eager validation; returns an unregister function.
- Leader election on core's `acquireLease`/`renewLease` — jobs fire on exactly
  one instance; takeover within one lease TTL of a leader dying.
- Per-run leases for cross-instance dedup, in-process overlap guard, optional
  per-job jitter, `runOnStart`, and per-tenant fan-out (`perTenant`).
- `preCronRun` (veto seam) + `postCronRun` hooks on the core hook bus.
- Redis-backed run stats (`getCronJobStats`) — last run, duration, outcome,
  run/fail/skip counters, readable from any instance.
- `./register` side-effect entry: auto-wired by `bootstrapLuckyStack`;
  teardown via the core `preServerStop` hook.
