# @luckystack/sync

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

Real-time sync transport for LuckyStack. Provides type-safe, room-based fanout over Socket.io with an HTTP/SSE fallback. Each sync event is a file-based route with a mandatory `_server_v{N}.ts` (runs once, validates, produces `serverOutput`) and an optional `_client_v{N}.ts` (runs once per recipient socket for per-target filtering or auth). Streaming primitives (`stream`, `broadcastStream`, `streamTo`) support live LLM tokens, collab-editor diffs, and per-recipient progress. An offline queue with configurable drop policy keeps optimistic sends from being lost when the socket reconnects.

## When to USE this package

- Real-time room-based fanout (collab editors, chat, multiplayer state)
- Streaming AI/LLM tokens with throttled chunking
- Per-recipient customization (filter / translate / brand) without a second round-trip
- Optimistic offline sends that should replay when the socket reconnects
- Server-validated mutations that must be broadcast to every peer in a room

## When to NOT suggest this (yet)

- Request/response with no fanout — use `@luckystack/api` (`apiRequest`)
- Pure presence/online-status broadcasts — use `@luckystack/presence`
- Cross-instance fanout without a Redis adapter — wire the adapter first (see `/docs/ARCHITECTURE_SOCKET.md`)
- One-off background jobs unrelated to a client room
- HTTP-only environments without a long-lived connection AND no SSE — the package needs at minimum the HTTP/SSE fallback

## Function Index

### Server entry (`@luckystack/sync`)

| Export | One-liner | Deep doc |
|---|---|---|
| `handleSyncRequest({ msg, socket, token })` | Socket.io sync entry — auth, rate-limit, validate, run `_server`, fanout, run `_client` per recipient, emit results, dispatch hooks. | → `docs/server-vs-client-handlers.md` |
| `handleHttpSyncRequest(req, res)` | HTTP/SSE fallback for sync requests when websockets are blocked. | → `docs/sync-request.md` |
| `createStreamThrottle({ flushEveryMs?, flushAtChars?, field? })` | Coalesce tiny stream pieces (LLM tokens) into bigger chunks before emit. | → `docs/streaming.md` |
| Type: `HttpSyncStreamEvent` | SSE event shape emitted by the HTTP fallback. | → `docs/sync-request.md` |
| Type: `StreamThrottle` / `CreateStreamThrottleOptions` | Throttle handle + options. | → `docs/streaming.md` |

### Client entry (`@luckystack/sync/client`)

| Export | One-liner | Deep doc |
|---|---|---|
| `syncRequest({ name, version, data?, receiver, ignoreSelf?, onStream?, offlineDropPolicy? })` | Fire a typed sync event into a room; resolves with the server result envelope. | → `docs/sync-request.md` |
| `useSyncEvents()` | React hook returning `{ upsertSyncEventCallback, upsertSyncEventStreamCallback }` scoped to the component lifetime. | → `docs/callback-registration.md` |
| `useSyncEventTrigger()` | React hook returning `{ triggerSyncEvent, triggerSyncStreamEvent }` for manually invoking registered callbacks (testing / local echo). | → `docs/callback-registration.md` |
| `initSyncRequest({ setSocketStatus, sessionRef })` | One-time wiring of socket lifecycle handlers (connect/disconnect/reconnectAttempt/userAfk/userBack/connectError) into the socket-status provider. | → `docs/callback-registration.md` |
| Type: `SyncRequestStreamEvent<T>` | Payload shape passed to `onStream` on the originator side. | → `docs/streaming.md` |
| Type: `SyncRouteStreamEvent<T>` | Payload shape passed to `upsertSyncEventStreamCallback` on recipients. | → `docs/streaming.md` |

### Streaming primitives (received inside `_server_v{N}.ts` params)

