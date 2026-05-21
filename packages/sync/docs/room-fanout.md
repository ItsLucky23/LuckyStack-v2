# room-fanout

> How `handleSyncRequest` resolves the `receiver` string to a set of Socket.io sockets, iterates them, and notifies hook consumers along the way. Covers the `'all'` sentinel, the per-token room convention, event-loop yielding for giant fanouts, the `preSyncFanout` / `postSyncFanout` hooks, and Redis-backed cross-instance fanout.

For the originator's `receiver` argument see [`./sync-request.md`](./sync-request.md). For per-recipient handler authoring see [`./server-vs-client-handlers.md`](./server-vs-client-handlers.md).

---

## 1. How `receiver` resolves to sockets

`handleSyncRequest` branches on `receiver`:

```ts
const sockets = receiver === 'all'
  ? ioInstance.sockets.sockets                          // Map<socketId, Socket>
  : ioInstance.sockets.adapter.rooms.get(receiver);     // Set<socketId> | undefined
```

- `receiver === 'all'` -> every connected socket on **this instance** (production with Redis adapter: every socket on every instance, see §6).
- Any other string -> the Socket.io room with that name. If the room does not exist or is empty, `sockets` is `undefined` and the fanout fails with `sync.noReceiversFound`.

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

This loop only exists on the socket path (`handleSyncRequest`). The HTTP path (`handleHttpSyncRequest`) does not yield — HTTP requests are inherently isolated per Node.js handler invocation, and the per-instance fanout sits inside a single async block anyway.

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

`recipientCount` differs from `sockets.size` in three cases:

1. **`ignoreSelf: true`** — every socket whose extracted token matches the sender's is skipped. If a user has 3 sockets in the room and triggered the sync themselves, `recipientCount` is `size - 3`.
2. **Sockets disappearing mid-fanout** — `ioInstance.sockets.sockets.get(socketId)` can return `undefined` between resolving the room set and emitting (the socket disconnected). Those iterations `continue` without bumping `recipientCount`.
3. **HTTP transport** — the HTTP path's `_client` execution `continue`s without bumping `recipientCount` only for per-recipient failures it could not recover from; the socket path always bumps for handled (success or error) recipients and only skips disappeared sockets.

This is why the hook payload exposes `recipientCount` instead of a raw room size — observers want the count that actually saw the payload.

---

## 7. Cross-instance fanout via Redis adapter

Single-instance fanout is built into Socket.io. **Cross-instance fanout requires the Redis adapter.** Without it, a `broadcastStream` on instance A reaches sockets on instance A only; sockets on instance B (same room name, different Node process) get nothing.

`@luckystack/server` wires the Redis adapter when `REDIS_URL` is set and the Socket.io Redis adapter peer is installed. With it:

- `io.to(roomCode).emit(...)` reaches every socket in the room **across every instance**.
- `ioInstance.sockets.adapter.rooms.get(roomCode)` still only sees the local instance's members — the Redis adapter handles the cross-instance fanout transparently at the emit layer.

This means `handleSyncRequest`'s **per-recipient `_client` execution only runs against local sockets**. If you need a `_client` handler to execute on every recipient regardless of which instance they're connected to, either:

1. Pin sticky sessions so a given room's sockets all land on the same instance (simplest), OR
2. Wire your own cross-instance per-recipient runner (rare, advanced).

For the common case (broadcast a single `serverOutput` to everyone in the room), the Redis adapter is sufficient. See [`/docs/ARCHITECTURE_SOCKET.md`](../../../docs/ARCHITECTURE_SOCKET.md) for the adapter setup.

---

## 8. `sync.noReceiversFound`

Triggered when the resolved `sockets` is `undefined` or falsy:

- The room name was misspelled.
- Every member already disconnected before the request reached the fanout step.
- A bug had the client `joinRoom`-ing under a different name than the sender's `receiver` argument.
- `receiver: 'all'` while no sockets are connected at all (development edge case).

Surfaced to the originator as:

```ts
{ status: 'error', errorCode: 'sync.noReceiversFound', message: '<localized>', httpStatus: 404 }
```

Default `httpStatus` mapping for this code comes from `defaultHttpStatusForResponse` in `@luckystack/core`.

This is not necessarily a bug — sending to an empty room is legal if the sender doesn't yet know the room is empty. UI typically treats `sync.noReceiversFound` as "your mutation succeeded server-side (the `_server` already ran and persisted state); just nobody happened to be listening". `_server`'s mutations are NOT rolled back when there are zero recipients.

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
