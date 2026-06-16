# Presence Lifecycle

> End-to-end timeline of every presence event from socket connect through reconnect, AFK, intentional disconnect, hard disconnect, and logout. Cross-references the helpers documented in [`docs/server-handlers.md`](./server-handlers.md), [`docs/disconnect-grace.md`](./disconnect-grace.md), [`docs/peer-notifier.md`](./peer-notifier.md), and [`docs/activity-broadcaster.md`](./activity-broadcaster.md). Also documents `registerPresenceHooks()` — the one-shot boot wiring — and the `postSocketReconnect` hook payload.

## `registerPresenceHooks()`

```ts
import { registerPresenceHooks } from '@luckystack/presence';

registerPresenceHooks();
```

Idempotent — a module-level `registered` flag short-circuits subsequent calls so it is safe to invoke from multiple entry points (server bootstrap, test setup, etc.). Today the function does exactly one thing: subscribe presence's cleanup handler to the `postLogout` hook from `@luckystack/login`.

The handler runs synchronously on every logout:

```ts
registerHook('postLogout', ({ token }): HookResult => {
  if (!token) return undefined;

  if (tempDisconnectedSockets.has(token)) {
    tempDisconnectedSockets.delete(token);
  }

  if (disconnectTimers.has(token)) {
    const timer = disconnectTimers.get(token);
    if (timer) {
      clearTimeout(timer);
      disconnectTimers.delete(token);
    }
  }

  return undefined;
});
```

Why this lives in `@luckystack/presence` (not in `@luckystack/login`):

- Earlier the cleanup was inline at the top of `logout()` in the login package. That meant `@luckystack/login` directly imported `@luckystack/presence` to read its state maps — a circular dependency in spirit (presence already depends on login for `getSession`).
- Moving the cleanup into a hook subscription inverts the direction: login owns the lifecycle event, presence owns its own state. Login knows nothing about presence's existence.

Call `registerPresenceHooks()` at the very start of your boot — alongside other framework registrations and *before* `createLuckyStackServer(...)`. The order does not strictly matter for the `postLogout` hook (logout cannot fire before the server is listening), but consistent ordering makes boot failures easier to read.

## Hook surface owned by presence

| Hook | Source file | Fired by | Receives | Use |
| --- | --- | --- | --- | --- |
| `prePresenceUpdate` | `hookPayloads.ts` | `informRoomPeers` (broadcast.ts) + default AFK event | `{ token, userId, kind: 'afk' \| 'back', roomCodes }` | Audit / metrics before peer iteration. |
| `postPresenceUpdate` | `hookPayloads.ts` | same as pre | pre payload + `recipientCount: number` | Audit / metrics after peer iteration. `recipientCount` is the real per-peer emit count (including the default AFK event, which now fans out via `informRoomPeers`). |
| `postSocketReconnect` | `hookPayloads.ts` | `socketConnected` when a timer was active | `{ token, userId: string \| null, roomCodes: string[] }` | Rehydrate client state, replay missed events, refresh caches. |
| `postDisconnectGraceExpired` | `hookPayloads.ts` | `socketDisconnecting` grace timer, on expiry | `{ token, userId, roomCodes, reason, sessionDeleted }` | Mark offline in DB, persist final state, audit the departure — the only "user truly gone" seam. |

Hooks consumed by presence:

| Hook | Source | Handler |
| --- | --- | --- |
| `postLogout` | `@luckystack/login` | `registerPresenceHooks()` cleanup — clears `disconnectTimers[token]` and `tempDisconnectedSockets.delete(token)`. |

## `PostSocketReconnectPayload`

```ts
export interface PostSocketReconnectPayload {
  token: string;
  userId: string | null;
  roomCodes: string[];
}
```

Fired **only** when a previously-disconnected socket reconnects within the disconnect grace window. The framework discriminates between:

- **Cold connect** — no prior timer existed for this token. The framework's `onSocketConnect` hook (from `@luckystack/server`) is the right surface; `postSocketReconnect` does **not** fire.
- **Reconnect inside grace** — `disconnectTimers.get(token)` resolved to a live timer at connect time. `socketConnected` cancels the timer, clears the temp-disconnected flag, and dispatches `postSocketReconnect`.

The `userId` may be `null` if the session was deleted by some other code while the grace timer was running — the cleanup is best-effort. Consumers that need a guaranteed user should re-fetch the session inside the handler:

```ts
import { registerHook } from '@luckystack/core';

registerHook('postSocketReconnect', async ({ token, userId, roomCodes }) => {
  if (!userId) {
    getLogger().warn('postSocketReconnect: session gone for token', { token });
    return;
  }
  // Rehydrate the client: replay any sync events queued during the gap, etc.
});
```

## End-to-end timelines