| Primitive | Audience | Deep doc |
|---|---|---|
| `stream(payload)` | Originator socket only (cheapest). | → `docs/streaming.md` |
| `broadcastStream(payload)` | Every socket in `roomCode`, across all instances (`io.to(room).emit` via the Redis adapter). | → `docs/streaming.md` |
| `streamTo(tokens, payload)` | Selective fanout to specific session tokens. | → `docs/streaming.md` |
| `stream(payload)` in `_client_v{N}.ts` | Per-recipient, runs after `_server` finishes. | → `docs/streaming.md` |

### Hooks dispatched by the server handler

| Hook | When | Deep doc |
|---|---|---|
| `preSocketMessage` | At the very top of the socket message handler (before auth/route resolution). Stop to reject the message. Transport-level seam mirroring `preHttpRequest`; `channel: 'sync'`. | → `docs/server-vs-client-handlers.md` |
| `preSyncAuthorize` | After basic `AuthProps` check, before rate-limit + input validation. Stop to reject. | → `docs/server-vs-client-handlers.md` |
| `postSyncAuthorize` | Observational — after the request passes auth + custom policy, before rate-limit + validation. | → `docs/server-vs-client-handlers.md` |
| `preSyncValidate` | Before runtime input validation. Stop to reject (mirrors `preApiValidate`). | → `docs/server-vs-client-handlers.md` |
| `postSyncValidate` | After validation, carrying `{ validation }` (mirrors `postApiValidate`). | → `docs/server-vs-client-handlers.md` |
| `preSyncExecute` | Before the `_server` handler runs. Stop to short-circuit (mirrors `preApiExecute`). | → `docs/server-vs-client-handlers.md` |
| `postSyncExecute` | After `_server` resolves OR throws, carrying `{ result, error, durationMs }`. Fires on the FAILURE path too (mirrors `postApiExecute`). | → `docs/server-vs-client-handlers.md` |
| `preSyncFanout` | After `_server` runs, before any recipient receives the payload. Stop to abort fanout. | → `docs/room-fanout.md` |
| `preSyncRecipient` | Per recipient, before that ONE socket receives the payload. Carries `{ routeName, receiver, recipientSocketId, recipientUserId, serverOutput }`. A stop signal SKIPS just that recipient (the loop continues; it is not counted as delivered) — it does NOT abort the whole fanout. `recipientUserId` is null on the hot path. | → `docs/room-fanout.md` |
| `postSyncFanout` | After all recipients have been emitted to. Receives `recipientCount`. | → `docs/room-fanout.md` |
| `preSyncStream` | Per stream chunk, before it is emitted (`stream` / `broadcastStream` / `streamTo`). Carries `{ routeName, chunk, recipient }` (`recipient` = `'originator'`, the room, or a token). Observational. | → `docs/streaming.md` |
| `postSyncStream` | Per stream chunk, after emit. Adds a 1-based per-stream `chunkIndex` to the `preSyncStream` payload. Observational. | → `docs/streaming.md` |
| `rateLimitExceeded` | When the per-route or per-IP bucket rejects a sync. | → `docs/error-states.md` |

## Config keys

### `registerProjectConfig({ sync, offlineQueue })`

