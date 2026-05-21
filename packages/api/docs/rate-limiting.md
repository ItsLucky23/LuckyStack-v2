# Rate Limiting

> Last updated: 2026-05-20

## Overview

Every API request runs through two rate-limit buckets, in order. The per-route bucket protects an individual endpoint from a single caller; the global per-IP bucket protects the server as a whole from a single source hitting many endpoints. Both buckets use the same strategy backend (configurable via `registerRateLimitStrategy` in `@luckystack/core`; defaults to memory-or-redis depending on `rateLimiting.store`), share the same `windowMs`, and emit the same `rateLimitExceeded` hook on rejection.

Rate-limit logic is identical on both transports — `handleApiRequest` and `handleHttpApiRequest` apply the same buckets in the same order. The only transport-specific difference is where the IP comes from: the socket transport reads `socket.handshake.address`; the HTTP transport takes a `requesterIp` parameter (the HTTP listener in `@luckystack/server` derives it from `req.socket.remoteAddress` + optional forwarded-header parsing).

Rejection responds with `api.rateLimitExceeded` + HTTP `429`, and includes `errorParams: [{ key: 'seconds', value: resetIn }]` so consumers can render a localized "try again in N seconds" message. The hook payload exposes the full key, scope, and counts for dashboards / alerting.

## The two buckets

### 1. Per-route bucket

Keyed per-caller per-route. Drops requests that exceed `apiEntry.rateLimit` (per route) or `rateLimiting.defaultApiLimit` (fallback) within `windowMs`.

**Key format:**

| Caller | Key |
| --- | --- |
| Authenticated (`token` present) | `token:<token>:api:<resolvedName>` |
| Anonymous (no token) | `ip:<requesterIp>:api:<resolvedName>` |

The `<resolvedName>` is the normalized route name returned by `parseTransportRouteName` (e.g. `settings/updateUser/v1`). Using the token (not user ID) as the key ensures the bucket sticks to the session even if multiple sessions exist for the same user under `session.perUser === 'multiple'`.

**Per-route override:** a route file can declare its own limit (or disable it):

```ts
// src/settings/_api/updateUser_v1.ts
export const rateLimit: number | false = 30;   // 30 requests per window
// or:
export const rateLimit = false;                 // No per-route bucket
```

When `rateLimit === false` or `0`, the per-route bucket is skipped entirely — the global IP bucket still applies.

When `rateLimit === undefined` (the export is absent), the handler falls back to `rateLimiting.defaultApiLimit`. If that is also `false`, the per-route bucket is skipped.

### 2. Global per-IP bucket

Keyed only by IP, shared across every route. Drops requests from a single IP that exceed `rateLimiting.defaultIpLimit` in `windowMs`, regardless of which routes they hit.

**Key format:** `ip:<requesterIp>:api:all`

When `defaultIpLimit === false` or `0`, the global bucket is skipped entirely. Per-route limits still apply.

The global bucket runs **after** the per-route bucket — a route that has burned through its per-route allowance returns `api.rateLimitExceeded` without ever touching the global bucket, so the per-route violator does not also consume global capacity.

## Bucket evaluation order

Both transports execute exactly:

1. Compute `effectiveApiLimit = apiEntry.rateLimit ?? rateLimiting.defaultApiLimit`.
2. If `effectiveApiLimit !== false && effectiveApiLimit > 0`:
   - Build the per-route key.
   - `await checkRateLimit({ key, limit, windowMs })`.
   - On `!allowed`, dispatch `rateLimitExceeded` with `scope: token ? 'user' : 'route'`, respond `api.rateLimitExceeded` + `429`, abort.
3. Read `defaultIpLimit = rateLimiting.defaultIpLimit`.
4. If `defaultIpLimit !== false && defaultIpLimit > 0`:
   - Build the global IP key.
   - `await checkRateLimit(...)`.
   - On `!allowed`, dispatch `rateLimitExceeded` with `scope: 'ip'`, respond `api.rateLimitExceeded` + `429`, abort.

The rate-limit step sits between auth and validation. Auth runs first so unauthenticated probes can't burn through anonymous IP buckets enumerating routes. Validation runs after rate limit so a flood of malformed payloads from a single caller is throttled the same way as well-formed traffic.

## API Reference

### `applyApiRateLimits` (internal, socket transport)

**Signature** (paraphrased):

```ts
const applyApiRateLimits = async (params: {
  apiEntry: RuntimeApiEntry;
  resolvedName: string;
  token: string | null;
  socket: Socket;
  user: SessionLayout | null;
  emitApiError: EmitApiError;
}): Promise<boolean>;
```

| Param | Notes |
| --- | --- |
| `apiEntry` | Read `rateLimit` field. |
| `resolvedName` | Used to build the per-route key. |
| `token` | When non-null, drives `token:<token>:...` key + `scope: 'user'`. |
| `socket` | Read `socket.handshake.address` for the IP fallback. |
| `user` | Surfaced as `userId` in the `rateLimitExceeded` payload. |
| `emitApiError` | Closure that emits the localized error envelope on the response channel. |

**Returns**: `Promise<boolean>` — `true` if both buckets allowed the request, `false` if either rejected.

### Inline rate-limit block in `handleHttpApiRequest`

Same logic, inlined rather than extracted into a helper. Reads `requesterIp` (or `'anonymous'` for the per-route bucket key, `'unknown'` for the global bucket key) instead of `socket.handshake.address`.