The timelines below assume `projectConfig.socketActivityBroadcaster === true` (presence is fully enabled). Without that flag the grace-window machinery never engages — `onSocketConnect` / `onSocketDisconnect` from `@luckystack/server` still fire, but no `userAfk` / `userBack` / `postSocketReconnect`.

### 1. Cold connect → activity → AFK timeout → cleanup

```
T+0      socket.io transport CONNECT  (token T)
         ├── socketConnected({ token: T, io })
         │     ├── disconnectTimers.get(T) -> undefined  ── cold connect path
         │     ├── isReconnect = false
         │     ├── (no postSocketReconnect dispatch)
         │     └── (no userBack broadcast — cold connect)
         └── @luckystack/server dispatches `onSocketConnect`

T+0..5m  app emits dispatchActivitySample(...) on heartbeats
         ├── default 'afk' event trigger:
         │     sample.now - sample.lastActivity > 5 * 60_000
         │       -> false (user still active)
         └── nothing fires

T+5m     dispatchActivitySample(...) — user has been idle 5+ minutes
         ├── default 'afk' event trigger -> true
         ├── refractoryMs check passes (no prior fire)
         ├── onTrigger -> informRoomPeers({ token, event: userAfk, extraData: { time: afkTimeoutMs } })
         │     ├── readSession(token) -> { id: userId, roomCodes }
         │     ├── prePresenceUpdate({ token, userId, kind: 'afk', roomCodes })  (veto seam)
         │     ├── for each peer socket in those rooms (adapter-aware fetchSockets):
         │     │     peerSocket.emit(socketEventNames.userAfk, { userId, endTime: now + afkTimeoutMs })
         │     └── postPresenceUpdate({ token, userId, kind: 'afk', roomCodes, recipientCount: N })

T+5m+60s next dispatchActivitySample:
         ├── trigger -> true, but refractoryMs (60_000) not elapsed
         └── skip
```

### 2. Tab switch (intentionalDisconnect) → grace → reconnect

```
T+0      socket connected, user clicks a different tab
         client emits socketEventNames.intentionalDisconnect

T+0      initActivityBroadcaster's listener fires:
         ├── clientSwitchedTab.add(token)
         ├── time = getDisconnectTime({ token, reason: undefined })
         │     -> disconnectTimers.tabSwitchMs (20_000)
         ├── informRoomPeers({ event: userAfk, extraData: { time: 20_000 } })
         │     ├── prePresenceUpdate({ kind: 'afk' })
         │     ├── emit userAfk to peers with endTime = now + 20_000
         │     └── postPresenceUpdate({ recipientCount: N })
         └── socket.disconnect(false)

T+0      socket.on('disconnect') fires with reason='client namespace disconnect'
         ├── socketDisconnecting({ token, reason, socket })
         │     ├── reason not in ignoreReasons
         │     ├── tempDisconnectedSockets.add(token)
         │     ├── getDisconnectTime -> tabSwitchMs (clientSwitchedTab is set)
         │     ├── clientSwitchedTab.delete(token), deleteSessionOnDisconnect = false
         │     └── setTimeout(20_000, cleanup)

T+0..20s user returns to tab, socket reconnects with same session token

T+~3s    socketConnected({ token, io })
         ├── disconnectTimers.get(token) -> live timer
         ├── clearTimeout, disconnectTimers.delete, tempDisconnectedSockets.delete
         ├── isReconnect = true
         ├── postSocketReconnect({ token, userId, roomCodes })  -- consumer hook
         └── informRoomPeers({ event: userBack, ignoreSelf: true })
               ├── prePresenceUpdate({ kind: 'back' })
               ├── emit userBack to peers
               └── postPresenceUpdate({ recipientCount: N })
```

### 3. Transport close (refresh) → grace → reconnect

```
T+0      user hits F5 / browser tab moves to back/forward cache
         socket.io transport closes with reason='transport close'

T+0      socketDisconnecting({ token, reason: 'transport close', socket })
         ├── reason not in ignoreReasons
         ├── tempDisconnectedSockets.add(token)
         ├── getDisconnectTime:
         │     clientSwitchedTab.has(token) -> false
         │     allowReasons.includes('transport close') -> true
         │     -> transportCloseMs (60_000)
         ├── deleteSessionOnDisconnect = true  (no tab-switch flag)
         └── setTimeout(60_000, cleanup)

T+0..60s page rehydrates, socket.io client reconnects with same token

T+~2s    socketConnected -> same reconnect path as timeline 2
         (postSocketReconnect + userBack broadcast)
```

### 4. Hard disconnect → grace expires → session delete

```
T+0      laptop closes, network drops
         socket.io transport eventually decides reason='transport close'

T+0      socketDisconnecting -> 60_000 ms grace timer scheduled

T+60s    no reconnect; timer fires:
         ├── tempDisconnectedSockets.has(token) -> true, delete
         ├── disconnectTimers.get(token) === timeout, ok
         ├── socketLeaveRoom({ token, socket, newPath: null })
         │     ├── getSession(token) -> session (still alive at this point)
         │     └── returns session
         └── deleteSession(token)   (because deleteSessionOnDisconnect was true)
               (the login package then fires preSessionDelete/postSessionDelete,
                clears active-tokens set, etc.)
```

