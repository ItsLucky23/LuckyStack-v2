# @luckystack/cron

A Redis-backed leader-elected scheduler for recurring LuckyStack jobs in multi-instance deployments. Prefer `npx luckystack add cron` in a scaffolded project so its consumer overlay arrives with the dependency. See `docs/scheduler.md` for the design and the installed package's types for job registration.

## Safety contract

Handlers **must be idempotent**: the leadership and run leases are best-effort, so a stalled leader can overlap its successor. Ticks missed during an outage are not replayed. The scheduler is not a durable queue and does not offer retries; use a queue for work that must eventually execute. Monitor Redis availability and job outcomes before treating a schedule as a guarantee.
