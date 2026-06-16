# error-states

> Authoritative catalog of error codes emitted by `syncRequest` (client) and `handleSyncRequest` / `handleHttpSyncRequest` (server). Documents HTTP-status mapping, locale-aware message normalization, `errorParams` interpolation slots, the `rateLimitExceeded` hook payload, and Sentry capture behavior.

For the originator response envelope shape see [`./sync-request.md`](./sync-request.md). For the full lifecycle these errors slot into see [`./server-vs-client-handlers.md`](./server-vs-client-handlers.md).

---

## 1. Error envelope shape

Every sync error — whether produced client-side before sending or server-side at any stage — collapses to the same shape after `normalizeErrorResponse`:

```ts
{
  status: 'error',
  message: string,                 // localized via preferredLocale / userLanguage
  errorCode: string,               // see catalog below
  errorParams?: { key, value }[],  // i18n interpolation slots
  httpStatus?: number,             // inferred via defaultHttpStatusForResponse
}
```

`message` is **always** the localized string for `errorCode` (with `errorParams` interpolated). The default i18n catalog ships built-in keys for every framework code; project-defined codes use whatever the project i18n catalog defines.

---

## 2. Client-side error codes

Produced by `syncRequest` BEFORE the message ever hits the wire.

| `errorCode` | Trigger | `httpStatus` (default) | `errorParams` |
|---|---|---|---|
| `sync.invalidName` | `name` is missing or not a string | n/a (local) | — |
| `routing.invalidServiceRouteName` | `name` doesn't match `<page>/<route>` shape | n/a (local) | `[{ key: 'name', value: <input name> }]` |
| `sync.invalidVersion` | `version` is missing or not a string | n/a (local) | — |
| `sync.missingReceiver` | `receiver` is missing or empty after trim | n/a (local) | — |
| `sync.ioUnavailable` | Socket never initialized or `waitForSocket()` timed out | n/a (local) | — |
| `offline.queueFull` | Socket offline + queue full + `dropPolicy: 'reject'` | n/a (local) | — |
| `sync.failedRequest` | Catch-all fallback for malformed ack (used in dev notification) | n/a (local) | `[{ key: 'name', ...}, { key: 'message', ...}]` |
| `sync.invalidServerResponse` | Server ack missing `status: 'success'` and no recognized error code | inherited from server response (if any) | — |

Local errors never travel over the wire — they short-circuit inside `syncRequest`'s promise body and resolve immediately with the error envelope. `httpStatus` doesn't apply (there was no HTTP).

---

## 3. Server-side error codes (originator-visible)

Emitted by `handleSyncRequest` / `handleHttpSyncRequest` to the originator's ack channel (`buildSyncResponseEventName(responseIndex)` for socket, HTTP response body for HTTP).

| `errorCode` | Trigger | `httpStatus` | `errorParams` |
|---|---|---|---|
| `sync.invalidRequest` | `msg` is not an object, or `name`/`data` missing or wrong type | `400` | — |
| `routing.invalidServiceRouteName` | `parseTransportRouteName` failed | `400` | `[{ key: 'name', value: <input name> }]` |
| `sync.invalidCallback` | `cb` is missing or not a string | `400` | — |
| `sync.missingReceiver` | `receiver` is empty after trim | `400` | — |
| `sync.notFound` | Neither `_server_v{N}` nor `_client_v{N}` exists for this route | `404` | — |
| `auth.required` | `auth.login === true` on `_server` and no session resolved | `401` | — |
| `auth.forbidden` (or route-specific code from `validateRequest`) | `validateRequest(auth.additional)` rejected | `403` (default; some predicates override) | predicate-defined |
| `sync.rateLimitExceeded` | Per-route or per-IP rate-limit bucket rejected | `429` | `[{ key: 'seconds', value: <retry in> }]` |
| `sync.invalidInputType` | `validateInputByType` rejected (Zod schema mismatch) | `400` | `[{ key: 'message', value: <readable reason> }]` |
| `sync.serverExecutionFailed` | `_server`'s `main(...)` threw (caught by `tryCatch`) | `500` | — |
| `<route-supplied>` (e.g. `board.cardNotFound`) | `_server` returned `{ status: 'error', errorCode }` | `defaultHttpStatusForResponse` or as-provided | as-provided |
| `sync.invalidServerResponse` | `_server` returned a value with `status` other than `'success'` / `'error'` | `500` | — |
| `sync.noReceiversFound` | Resolved sockets is `undefined` or empty | `404` | — |
| `<hook-supplied>` | `preSyncAuthorize` / `preSyncFanout` stop signal | from hook | from hook |

The `preSyncAuthorize` and `preSyncFanout` hooks can stop with any `errorCode` they choose; the framework normalizes the message via `normalizeErrorResponse` using the originator's locale.

---

## 4. Server-side error codes (per-recipient, fanout step)

