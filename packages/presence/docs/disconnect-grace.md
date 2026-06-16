# Disconnect Grace Window

> When a socket disconnects, presence does **not** immediately tear down session state or notify peers. Instead it opens a per-token grace window so a refresh, tab switch, or transient network blip can reconnect without losing context. The window length depends on the disconnect reason and a per-install `PresenceConfig`.

## Decision tree

```
socket disconnects with reason R, token T
            │
            ▼
  R in getPresenceConfig().ignoreReasons?  ─── yes ──► no-op (no timer, no peer notify, no session delete)
            │ no
            ▼
  T already in tempDisconnectedSockets?  ─── yes ──► no-op (duplicate disconnect event)
            │ no
            ▼
  add T to tempDisconnectedSockets
            │
            ▼
  compute grace duration via getDisconnectTime({ token: T, reason: R })
            │
            ├── clientSwitchedTab.has(T)               ──► disconnectTimers.tabSwitchMs       (default 20_000 ms)
            │      and deleteSessionOnDisconnect = false
            │
            ├── getPresenceConfig().allowReasons.includes(R) ──► disconnectTimers.transportCloseMs  (default 60_000 ms)
            │
            └── else                                     ──► disconnectTimers.defaultMs         (default 2_000 ms)
            ▼
  setTimeout(time, on expiry:
    remove T from tempDisconnectedSockets
    confirm we are still the active timer
    if T's private token room still has live sockets -> bail (another tab is open)
    resolve session (userId + roomCodes) for the hook
    socketLeaveRoom({ token, socket, newPath: null })
    if (deleteSessionOnDisconnect) deleteSession(T)
    dispatch postDisconnectGraceExpired({ token, userId, roomCodes, reason, sessionDeleted })
  )
            │
            ▼
  store timer in disconnectTimers (replacing any existing one)
```

A reconnect inside the window cancels the timer (see `socketConnected` in [`docs/server-handlers.md`](./server-handlers.md)) and dispatches `postSocketReconnect` so consumers can rehydrate state.

## `PresenceConfig` shape

```ts
export interface DisconnectTimers {
  tabSwitchMs: number;
  transportCloseMs: number;
  defaultMs: number;
}

export interface PresenceConfig {
  disconnectTimers: DisconnectTimers;
  ignoreReasons: string[];
  allowReasons: string[];
  afkTimeoutMs: number;
  activitySampleIntervalMs: number;
}
```

Each field:

| Field | Default | Meaning |
| --- | --- | --- |
| `disconnectTimers.tabSwitchMs` | `20_000` | Reconnect window when the client intentionally disconnected (tab switch / hidden tab). Short because the user is expected back imminently; the session is **not** deleted on expiry so a slightly-late reconnect still finds its state. |
| `disconnectTimers.transportCloseMs` | `60_000` | Reconnect window for `transport close` / `transport error` — clean transport tear-down (refresh, mobile lock screen, network blip). Generous because reconnects are frequent and benign. |
| `disconnectTimers.defaultMs` | `2_000` | Reconnect window for any other reason — covers unexpected disconnects (process crash, OS kill). Short because a clean recovery is unlikely. |
| `ignoreReasons` | `['ping timeout']` | Disconnect reasons treated as no-ops. The client is almost certainly still there; the socket got kicked by a heartbeat miss but will reconnect on its own. No timer, no peer notify, no session delete. |
| `allowReasons` | `['transport close', 'transport error']` | Disconnect reasons that earn the generous `transportCloseMs` window. Anything outside both lists falls back to `defaultMs`. |
| `afkTimeoutMs` | `5 * 60_000` | Idle threshold for the default `'afk'` activity event (see [`docs/activity-broadcaster.md`](./activity-broadcaster.md)). Set to `0` to disable AFK detection. |
| `activitySampleIntervalMs` | `15_000` | How often the server-side activity sampler walks every connected socket and feeds an `ActivitySample` to `dispatchActivitySample` (which fires the registered activity events). Should be well below `afkTimeoutMs`. Set to `0` to disable the sampler. |

## `DEFAULT_PRESENCE_CONFIG`

