# Redis Adapter

> Deep specs for the Redis client proxy, connection options helper, and the Socket.io cross-instance adapter. Source: `packages/core/src/redis.ts`, `socketRedisAdapter.ts`. Bijgewerkt: 2026-05-20.

## Overview

Core ships a single Redis client that the entire framework shares for session storage, rate limiting, OAuth state, password-reset tokens, boot UUIDs, and the Socket.io pub/sub adapter. The `redis` export is a `Proxy` that defers resolution to call time so a consumer can `registerRedisClient(customClient)` after this module is imported and still win.

`attachSocketRedisAdapter(io)` wires `@socket.io/redis-adapter` with two duplicated pub/sub connections so room broadcasts span multiple Node processes — without it, `io.to(room).emit(...)` only reaches clients connected to the same instance.

`getRedisConnectionOptions()` exposes the same `{ host, port, username?, password? }` shape that the framework's default ioredis client uses. `@luckystack/router` reuses it for short-lived cross-env probes so a config rename never drifts between writer and reader.

## API Reference

### `redis: RedisClient` (proxy)

**Signature:**
```typescript
export const redis: RedisClient
export default redis
```

**Behavior:**
- Every method/property access is forwarded to whatever `getRedisClient()` currently returns.
- When the consumer has called `registerRedisClient(...)`, that client wins.
- Otherwise the proxy lazily constructs a default ioredis instance from `env.REDIS_HOST` / `env.REDIS_PORT` (plus optional `REDIS_USER` / `REDIS_PASSWORD`) on first access.
- The default client installs a `connect` listener that logs `"Connected to Redis"` via `getLogger().info` and an `error` listener that routes to `getLogger().error`.
- The default client uses an exponential `retryStrategy(times => Math.min(times * 50, 2000))`.

**Edge cases:**
- Method results are auto-bound to the underlying client to keep `this` correct for chained calls (`redis.multi().get(...).exec()` works).
- The `has` trap checks against the live client so `'eval' in redis` reports whatever the registered client supports.

**Example:**
```typescript
import { redis } from '@luckystack/core';

await redis.set(`${prefix}:foo`, 'bar', 'EX', 60);
const value = await redis.get(`${prefix}:foo`);
```

### `getRedisConnectionOptions(): RedisConnectionOptions`

**Signature:**
```typescript
export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export const getRedisConnectionOptions = (): RedisConnectionOptions
```

**Behavior:**
- Reads `env.REDIS_HOST` and parses `env.REDIS_PORT` to a number.
- Includes `username` only when `process.env.REDIS_USER` is non-empty.
- Includes `password` only when `process.env.REDIS_PASSWORD` is non-empty.
- Read at call time so dotenv timing doesn't capture stale values.

**Example:**
```typescript
import Redis from 'ioredis';
import { getRedisConnectionOptions } from '@luckystack/core';

// router-side: open a short-lived probe with the same params
const probe = new Redis({ ...getRedisConnectionOptions(), lazyConnect: true });
```

### `attachSocketRedisAdapter(io: SocketIOServer): void`

**Signature:**
```typescript
export const attachSocketRedisAdapter = (io: SocketIOServer): void
```

**Behavior (in order):**
1. Calls `redis.duplicate()` twice to obtain dedicated pub + sub clients (ioredis blocks non-pub/sub commands on a connection in subscribe mode, so duplicating is required).
2. Installs `error` listeners on both clients that log to `console.error` with the `[socket-redis-adapter]` prefix.
3. Calls `io.adapter(createAdapter(pubClient, subClient))` to wire `@socket.io/redis-adapter`.

**Edge cases:**
- Calling this after `io` has already accepted connections is allowed but races with in-flight broadcasts — wire it before `io.listen` / connection handlers in the boot sequence.
- The duplicated clients inherit the active registered client (or the default).

**Example:**
```typescript
import { Server } from 'socket.io';
import { attachSocketRedisAdapter, setIoInstance } from '@luckystack/core';

const io = new Server(httpServer, { /* ... */ });
attachSocketRedisAdapter(io);
setIoInstance(io);
```

## Config keys consumed

| Env var | Default | Purpose |
|---|---|---|
| `REDIS_HOST` | `'127.0.0.1'` | Default client + `getRedisConnectionOptions`. |
| `REDIS_PORT` | `'6379'` | Same. |
| `REDIS_USER` | (unset) | Optional ioredis auth. |
| `REDIS_PASSWORD` | (unset) | Optional ioredis auth. |

## Related

- Function INDEX: `packages/core/CLAUDE.md`
- Architecture: `docs/ARCHITECTURE_SOCKET.md`, `docs/HOSTING.md`
- README: `packages/core/README.md`
- Source: `packages/core/src/redis.ts`, `socketRedisAdapter.ts`, `clients.ts`
