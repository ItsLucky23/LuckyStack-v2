# Scheduler design

A single Redis lease elects a scheduling leader so replicas normally do not fire the same recurring job. A separate run lease reduces overlap when leadership changes; neither is a distributed exactly-once guarantee. A process can stall beyond a lease and resume after a new leader starts work, so **every handler must be idempotent**. See the scheduler and core lease implementation for timing and keys rather than duplicating defaults here.

Missed runs are intentionally not replayed on recovery. This avoids an outage causing a sudden burst of stale work; choose a durable queue if every task must execute. Cron-expression timing is delegated to a parser with timezone/DST support instead of hand-rolled calendar calculations. Jitter exists to avoid synchronized jobs overloading shared infrastructure.

Redis failure can mean no leader and therefore no jobs; monitor outcomes. A hung handler can keep its overlap guard and run lease active, so investigate the handler rather than assuming a later tick will repair it. Per-tenant failures should not silently count as successful delivery to every tenant. Keep test resets out of production paths.
