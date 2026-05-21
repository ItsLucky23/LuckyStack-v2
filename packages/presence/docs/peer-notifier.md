# Peer Notifier

> `informRoomPeers` is the internal fan-out helper that emits `userAfk` / `userBack` socket events to every peer in every room a token belongs to. It is the only writer of those two socket events inside `@luckystack/presence`. Two hooks fire around the fan-out — `prePresenceUpdate` before peer iteration, and `postPresenceUpdate` after — so consumers can audit, gate, or layer behavior without forking the helper.

## Signature

```ts
import { informRoomPeers } from '@luckystack/presence/activity/peerNotifier'; // internal path
```

Although `informRoomPeers` is not re-exported from the package barrel today (it lives at the internal subpath), the function is stable and documented because the framework + tests call into it. Public consumers should drive the same behavior by dispatching activity events or relying on `socketConnected` / `initActivityBroadcaster`, not by importing the internal helper.

```ts
export const informRoomPeers = async (args: {
  token: string;
  io?: Server | null;       // defaults to getIoInstance()
  event:
    | typeof socketEventNames.userAfk
    | typeof socketEventNames.userBack;
  extraData?: {
    ignoreSelf?: boolean;
    time?: number;          // only used for userAfk — becomes (now + time)
  };
}) => Promise<void>;
```

Return type is `Promise<void>`. The helper never throws on missing data — every short-circuit path logs (when relevant) and resolves cleanly.

## Argument breakdown

### `token` (required)

Session token. Used to:

1. Look up the session via `getSession(token)` so we know which rooms to fan out into and which `userId` to attach to the emitted payload.
2. Filter the originator socket out when `extraData.ignoreSelf === true`. `extractTokenFromSocket(peerSocket) === token` is the comparison; the function relies on every socket carrying its session token in the same place core's extractor reads from.

### `io` (optional)

Defaults to `getIoInstance()` (from `@luckystack/core`). Override when you need to broadcast through a non-default io instance — e.g. a separate namespace or a test harness. If `io` is `null` / `undefined` after the default fallback, the helper warns `presence: no io instance found to inform room peers` and returns.

### `event` (required)

One of `socketEventNames.userAfk` or `socketEventNames.userBack`. Determines:

- `kind: 'afk' | 'back'` on the pre/post hook payloads.
- The emitted payload shape per peer (`userAfk` includes `endTime`, `userBack` does not).
- Which branch of the emit loop runs.

### `extraData.ignoreSelf` (optional, default `false`)

Filter that excludes the originator socket from peer iteration. The helper compares `extractTokenFromSocket(peerSocket) == token` and skips matches. Used by `socketConnected` so a user does not receive their own `userBack` echo.

### `extraData.time` (optional, only for `userAfk`)

Added to `Date.now()` to compute the `endTime` field of the `userAfk` payload. The client uses `endTime` to render "John is away — back in ~20s" countdowns. Passed by `initActivityBroadcaster` based on the upcoming grace window (`getDisconnectTime`). For `userBack` the field is ignored.

## Execution order

1. **`ensureIo` guard** — if `io` is nullish, log + return.
2. **Session lookup** — `await getSession(token)`. The result feeds:
   - `roomCodes`: filtered `session?.roomCodes` keeping only non-empty strings.
   - `userId`: `session.id ?? null` (typed as the project session id, defaults to the Prisma `User.id` string).
3. **Early exit** — if there is no session or zero room codes, return. Lone-user tokens that have not joined any room are silently skipped (they have nobody to notify).
4. **`prePresenceUpdate` dispatch** — fires `{ token, userId, kind, roomCodes }` (kind derived from `event`). Consumers may abort here (the helper does not check the result; this is "audit" surface, not "veto" surface — if you need a veto, file an issue).
5. **Peer iteration** — for each room code:
   - `io.sockets.adapter.rooms.get(room)` → set of socket ids.
   - For each socket id, skip if already in `handledSockets` (de-dupe across overlapping rooms — a peer in two shared rooms only receives one emit).
   - Resolve the socket via `io.sockets.sockets.get(socketKey)`. If gone (already disconnected), continue.
   - If `extraData.ignoreSelf`, skip when the peer's token matches the originator.
   - Emit:
     - `userAfk` → `tempSocket.emit('userAfk', { userId: session.id, endTime: Date.now() + (extraData.time || 0) })`.
     - `userBack` → `tempSocket.emit('userBack', { userId: session.id })`.
   - Increment `recipientCount`.
6. **`postPresenceUpdate` dispatch** — fires `{ token, userId, kind, roomCodes, recipientCount }`. `recipientCount` is the number of `emit()` calls actually made (never includes the originator when `ignoreSelf` is true).

The dedupe set ensures that a user in rooms A and B who shares both rooms with the same peer only gets one `userAfk` / `userBack` event for that peer, not one per shared room.

## Return shapes

The function returns `Promise<void>`. The four short-circuit conditions:

1. `!ensureIo(io)` → warn + return. No hooks fire.
2. Session missing → return silently. No hooks fire. (This guards against late events for tokens whose session was already deleted.)
3. `roomCodes.length === 0` → return silently. No hooks fire.
4. Normal path → both hooks fire; one emit per non-deduped non-self peer.

## Hook contracts

