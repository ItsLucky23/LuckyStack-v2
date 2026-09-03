# room-fanout

> How `handleSyncRequest` resolves the `receiver` string to a set of Socket.io sockets, iterates them, and notifies hook consumers along the way. Covers the `'all'` sentinel, the per-token room convention, event-loop yielding for giant fanouts, the `preSyncFanout` / `postSyncFanout` hooks, and Redis-backed cross-instance fanout.

For the originator's `receiver` argument see [`./sync-request.md`](./sync-request.md). For per-recipient handler authoring see [`./server-vs-client-handlers.md`](./server-vs-client-handlers.md).

> **Applies from `@luckystack/sync` 0.10.0.** Earlier versions resolved recipients from this process's own adapter maps, and only the socket transport rejected an empty room. Everything below describes the cross-instance model that replaced that.

---

## 1. How `receiver` resolves to sockets

Both transports — `handleSyncRequest` (socket) and `handleHttpSyncRequest` (HTTP/SSE) — resolve recipients the same way, in the same order:

1. **Format the room.** The `receiver` string goes through the room-name formatter from `@luckystack/core` under the canonical `'broadcast'` purpose, so a non-identity `registerRoomNameFormatter` targets the same physical room the sockets joined (join formats the name too). `'all'` is a sentinel and is never formatted.
2. **Enumerate across instances — before `_server` runs.** The framework asks Socket.io for the members of that physical room on **every** instance sharing the Redis adapter (`io.in(room).fetchSockets()`), or for every socket everywhere when the receiver is `'all'`. The result is a list of `RemoteSocket`s — never a lookup in this process's local room map. This happens after auth, rate-limit and the authorize hooks but **before** input validation and the `_server` handler, so nothing has been persisted yet when it fails.
3. **Empty → `sync.noReceiversFound`.** An empty list ends the request with that error on **both** transports, before `_server` runs, before `preSyncFanout` fires and before any recipient is touched. See §8.
4. `_server` (validate input, execute, persist), then `preSyncFanout`, then the per-recipient loop (§3).

Three consequences worth internalising: a recipient on another instance is a first-class recipient (its `_client` runs, see §7); "does the room exist locally" is never the question — the only question is whether the cross-instance query returned members; and an error from this step is a **pre-commit** rejection — the cross-instance query can fail (an adapter request timeout when an instance on the channel does not answer) and when that happened after `_server` had persisted its mutation the caller was told `error` about a change that had been saved, so a retry applied it twice. The cost of resolving first is a recipient snapshot taken one handler-execution earlier: a socket that joins the room while `_server` runs misses that one fan-out.

Whether the sender is *allowed* to target the room at all is a separate, earlier check (`sync.requireRoomMembership`) whose semantics deliberately differ per transport — see [`/docs/ARCHITECTURE_SYNC.md`](../../../docs/ARCHITECTURE_SYNC.md) → "Room membership is transport-specific".

There is no "broadcast to all but yourself" sentinel — pass `ignoreSelf: true` to skip the originator's own sockets. See [`./ignore-self.md`](./ignore-self.md).

---

## 2. Room conventions

Rooms are managed by `@luckystack/core` (client) via `joinRoom(code)` / `leaveRoom(code)`. Conventions in production code:

| Room name | Membership | Used for |
|---|---|---|
| `<sessionToken>` (auto-joined) | Every socket of one user | `streamTo(token, payload)` reaches all that user's devices. |
| `<sharedCode>` (manual join) | Multiple users by app logic | Collab editors, multiplayer rooms, chat. |
| `'all'` (sentinel, not a real room) | Every connected socket | Global broadcasts. Avoid in production. |

### Why every socket auto-joins a room named after its session token

`@luckystack/server` joins each socket to a room with that socket's session token at connect time. This is what makes `streamTo(['userToken1', 'userToken2'], payload)` work — without it the framework would have to maintain a separate `tokenToSockets` map.

Side effect: if a user is connected from three devices (three sockets, three different `socket.id`s, one session token), `streamTo` reaches all three because they all live in the same per-token room.

---