### 5. Ping timeout → no-op

```
T+0      heartbeat misses fire, transport reports reason='ping timeout'

T+0      socketDisconnecting:
         ├── getPresenceConfig().ignoreReasons.includes('ping timeout') -> true
         └── log "presence: ignored disconnect" and return
         (no timer, no peer notify, no session delete)

T+~3s    socket.io transport reconnects with same token
         ├── socketConnected:
         │     ├── disconnectTimers.get(token) -> undefined
         │     └── treated as cold connect (no postSocketReconnect)
```

The `ping timeout` reason is the canonical "treat as no-op" case — the transport will reconnect on its own milliseconds later. This is why it ships in the default `ignoreReasons`.

### 6. Logout → presence cleanup

```
T+0      user clicks Logout, client fires the logout API call

T+0      @luckystack/login logout({ token, socket, userId, ... }):
         ├── preLogout (can abort)
         ├── deleteSession (unless skipSessionDelete)
         ├── adapter.untrackActive
         ├── socket.leave(token)
         ├── socket.emit(socketEventNames.logout)
         └── postLogout({ token, userId, ... })

T+0      registerPresenceHooks's postLogout subscriber runs:
         ├── tempDisconnectedSockets.delete(token)
         └── disconnectTimers.get(token) -> any active timer is cleared
```

If there was no grace timer or temp-disconnected entry, the cleanup is a no-op. If there was one (user closed the tab and immediately logged in elsewhere, racing the grace window), the cleanup makes sure the pending session-delete timer does not fire later and tear down the brand-new session.

## Hook execution order across all events

For a single reconnect-within-grace flow with hooks registered on every surface:

```
1. (server) socketConnected fires
2. (presence) postSocketReconnect           -- async dispatch, fire-and-forget
3. (server)   onSocketConnect               -- async dispatch
4. (presence) prePresenceUpdate             -- await before peer iteration
5. (presence) per-peer emits userBack
6. (presence) postPresenceUpdate            -- await after iteration
```

For a cold-connect flow:

```
1. (server) socketConnected fires
2. (server) onSocketConnect                 -- async dispatch
   (no postSocketReconnect, no prePresenceUpdate, no postPresenceUpdate)
```

For a logout flow:

```
1. (login)    preLogout                     -- can abort
2. (session)  preSessionDelete -> postSessionDelete
3. (login)    postLogout
4. (presence) postLogout subscriber cleans up state maps
```

## Interaction with `@luckystack/server` auto-wiring

`packages/server/src/loadSocket.ts` calls `socketConnected`, `socketDisconnecting`, `socketLeaveRoom`, and `initActivityBroadcaster` automatically when the project enables `socketActivityBroadcaster`. The lifecycle handlers in this package are designed for that wiring:

- `socketConnected` is called once per `io.on('connect')`.
- `socketDisconnecting` is gated by the `activityBroadcasterEnabled` flag inside the disconnect handler.
- `initActivityBroadcaster` is gated by the same flag.

For non-framework hosts (custom socket.io setup, micro-service bridge, test harness), call the four helpers yourself — the contracts are stable. See [`docs/server-handlers.md`](./server-handlers.md) for the exact call sites.

## Idempotency guarantees

- `registerPresenceHooks()` — module-level `registered` flag, safe to call multiple times.
- `socketConnected` — calling on a socket that has no active timer is a no-op for the grace window (just `getSession + (no broadcast)` if there are no rooms).
- `socketDisconnecting` — duplicate calls for the same token short-circuit on `tempDisconnectedSockets.has(token)`.
- `socketLeaveRoom` — no side effects on state; reading `getSession` is the only work.
- `initActivityBroadcaster` — calling twice on the same socket installs the listener twice. Don't.
- `registerActivityEvent(name, ...)` — overwrites the existing entry by name. Idempotent under same-name re-registration.

## See also

- [`docs/server-handlers.md`](./server-handlers.md) — `socketConnected` / `socketDisconnecting` / `socketLeaveRoom`.
- [`docs/disconnect-grace.md`](./disconnect-grace.md) — grace window math.
- [`docs/peer-notifier.md`](./peer-notifier.md) — `informRoomPeers` hook contracts.
- [`docs/activity-broadcaster.md`](./activity-broadcaster.md) — `initActivityBroadcaster` + activity-event registry.
- `/docs/ARCHITECTURE_SOCKET.md` — socket lifecycle, room model, redis adapter.
- `/docs/ARCHITECTURE_SESSION.md` — session create/delete + single-session enforcement.
- `packages/presence/src/hooks.ts` — `registerPresenceHooks` source.
