# server-vs-client-handlers

> A sync route is **two files**: a mandatory `_server_v{N}.ts` that runs **once per request** to validate and produce `serverOutput`, and an **optional** `_client_v{N}.ts` that runs **once per recipient socket** for per-target filtering, per-client auth, or producing a custom `clientOutput`. This doc covers the contract of both files and the rules for when to skip the `_client` file entirely.

For the originator-side call signature see [`./sync-request.md`](./sync-request.md). For fanout mechanics see [`./room-fanout.md`](./room-fanout.md).

---

## 1. The two-file model

Given the file-based router (see `/docs/ARCHITECTURE_ROUTING.md`):

```
src/board/_sync/moveCard_server_v1.ts   <- REQUIRED: validates + produces serverOutput (runs once)
src/board/_sync/moveCard_client_v1.ts   <- OPTIONAL: per-recipient logic (runs once per socket in the room)
```

Route name: `board/moveCard` at version `v1`. The framework loads both files via `getRuntimeSyncMaps()` and keys them as `board/moveCard/v1_server` and `board/moveCard/v1_client`.

A route is valid if **at least one** of the two files exists. If neither exists, `handleSyncRequest` rejects with `sync.notFound`.

---

## 2. `_server_v{N}.ts` contract — runs ONCE per request

```ts
import type { SessionLayout, Functions } from '@luckystack/core';
import type { AuthProps } from '@luckystack/login';

export const auth: AuthProps = { login: true };

export interface SyncParams {
  clientInput: { /* validated against generated Zod schema */ };
  user: SessionLayout | null;       // null only when auth.login === false
  functions: Functions;              // tryCatch, db, redis, notify, ...
  roomCode: string;                  // the `receiver` from syncRequest
  stream: (payload?: Record<string, unknown>) => void;        // originator only
  broadcastStream: (payload?: Record<string, unknown>) => void; // entire room
  streamTo: (tokens: string | string[], payload?: Record<string, unknown>) => void;
}

export const main = async ({ clientInput, user, functions, roomCode, broadcastStream }: SyncParams) => {
  // 1. Mutate persistent state.
  await functions.db.card.update({ where: { id: clientInput.cardId }, data: { laneId: clientInput.toLane } });

  // 2. Optionally stream progress / tokens / diffs (broadcastStream goes to everyone in roomCode).
  // 3. Return the success envelope. Everything except `status` becomes `serverOutput` for the recipients.
  return { status: 'success', cardId: clientInput.cardId, movedBy: user!.id };
};
```

Key rules:

- **`auth: AuthProps` is mandatory.** Drives the framework's auth gate (`auth.login` -> require session, `auth.additional` -> run `validateRequest` predicates). See `@luckystack/login` `AuthProps`.
- **Return must include `status: 'success' | 'error'`.** Anything else collapses to `sync.invalidServerResponse`. The rest of the object is forwarded as `serverOutput` (after stripping `status`).
- **Streaming primitives are received as params.** See [`./streaming.md`](./streaming.md) for the audience matrix.
- **Never `try/catch` manually.** Wrap async ops in `functions.tryCatch` (or the destructured `tryCatch` from `functions`) — the framework already wraps the whole `main()` in its own `tryCatch` for Sentry capture, but per-operation `tryCatch` lets you surface targeted error codes.

---

## 3. `_client_v{N}.ts` contract — runs ONCE per recipient socket

```ts
import type { Functions } from '@luckystack/core';

export interface SyncClientParams {
  clientInput: { /* same shape as _server */ };
  token: string | null;             // recipient's session token (NOT the sender's)
  functions: Functions;
  serverOutput: unknown;             // exactly what _server returned (minus `status`)
  roomCode: string;
  stream: (payload?: Record<string, unknown>) => void;  // per-recipient stream
}

export const main = async ({ clientInput, token, functions, serverOutput, roomCode }: SyncClientParams) => {
  // 1. Optionally fetch this recipient's session — DO NOT receive `user`, only `token`.
  //    The framework deliberately does not pre-resolve sessions per recipient because
  //    most clients do not need them. Resolving N sessions for a 50-user room is wasteful.
  const recipient = await functions.session.getSession(token);
  if (!recipient) return { status: 'success' };  // anonymous viewer — leave as-is

  // 2. Filter / brand / translate based on the recipient.
  if (recipient.role === 'guest' && serverOutput.privateNotes) {
    return { status: 'success', visibleNotes: null };  // strip the private field
  }

  // 3. Return a `clientOutput` envelope. Same status rules as _server.
  return { status: 'success', visibleNotes: serverOutput.privateNotes };
};
```

Key rules:

- **No `user` param.** Receives `token` instead. Call `functions.session.getSession(token)` only when you actually need the session — most `_client` files don't.
- **Cannot validate or reject the request.** Validation already happened in `_server`. `_client` only customizes per-recipient output. Its error path emits `sync.clientExecutionFailed` / `sync.invalidClientResponse` / `sync.clientRejected` to that specific recipient, but does NOT abort the fanout to the others.
- **No `broadcastStream` / `streamTo`.** A per-recipient handler cannot fanout to other recipients — that contract is server-scope only.