## 3. The fanout loop

After auth, rate-limit, validation, and `_server` execution succeed, `handleSyncRequest` enters the per-recipient loop:

```
preSyncFanout (stop signal aborts before any recipient is touched)
        |
        v
for each socket in <resolved sockets>:
    yield every N (configurable)
    skip if ignoreSelf && token === recipientToken
    preSyncRecipient (stop without overrideOutput skips this recipient, uncounted;
                      stop WITH overrideOutput replaces serverOutput for this recipient)
    recipientCount++
    if _client exists:
        run clientHandler
        emit per-recipient result (success or normalized error)
    else:
        emit { serverOutput, clientOutput: {}, status: 'success', cb, fullName }
        |
        v
postSyncFanout({ recipientCount, ...payload })
```

Per-recipient errors do **not** abort the loop. A single recipient failing `_client` execution receives a `sync.clientExecutionFailed` frame; everyone else still receives their merged payload.

---

## 4. Event-loop yielding (`sync.fanoutYieldEvery`, `sync.fanoutYieldMs`)

```ts
const { fanoutYieldEvery, fanoutYieldMs } = getProjectConfig().sync;
let tempCount = 1;
for (const socketEntry of sockets) {
  tempCount++;
  if (tempCount % fanoutYieldEvery === 0) {
    await new Promise(resolve => setTimeout(resolve, fanoutYieldMs));
  }
  // ... fanout to this recipient ...
}
```

Why: a `receiver: 'all'` fanout against thousands of sockets would otherwise block the event loop for the whole iteration. Yielding every `fanoutYieldEvery` recipients (default: see `projectConfig.sync.fanoutYieldEvery`) for `fanoutYieldMs` (default: a few ms) lets other socket events, API requests, and the heartbeat handlers run.

Tuning:

- **Higher `fanoutYieldEvery` + lower `fanoutYieldMs`** = faster fanout, less responsiveness for other requests.
- **Lower `fanoutYieldEvery` + higher `fanoutYieldMs`** = smoother for concurrent traffic but slower fanout.
- For typical room sizes (<100 recipients), the yield never triggers — defaults are tuned for `receiver: 'all'` worst cases.

Both transports yield on the same schedule — the HTTP handler's loop reads the same two config keys. An HTTP-invoked fanout still runs on the event loop of the instance that received the request, so a giant `'all'` fanout would starve it just the same.

---

## 5. Hooks dispatched during fanout

### `preSyncFanout`

```ts
{
  routeName: string,         // e.g. 'board/moveCard/v1'
  data: Record<string, unknown>,   // clientInput
  user: SessionLayout | null,      // sender's session
  receiver: string,                 // resolved roomCode or 'all'
  serverOutput: unknown,            // what _server returned (minus status)
}
```

Fires **after** `_server` runs successfully and the recipient set is resolved, **before** any recipient receives the payload. Stop signal converts to an originator-side error envelope with the hook's `errorCode` / `httpStatus`. Use for:

- "Don't fanout this mutation to a degraded region while we drain traffic."
- "Throttle fanout-heavy routes during peak load."
- "Inject a cross-room replication hop before the room receives the payload."

### `preSyncRecipient`

Fires once per resolved recipient, after the `ignoreSelf` skip and before that one socket receives anything. It carries the route name, the receiver, the recipient's socket id, the recipient's session token (`recipientToken`, `null` for an anonymous socket) and the `serverOutput` about to be sent. Exact shape: `HookPayloads` in `@luckystack/core`.

Semantics that differ from the other fanout hooks:

- A stop signal **without** `overrideOutput` skips just this recipient — the loop continues, and the skipped socket is not counted in `recipientCount`.
- A stop signal **with** `overrideOutput` still delivers to this recipient, but with the override in place of `serverOutput` — per-recipient redaction without a `_client` file.
- `recipientUserId` is **always `null`**. There is no resolver option: resolving a user per recipient would cost a session read per socket on the hot path. A handler that needs the user reads the session itself by `recipientToken` (the token is already known in the loop, so it costs nothing to expose).

