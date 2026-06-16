# Activity Broadcaster

> The activity broadcaster turns raw user-interaction signals into presence events. Two layers cooperate: the per-socket `initActivityBroadcaster` wiring (server-side socket listeners) and the pluggable activity-event registry (`registerActivityEvent` + `dispatchActivitySample`). The framework ships a default `'afk'` event so a fresh install gets idle detection without extra registration.

## Layering

```
client                                          server
------                                          ------
intentionalDisconnect ────────────────► socket.on('intentionalDisconnect')
                                                │
                                                ▼
                                       informRoomPeers(userAfk)
                                                │
                                                ▼
                                       socket.disconnect(false)
                                                │
                                                ▼
                                       socketDisconnecting (grace timer)

user-activity ticks (location change, key/mouse heartbeat, …)
                                                │
                                                ▼
                                       dispatchActivitySample({ socketId, token, lastActivity, now, data })
                                                │
                                                ▼
                                       for each ActivityEvent in registry:
                                           if trigger(sample) and refractory ok:
                                               await onTrigger(sample)
```

The two halves are independent. `initActivityBroadcaster` is opt-in (gated by `projectConfig.socketActivityBroadcaster`); the activity-event registry is always live in-process so any caller can `dispatchActivitySample(...)` and let the default `'afk'` event (or custom ones) fire.

## `initActivityBroadcaster({ token, socket })`

```ts
import { initActivityBroadcaster } from '@luckystack/presence';

initActivityBroadcaster({ token, socket });
```

Registers a single socket listener: `socket.on(socketEventNames.intentionalDisconnect, ...)`. The handler runs when the browser tab emits the intentional-disconnect signal (e.g. before-unload, hidden tab heartbeat, or explicit `socket.emit('intentionalDisconnect')`). On fire:

1. Adds the token to `clientSwitchedTab` (the disconnect-grace logic later reads this set to decide whether to delete the session on timer expiry).
2. Computes the upcoming grace duration via `getDisconnectTime({ token, reason: undefined })` — for a tab switch this resolves to `disconnectTimers.tabSwitchMs` (default `20_000`) because `clientSwitchedTab.has(token)` is now true.
3. Calls `informRoomPeers({ token, event: socketEventNames.userAfk, extraData: { time } })`. Every peer receives `{ userId, endTime: Date.now() + time }` so UIs can render "John is away — back in ~20s".
4. Calls `socket.disconnect(false)` to release the socket without forcing a `connect_error` on the client. The disconnect listener then enters `socketDisconnecting`, which opens the grace window.

The framework calls this once per connected socket, only when `projectConfig.socketActivityBroadcaster === true` and a token is present:

```ts
// packages/server/src/loadSocket.ts
if (activityBroadcasterEnabled && token) {
  initActivityBroadcaster({ socket, token });
}
```

If you skip this call, the `intentionalDisconnect` event is silently ignored, no `userAfk` is broadcast, and the session simply lingers until the actual transport closes.

## Activity-event registry

The registry is a pluggable lookup keyed by `name`. Each entry is an `ActivityEvent`:

```ts
export interface ActivityEvent {
  name: string;
  trigger: (sample: ActivitySample) => boolean;
  onTrigger: (sample: ActivitySample) => void | Promise<void>;
  refractoryMs?: number;
}

export interface ActivitySample {
  socketId: string;
  token: string | null;
  lastActivity: number;
  now: number;
  data?: Record<string, unknown>;
}
```

### `registerActivityEvent(name, event)`

Registers or replaces an event. The `name` you pass overrides the value on the event object (the registry sets `name` itself, so callers pass `Omit<ActivityEvent, 'name'>`). Returns the previously registered event for the same name (or `undefined`) so callers can chain.

```ts
import { registerActivityEvent } from '@luckystack/presence';

const previous = registerActivityEvent('typing', {
  refractoryMs: 5_000,
  trigger: (sample) => sample.data?.type === 'keystroke',
  onTrigger: async (sample) => {
    await informRoomPeers({
      token: sample.token!,
      event: socketEventNames.userBack,
      extraData: { ignoreSelf: true },
    });
  },
});

if (previous) {
  // a different module already owned 'typing'; merge or restore as needed
}
```

Replacing the default AFK event:

```ts
import { unregisterActivityEvent, registerActivityEvent } from '@luckystack/presence';

unregisterActivityEvent('afk');
registerActivityEvent('afk', {
  refractoryMs: 30_000,
  trigger: (sample) => sample.now - sample.lastActivity > 90_000, // 90s instead of 5min
  onTrigger: (sample) => {
    // custom side effect — analytics, custom socket event, etc.
  },
});
```

### `unregisterActivityEvent(name)`