---

## 4. When to create `_client_v{N}.ts`

| Goal | Need `_client`? | Why |
|---|---|---|
| Mutate state, tell the room what changed | No | `serverOutput` reaches every recipient unchanged. |
| Hide a field from non-owner viewers | Yes | Per-recipient filter. |
| Brand the payload (translate strings, swap CDN host, inject feature flags) | Yes | Per-recipient customization. |
| Per-recipient auth (e.g. "guests get a redacted version") | Yes | Use `token` -> `getSession` -> branch. |
| Per-recipient stream (different chunks per viewer) | Yes | Only `_client` has the per-target `stream(...)` primitive. |
| Just return `{ status: 'success' }` | **No — delete the file** | Pure overhead: framework already emits success with `clientOutput: {}` when `_client` is absent. |

### The "empty client" anti-pattern

```ts
// BAD — adds avoidable per-recipient await + tryCatch + emit overhead for every socket in the room.
export const main = async () => ({ status: 'success' });
```

If the file would only return `{ status: 'success' }`, leave it out. The framework's no-client branch emits:

```ts
{
  cb,
  fullName: resolvedName,
  serverOutput,
  clientOutput: {},
  message: `${resolvedName} sync success`,
  status: 'success',
}
```

…directly to each recipient with zero per-recipient handler invocation. That path is materially cheaper, especially when `receiver: 'all'`.

Rule of thumb: a `_client` file exists **only** when it makes a decision the server cannot make once.

---

## 5. Full lifecycle of `handleSyncRequest`

```
incoming msg (Socket.io 'sync' event)
        |
        v
 1. validate msg shape  -> sync.invalidRequest
 2. parseTransportRouteName(name)  -> routing.invalidServiceRouteName
 3. validate cb         -> sync.invalidCallback
 4. validate receiver   -> sync.missingReceiver
 5. getSession(token)   -> setSentryUser(...)
 6. getRuntimeSyncMaps()
    no _server AND no _client  -> sync.notFound
        |
        v
 7. If _server exists:
        AuthProps gate (auth.login)        -> auth.required
        validateRequest(auth.additional)   -> auth.forbidden
 8. dispatchHook('preSyncAuthorize')       -> stop signal becomes error envelope
 9. applySyncRateLimits()                  -> sync.rateLimitExceeded
10. If _server exists:
        validateInputByType(clientInput)   -> sync.invalidInputType
        tryCatch(serverMain(...))          -> sync.serverExecutionFailed
        status !== 'success' | 'error'     -> sync.invalidServerResponse
        status === 'error'                 -> server's errorCode (normalized)
        status === 'success'               -> serverOutput = result (minus status)
11. Resolve recipients:
        receiver === 'all'  -> io.sockets.sockets (Map of every connected socket)
        otherwise           -> io.sockets.adapter.rooms.get(receiver) (Set of IDs)
        no sockets found    -> sync.noReceiversFound
12. dispatchHook('preSyncFanout')          -> stop signal becomes error envelope
13. Per-recipient loop (with periodic event-loop yield):
        if (ignoreSelf && token === recipientToken) continue
        recipientCount++
        if (_client exists):
            tryCatch(clientHandler(...))   -> sync.clientExecutionFailed to that recipient
            status='error'                 -> normalized error to that recipient
            status='success'               -> emit { serverOutput, clientOutput, ... }
        else:
            emit { serverOutput, clientOutput: {}, ... }
14. dispatchHook('postSyncFanout', { recipientCount })
15. ack originator: emit(buildSyncResponseEventName(responseIndex), { status, result: serverOutput })
```

Per-recipient failures inside step 13 do **not** abort the fanout — every other recipient still receives the merged payload. The originator's ack always reflects the `_server` outcome, never the per-recipient outcomes.

---

## 6. Failure-mode matrix

| Stage | Trigger | Error code | Visibility |
|---|---|---|---|
| Msg shape | Non-object `msg` | `sync.invalidRequest` | originator ack |
| Routing | Bad `name` shape | `routing.invalidServiceRouteName` | originator ack |
| Routing | No `cb` | `sync.invalidCallback` | originator ack |
| Routing | No receiver | `sync.missingReceiver` | originator ack |
| Route lookup | No `_server` AND no `_client` | `sync.notFound` | originator ack |
| Auth | `auth.login` + no session | `auth.required` | originator ack |
| Auth | `validateRequest` reject | `auth.forbidden` (or specific predicate code) | originator ack |
| Auth | `preSyncAuthorize` stop | hook's `errorCode` | originator ack |
| Rate limit | Per-route or per-IP bucket | `sync.rateLimitExceeded` | originator ack |
| Validation | Zod fail | `sync.invalidInputType` | originator ack |
| Server execution | Thrown | `sync.serverExecutionFailed` | originator ack |
| Server return | `status: 'error'` from `_server` | route-supplied `errorCode` | originator ack |
| Server return | Anything other than `success`/`error` | `sync.invalidServerResponse` | originator ack |
| Fanout | No sockets in room | `sync.noReceiversFound` | originator ack |
| Fanout | `preSyncFanout` stop | hook's `errorCode` | originator ack |
| Per-recipient | `_client` thrown | `sync.clientExecutionFailed` | that recipient only |
| Per-recipient | `_client` returned `status: 'error'` | route code or `sync.clientRejected` | that recipient only |
| Per-recipient | `_client` returned non-success | `sync.invalidClientResponse` | that recipient only |