Fires on both transports and for remote recipients too (§7).

### `postSyncFanout`

```ts
{
  routeName: string,
  data: Record<string, unknown>,
  user: SessionLayout | null,
  receiver: string,
  serverOutput: unknown,
  recipientCount: number,    // actual number of sockets emitted to (NOT room size)
}
```

Fires after the last recipient's emit. Observation-only — there is no stop signal because the fanout has already happened. Use for:

- Audit logs ("this mutation reached N viewers").
- Metrics (`fanout_size_histogram.observe(recipientCount)`).
- Cross-region eventual-consistency markers.

### `rateLimitExceeded`

```ts
// Scope 'user' or 'route' (per-token / per-IP per-route bucket):
{
  scope: 'user' | 'route',
  key: string,            // 'token:<token>:sync:<route>' or 'ip:<ip>:sync:<route>'
  limit: number,
  windowMs: number,
  count: number,
  route: string,
  userId: string | undefined,
}

// Scope 'ip' (global per-IP cross-route bucket):
{
  scope: 'ip',
  key: string,            // 'ip:<ip>:sync:all'
  limit: number,
  windowMs: number,
  count: number,
  ip: string,
}
```

Fires before fanout begins, when either bucket rejects. Used to surface abusive senders and feed automated mitigation.

---

## 6. `recipientCount` vs raw room size

`recipientCount` differs from the size of the resolved recipient list in two cases, identically on both transports:

1. **`ignoreSelf: true`** — every socket whose extracted token matches the sender's is skipped. If a user has 3 sockets in the room and triggered the sync themselves, `recipientCount` is `size - 3`.
2. **`preSyncRecipient` stop without `overrideOutput`** — the recipient is skipped and not counted (§5).

What does **not** reduce it:

- **Sockets disappearing mid-fanout.** The recipient list is a snapshot of `RemoteSocket`s taken once, before the loop. A socket that disconnects between the snapshot and its turn is still iterated: the loop emits to the remote handle, the adapter drops the emit because the target is gone, and the recipient is still counted. There is no per-iteration "does this socket still exist" re-check against a local map — that check would only be answerable for local sockets anyway.
- **A failing `_client`.** The recipient is counted before `_client` runs, so a recipient that received an error frame counts the same as one that received a success frame.

So `recipientCount` is "how many recipients the loop emitted to", not "how many received the payload" — the second number does not exist on the server side of an adapter. Observers wanting delivery confirmation need a client-side ack of their own.

---

## 7. Cross-instance fanout via Redis adapter

Single-instance fanout is built into Socket.io. **Cross-instance fanout requires the Redis adapter**, which `@luckystack/server` attaches on every backend (see [`/docs/ARCHITECTURE_SOCKET.md`](../../../docs/ARCHITECTURE_SOCKET.md)). Two mechanisms ride on it:

- `io.to(room).emit(...)` — used by the streaming emitters — publishes to Redis; every instance delivers to its own members of that room.
- `io.in(room).fetchSockets()` + `RemoteSocket.emit()` — used by the regular sync fanout — enumerates the room across all instances and delivers to each member individually.