Emitted to a **single recipient** when `_client_v{N}.ts` execution fails for them only. These do NOT propagate back to the originator and do NOT abort the fanout loop.

| `errorCode` | Trigger | `httpStatus` | `errorParams` |
|---|---|---|---|
| `sync.clientExecutionFailed` | `_client`'s `main(...)` threw (caught by per-recipient `tryCatch`) | `500` | — |
| `<route-supplied>` (e.g. `chat.translationFailed`) | `_client` returned `{ status: 'error', errorCode }` | as-provided | as-provided |
| `sync.clientRejected` | `_client` returned `{ status: 'error' }` without an `errorCode` | `500` (default) | — |
| `sync.invalidClientResponse` | `_client` returned something other than `'success'` / `'error'` | `500` | — |

Recipients see these on their own `socketEventNames.sync` channel as if they were normal sync frames, just with `status: 'error'` set. Subscribers in `upsertSyncEventCallback` that branch on `status` will see the error variant.

---

## 5. HTTP-status mapping

`httpStatus` defaults via `defaultHttpStatusForResponse(errorCode)` in `@luckystack/core`. Default rules (paraphrased — see core for exact source):

- `auth.required` -> `401`
- `auth.forbidden` and similar role/policy codes -> `403`
- Validation failures (`*.invalidRequest`, `*.invalidInputType`, `*.invalidName`, `routing.invalidServiceRouteName`) -> `400`
- Not-found (`*.notFound`, `sync.noReceiversFound`) -> `404`
- Rate limit (`*.rateLimitExceeded`) -> `429`
- Execution failures (`*.ExecutionFailed`, `*.invalid*Response`) -> `500`

A hook or route can override the default by returning `httpStatus: <number>` in its stop signal or error payload. Custom codes inherit the fallback `500` unless `defaultHttpStatusForResponse` is extended in core.

---

## 6. `errorParams` localization slots

`errorParams` is an array of `{ key, value }` pairs interpolated into the i18n message template. Framework codes use:

- `sync.rateLimitExceeded` -> `[{ key: 'seconds', value: <number> }]` — the seconds until the next request is allowed. Template: "Rate limited, retry in {{seconds}}s".
- `sync.invalidInputType` -> `[{ key: 'message', value: <Zod reason> }]` — the Zod error message. Template: "Input validation failed: {{message}}".
- `sync.failedRequest` (dev notification) -> `[{ key: 'name', ...}, { key: 'message', ...}]`. Template: "Sync {{name}} failed: {{message}}".
- `routing.invalidServiceRouteName` -> `[{ key: 'name', value: <bad input> }]`. Template: "Invalid service route name: {{name}}".

Project codes can carry whatever slots their templates declare. The normalizer doesn't enforce a schema — it interpolates blindly.

---

## 7. `rateLimitExceeded` hook payload

Fired whenever a rate-limit bucket rejects a sync request. The payload differs by `scope`:

### Scope `'user'` or `'ip'` (per-route bucket, identified by token or by IP)

```ts
{
  scope: 'user' | 'ip',
  key: string,         // 'token:<token>:sync:<routeName>' or 'ip:<ip>:sync:<routeName>'
  limit: number,       // projectConfig.rateLimiting.defaultApiLimit
  windowMs: number,    // projectConfig.rateLimiting.windowMs
  count: number,       // limit + 1 (the request that tipped over)
  route: string,       // e.g. 'board/moveCard/v1' — marks this a per-route bucket
  userId: string | undefined,
  ip: string | undefined, // set when anonymous (no token), else undefined
}
```

`scope: 'user'` when the request carried a session token; `scope: 'ip'` when it was anonymous (the per-route bucket is then IP-keyed). The `route` field stays set in both cases to distinguish this per-route bucket from the global `:sync:all` IP bucket below (parity with the API handler).

### Scope `'ip'` (global per-IP bucket, across all sync routes)

```ts
{
  scope: 'ip',
  key: string,         // 'ip:<ip>:sync:all'
  limit: number,       // projectConfig.rateLimiting.defaultIpLimit
  windowMs: number,
  count: number,
  ip: string,
}
```

The hook is observation-only — there is no stop signal. The fanout has already been aborted by the time the hook fires.

Typical consumer: a mitigation system that bans the offending IP / user after N hook fires within a window.

---

## 8. Locale resolution

Both transports localize error messages through the same chain:

1. **`preferredLocale`** — first non-empty match from headers:
   - Socket: `socket.handshake.headers['x-language']` -> `socket.handshake.headers['accept-language']`.
   - HTTP: `xLanguageHeader` argument -> `acceptLanguageHeader` argument.
2. **`userLanguage`** — `user.language` from the resolved session.
3. **Fallback** — `projectConfig.defaultLanguage`.

