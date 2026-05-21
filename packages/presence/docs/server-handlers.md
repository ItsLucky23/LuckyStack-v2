# Server Handlers

> Socket lifecycle entry points exported from `@luckystack/presence`. These are the per-connection hooks that consumers (or the framework) call inside their socket.io `connect` / `disconnect` listeners.

The three handlers documented here all share one assumption: a session token has been extracted from the socket and resolves (or has previously resolved) to a session via `getSession(token)` in `@luckystack/login`. Without a token the handlers either no-op or warn — they are deliberately defensive so consumers can call them unconditionally inside a `socket.on(...)` listener.

`@luckystack/server` already wires all three by default (see `packages/server/src/loadSocket.ts`). You only need to call them directly when:

- you build your own socket.io setup without `createLuckyStackServer`, or
- you need to invoke `socketLeaveRoom` from an HTTP route / cron job that does not have a live socket on the connect path.

## Signatures

```ts
import {
  socketConnected,
  socketDisconnecting,
  socketLeaveRoom,
} from '@luckystack/presence';

socketConnected(args: { token: string; io: Server }): Promise<void>;

socketDisconnecting(args: {
  token: string;
  reason: string;
  socket: Socket;
}): Promise<void>;

socketLeaveRoom(args: {
  token: string | null;
  socket: Socket;
  newPath: string | null;
}): Promise<BaseSessionLayout | null>;
```

`Server` / `Socket` are the `socket.io` types. `BaseSessionLayout` comes from `@luckystack/core` (the project session shape, defaults to the Prisma `User` extended with `roomCodes`).

## `socketConnected({ token, io })`

Call this once at the top of your `io.on('connect', socket => ...)` listener, after extracting the session token.

What it does, in order:

1. Looks up the per-token disconnect timer in `disconnectTimers`. If one exists, the socket is reconnecting inside its grace window:
   - Clears the timeout.
   - Removes the token from `tempDisconnectedSockets`.
   - Sets a local `isReconnect = true` flag.
2. Reads the session via `getSession(token)` to grab `roomCodes` and `userId`.
3. If `isReconnect`, dispatches `postSocketReconnect` with `{ token, userId, roomCodes }` (asynchronously — the dispatch is fire-and-forget, the lifecycle handler does not await consumer hooks).
4. If the session has at least one room code and a `userId`, calls `informRoomPeers` with the `userBack` event and `ignoreSelf: true`, broadcasting `{ userId }` to every peer socket in the shared rooms.

Edge cases:

- No prior timer + no roomCodes + no userId → emits no `userBack`, dispatches no `postSocketReconnect`. This is the cold-connect path. Use the `onSocketConnect` hook from `@luckystack/server` for cold-connect logic; `postSocketReconnect` is reserved for the reconnect-only case.
- A token with a timer but no session (session was deleted while the timer was running) → still dispatches `postSocketReconnect` with `userId: null, roomCodes: []`. The room broadcast is skipped.
- `io` not yet attached → `informRoomPeers` warns `presence: no io instance found to inform room peers` and returns. The disconnect timer cleanup still happens.

Typical call site (`packages/server/src/loadSocket.ts`):

```ts
io.on(socketEventNames.connect, (socket) => {
  const token = extractTokenFromSocket(socket);
  if (token) {
    socketConnected({ token, io });
  }
  // ... custom socket.on handlers
});
```

## `socketDisconnecting({ token, reason, socket })`

Wire this to `socket.on(socketEventNames.disconnect, reason => ...)`. It opens the disconnect grace window so a network blip / browser refresh / tab switch does not immediately tear down session state.

What it does:

1. Reads `getPresenceConfig().ignoreReasons`. If `reason` is in the list (default `['ping timeout']`), logs `presence: ignored disconnect` and returns. No timer, no peer notification.
2. Returns early when `token` is falsy.
3. Skips if `tempDisconnectedSockets.has(token)` already — guards against duplicate `disconnect` events on the same socket.
4. Otherwise adds the token to `tempDisconnectedSockets`.
5. Computes the grace duration via `getDisconnectTime({ token, reason })`:
   - `clientSwitchedTab.has(token)` → `disconnectTimers.tabSwitchMs` (default `20_000`). The flag is then cleared and `deleteSessionOnDisconnect` is set to `false` — a tab-switch reconnect must keep the session alive even if the timer expires before reconnection.
   - `allowReasons.includes(reason)` → `disconnectTimers.transportCloseMs` (default `60_000`). Used for `transport close` / `transport error`.
   - else → `disconnectTimers.defaultMs` (default `2_000`).
6. Schedules a `setTimeout(time, ...)` that, on expiry:
   - Drops the token from `tempDisconnectedSockets`.
   - Confirms it is still the active timer (`disconnectTimers.get(token) === timeout`) — guards against a reconnect that already replaced the timer.
   - Calls `socketLeaveRoom({ token, socket, newPath: null })`.
   - When `deleteSessionOnDisconnect`, calls `deleteSession(token)`. (For tab-switch flows this stays false so the session survives the gap.)
   - Logs `presence: user fully disconnected`.
