# Request Pipeline

> Deep specs. Bron: `packages/server/src/httpHandler.ts`, `packages/server/src/loadSocket.ts`, `packages/server/src/sse.ts`. Bijgewerkt: 2026-05-20.

## Overview

`handleHttpRequest` is the orchestrator that every HTTP request flows through. Its job is fixed and intentionally narrow: enforce origin policy, set headers, parse session + CSRF, run pre-request hook, decide method validity, parse params, then walk two ordered handler tables. Each handler in those tables (see `http-routes.md`) is single-purpose and returns `boolean`.

Top-level flow:

1. Build session-cookie option string (`HttpOnly; SameSite; Path; Max-Age; Secure?`).
2. `enforceOriginPolicy(req, res)` — origin/referer gate. Read-only methods without origin pass; state-changing methods without origin are 403.
3. `setSecurityHeaders(req, res, origin)` — framework defaults + consumer builder (see `security-defaults.md`).
4. Resolve `requestId` from `x-request-id` (echoed back) or `randomUUID()`. Set `X-Request-Id` response header.
5. Dispatch `preHttpRequest` hook with a sanitized header subset. A `HookStopSignal` returns `JSON.stringify({ status: 'error', errorCode })` at `signal.httpStatus ?? 403`.
6. `OPTIONS` -> `204` and return.
7. Method allowlist: `GET / POST / PUT / DELETE`. Anything else -> `404` plain text.
8. Extract session token via `extractTokenFromRequest`. Sliding-cookie refresh when the cookie + session both exist.
9. `enforceCsrfOnStateChangingRequest(...)` — see `security-defaults.md`.
10. Dispatch `PRE_PARAMS_ROUTES` (`csrf`, `favicon`, `livez`, `readyz`, `_health`, `_test/reset`) — fast paths that should not consume the body.
11. `parseRequestParams(...)` — `await getParams({ method, req, res, queryString })`. Streams the body when applicable; bails out if `res.writableEnded`.
12. Dispatch `POST_PARAMS_ROUTES` (`uploads`, `auth/api`, `auth/callback`, `api`, `sync`, `customRoutes`, `staticAndSpaFallback`).

Socket.io runs on a parallel lifecycle — attached to the same `http.Server` via `loadSocket(httpServer, { maxHttpBufferSize })` but with its own event-driven dispatch.

## API Reference

### `handleHttpRequest(req, res, options): Promise<void>`

**Signature:**

```typescript
export const handleHttpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  options: CreateLuckyStackServerOptions,
): Promise<void>;
```

**Parameters:**

| Field | Type | Purpose |
| --- | --- | --- |
| `req` | `IncomingMessage` | Raw Node request. |
| `res` | `ServerResponse` | Raw Node response. |
| `options` | `CreateLuckyStackServerOptions` | Forwarded to the route handler context (used by `staticAndSpaFallback` / `customRoutes`). |

**Returns:** `Promise<void>`. The handler resolves once it has ended the response (or short-circuited).

**Behavior (execution order):**

- Read `projectConfig` once and snapshot `shouldLogDev`, `sessionCookieName`, `sessionCookieOptions`.
- `enforceOriginPolicy`: state-changing requests without `Origin` / `Referer` are rejected with `403 'Forbidden'`. A present-but-disallowed origin is also `403`. Read-only methods without origin pass to keep health probes and asset fetches working.
- `setSecurityHeaders`: see `security-defaults.md`. Consumer builder runs after defaults; errors fall through to defaults.
- Compute `requestId`. Honor `x-request-id` (idempotent for retrying proxies); otherwise mint a `randomUUID()`. Echo as `X-Request-Id` response header.
- Build a sanitized `safeHeaders` map (drops `authorization`, `cookie`, `set-cookie`, `x-csrf-token`).
- Dispatch `preHttpRequest` hook. On `result.stopped`: respond with `signal.httpStatus ?? 403` and `application/json { status: 'error', errorCode: signal.errorCode }`.
- `OPTIONS` -> `writeHead(204)` + `end()`.
- Reject methods outside `GET / POST / PUT / DELETE` with `404 text/plain`.
- Split `req.url` into `[routePath, queryString]`.
- `extractTokenFromRequest(req)` — pulls token from cookie or `Authorization`.
- `refreshSessionCookieIfPresent` — sliding expiration in cookie mode. Re-emits `Set-Cookie` with refreshed `Max-Age` when the session exists.
- `enforceCsrfOnStateChangingRequest` — returns `true` when it has ended the response; the request loop bails.
- `dispatchRoutes(PRE_PARAMS_ROUTES, { ...baseCtx, params: {} })` — first handler to return `true` (or end `res`) wins; otherwise the chain falls through.
- `parseRequestParams` — pulls body when method needs one. If `res.writableEnded` (because the body parser ended with an error), bail out.
- `dispatchRoutes(POST_PARAMS_ROUTES, { ...baseCtx, params })`.

