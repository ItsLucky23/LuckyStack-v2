# Rate Limit Strategy

> Deep specs for the pluggable rate-limit dispatcher and built-in memory/Redis strategy. Source: `packages/core/src/rateLimiter.ts`. Bijgewerkt: 2026-05-20.

## Overview

Rate limiting in LuckyStack is a thin dispatcher backed by a swappable strategy. Framework code calls `checkRateLimit({ key, limit, windowMs })`; the active `RateLimitStrategy` decides how to count. The default strategy implements in-memory counters with optional Redis backing for multi-instance deployments and silently degrades to memory mode on Redis failure (with a one-shot warn log).

Consumers can plug in their own backend (token-bucket, sliding-window, per-user tier limits, Cloudflare KV, no-op) by implementing the four `RateLimitStrategy` methods and calling `registerRateLimitStrategy(strategy)` at boot.

The dispatcher also runs an internal cleanup timer that drops expired in-memory entries every `rateLimiting.cleanupIntervalMs`. The timer is `unref`'d so it never holds the process open.

## Types

```typescript
export interface CheckRateLimitParams {
  key: string;
  limit: number;
  windowMs?: number; // default 60_000
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // seconds until reset
}

export interface RateLimitStrategy {
  name: string;
  check(params: CheckRateLimitParams): Promise<RateLimitResult>;
  getStatus(key: string, limit: number): Promise<RateLimitResult>;
  clear(key: string): Promise<void>;
  clearAll(): Promise<void>;
}
```

## API Reference — Dispatcher

### `checkRateLimit(params: CheckRateLimitParams): Promise<RateLimitResult>`

**Behavior:** Delegates to `getRateLimitStrategy().check(params)`. Increments the counter as a side effect when allowed.

**Example:**
```typescript
import { checkRateLimit } from '@luckystack/core';

const { allowed, remaining, resetIn } = await checkRateLimit({
  key: `user:${userId}:api:getData`,
  limit: 60,
});

if (!allowed) {
  return { status: 'error', errorCode: 'rateLimit.exceeded', httpStatus: 429 };
}
```

### `getRateLimitStatus(key, limit): Promise<RateLimitResult>`

**Behavior:** Read-only — does NOT increment. Useful for `X-RateLimit-Remaining` response headers.

### `clearRateLimit(key): Promise<void>`

Resets a single key. Useful for admin overrides or post-test cleanup.

### `clearAllRateLimits(): Promise<void>`

Wipes every key under the active strategy's namespace. Useful for tests / server restart.

### `registerRateLimitStrategy(strategy: RateLimitStrategy): void`

**Behavior:**
- Replaces the active strategy (last-write-wins).
- Logs `[RateLimiter] active strategy → <name>` at debug level.
- Common use cases: token-bucket, sliding-window, per-tier user limits, edge-KV, no-op (tests).

### `getRateLimitStrategy(): RateLimitStrategy`

Returns the currently active strategy. Defaults to `defaultRateLimitStrategy`.

## API Reference — Built-in Default Strategy

### `defaultRateLimitStrategy: RateLimitStrategy`

`name === 'default-memory-redis'`. Reads `projectConfig.rateLimiting.{enabled,store,redisKeyPrefix,windowMs}` at call time.

#### `check(params)` flow

1. If `rateLimiting.enabled === false` → returns `{ allowed: true, remaining: limit, resetIn: 0 }` without touching counters.
2. If `rateLimiting.store === 'redis'`:
   - Runs a Lua `INCR` + `PEXPIRE` script atomically against `<projectName>:<redisKeyPrefix>:<key>`.
   - Returns `{ allowed: count <= limit, remaining: max(0, limit - count), resetIn: ceil(ttl / 1000) }` when the script returns a valid pair.
   - On any Redis error, logs a one-shot warn `[RateLimiter] Redis mode unavailable, falling back to in-memory mode` and falls through to the memory path.
3. Memory path:
   - First request in the window → create entry, return `allowed: true, remaining: limit - 1`.
   - Subsequent requests → increment, return `{ allowed: count <= limit, remaining: max(0, limit - count), resetIn: ceil((resetAt - now) / 1000) }`.

#### `getStatus(key, limit)` flow

Same dual-path shape but does NOT increment. The Redis path uses `MULTI` (`GET` + `PTTL`) to read current count + remaining TTL.

#### `clear(key)` flow

- Redis mode: `DEL <prefix>:<key>` (wrapped in `tryCatch`).
- Always: deletes the in-memory entry as well.

#### `clearAll()` flow

- Redis mode: `SCAN` with `MATCH <prefix>:*`, `DEL` matched keys, repeat until cursor returns to `'0'`.
- Always: clears the in-memory map.

### Lua script (atomic increment)

```lua
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
```

### Cleanup timer

A self-rescheduling `setTimeout(unref)` deletes expired in-memory entries every `rateLimiting.cleanupIntervalMs`. Re-reads the config each tick so a late `registerProjectConfig` is picked up. Logs `[RateLimiter] Cleaned N expired entries` at debug level when any are removed.

## Edge cases

- Negative or non-finite `windowMs` is normalized to `projectConfig.rateLimiting.windowMs`.
- Concurrent strategy switches are allowed but the cleanup timer keeps running against the in-memory map regardless of the active strategy — fine because the map is only touched by the default strategy.
- The default Redis script + scan path swallow errors via `tryCatch`; a network blip degrades to memory mode instead of throwing.
- The disabled mode (`rateLimiting.enabled = false`) still calls `getStatus` happily — useful for showing meaningful headers in dev.

## Hooks dispatched

Rate limiting itself does not dispatch hooks from core. The api/sync packages dispatch `rateLimitExceeded` when their handlers translate a `RateLimitResult` rejection into the response envelope.

## Config keys consumed

| Key | Type | Default | Description |
|---|---|---|---|
| `rateLimiting.enabled` | `boolean` | `true` | Global kill-switch. |
| `rateLimiting.store` | `'memory' \| 'redis'` | `'memory'` | Backend. |
| `rateLimiting.redisKeyPrefix` | `string` | `'rate-limit'` | Prefixed with `<projectName>:`. |
| `rateLimiting.defaultApiLimit` | `number \| false` | `60` | Default per-route cap (consumed by api package). |
| `rateLimiting.defaultIpLimit` | `number \| false` | `100` | Default per-IP cap. |
| `rateLimiting.windowMs` | `number` | `60_000` | Sliding window. |
| `rateLimiting.cleanupIntervalMs` | `number` | `60_000` | Memory eviction cadence. |

## Example — register a no-op strategy for tests

```typescript
import { registerRateLimitStrategy, type RateLimitStrategy } from '@luckystack/core';

const noopStrategy: RateLimitStrategy = {
  name: 'noop',
  check: async ({ limit }) => ({ allowed: true, remaining: limit, resetIn: 0 }),
  getStatus: async (_key, limit) => ({ allowed: true, remaining: limit, resetIn: 0 }),
  clear: async () => undefined,
  clearAll: async () => undefined,
};

registerRateLimitStrategy(noopStrategy);
```

## Related

- Function INDEX: `packages/core/CLAUDE.md`
- Architecture: `docs/ARCHITECTURE_EXTENSION_POINTS.md`, `docs/ARCHITECTURE_API.md`
- README: `packages/core/README.md`
- Source: `packages/core/src/rateLimiter.ts`
