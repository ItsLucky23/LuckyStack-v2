# Socket Bootstrap

> Deep specs for socket transport bootstrap, token extraction, CORS check, offline queue, CSRF, cookies, service-route helpers and event constants. Source: `packages/core/src/`. Bijgewerkt: 2026-05-20.

## Overview

This topic covers the wiring around the LuckyStack socket transport:

- **Server-side socket slot** — `setIoInstance` / `getIoInstance` so framework code can broadcast.
- **Client-side socket singleton** — live binding `socket`, `setSocket`, `waitForSocket`, `incrementResponseIndex`.
- **Token extraction** — pull the session token from a Socket.io handshake (`extractTokenFromSocket`) or a Node `IncomingMessage` (`extractTokenFromRequest`).
- **Origin check** — `allowedOrigin` for CORS-style allow-listing, with `corsRejected` hook fan-out.
- **Offline queue** — `enqueueApiRequest`, `enqueueSyncRequest`, flushers, and per-item `dropPolicy` overrides.
- **CSRF + httpFetch** — lazy `/auth/csrf` token cache + drop-in fetch wrapper.
- **Wire-protocol constants** — `socketEventNames` map + per-prefix event-name builders.
- **Route parsers** — `parseServiceRouteName`, `parseTransportRouteName`.
- **Cookie helpers** — `getCookieValue`, `hasCookie`.
- **HTTP helpers** — `inferHttpMethod`, `getEffectiveHttpMethod`, `isMethodAllowed`.

Token extraction respects `projectConfig.session.basedToken`: when `true` the framework prefers `socket.handshake.auth.token` / `Authorization: Bearer ...`, otherwise the configured session cookie wins (with the other transport as fallback).

## API Reference — IO Instance

### `setIoInstance(io: SocketIOServer | null): void`

**Signature:**
```typescript
export const setIoInstance = (io: SocketIOServer | null): void
```

**Behavior:** Stores the running Socket.io server in a module-level slot. Framework code (`@luckystack/sync`, presence package, etc.) reads via `getIoInstance()` for broadcast paths.

### `getIoInstance(): SocketIOServer | null`

Returns the registered instance or `null` when no server has been set. Callers must null-check.

## API Reference — Client Socket Singleton

### `socket: Socket | null`

A live `export let` binding — importers always see the current value after `setSocket(...)` replaces it.

### `setSocket(next: Socket | null): void`

Stores the project's socket.io-client instance. Called from `src/_sockets/socketInitializer.ts`.

### `incrementResponseIndex(): number`

**Returns:** The next monotonic response index (used to build per-request reply event names like `apiResponse-42`).

**Behavior:**
- Module-scoped counter, increments before returning so the first call returns `1`.
- Used by `apiRequest` / `syncRequest` clients to disambiguate concurrent requests on the same socket.

### `waitForSocket(): Promise<Socket | null>`

**Behavior:**
- Polls every 10 ms until `socket !== null` or 500 iterations elapse (~5 seconds).
- Returns the socket on success, `null` on timeout.

**Example:**
```typescript
import { waitForSocket } from '@luckystack/core/client';

const s = await waitForSocket();
if (!s) throw new Error('socket never connected');
```

## API Reference — Custom Socket Middlewares

The framework lets consumers wedge their own Socket.io `io.use(...)` middlewares into the bootstrap without forking `loadSocket.ts`. Registered middlewares run in registration order, before any `connect` handler — same contract as a direct `io.use(...)` call.

### `registerSocketMiddleware(mw: SocketMiddleware): void`

**Signature:**
```typescript
export type SocketMiddleware = (socket: Socket, next: (err?: Error) => void) => void;
export const registerSocketMiddleware = (mw: SocketMiddleware): void
```

**Behavior:** Appends the middleware to a module-level list. `@luckystack/server`'s `loadSocket` calls `applySocketMiddlewares(io)` after constructing the `SocketIOServer` and before attaching the `connect` handler, so every registered middleware runs on the handshake of every incoming socket.