```ts
export const DEFAULT_PRESENCE_CONFIG: PresenceConfig = {
  disconnectTimers: {
    tabSwitchMs: 20_000,
    transportCloseMs: 60_000,
    defaultMs: 2000,
  },
  ignoreReasons: ['ping timeout'],
  allowReasons: ['transport close', 'transport error'],
  afkTimeoutMs: 5 * 60_000,
  activitySampleIntervalMs: 15_000,
};
```

This is the baseline. Without any registration call, `getPresenceConfig()` returns this object. It is exported so consumers can read framework defaults without booting the registry.

## `registerPresenceConfig(input: PresenceConfigInput)`

Deep-merges `input` into `DEFAULT_PRESENCE_CONFIG` and stores the result as the active config. The input type is a `DeepPartial<PresenceConfig>` so callers can override individual leaves:

```ts
import { registerPresenceConfig } from '@luckystack/presence';

registerPresenceConfig({
  disconnectTimers: {
    transportCloseMs: 90_000, // give SPA reload an extra 30s
  },
  ignoreReasons: ['ping timeout', 'client namespace disconnect'],
});
```

Merge rules:

- `undefined` values are skipped (do not nuke a default to `undefined`).
- Plain objects are merged recursively.
- Arrays are **replaced wholesale**. Passing `ignoreReasons: ['foo']` drops `'ping timeout'`. Spread the default in if you want additive behavior:

  ```ts
  registerPresenceConfig({
    ignoreReasons: [...DEFAULT_PRESENCE_CONFIG.ignoreReasons, 'client namespace disconnect'],
  });
  ```

- Non-object overrides (numbers, strings) overwrite the base.

Call it as early as possible — typically next to `registerProjectConfig(...)` and before `registerPresenceHooks()`. The config is read lazily by `getPresenceConfig()` on every disconnect, so late registrations still take effect for future events, but in-flight grace timers were already scheduled with the prior config.

## `getPresenceConfig()`

Returns the current active config object. Reads happen at call time (no module-load capture), so registries can be swapped in test setups without re-importing modules.

```ts
import { getPresenceConfig } from '@luckystack/presence';

const config = getPresenceConfig();
console.log(config.disconnectTimers.defaultMs); // 2000 unless overridden
```

## Internal state maps

These are exported from `@luckystack/presence` mostly for tests, admin tooling, and introspection. Mutating them by hand outside of `registerPresenceHooks` cleanup is not recommended.

### `disconnectTimers: Map<string, NodeJS.Timeout>`

Token → active grace-period timer. Populated by `socketDisconnecting`, cleared by `socketConnected` (on reconnect inside the window) and by `postLogout` cleanup (logout invalidates the timer outright). The timer references a `setTimeout` handle; tests can `clearTimeout(...)` on the value before asserting state.

### `tempDisconnectedSockets: Set<string>`

Tokens currently inside the grace window. Used as a guard against duplicate disconnect events and as the "is this user temporarily gone?" flag for higher layers. Cleared on reconnect, timer expiry, and `postLogout`.

### `clientSwitchedTab: Set<string>`

Tokens that emitted the `intentionalDisconnect` socket event (see `initActivityBroadcaster` in [`docs/activity-broadcaster.md`](./activity-broadcaster.md)). Read once by `getDisconnectTime` to grant the `tabSwitchMs` window, then cleared immediately in `socketDisconnecting`. The set is effectively a one-shot flag per disconnect.

## `getDisconnectTime({ token, reason })`

Internal helper, exported via the state module. Returns the grace duration in milliseconds:

```ts
export const getDisconnectTime = ({ token, reason }) => {
  const config = getPresenceConfig();
  if (clientSwitchedTab.has(token)) return config.disconnectTimers.tabSwitchMs;
  if (config.allowReasons.includes(reason ?? 'NULL')) return config.disconnectTimers.transportCloseMs;
  return config.disconnectTimers.defaultMs;
};
```

The `reason ?? 'NULL'` fallback is for callers passing `undefined` (notably `initActivityBroadcaster`, which calls before the socket has a disconnect reason). `'NULL'` is never in `allowReasons` by default, so undefined-reason callers fall through to `defaultMs` — except for the tab-switch path, which is checked first.

## Race conditions handled