### `prePresenceUpdate`

Payload:

```ts
export interface PrePresenceUpdatePayload {
  token: string;
  userId: string | null;
  kind: 'afk' | 'back';
  roomCodes: string[];
}
```

Fired before the emit loop. Receives the full set of room codes so a consumer can compute "how many peers might receive this" by walking the io adapter themselves. Typical uses:

- Audit log: "user X went AFK in rooms [...]"
- Side-effect: write a `presence.event` row for the analytics pipeline
- Pre-emit metrics: increment `presence.broadcast.start` counters

```ts
import { registerHook } from '@luckystack/core';

registerHook('prePresenceUpdate', async ({ token, userId, kind, roomCodes }) => {
  metrics.increment(`presence.broadcast.start`, { kind, rooms: roomCodes.length });
});
```

### `postPresenceUpdate`

Payload:

```ts
export interface PostPresenceUpdatePayload extends PrePresenceUpdatePayload {
  recipientCount: number;
}
```

Fired after every peer emit. `recipientCount` is the count of `emit()` invocations made:

- Excludes the originator when `ignoreSelf === true`.
- De-duplicates across shared rooms (a peer in two rooms with the originator counts once).
- May be `0` if the room set contained only the originator (with `ignoreSelf`) or only dead/disconnected socket ids.

Typical uses:

- Recipient-count metrics: "average fan-out per AFK event."
- Compensation logic: if `recipientCount === 0`, fall back to a queued message.
- Latency tracking: `Date.now() - preTimestamp` to measure broadcast time.

```ts
registerHook('postPresenceUpdate', async ({ kind, recipientCount }) => {
  if (recipientCount === 0) {
    getLogger().debug(`presence: ${kind} fan-out had no recipients`);
  }
});
```

### Recipient-count semantics — `informRoomPeers` vs default AFK event

The default `'afk'` activity event uses `io.to(roomName).emit(...)` (room-level fan-out) instead of socket iteration. It cannot cheaply count recipients, so its `postPresenceUpdate` payload uses `recipientCount: -1` as a sentinel. Consumers that need accurate counts should rely on the `informRoomPeers` path (used by `socketConnected` and `initActivityBroadcaster`) and treat `-1` as "unknown."

## Emitted socket events

### `socketEventNames.userAfk`

Per-peer payload: `{ userId: string, endTime: number }`. `endTime` is `Date.now() + extraData.time`. Clients display countdowns or fade the peer's avatar.

### `socketEventNames.userBack`

Per-peer payload: `{ userId: string }`. Clients restore the peer's avatar to normal.

## Internal de-duplication

```ts
const handledSockets = new Set<string>();
for (const room of roomCodes) {
  const roomSockets = io.sockets.adapter.rooms.get(room);
  for (const socketId of roomSockets || []) {
    if (handledSockets.has(socketId)) continue;
    handledSockets.add(socketId);
    // ... emit
  }
}
```

The set is per-`informRoomPeers` call; it does not persist between calls. Across two distinct presence events (e.g. AFK then back), the same peer receives both, as intended.

## Edge cases

- **Originator is in the room they emit into** — without `ignoreSelf`, the originator receives their own event. The fan-out callers that matter (`socketConnected`, default AFK event) all set `ignoreSelf: true` or use room-level emit that bypasses the issue.
- **Stale socket id in the adapter** — `io.sockets.sockets.get(socketKey)` returns `undefined`; the iteration continues. No emit, no increment.
- **Room exists but has zero members** — `roomSockets` is `undefined` (or empty Set); the loop is a no-op for that room.
- **Single-instance vs Redis adapter** — when the redis adapter is attached, `io.sockets.adapter.rooms.get(room)` only includes locally-connected sockets. Remote peers are reached via the underlying socket.io adapter's pub/sub when the helper calls `tempSocket.emit(...)` — no, that is misleading: `tempSocket.emit` is local only. For cross-instance presence broadcasts you currently need `@luckystack/sync` or the `io.to(room).emit(...)` form used by the default AFK event. `informRoomPeers` is local-instance fan-out.

## Why `informRoomPeers` is not in the public barrel

The function is too tightly coupled to `getSession` + `extractTokenFromSocket` semantics to expose as a stable user-facing API. Consumers wanting custom presence broadcasts should either:

- Register a custom `ActivityEvent` (see [`docs/activity-broadcaster.md`](./activity-broadcaster.md)) and use `io.to(roomName).emit(...)` directly inside the `onTrigger` callback, **or**
- Drive `userAfk` / `userBack` via the framework wiring (intentional disconnect / reconnect-through-grace) and read the post-hook for downstream effects.

If a public-facing variant is added later, it will live next to `socketLeaveRoom` in the package barrel.

## See also

- [`docs/server-handlers.md`](./server-handlers.md) — `socketConnected` calls `informRoomPeers` on reconnect.
- [`docs/activity-broadcaster.md`](./activity-broadcaster.md) — `initActivityBroadcaster` calls `informRoomPeers` for tab-switch AFK.
- [`docs/lifecycle.md`](./lifecycle.md) — full timeline with hook ordering.
- `packages/presence/src/activity/peerNotifier.ts` — source.
- `packages/presence/src/hookPayloads.ts` — payload types + `HookPayloads` augmentation.