7. Clears any pre-existing timer for the same token, then stores the new one in `disconnectTimers`.

Edge cases:

- A reason in `ignoreReasons` means presence treats the disconnect as a momentary noise event — no `tempDisconnectedSockets` insert, no timer, no session delete. The socket is gone from `io.sockets` but presence keeps state intact, waiting for the next connect.
- If `socketConnected` fires before the timer expires, it clears the timer and the cleanup never runs.
- `socket` is required so the eventual cleanup can call `socket.leave(...)` / `socket.disconnect(...)` if needed. Passing a stale socket is safe (socket.io leaves are idempotent).

## `socketLeaveRoom({ token, socket, newPath })`

Programmatic room-leave entry point. Two real callers:

1. The disconnect-grace timer in `socketDisconnecting` (passes `newPath: null`).
2. The `updateLocation` socket event in `@luckystack/server` (passes `newPath: newLocation.pathName`) — wired only when `activityBroadcasterEnabled === true`.

The current implementation is intentionally minimal: it validates that the caller has a token, resolves the session, and returns the session (or `null` on failure). It does **not** mutate room membership directly — that happens in the caller via `await saveSession(token, { ...session, roomCodes: nextRoomCodes })` and `socket.leave(roomCode)`.

What it does:

1. If `token` is falsy → `getLogger().warn('presence: trying to update room peers but no token provided')` and returns `null`.
2. Calls `getSession(token)`. If the session is missing or `id` is undefined → `getLogger().warn('presence: no session data for given token', { token })` and returns `null`.
3. Otherwise returns the session (typed as `BaseSessionLayout` / Prisma `User`).

Returning the session lets the `updateLocation` listener short-circuit a second `getSession` call:

```ts
let returnedUser: BaseSessionLayout | null = null;
if (activityBroadcasterEnabled) {
  returnedUser = await socketLeaveRoom({ token, socket, newPath: newLocation.pathName });
}
const user = returnedUser || (await getSession(token));
```

When you call this from a non-framework consumer:

```ts
import { socketLeaveRoom } from '@luckystack/presence';

const session = await socketLeaveRoom({
  token: extractTokenFromSocket(socket),
  socket,
  newPath: null,
});
if (!session) return; // already logged a warn
// session.roomCodes is the prior membership; mutate + save as needed
```

## Framework wiring reference

`packages/server/src/loadSocket.ts` calls these in three places — match this layout if you build your own server:

```ts
io.on(socketEventNames.connect, (socket) => {
  const token = extractTokenFromSocket(socket);
  const activityBroadcasterEnabled = config.socketActivityBroadcaster ?? false;

  if (token) {
    socketConnected({ token, io });
  }

  socket.on(socketEventNames.disconnect, (reason: string) => {
    if (activityBroadcasterEnabled && token) {
      socketDisconnecting({ token, socket, reason });
    }
  });

  socket.on(socketEventNames.updateLocation, (newLocation) => {
    if (!token) return;
    void withSessionLock(token, async () => {
      let user: BaseSessionLayout | null = null;
      if (activityBroadcasterEnabled) {
        user = await socketLeaveRoom({ token, socket, newPath: newLocation.pathName });
      }
      user = user || (await getSession(token));
      // ...persist new location
    });
  });

  if (activityBroadcasterEnabled && token) {
    initActivityBroadcaster({ socket, token });
  }
});
```

The `activityBroadcasterEnabled` gate keeps `socketDisconnecting` (and therefore the grace window + peer notification) opt-in. Apps that do not enable `projectConfig.socketActivityBroadcaster` still get `onSocketDisconnect` from `@luckystack/server`, but presence's grace-window machinery never engages.

## Common mistakes

- Calling `socketConnected` without `await` is fine — the function dispatches its async work internally and the framework intentionally does not await it (presence broadcasting must never block the connect path).
- Calling `socketDisconnecting` from outside the actual disconnect listener (e.g. from a logout handler) will incorrectly start a grace timer. For logout, dispatch `postLogout` instead — presence already subscribes to it and cleans up its state (see `docs/lifecycle.md`).
- Passing a `newPath` to `socketLeaveRoom` does not currently change behavior — it is reserved for a future per-path room reconciliation pass. Leave it `null` unless you are wiring the framework's `updateLocation` flow.

## See also

- [`docs/disconnect-grace.md`](./disconnect-grace.md) — timer math + reason classification.
- [`docs/peer-notifier.md`](./peer-notifier.md) — `informRoomPeers` + `pre/postPresenceUpdate` hooks.
- [`docs/lifecycle.md`](./lifecycle.md) — end-to-end timeline + hook ordering.
- [`docs/activity-broadcaster.md`](./activity-broadcaster.md) — `initActivityBroadcaster` + activity-event registry.
