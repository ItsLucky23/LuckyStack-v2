# Boot-UUID TTL lifecycle review — 2026-07-22

> Validation of an externally reported production-readiness finding. Supersedes: —

Last updated: 2026-07-22

## Status ledger

| ID | Finding | Severity | Status | Found | Resolved | Evidence / resolution |
|---|---|---:|---|---|---|---|
| BU-01 | The Redis boot UUID had a default one-hour TTL but was written only once during server construction. `/readyz` requires that key, so a healthy long-running backend became `503 not-ready` after the TTL elapsed. | **HIGH** | **fixed** | 2026-07-22 | 2026-07-22 | `@luckystack/core` now renews the existing environment UUID every TTL/3 without rotating it, recreates it after Redis recovery, serializes refreshes, logs/retries failures and exposes an idempotent stop handle. `@luckystack/server` starts the heartbeat only after HTTP listen succeeds and cancels it before shutdown. Regression tests cover renewal, recovery, no-overlap, retry and stop. |

## Evidence

- `packages/core/src/bootUuid.ts` wrote `SET luckystack:boot:<env> <uuid> EX 3600`.
- `packages/server/src/createServer.ts` called that write once and had no timer.
- `packages/server/src/httpRoutes/healthRoutes.ts` includes `Boolean(readBootUuid())`
  in readiness and returns 503 when the key is absent.
- The previous router documentation said a long-running process kept the key
  alive, but documented and implemented only a startup write.

## Resolution notes

The heartbeat extends the TTL with `EXPIRE`; it does not generate a new UUID on
every tick. This keeps router comparisons and `@bootUuid`-keyed health hashes
stable. The key is environment-level, so every healthy backend can renew the
same current value. Only a genuinely missing key is recreated.