**Example — license-key gate:**
```typescript
import { registerSocketMiddleware } from '@luckystack/core';

registerSocketMiddleware((socket, next) => {
  const licenseKey = socket.handshake.auth.licenseKey;
  if (typeof licenseKey !== 'string' || !isValidLicense(licenseKey)) {
    return next(new Error('invalid license'));
  }
  next();
});
```

**Example — observability tag (Datadog APM):**
```typescript
import { registerSocketMiddleware } from '@luckystack/core';
import tracer from 'dd-trace';

registerSocketMiddleware((socket, next) => {
  const span = tracer.scope().active();
  if (span) span.setTag('socket.id', socket.id);
  next();
});
```

### `getSocketMiddlewares(): readonly SocketMiddleware[]`

Read the registered list (frozen view). Useful for diagnostics.

### `clearSocketMiddlewares(): void`

Drops every registered middleware. Test/hot-reload helper.

### `applySocketMiddlewares(io: SocketIOServer): void`

Framework-internal — wires every registered middleware via `io.use(...)`. Called by `@luckystack/server`'s `loadSocket`; consumers should not call this directly.

## API Reference — Token Extraction

### `extractTokenFromSocket(socket: Socket): string | null`

**Signature:**
```typescript
export const extractTokenFromSocket = (socket: Socket): string | null
```

**Behavior:**
- Reads `socket.handshake.auth.token` (when it is a string) and the configured cookie (`projectConfig.http.sessionCookieName`) from `socket.handshake.headers.cookie`.
- When `session.basedToken === true`: returns the auth-token first, falls back to the cookie.
- When `session.basedToken === false`: returns the cookie first, falls back to the auth-token.

**Returns:** The token string or `null`.

### `extractTokenFromRequest(req: IncomingMessage): string | null`

**Signature:**
```typescript
export const extractTokenFromRequest = (req: IncomingMessage): string | null
```

**Behavior:**
- Reads `req.headers.authorization` and extracts the bearer (`'Bearer <token>'`).
- Reads the configured cookie from `req.headers.cookie`.
- Picks cookie-first vs bearer-first based on `session.basedToken`.

## API Reference — Origin Check

### `allowedOrigin(origin: string): boolean`

**Signature:**
```typescript
const allowedOrigin = (origin: string): boolean
export default allowedOrigin
```

**Behavior (in execution order):**
1. Normalizes the origin to `scheme://host[:port]`, strips default `:80` / `:443`, lowercases.
2. Computes the same-origin bind location from `getBindAddress()` and the `SECURE` env var.
3. When `cors.allowLocalhost` and the origin matches `/^https?:\/\/localhost(:\d+)?$/i` → returns `true`.
4. When `cors.allowedOrigins` is a function → calls it; if it returns true (or the origin equals the bind location) → returns `true`.
5. When `cors.allowedOrigins` is a string array → builds a normalized allowed set (bind location + configured list); returns `true` on match.
6. Otherwise: dispatches the `corsRejected` hook (with origin + normalized origin + allowedOrigins + allowLocalhost) and returns `false`. Also logs via `getLogger().warn` when `logging.devLogs` is on.

**Edge cases:**
- An empty `origin` is treated as not-allowed.
- The resolver-function form is sync only — async predicates are not supported because Socket.io's CORS check is sync.

## API Reference — Offline Queue

Per-queue items:
```typescript
interface QueueItem {
  id: string;
  key: string;
  run: (socketInstance: Socket) => void;
  createdAt: number;
  dropPolicy?: 'drop-oldest' | 'drop-newest' | 'reject';
}
```

### `isOnline(): boolean`
Returns `true` in non-browser environments. In browsers, reads `navigator.onLine`.

### `enqueueApiRequest(item): boolean` / `enqueueSyncRequest(item): boolean`

