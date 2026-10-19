---
name: interval-cron-jobs-resume-from-their-last-run
title: Interval cron jobs resume from their last run after a restart or leader change
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [cron, scheduler, multi-instance, redis, reliability]
supersedes: []
relates: [0022]
---

## Context

ADR 0022 chose no catch-up: ticks missed while no leader is alive are skipped.
The scheduler implemented that by computing every schedule from "now" when an
instance gained leadership. For cron expressions that is harmless, because
they have absolute fire times.

For interval jobs (`{ everyMs }`) "from now" meant `now + everyMs` on every
process start, deploy and leader change, and on every Redis lease blip. A
period longer than the usual time between deploys — a daily cleanup in a
project that deploys several times a day — never fired, and monitoring only
saw a job without stats. The job type already promised "previous fire +
everyMs", and the stats already stored the last run time. The owner chose to
resume intervals over documenting the reset (sweep finding 031).

## Decision

This amends ADR 0022 for interval jobs only. When a leader starts scheduling an
interval job, the next run counts from the job's anchor instead of from now:
the start of its most recent run, or, for a job that never ran, the first time
any leader scheduled it (stored once per job in Redis). An overdue job runs
once on the next tick and the following run counts from that fire; missed
periods are never replayed. Cron expressions keep the ADR 0022 behaviour. When
Redis cannot be read, the scheduler falls back to counting from now.

## Rejected alternatives

- **Document the reset and advise cron expressions for long intervals.** It
  keeps a silent "never runs" failure.
- **Full catch-up, replaying every missed period.** Rejected for the reason in
  ADR 0022: an outage would cause a burst of stale work.
- **Anchor on the last run only.** A job restarted more often than its period
  would never get its first run.
- **Store the first-scheduled anchor in the job's stats record.** The stats
  query would then return a record for a job that never ran, which breaks its
  contract.

## Consequences

- After a deploy, an overdue interval job runs straight away. Handlers must
  stay idempotent, which they already had to be.
- Each interval job that has not run yet keeps one small Redis key. It has no
  expiry, so a renamed or removed job leaves it behind.
- A leader change during a run can make the new leader see an older last run
  and try to run at once; the per-run lease turns that into a counted skip.