**Errors / Edge cases:**

- The orchestrator itself never wraps the table in `tryCatch`. Per-route handlers wrap their work; `customRoutes` handlers are caught and reported as `500 server.customRouteFailed`.
- Handler order is fixed; mutating it requires editing `PRE_PARAMS_ROUTES` / `POST_PARAMS_ROUTES`.
- A handler that ends `res` but returns `false` still terminates dispatch — `dispatchRoutes` checks `res.writableEnded` after each call.

---

### `dispatchRoutes(handlers, ctx): Promise<boolean>`

**Signature:**

```typescript
const dispatchRoutes = async (
  handlers: HttpRouteHandler[],
  ctx: HttpRouteContext,
): Promise<boolean>;
```

**Behavior:**

- Iterates `handlers` in array order.
- After each call, if `handled === true` OR `ctx.res.writableEnded` -> return `true` (stop).
- Otherwise continue. Return `false` if none handled.

**Edge case:** a handler that writes a partial response without ending (`res.write(...)`) without setting `writableEnded` still falls through unless it returns `true`. Always end the response or return `true`.

---

### `loadSocket(httpServer, options?): SocketIOServer`

**Signature:**

```typescript
export interface LoadSocketOptions {
  maxHttpBufferSize?: number;
}

export const loadSocket = (
  httpServer: HttpServer,
  options: LoadSocketOptions = {},
): SocketIOServer;
```

**Parameters:**

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `httpServer` | `http.Server` | required | The HTTP server returned by `createLuckyStackServer`. Socket.io upgrades on it. |
| `options.maxHttpBufferSize` | `number` | `projectConfig.socket.maxHttpBufferSize` | Forwarded to Socket.io. |

**Returns:** the `SocketIOServer` instance. Also registered globally via `setIoInstance(io)` so framework code (presence, broadcast helpers) can reach it without a parameter.

**Behavior:**

- Construct `SocketIOServer` with:
  - CORS: methods `GET / POST / PUT / DELETE / OPTIONS`, origin callback delegates to `allowedOrigin`, `credentials: true`. Empty origin is allowed (Socket.io polling without an origin header).
  - `maxHttpBufferSize`, `pingTimeout`, `pingInterval` from `projectConfig.socket`.
- `setIoInstance(io)` and `attachSocketRedisAdapter(io)` — required for room broadcasts to fan out across instances.
- `io.on('connect', ...)` per-socket lifecycle:
  - Extract token, cache `activityBroadcasterEnabled` + `locationProviderEnabled` flags + `preferredLocale`.
  - When token present: `socketConnected({ token, io })` (presence).
  - Dispatch `onSocketConnect` hook with `{ socketId, token, ip }`.
  - Wire event handlers (delegates):
    - `apiRequest` -> `handleApiRequest({ msg, socket, token })` from `@luckystack/api`.
    - `sync` -> `handleSyncRequest({ msg, socket, token })` from `@luckystack/sync`.
    - `joinRoom` -> validate, `getSession(token)`, dispatch `preRoomJoin` (may stop), `socket.join(group)`, persist `roomCodes` via `saveSession`, emit `buildJoinRoomResponseEventName(responseIndex)`, dispatch `postRoomJoin`. Serialized per-token via `withSessionLock`.
    - `leaveRoom` -> symmetric to `joinRoom`. Dispatches `preRoomLeave` / `postRoomLeave`.
    - `getJoinedRooms` -> emits visible rooms (filters out `socket.id` and the token room).
    - `disconnect` -> dispatch `onSocketDisconnect`, then either `socketDisconnecting` (if presence is enabled) or a dev log line.
    - `updateLocation` -> when location provider is enabled, mutate session location, dispatch `onLocationUpdate`. Coordinates with `socketLeaveRoom` from presence.
  - When `activityBroadcasterEnabled && token`: `initActivityBroadcaster({ socket, token })`.
  - When token present: `socket.join(token)` — every authenticated socket joins its own token room so server-side code can target a user by token.

**Errors / Edge cases:**