**Behavior:**
1. Evicts items older than `offlineQueue.maxAgeMs` from the relevant queue.
2. If `queue.length < offlineQueue.maxSize`, pushes the new item and returns `true`.
3. Otherwise applies the effective drop policy (per-item `dropPolicy` overrides the global default):
   - `'drop-oldest'` — shift + push, returns `true` (logs debug).
   - `'drop-newest'` — keep existing queue, returns `false` (logs debug).
   - `'reject'` — returns `false` (logs warn).

### `removeApiQueueItem(id)` / `removeSyncQueueItem(id)`
Removes a single item by `id`. No-op if not found.

### `removeApiQueueItemsByKey(key)`
Removes every API queue item matching `item.key`. Used to coalesce duplicate requests.

### `flushApiQueue(canRun, socketInstance)` / `flushSyncQueue(canRun, socketInstance)`

**Behavior:**
- Re-entrancy guard prevents nested flushes for the same queue.
- Evicts expired items.
- Drains FIFO while `canRun()` returns `true`, calling each item's `run(socketInstance)`.

### `getApiQueueSize(): number` / `getSyncQueueSize(): number`

Read-only sizes (after eviction triggers from enqueue/flush; reads alone do not evict).

**Example:**
```typescript
import { enqueueApiRequest } from '@luckystack/core/client';

enqueueApiRequest({
  id: requestId,
  key: `${routeName}:${userId}`,
  createdAt: Date.now(),
  dropPolicy: 'drop-newest',
  run: (s) => s.emit('apiRequest', message),
});
```

## API Reference — CSRF + httpFetch

### `getCsrfToken(): Promise<string | null>`

**Behavior:**
- Returns `null` immediately in token-mode sessions (`session.basedToken === true`) — CSRF is unnecessary because cross-origin requests don't auto-attach sessionStorage.
- Returns the cached token if previously fetched.
- Otherwise fetches `/auth/csrf` with `credentials: 'include'`, caches and returns `body.csrfToken`.
- Inflight de-duplication: concurrent callers share the same promise.

### `clearCsrfToken(): void`

Drops the cached token + any inflight fetch. Call on logout or when a 403 `auth.csrfMismatch` is observed.

### `httpFetch(input, init?): Promise<Response>`

Drop-in `fetch` replacement that:
- Forces `credentials: 'include'` unless overridden.
- Adds `Content-Type: application/json` when a string body is present and no content-type was set.
- For state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) in cookie mode: lazily fetches the CSRF token, attaches as `x-csrf-token`. On a 403 `auth.csrfMismatch` response, clears the cache and retries once with a refreshed token.

**Example:**
```typescript
import { httpFetch } from '@luckystack/core/client';

const res = await httpFetch('/api/system/myRoute/v1', {
  method: 'POST',
  body: JSON.stringify({ foo: 1 }),
});
```

## API Reference — Wire Protocol Constants

### `socketEventNames`

A frozen record of event names:

| Key | Value |
|---|---|
| `apiRequest` | `'apiRequest'` |
| `sync` | `'sync'` |
| `joinRoom` / `leaveRoom` / `getJoinedRooms` | (same literal) |
| `updateLocation` / `updateSession` / `sessionReplaced` / `logout` | (same literal) |
| `intentionalDisconnect` / `intentionalReconnect` / `userAfk` / `userBack` | (same literal) |
| `connect` / `disconnect` / `reconnectAttempt` / `connectError` | underlying socket.io events |
| `apiResponsePrefix` | `'apiResponse-'` |
| `apiStreamPrefix` | `'apiStream-'` |
| `syncResponsePrefix` | `'sync-'` |
| `syncProgressPrefix` | `'sync-progress-'` |
| `joinRoomResponsePrefix` / `leaveRoomResponsePrefix` / `getJoinedRoomsResponsePrefix` | (same prefix) |

### Event name builders