1. **Reconnect during grace** — `socketConnected` clears the timer and removes the token from `tempDisconnectedSockets`. The pending `setTimeout` still fires (we cannot un-schedule a Node timer that already executed), but on entry it checks `disconnectTimers.get(token) !== timeout` and returns early.
2. **Repeated disconnect events on the same socket** — `tempDisconnectedSockets.has(token)` short-circuits the second invocation so we do not stack timers.
3. **Logout during grace** — `registerPresenceHooks()` subscribes to `postLogout` and clears the timer + drops the token from `tempDisconnectedSockets`. The pending `setTimeout` then no-ops on the same `tempDisconnectedSockets.has(token)` check (the token is gone).
4. **Tab switch → real disconnect** — `clientSwitchedTab` is consumed (deleted) at the start of `socketDisconnecting`, so a later "transport close" for the same token gets the normal `transportCloseMs` window, not a second tab-switch shortcut.
5. **Multi-tab shared session** — two tabs share one token but hold two sockets, each joined to the token's private room (`socket.join(token)`). Closing tab B arms a grace timer, but tab A is still connected, so `socketConnected` never re-fires to cancel it. On expiry the timer checks `io.sockets.adapter.rooms.get(token)?.size`; if it is non-zero (tab A is live), it **bails** — no `socketLeaveRoom`, no `deleteSession`, no `postDisconnectGraceExpired`. The shared session survives until the last tab closes.

## Trust model — `intentionalDisconnect` is client-asserted

The tab-switch path is driven by the `intentionalDisconnect` socket event, which is **fully client-controlled**. A client can choose to emit it (to claim the short `tabSwitchMs` window + skip delete-on-disconnect) or not. Two consequences:

- **Best-effort, not a guarantee.** A client that always emits `intentionalDisconnect` keeps `deleteSessionOnDisconnect = false`, so its session is preserved on disconnect rather than deleted. The Redis session **TTL is the real bound** on session lifetime — "delete on disconnect" is an optimization, not a security control. Do not rely on disconnect-delete to revoke access; rely on the TTL and explicit logout.
- **No self-spam.** `initActivityBroadcaster` honours `intentionalDisconnect` **at most once per connection** (a per-socket `intentionalDisconnectHandled` flag), so a client cannot repeatedly emit it to spam `userAfk` to its own roommates. The broadcast `userId` is always resolved server-side from the session, so a client can never assert another user's presence either.

## Tuning recipes

### Multiplayer game lobby — generous tab-switch, short crash recovery

```ts
registerPresenceConfig({
  disconnectTimers: {
    tabSwitchMs: 30_000,
    transportCloseMs: 45_000,
    defaultMs: 1_000,
  },
});
```

### Collaborative doc editor — every reconnect counts

```ts
registerPresenceConfig({
  disconnectTimers: {
    tabSwitchMs: 60_000,
    transportCloseMs: 120_000,
    defaultMs: 5_000,
  },
  ignoreReasons: [...DEFAULT_PRESENCE_CONFIG.ignoreReasons, 'transport error'],
});
```

(Adding `transport error` to `ignoreReasons` here is a deliberate choice — for some editors a transient transport error is no signal worth acting on.)

### Strict single-instance backend — disable the grace entirely

```ts
registerPresenceConfig({
  disconnectTimers: {
    tabSwitchMs: 0,
    transportCloseMs: 0,
    defaultMs: 0,
  },
});
```

A `0`-ms timer still goes through `setTimeout`, so the cleanup runs at the next tick. The session is deleted, the room is left, and a reconnect afterwards is treated as a fresh login.

## Types

```ts
export type PresenceConfigInput = DeepPartial<PresenceConfig>;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object | undefined
    ? DeepPartial<NonNullable<T[K]>>
    : T[K];
};
```

`PresenceConfigInput` is the public input type for `registerPresenceConfig`. `DisconnectTimers` and `PresenceConfig` are exported so consumers can type config builders without re-deriving the shape.

## See also

- [`docs/server-handlers.md`](./server-handlers.md) — `socketDisconnecting` step-by-step.
- [`docs/lifecycle.md`](./lifecycle.md) — end-to-end timeline including the grace window.
- [`docs/peer-notifier.md`](./peer-notifier.md) — what gets broadcast when the grace window expires (`userAfk` was sent up front; the timer cleanup does NOT re-broadcast).
- `packages/presence/src/presenceConfig.ts` — source.
- `packages/presence/src/activity/state.ts` — internal state maps.