Full catalog including HTTP-status mapping in [`./error-states.md`](./error-states.md).

---

## 7. Example A — server-only sync (no `_client`)

```ts
// src/notifications/_sync/markRead_server_v1.ts
export const auth = { login: true };

export interface SyncParams {
  clientInput: { notificationId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions }: SyncParams) => {
  await functions.db.notification.update({
    where: { id: clientInput.notificationId, userId: user.id },
    data: { readAt: new Date() },
  });
  return { status: 'success', notificationId: clientInput.notificationId };
};
```

No `_client` file. Every recipient in `roomCode` receives `{ serverOutput: { notificationId }, clientOutput: {} }`.

---

## 8. Example B — server + client per-recipient filter

```ts
// src/board/_sync/showCard_server_v1.ts
export const auth = { login: true };

export const main = async ({ clientInput, functions }: SyncParams) => {
  const card = await functions.db.card.findUnique({ where: { id: clientInput.cardId } });
  if (!card) return { status: 'error', errorCode: 'board.cardNotFound' };
  return { status: 'success', card };
};
```

```ts
// src/board/_sync/showCard_client_v1.ts — strip privateNotes from non-owners
export const main = async ({ token, serverOutput, functions }: SyncClientParams) => {
  const recipient = await functions.session.getSession(token);
  if (!recipient) return { status: 'success', card: { ...serverOutput.card, privateNotes: null } };

  if (recipient.id !== serverOutput.card.ownerId) {
    return { status: 'success', card: { ...serverOutput.card, privateNotes: null } };
  }
  return { status: 'success', card: serverOutput.card };
};
```

Recipients see:

- Owner: `{ serverOutput, clientOutput: { card: { privateNotes: '...' } } }`
- Anyone else: `{ serverOutput, clientOutput: { card: { privateNotes: null } } }`

Note: `serverOutput` is the same payload for every recipient — only `clientOutput` differs. The client-side handler chooses which to render.

---

## 9. Example C — server + client custom `clientOutput` (translation)

```ts
// src/chat/_sync/announce_server_v1.ts
export const main = async ({ clientInput }: SyncParams) => ({
  status: 'success',
  i18nKey: clientInput.i18nKey,
  params: clientInput.params,
});
```

```ts
// src/chat/_sync/announce_client_v1.ts — pre-translate per recipient locale
export const main = async ({ token, serverOutput, functions }: SyncClientParams) => {
  const recipient = await functions.session.getSession(token);
  const locale = recipient?.language ?? 'en';
  const text = functions.translator.translate({ key: serverOutput.i18nKey, params: serverOutput.params, locale });
  return { status: 'success', text };
};
```

This is the canonical reason to add `_client`: the translation cost is per-locale, the source key is shared, and centralizing it in `_client` keeps the room mutation single-source.

---

## 10. Related hooks

| Hook | Stage | Stop semantics |
|---|---|---|
| `preSyncAuthorize` | After `AuthProps` gate, before rate-limit | Stop -> originator error envelope with hook's `errorCode` |
| `preSyncFanout` | After `_server` runs, before any recipient receives | Stop -> originator error envelope; nobody gets the payload |
| `postSyncFanout` | After all recipients emitted | Observation-only; receives `recipientCount` |
| `rateLimitExceeded` | When per-route or per-IP bucket rejects | Observation-only |
| `preSyncStream` / `postSyncStream` | Per stream chunk emit | Observation-only |

Hook payload shapes live in `@luckystack/core` (`HookPayloads`).

---

## 11. Related

- Originator API: [`./sync-request.md`](./sync-request.md)
- Streaming primitives: [`./streaming.md`](./streaming.md)
- Room mechanics + fanout hooks: [`./room-fanout.md`](./room-fanout.md)
- Skip-self semantics: [`./ignore-self.md`](./ignore-self.md)
- Recipient subscription: [`./callback-registration.md`](./callback-registration.md)
- Version coexistence: [`./version-policy.md`](./version-policy.md)
- Full architecture: [`/docs/ARCHITECTURE_SYNC.md`](../../../docs/ARCHITECTURE_SYNC.md)
- Routing conventions: [`/docs/ARCHITECTURE_ROUTING.md`](../../../docs/ARCHITECTURE_ROUTING.md)