| Function | Behavior |
|---|---|
| `buildApiResponseEventName(idx)` | `'apiResponse-<idx>'` |
| `buildApiStreamEventName(idx)` | `'apiStream-<idx>'` |
| `buildSyncResponseEventName(idx)` | `'sync-<idx>'` |
| `buildSyncProgressEventName(idx)` | `'sync-progress-<idx>'` |
| `buildJoinRoomResponseEventName(idx)` | `'joinRoom-<idx>'` |
| `buildLeaveRoomResponseEventName(idx)` | `'leaveRoom-<idx>'` |
| `buildGetJoinedRoomsResponseEventName(idx)` | `'getJoinedRooms-<idx>'` |

## API Reference — Service Route Parsers

### `parseServiceRouteName(value: string): ServiceRouteParseResult`

Validates `<service>/<routeName...>` strings.

**Returns:**
- `{ status: 'success', normalizedRouteName, service, routeName }` — when at least two non-empty segments are present.
- `{ status: 'error', reason }` — for empty input, empty segments, or fewer than two segments.

Normalization rules: trim, replace `\` with `/`, strip leading/trailing slashes.

### `parseTransportRouteName({ value, prefix })`

Validates a full transport route like `'api/system/foo/v1'`.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `value` | `string` | yes | Raw route string. |
| `prefix` | `'api' \| 'sync'` | yes | Determines whether the leading `'api'`/`'sync'` segment is stripped. |

**Returns:**
- `{ status: 'success', normalizedFullName, version, serviceRoute }` — when the trailing segment matches `/^v\d+$/` and the leading service/route part parses cleanly.
- `{ status: 'error', reason }` — on length / version / segment violations.

## API Reference — Cookies

### `getCookieValue(cookieHeader: string | undefined, cookieName: string): string | null`

Regex-escapes `cookieName`, searches for `(?:^|;\s*)<name>=<value>` in the header, URL-decodes the captured value (falls back to raw on decode failure). Returns `null` when input is missing or no match.

### `hasCookie(cookieHeader, cookieName): boolean`

Convenience wrapper — true when `getCookieValue` returns a non-null value.

## API Reference — HTTP Method Inference

### `inferHttpMethod(apiName: string): HttpMethod`

Naming-convention heuristic (used as fallback when no `apiMethodMap` is registered):
- starts with `get` / `fetch` / `list` → `GET`
- starts with `delete` / `remove` → `DELETE`
- starts with `update` / `edit` / `patch` → `PUT`
- otherwise → `POST`

Strips a trailing `v\d+` segment before applying the rule, so `api/examples/getUser/v1` resolves to `'GET'`.

### `getEffectiveHttpMethod(apiConfig, apiName)`

Prefers an explicit `apiConfig.httpMethod`; otherwise calls `inferHttpMethod(apiName)`.

### `isMethodAllowed(requestMethod, allowedMethod): boolean`

Returns `true` when the request method matches the allowed method or is `'OPTIONS'` (CORS preflight passthrough).

## Hooks dispatched

| Hook name | Payload type | When |
|---|---|---|
| `corsRejected` | `CorsRejectedPayload` | `allowedOrigin` is about to return `false`. |

## Config keys consumed

| Key | Where |
|---|---|
| `session.basedToken` | token extractors, `httpFetch`, `getCsrfToken` |
| `http.sessionCookieName` | token extractors |
| `http.cors.allowedOrigins`, `http.cors.allowLocalhost` | `allowedOrigin` |
| `offlineQueue.maxSize`, `maxAgeMs`, `dropPolicy` | offline queue |
| `logging.devLogs` | `allowedOrigin` warn-logs |

## Related

- Function INDEX: `packages/core/CLAUDE.md`
- Architecture: `docs/ARCHITECTURE_SOCKET.md`, `docs/ARCHITECTURE_API.md`, `docs/ARCHITECTURE_SYNC.md`, `docs/ARCHITECTURE_AUTH.md`
- README: `packages/core/README.md`
- Source: `packages/core/src/socketTypes.ts`, `socketState.ts`, `socketEvents.ts`, `extractToken.ts`, `extractTokenFromRequest.ts`, `checkOrigin.ts`, `offlineQueue.ts`, `csrf.ts`, `cookies.ts`, `httpApiUtils.ts`, `serviceRoute.ts`