`extractLanguageFromHeader` accepts either a string or `string[]` (Node's headers can be either), trims whitespace, and picks the first listed language. The chain doesn't combine locales — first non-empty wins.

Recipients (per-recipient errors during fanout) use **their own** headers, not the sender's. That's why `handleSyncRequest`'s per-recipient error path re-extracts `tempSocket.handshake.headers` for each recipient.

---

## 9. Sentry capture via `tryCatch`

Every `_server` and `_client` execution is wrapped in `tryCatch(..., undefined, { handler, sync, stage, userId, ... })`. The fourth argument is the breadcrumb context that gets attached when `tryCatch` captures an exception.

Captured automatically:

- `_server` thrown errors -> Sentry breadcrumb: `{ handler: 'handleSyncRequest', sync: <route>, stage: 'server', userId, receiver, transport: 'socket' | 'http' }`.
- `_client` thrown errors -> Sentry breadcrumb: `{ handler: 'handleSyncRequest', sync: <route>, stage: 'client', sourceUserId, targetToken, receiver, transport }`.

NOT captured (returned as `status: 'error'` envelopes only):

- Validation failures (`sync.invalidInputType`) — these are caller errors, not server bugs.
- Auth rejects — these are policy outcomes.
- Rate-limit rejects — these are noise.
- `_server` / `_client` returning `{ status: 'error' }` voluntarily — the handler made a domain decision; nothing threw.

If you need to also Sentry-capture a voluntary error (e.g. "this code path should never trigger in production"), do it explicitly inside the handler via `@luckystack/error-tracking`'s `captureException`.

---

## 10. Offline queue overflow flow

When the socket is offline AND `dropPolicy: 'reject'` is active:

```
syncRequest({ ..., offlineDropPolicy: 'reject' })
  -> canSendNow(socket) === false
  -> enqueueSyncRequest({ id, key, run, createdAt, dropPolicy: 'reject' })
  -> queue full
  -> enqueueSyncRequest returns false
  -> resolve({
       status: 'error',
       errorCode: 'offline.queueFull',
       message: <localized>,
       httpStatus: undefined,
     })
```

With `dropPolicy: 'drop-oldest'` or `'drop-newest'`, the queue policy handles eviction silently and the caller's promise stays pending until the network comes back (then resolves on replay).

`offline.queueFull` is the only error code that fires when there is no server interaction at all — it's purely a client-side admission of "we cannot promise to deliver this if we accept it".

---

## 11. Dev-only side effects

When `projectConfig.logging.devLogs === true`:

- Local validation failures (`sync.invalidName`, `sync.missingReceiver`, etc.) log via `getLogger().error(...)`.
- Server returning `{ status: 'error' }` logs the normalized message at `getLogger().error(...)`.
- Auth rejects, validation rejects, etc., warn-log at `getLogger().warn(...)`.

When `projectConfig.logging.devNotifications === true` AND on the client:

- Most local validation failures call `notify.error({ key: '<errorCode>' })`.

These are dev hints, not production behavior. Toggle both to `false` for production to avoid leaking diagnostic info into user-facing notifications.

---

## 12. Quick lookup by symptom

| Symptom | Most likely code | Where to look |
|---|---|---|
| `syncRequest` returns immediately with error | `sync.missingReceiver`, `sync.invalidVersion`, `sync.ioUnavailable` | Client-side validation, §2 |
| Request reached server but auth rejected | `auth.required`, `auth.forbidden` | `_server`'s `auth` export, [`./server-vs-client-handlers.md`](./server-vs-client-handlers.md) |
| 429 rate-limit responses | `sync.rateLimitExceeded` | `projectConfig.rateLimiting` |
| Server-side schema fail | `sync.invalidInputType` | `_server`'s `SyncParams.clientInput` interface + generated Zod schema |
| Handler threw | `sync.serverExecutionFailed` / `sync.clientExecutionFailed` | Sentry breadcrumb |
| Domain logic rejected | `<route-supplied errorCode>` | The `_server` or `_client` file's return path |
| Empty room | `sync.noReceiversFound` | `receiver` argument; check room membership |
| Offline + caller didn't await | `offline.queueFull` | Bump `offlineQueue.maxSize` or switch `dropPolicy` |

---

## 13. Related

- Originator response envelope: [`./sync-request.md`](./sync-request.md)
- Pipeline / lifecycle: [`./server-vs-client-handlers.md`](./server-vs-client-handlers.md)
- Rate limiting hook + buckets: [`./room-fanout.md`](./room-fanout.md) §5
- Hook payload shapes: `@luckystack/core` `HookPayloads`
- Status-code mapping source: `@luckystack/core` `defaultHttpStatusForResponse`
- Locale extraction: `@luckystack/core` `extractLanguageFromHeader`, `normalizeErrorResponse`
- Project config: `projectConfig.rateLimiting`, `projectConfig.offlineQueue`, `projectConfig.logging`