**The per-recipient `_client` handler runs for remote recipients too.** The fanout loop iterates the cross-instance list, runs `_client` on the instance that is handling the request (it has the route code, the `serverOutput`, and the recipient's handshake headers and token), and delivers the result through the recipient's `RemoteSocket`. No sticky sessions are needed for correctness; spreading one room's members across instances is fine. The cost model (one Redis round-trip per fanout plus one emit per remote recipient) is in [`/docs/ARCHITECTURE_MULTI_INSTANCE.md`](../../../docs/ARCHITECTURE_MULTI_INSTANCE.md).

> **Warning — `io.sockets.adapter.rooms`, `io.sockets.adapter.sids` and enumerating `io.sockets.sockets` are per-instance maps.** They answer "who is connected to *this process*", which under the Redis adapter is a partial view that looks complete: no error, just missing members. A helper that builds a room snapshot, a presence list or a broadcast target from them works on one instance and silently drops the rest of the cluster on two. Use instead:
>
> - `getRoomSockets(room, { userId? })` from `@luckystack/core` — routes the room through the formatter under `'broadcast'` and returns the cross-instance `RemoteSocket[]` (`'all'` = every socket everywhere). It throws when no Socket.io server is registered, because a silent empty list is exactly the failure this exists to prevent.
> - `io.in(room).fetchSockets()` / `io.to(room).emit()` directly when you already hold the physical room name.
>
> Three guards catch the mistake before production does: the ESLint rule `luckystack/no-local-socket-enumeration` in `@luckystack/core/eslint` flags the patterns statically; outside production `getIoInstance()` returns a guarded view that **throws** on those accessors (`sockets.sockets.get(id)` stays allowed); and `getIoInstance({ raw: true })` is the explicit opt-in for deliberate per-instance work — a sweep cleaning up its own connections, or sampling this process's backpressure. In production the raw instance is always returned, so the guard costs nothing on the hot path.

`recipientCount` in `postSyncFanout` counts recipients on every instance, not just local ones.

---

## 8. `sync.noReceiversFound`

Triggered on **both transports** when the cross-instance recipient list (§1) comes back empty. Before 0.10.0 only the socket transport rejected this; the HTTP/SSE path returned `success` with zero recipients, so an HTTP caller could not tell "delivered" from "nobody there". Typical causes:

- The room name was misspelled.
- Every member already disconnected before the request reached the fanout step.
- A bug had the client `joinRoom`-ing under a different name than the sender's `receiver` argument.
- A room-name formatter that folds the caller's `userId` into the physical name — join and fanout then land in different physical rooms (see the formatter contract in `packages/core/docs/socket-bootstrap.md`).
- On `routed-http`: the caller's session still lists the room in `roomCodes` (so the membership check passed) but no socket has re-joined it — see the membership section in [`/docs/ARCHITECTURE_SYNC.md`](../../../docs/ARCHITECTURE_SYNC.md).
- `receiver: 'all'` while no sockets are connected at all (development edge case).

Surfaced to the originator as:

```ts
{ status: 'error', errorCode: 'sync.noReceiversFound', message: '<localized>', httpStatus: 404 }
```

Default `httpStatus` mapping for this code comes from `defaultHttpStatusForResponse` in `@luckystack/core`.

This is not necessarily a bug — sending to an empty room is legal if the sender doesn't yet know the room is empty. Recipients are resolved **before** `_server` runs (§1), so on this error nothing has been persisted: the mutation did NOT happen, and a retry once someone is listening is safe. (Earlier versions ran the check after `_server`, so the UI had to read this error as "saved, but nobody was listening"; that reading is now wrong.)

---

## 9. Sanity-check checklist

- Are sockets joining the right room? `socket.rooms` on the recipient side lists every room they're in (including the auto-joined `<sessionToken>` room and `<socket.id>` self-room).
- Is the Redis adapter wired in production? `getIoInstance().of('/').adapter` should be `RedisAdapter`, not `Adapter`.
- Are giant fanouts hot in the profiler? Bump `fanoutYieldEvery` higher OR move to per-token rooms instead of `receiver: 'all'`.
- Is `recipientCount` consistently below room size? Probably `ignoreSelf: true` + multi-tab usage. Expected; not a bug.

---

## 10. Related

- Originator API: [`./sync-request.md`](./sync-request.md)
- Handler authoring: [`./server-vs-client-handlers.md`](./server-vs-client-handlers.md)
- Skip-self semantics: [`./ignore-self.md`](./ignore-self.md)
- Streaming fanout: [`./streaming.md`](./streaming.md)
- Error catalog (including `sync.noReceiversFound`): [`./error-states.md`](./error-states.md)
- Socket.io + Redis adapter: [`/docs/ARCHITECTURE_SOCKET.md`](../../../docs/ARCHITECTURE_SOCKET.md)
- Hook payload shapes: `@luckystack/core` `HookPayloads`
- Config: `projectConfig.sync.fanoutYieldEvery`, `projectConfig.sync.fanoutYieldMs`
