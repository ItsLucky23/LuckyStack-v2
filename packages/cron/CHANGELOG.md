# Changelog

All notable changes to `@luckystack/cron` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the
monorepo's lockstep versioning.

## [0.11.0] - 2026-10-14

### Changed

- Type declarations are emitted per source file by TypeScript 7 (`tsc -b`) instead of one bundled `.d.ts` per entry, so the framework build no longer runs package by package. The exported types are unchanged; relative imports inside the declarations carry `.js`, so `moduleResolution: "node16"`/`"nodenext"` projects resolve them as before. `@luckystack/cron/register` no longer exports two internal payload interfaces under the bundler's placeholder names `P` and `a`.
- Package design guidance now ships as `AGENTS.md`, not `CLAUDE.md`. Handwritten docs focus on rationale and safety; exact API contracts remain in installed declarations/source.

## [0.8.4] - 2026-08-17

### Changed

- Clarified that Redis leader and per-run leases provide best-effort single-leader scheduling, not an exactly-once guarantee: a stalled process can outlive its lease, so every cron handler must remain idempotent.
- Documented `npx luckystack add cron` as the preferred consumer install path; direct package installation remains supported.

## [0.7.4] - 2026-07-22

### Fixed

- Every intentional background promise now has a terminal observer, the leader
  in-flight latch resets in `finally`, and per-run timer/running state is cleaned
  even when an injected lease/infrastructure primitive rejects. Background
  failures are logged instead of becoming unhandled rejections or wedging later
  scheduler ticks.
- A `runOnStart` job registered after this process already acquired leadership
  now runs on the next tick instead of waiting for leadership to be lost and
  reacquired.

## [0.5.0] - 2026-07-11

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
