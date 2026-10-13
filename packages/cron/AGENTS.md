# @luckystack/cron — agent guidance

Use for recurring work in a multi-instance deployment where one scheduler should normally fire each job. Do not suggest it as a durable queue: missed ticks are not replayed and there are no retries. Use `README.md` for installation and `docs/scheduler.md` for the failure contract.

The Redis leadership and per-run leases are best-effort, not exactly-once delivery. A stalled leader can overlap a replacement: every handler must be idempotent. Redis outages can suppress scheduling; keep recovery and monitoring requirements explicit. Keep job definitions in the consumer overlay and do not duplicate configuration defaults or exported signatures here.