- `sync.streamThrottle.flushAtChars` — char threshold before a buffered throttle flushes. Default `32`.
- `sync.streamThrottle.flushEveryMs` — timer-based flush interval; `false` disables the timer. Default `50`.
- `sync.streamThrottle.field` — payload key carrying the buffered text. Default `'chunk'`.
- `sync.fanoutYieldEvery` — yield to the event loop every N recipients during a giant fanout. Clamped to `>= 1` (a configured `0` would make the modulo `NaN` and never yield).
- `sync.fanoutYieldMs` — duration of the yield `setTimeout`.
- `sync.requestTimeoutMs` — client-side ack-timeout for `syncRequest` (CORE-06). After this elapses with no acknowledgement the promise settles with `{ status:'error', errorCode:'sync.requestTimeout', httpStatus:504 }` instead of hanging. `false` disables. Default `30000`.
- `sync.allowClientReceiverAll` — when `false`, a client requesting the broadcast receiver `'all'` is rejected (`sync.receiverNotAllowed`, 403) on both transports (SYNC-07). **Default `false` (0.2.0 secure-default flip — was `true`); opt back into cluster-wide broadcast explicitly or approve via `preSyncAuthorize`.**
- `sync.requireRoomMembership` — when `true`, a client may only target a room it has actually joined; an unjoined room is rejected (`sync.notRoomMember`, 403). Enforced on BOTH transports: the SOCKET path checks `socket.rooms`, the HTTP/SSE path derives membership from the session's persisted `roomCodes`. An anonymous HTTP caller (no session) has undeterminable membership and is rejected (fail-closed) — the flag is no longer silently bypassable over the HTTP fallback. **Default `true` (0.2.0 secure-default flip — was `false`); set `false` for the legacy any-room behavior.**
- `sync.flushPressure.maxBufferedBytes` — default drain threshold for the `flushPressure` backpressure helper when no per-call `thresholdBytes` is given (SYNC-15). Default `5_242_880` (5 MiB).
- `sync.flushPressure.highWaterMarkChunks` — upper bound (in packets) on the derived flush-pressure threshold. Default `1000`. (`lowWaterMarkChunks` is surfaced in core but full chunk-watermark hysteresis is a residual — see fix report.)

### Per-route `_server` exports

- `export const rateLimit: number | false` — per-route rate limit (mirrors `@luckystack/api`). Overrides `rateLimiting.defaultApiLimit` for this sync route's per-requester bucket; `false` disables it (the global per-IP bucket still applies); omit to fall back to `defaultApiLimit`. Honored by both transports.
- `offlineQueue.maxSize` — cap on the client-side offline queue.
- `offlineQueue.dropPolicy` — `'reject'` (default — overflow returns `offline.queueFull`), `'drop-oldest'`, or `'drop-newest'`. Per-request override via `syncRequest({ offlineDropPolicy })`. SYNC-09: when a request that was already QUEUED is later evicted (drop-oldest by a newer enqueue, or age expiry) its awaiting promise now settles with `{ status:'error', errorCode:'offline.dropped' }` (was: hung forever).

### Logging toggles

- `logging.devLogs`, `logging.devNotifications`, `logging.socketStatus`, `logging.stream` — drive the dev-only log lines in this package.

### Env vars

None directly. Inherits socket transport config from `@luckystack/server` and Redis adapter config from `@luckystack/core`.

## Peer dependencies

- **Required**: `@luckystack/core`, `@luckystack/error-tracking`. **`@luckystack/login` is NOT a dependency** (0.2.0 decoupling) — sessions resolve through core's `readSession` / session-provider registry (`handleSyncRequest` imports `readSession` from `@luckystack/core`), with login as the default *provider* (optional package), not a hard runtime dep.
- **Peer (canonical ranges, 2026-05-07)**:
  - `@prisma/client@^6.19.0` (transitively required via `@luckystack/core`)
  - `react@^19.2.0` (only the `/client` subpath)
  - `socket.io@^4.8.0` (server entry)
  - `socket.io-client@^4.8.0` (client entry)
- Redis adapter (required for cross-instance fanout) wired by `@luckystack/server`; see `/docs/ARCHITECTURE_SOCKET.md`.

## Related

- Architecture deep-dive: `/docs/ARCHITECTURE_SYNC.md`
- Socket setup + Redis adapter: `/docs/ARCHITECTURE_SOCKET.md`
- Multi-instance model + pitfalls (regular `syncRequest` fan-out reaches across instances via `io.in(room).fetchSockets()` + `RemoteSocket.emit()`; streaming via `broadcastStream`/`streamTo`): `/docs/ARCHITECTURE_MULTI_INSTANCE.md`
- File-based `_sync/` routing: `/docs/ARCHITECTURE_ROUTING.md`
- Streaming page reconstruction: `/docs/STREAMING_RECONSTRUCTION.md`
- README (consumer quickstart): `./README.md`
- Sibling packages: `@luckystack/api`, `@luckystack/presence`, `@luckystack/server`