No-op if not registered. Removes the entry from the registry; subsequent `dispatchActivitySample` calls will not invoke it. The refractory map is keyed by `${name}|${socketId}`; the server prunes a socket's throttle entries on disconnect (`clearActivity` -> `clearActivityThrottle(socketId)`), so the map does not grow unbounded across the lifetime of a long-running deploy.

### `listActivityEvents()`

Returns every registered event in registration (insertion) order. Useful for diagnostics, admin pages, or building a runtime debug UI.

```ts
listActivityEvents().forEach((e) => console.log(e.name, e.refractoryMs));
```

### `dispatchActivitySample(sample)`

Evaluates every registered event against the sample. For each event:

1. Run `event.trigger(sample)`. If falsy, skip.
2. If `event.refractoryMs > 0`, check the per-`(name, socketId)` last-fired timestamp. If `sample.now - last < refractoryMs`, skip. Otherwise record `sample.now` as the new last-fired.
3. `await event.onTrigger(sample)`. Errors are swallowed — one buggy event must not break the chain.

Call this from anywhere you collect activity signals: a route change, a websocket heartbeat, a key-press throttle, or a server-side cron that scans `io.sockets`:

```ts
import { dispatchActivitySample } from '@luckystack/presence';

io.sockets.sockets.forEach((socket) => {
  dispatchActivitySample({
    socketId: socket.id,
    token: extractTokenFromSocket(socket),
    lastActivity: socket.data.lastActivity ?? Date.now(),
    now: Date.now(),
  });
});
```

The function is `async` because `onTrigger` is awaited, but it runs events serially within one call. Callers that need parallel fan-out should dispatch one sample per micro-task.

## Default `'afk'` event

Registered on module load by `index.ts`:

```ts
import { registerDefaultAfkEvent } from './activity/afkEvent';
registerDefaultAfkEvent();
```

The default event:

- `trigger`: returns `true` when `getPresenceConfig().afkTimeoutMs > 0` and `sample.now - sample.lastActivity > afkTimeoutMs` (default 5 minutes).
- `refractoryMs`: `60_000` — once a user is marked AFK, the event does not re-fire for the same socket for at least a minute.
- `onTrigger`: calls `informRoomPeers({ token, event: userAfk, extraData: { time: afkTimeoutMs } })`. That resolves the session, dispatches `prePresenceUpdate` (`{ token, userId, kind: 'afk', roomCodes }` — a veto seam), emits `socketEventNames.userAfk` with `{ userId, endTime: now + afkTimeoutMs }` (**never** the raw session token) to each peer, then dispatches `postPresenceUpdate` with the real `recipientCount`.

Because the default AFK event now routes through `informRoomPeers` (same path as reconnect `userBack`), its `postPresenceUpdate.recipientCount` is the real per-peer emit count and the broadcast is adapter-aware (reaches roommates on other instances). There is no `recipientCount: -1` sentinel anymore, and the payload carries `userId` + `endTime`, not `token`.

To disable AFK detection entirely without unregistering:

```ts
registerPresenceConfig({ afkTimeoutMs: 0 });
```

To replace the default with a custom AFK detector, see the "Replacing the default AFK event" snippet above.

## Why the registry exists

Previously AFK detection was hardcoded into the socket lifecycle. Pulling it into a pluggable registry lets installers add:

- typing detection ("John is typing…"),
- location-change-as-activity (route change resets `lastActivity`),
- inactivity-tier broadcasting (warn, idle, away),
- per-room presence (game lobbies, doc collaboration),

without forking presence or stacking parallel listeners. The framework still owns the default `'afk'` entry; consumers compose.

## Common mistakes

- Calling `dispatchActivitySample` with `token: null` works, but the default AFK event short-circuits (`if (!io || !sample.token) return;`). Anonymous sockets cannot be marked AFK.
- Forgetting `refractoryMs` will fire `onTrigger` on every tick while `trigger` stays true. Set it to at least your activity-sample cadence.
- Throwing inside `onTrigger` is swallowed silently. Log inside the callback if you need observability.
- Replacing `'afk'` without restoring the framework's `refractoryMs` (60s) often causes "AFK spam" — peers receive a `userAfk` event every dispatch tick.

## See also

- [`docs/peer-notifier.md`](./peer-notifier.md) — the `informRoomPeers` helper that the broadcaster calls.
- [`docs/disconnect-grace.md`](./disconnect-grace.md) — what happens after the broadcaster forces a `socket.disconnect(false)`.
- [`docs/lifecycle.md`](./lifecycle.md) — end-to-end timeline.
- `packages/presence/src/activityEvents.ts` — source.
- `packages/presence/src/activity/afkEvent.ts` — default AFK event.