### `checkRateLimit({ key, limit, windowMs })` (re-exported from `@luckystack/core`)

The underlying strategy call.

**Signature**:

```ts
async function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<{ allowed: boolean; resetIn: number; current: number }>;
```

**Behavior**:

- Delegates to the registered strategy (`registerRateLimitStrategy`). Default strategy uses Redis when `rateLimiting.store === 'redis'`, otherwise an in-memory token-bucket.
- `resetIn` is seconds until the window resets, used as the `seconds` error param.
- Backend implementation lives in `@luckystack/core/src/rateLimiter.ts`; see its docs for sliding-window semantics and the `redisKeyPrefix` config option.

## Hooks dispatched

| Hook | When | Payload (key fields) |
| --- | --- | --- |
| `rateLimitExceeded` | A bucket rejects | `scope: 'user' \| 'route' \| 'ip'`, `key: string`, `limit: number`, `windowMs: number`, `count: number` (always `limit + 1` here), `route?: string`, `userId?: string`, `ip?: string` |

The hook fires before the error response is emitted, so handlers that want to escalate (alerting, IP-banning) can act on the same request. Handlers run inside `void dispatchHook(...)` — they cannot block or alter the rejection.

`scope` distinguishes the three cases:

- `'user'` — per-route bucket rejected an authenticated caller (`token` was non-null).
- `'route'` — per-route bucket rejected an anonymous caller (no token; keyed by IP).
- `'ip'` — global per-IP bucket rejected.

## Error response

Both transports return the same envelope on rejection:

```jsonc
{
  "status": "error",
  "httpStatus": 429,
  "errorCode": "api.rateLimitExceeded",
  "errorParams": [{ "key": "seconds", "value": 42 }],
  "message": "Too many requests. Try again in 42 seconds."
  // message comes from the registered localized normalizer using errorCode + errorParams
}
```

`resetIn` reflects the strategy's view of when the bucket frees up. The localized normalizer renders the message via the consumer's translate function — see [`./error-handling.md`](./error-handling.md).

## Config keys

All read at request time via `getProjectConfig()`.

| Key | Type | Effect |
| --- | --- | --- |
| `rateLimiting.defaultApiLimit` | `number \| false` | Fallback per-route limit when the route does not export `rateLimit`. `false` disables. |
| `rateLimiting.defaultIpLimit` | `number \| false` | Global per-IP limit across all routes. `false` disables. |
| `rateLimiting.windowMs` | `number` | Window size for both buckets, in ms. Default 60000 (one minute). |
| `rateLimiting.store` | `'memory' \| 'redis'` | Backend for the default strategy. `'redis'` is required for multi-instance consistency. |
| `rateLimiting.redisKeyPrefix` | `string` | Prefix prepended to keys when using the Redis backend. |
| `rateLimiting.enabled` | `boolean` | Master switch on the default strategy. When `false`, every `checkRateLimit` call returns `{ allowed: true }`. |

## Disabling rate limiting

| Scope | How |
| --- | --- |
| One route, per-route bucket only | `export const rateLimit = false;` in the route file. |
| One route, both buckets | `export const rateLimit = false;` + run the consumer behind a load balancer that absorbs the IP bucket. There is no per-route opt-out for the global bucket. |
| Globally, per-route bucket | `rateLimiting.defaultApiLimit: false` in `registerProjectConfig`. |
| Globally, IP bucket | `rateLimiting.defaultIpLimit: false`. |
| Globally, everything | `rateLimiting.enabled: false` (default strategy honors this and short-circuits). |
| Replace backend | `registerRateLimitStrategy(myStrategy)` from `@luckystack/core` — useful for edge-KV-backed limits, per-tier quotas, or no-op test strategies. |

## Edge cases

- **Anonymous request with no IP** — the socket transport falls back to `'unknown'` for `socket.handshake.address`; the HTTP transport falls back to `'anonymous'` for the per-route bucket and `'unknown'` for the global bucket. All anonymous callers that lack an IP share the same bucket. Front your server with a load balancer that always supplies `X-Forwarded-For` (parsed by `@luckystack/server`'s request adapter) to avoid this collision.
- **Token present but session deleted** — the bucket is still keyed by the token string; subsequent requests with the same expired token still throttle. Once the session is fully GC'd from `getSession`, the auth gate rejects with `auth.required` before rate-limit checks run (auth runs first).
- **Race within `windowMs`** — `checkRateLimit` is atomic on the strategy backend (`INCR` + `EXPIRE` for Redis, lock-free counter for memory). Two requests arriving at the same millisecond both count toward the limit.
- **Per-route `rateLimit = 0`** — equivalent to `false` (bucket skipped). The handler explicitly guards on `effectiveApiLimit > 0`.
- **Custom strategy returns `allowed: false` with `resetIn: 0`** — the response still echoes `seconds: 0`. Renderers should treat `seconds <= 0` as "right now" / "very soon".

## Related

- API request lifecycle: [`./api-request-lifecycle.md`](./api-request-lifecycle.md)
- Error handling: [`./error-handling.md`](./error-handling.md)
- Rate-limit strategy: `@luckystack/core/docs/rate-limit-strategy.md`
- Architecture: [`/docs/ARCHITECTURE_API.md`](../../../docs/ARCHITECTURE_API.md) (see "Rate Limiting")