- `withSessionLock(token, fn)` serializes per-token mutations to prevent read-modify-write races on `session.roomCodes`. The lock's `then(fn, fn)` ensures a failed prior call doesn't block the next caller.
- Legacy session shapes that still carry `code` / `codes` are stripped on save via `sanitizeSessionRoomKeys`.
- Room validation: empty / non-string `group` -> emit `room.invalid` error frame.
- `responseIndex` is required for join/leave/getJoinedRooms; non-number values silently no-op (the client never gets a response — Socket.io's response indexing is purely opt-in).

## SSE streaming inside the pipeline

`/api/*` and `/sync/*` opt into SSE via `shouldUseHttpStream({ acceptHeader, queryString })`. When enabled:

- `initSseResponse(res)` writes `200 text/event-stream` + `Cache-Control: no-cache, no-transform` + `Connection: keep-alive` + `X-Accel-Buffering: no`. Optional `projectConfig.http.stream.connectedComment` is sent as the initial keepalive comment.
- The route handler passes a `stream` callback to its delegate. The delegate emits per-event payloads; the handler forwards each as `event: stream\ndata: <json>\n\n`.
- On completion, emit `event: final` with the result envelope. On error, `event: error`. Then `res.end()`.
- `req.on('close', ...)` flips a `streamClosed` flag so post-disconnect writes are suppressed.

## Hooks dispatched

| Hook | Payload | When |
| --- | --- | --- |
| `preHttpRequest` | `{ method, url, requestId, origin, headers }` | Before route dispatch. May stop with `HookStopSignal` to short-circuit. `headers` omits sensitive entries. |
| `csrfMismatch` | `{ route, method, requestId, userId, providedToken: boolean }` | Cookie-mode CSRF check rejects a write. Token VALUE is never in payload. |
| `apiError` / `syncError` | `{ route, method, requestId, error }` | Outer error path of `/api/*` / `/sync/*` handlers (see `http-routes.md`). |
| `rateLimitExceeded` | `{ scope, key, limit, windowMs, count, route, ip }` | Credentials login. |
| `onSocketConnect` / `onSocketDisconnect` | `OnSocketConnectPayload` / `OnSocketDisconnectPayload` | Socket lifecycle (see `create-server.md`). |
| `preRoomJoin` / `postRoomJoin` | `PreRoomJoinPayload` / `PostRoomJoinPayload` | Room-join lifecycle inside `loadSocket`. `pre*` may stop. |
| `preRoomLeave` / `postRoomLeave` | `PreRoomLeavePayload` / `PostRoomLeavePayload` | Room-leave lifecycle inside `loadSocket`. `pre*` may stop. |
| `onLocationUpdate` | `OnLocationUpdatePayload` | When the presence layer reports a path change. |

## Config keys consumed

| Source | Key | Effect |
| --- | --- | --- |
| env | `SECURE` | `'true'` -> session cookies get the `Secure;` flag. |
| config | `projectConfig.logging.devLogs` | Gates per-request debug logs (sanitized params + method/route). |
| config | `projectConfig.http.cors.*` / `securityHeaders.*` | Response headers (see `security-defaults.md`). |
| config | `projectConfig.http.sessionCookieName` / `sessionCookiePath` / `sessionCookieSameSite` | Session cookie shape. |
| config | `projectConfig.session.expiryDays` / `basedToken` | Cookie `Max-Age` + CSRF middleware activation predicate. |
| config | `projectConfig.http.stream.queryParam` / `enabledValue` / `connectedComment` | SSE opt-in + keepalive. |
| config | `projectConfig.socket.maxHttpBufferSize` / `pingTimeout` / `pingInterval` | Socket.io transport options. |
| config | `projectConfig.socketActivityBroadcaster` / `locationProviderEnabled` | Gate presence-related socket handlers. |

## Error fall-through

- The outer `handleHttpRequest` does NOT wrap the table in a global `tryCatch`. Each handler is responsible for its own errors.
- `handleApiRoute` / `handleSyncRoute` wrap their body and emit `500 *.invalidRequestFormat` after dispatching `apiError` / `syncError`.
- `handleCustomRoutes` wraps each handler and emits `500 server.customRouteFailed` on throw.
- Throws from inside a `dispatchHook` handler propagate per `@luckystack/core`'s `dispatchHook` semantics — generally they are caught and logged inside the hook system.

## Related

- Function INDEX: `packages/server/AI_INDEX.md`
- HTTP routes: `packages/server/docs/http-routes.md`
- Security defaults: `packages/server/docs/security-defaults.md`
- Create server: `packages/server/docs/create-server.md`
- Architecture: `docs/ARCHITECTURE_API.md`, `docs/ARCHITECTURE_SOCKET.md`, `docs/ARCHITECTURE_SYNC.md`, `docs/ARCHITECTURE_SESSION.md`
- README: `packages/server/README.md`
