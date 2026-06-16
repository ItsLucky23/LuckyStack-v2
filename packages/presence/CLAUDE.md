# @luckystack/presence

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

Presence and activity awareness layer for LuckyStack: AFK detection, disconnect grace windows, room-peer notifications (userAfk / userBack / userLeft), reconnect lifecycle, single-session enforcement integration, and a pluggable activity-event registry. Ships two entry points: a server bundle (default export — socket.io lifecycle wiring) and a browser-safe `/client` subpath (React surface for the socket status indicator and route-change location syncer).

## When to USE this package

- Multiplayer / collaborative apps where users share rooms and need to see who is present, idle, or temporarily disconnected.
- You want a disconnect grace window so refresh / tab switch / network blip does not noisily tear down session state.
- You want a `postSocketReconnect` hook to rehydrate client state after a reconnect (without conflating cold connect).
- You need pluggable activity events (AFK is built-in, but typing-detection, location-change-as-activity, etc. can be added).
- You want a floating socket-status badge in the dashboard template (`SocketStatusIndicator`) gated by config.

## When to NOT suggest this (yet)

- Pure request/response apps with no rooms or shared state — the broadcaster overhead is wasted.
- Apps that already implement their own presence layer; do not stack two systems on the same socket lifecycle.
- Single-user CLI / job-runner deployments — the socket.io peer dependency only pays off with concurrent clients.
- Do not import the root barrel into a Vite client bundle. Use `@luckystack/presence/client` for browser code; the server barrel pulls socket.io / Node APIs.

## Function Index

### Server entry — `@luckystack/presence`

| Function / Export | 1-regel | Deep doc |
|---|---|---|
| `registerPresenceHooks()` | One-shot boot wiring — registers `postLogout` cleanup + activity broadcaster | → docs/lifecycle.md |
| `socketConnected({ token, io })` | Lifecycle: clear disconnect timer on reconnect, fire `postSocketReconnect`, notify roommates `userBack` | → docs/server-handlers.md |
| `socketDisconnecting({ token, reason, socket })` | Lifecycle: open disconnect grace timer (per reason); on expiry, broadcast `userLeft` to remaining room peers (gated by `socketActivityBroadcaster`), leave rooms + delete session | → docs/disconnect-grace.md |
| `socketLeaveRoom({ token, socket, newPath })` | Resolve the departing token's session for grace-expiry teardown (does NOT call `socket.leave()`; `socket`/`newPath` unused) | → docs/server-handlers.md |
| `initActivityBroadcaster({ token, socket })` | Wire the `intentionalDisconnect` socket event for tab-switch awareness | → docs/activity-broadcaster.md |
| `clientSwitchedTab` (Set<string>) | Token-set: client signalled an intentional tab switch (short reconnect window) | → docs/disconnect-grace.md |
| `disconnectTimers` (Map<string, Timeout>) | Token -> grace-period timer (introspection / test reset) | → docs/disconnect-grace.md |
| `tempDisconnectedSockets` (Set<string>) | Tokens currently inside the disconnect grace window | → docs/disconnect-grace.md |
| `registerActivityEvent(name, event)` | Register / replace a pluggable activity event (predicate + onTrigger + refractoryMs) | → docs/activity-broadcaster.md |
| `unregisterActivityEvent(name)` | Remove a registered activity event by name | → docs/activity-broadcaster.md |
| `listActivityEvents()` | List every registered activity event in registration order | → docs/activity-broadcaster.md |
| `dispatchActivitySample(sample)` | Evaluate all registered events against an activity sample; fires matching `onTrigger`s with refractory throttle. Driven in production by `startActivitySampler` | → docs/activity-broadcaster.md |
| `recordActivity(socketId)` | Mark a socket active right now (called by the server on connect + every client `activity` heartbeat) | → docs/activity-broadcaster.md |
| `clearActivity(socketId)` | Drop a socket's last-activity record + its refractory-throttle entries (called by the server on disconnect) | → docs/activity-broadcaster.md |
| `clearActivityThrottle(socketId)` | Purge a socket's refractory-throttle timestamps from the activity-event registry (called by `clearActivity`) | → docs/activity-broadcaster.md |
| `getLastActivity(socketId)` | Read a socket's last-activity timestamp (ms epoch) or `undefined` — for consumer roster/AFK queries | → docs/activity-broadcaster.md |
| `getRoomPresence(roomCode, { io? })` | Snapshot a room's peers (`socketId`, `token`, `lastActivity`, `afk`) for a late joiner; adapter-aware (spans instances) | → docs/activity-broadcaster.md |
| `startActivitySampler({ io?, intervalMs? })` | Start the single interval that walks every socket and feeds `dispatchActivitySample` every `activitySampleIntervalMs`. Idempotent; returns the stop fn. Auto-started by `@luckystack/server` on first connect when `socketActivityBroadcaster` is on | → docs/activity-broadcaster.md |
| `stopActivitySampler()` | Stop the sampler interval (shutdown / test reset) | → docs/activity-broadcaster.md |
| `registerPresenceConfig(input)` | Override disconnect timers, ignore/allow reasons, AFK timeout, activity-sample interval | → docs/disconnect-grace.md |
| `getPresenceConfig()` | Read the merged active config (lazy — reads at call time) | → docs/disconnect-grace.md |
| `DEFAULT_PRESENCE_CONFIG` | Default values (tabSwitch 20s, transportClose 60s, default 2s, afkTimeout 5min) | → docs/disconnect-grace.md |
| Type: `ActivityEvent`, `ActivitySample` | Activity-event registry types | → docs/activity-broadcaster.md |
| Type: `PresenceConfig`, `PresenceConfigInput`, `DisconnectTimers` | Config-input types for `registerPresenceConfig` | → docs/disconnect-grace.md |
| Hook payload: `PrePresenceUpdatePayload` | `{ token, userId, kind, roomCodes }` | → docs/peer-notifier.md |
| Hook payload: `PostPresenceUpdatePayload` | Pre payload + `recipientCount` | → docs/peer-notifier.md |
| Hook payload: `PostSocketReconnectPayload` | `{ token, userId, roomCodes }` (reconnect-only, not initial connect) | → docs/lifecycle.md |
| Hook payload: `PostDisconnectGraceExpiredPayload` | `{ token, userId, roomCodes, reason, sessionDeleted }` (grace window expired — user truly gone) | → docs/lifecycle.md |
| Hook: `prePresenceUpdate` | Before peer iteration — VETO seam (return stop to suppress fan-out: invisible/DND) | → docs/peer-notifier.md |
| Hook: `postPresenceUpdate` | After peer emits complete (with recipient count) | → docs/peer-notifier.md |
| Hook: `postSocketReconnect` | Fires only when a reconnect lands within the grace window | → docs/lifecycle.md |
| Hook: `postDisconnectGraceExpired` | Fires when the disconnect grace window expires without reconnect (mark offline / persist final state) | → docs/lifecycle.md |
| Hook: `postLogout` (consumed) | Presence registers a handler that clears its disconnect timer + temp-set for the logged-out token | → docs/lifecycle.md |

### Client entry — `@luckystack/presence/client`

| Function / Export | 1-regel | Deep doc |
|---|---|---|
| `SocketStatusIndicator` (React component) | Floating status badge (gated by `projectConfig.socketStatusIndicator`); `position` + `className` props for placement/shape | → docs/client-component.md |
| `SocketStatusIndicatorProps` (type) | `{ status, reconnectAttempt?, label?, formatStatus?, position?, className? }` | → docs/client-component.md |
| `LocationProvider` (React component) | Route wrapper that emits `updateLocation` on every `react-router` pathname change (gated by `projectConfig.locationProviderEnabled`). Sends NO query params by default; opt-in per-key via `searchParamFilter` (secrets in URLs never auto-forwarded) | → docs/client-component.md |
| `LocationProviderProps` (type) | `{ searchParamFilter?: string[] \| (key, value) => boolean }` | → docs/client-component.md |

## Config keys (env vars + registerProjectConfig slots)

- `socketActivityBroadcaster` (projectConfig, default `false`) — when `true`, peer notifications (`userAfk` / `userBack` / `userLeft`) are broadcast on AFK / back / room churn / departure (hard disconnect or grace expiry).
- `socketStatusIndicator` (projectConfig, default `false`) — when `true`, `SocketStatusIndicator` renders the floating badge.
- `locationProviderEnabled` (projectConfig, default `false`) — when `true`, `LocationProvider` emits `updateLocation` socket events on react-router path changes.
- `disconnectTimers.tabSwitchMs` (presenceConfig, default `20_000`) — reconnect window after an intentional tab switch.
- `disconnectTimers.transportCloseMs` (presenceConfig, default `60_000`) — reconnect window for `transport close` / `transport error` (browser refresh, network blip).
- `disconnectTimers.defaultMs` (presenceConfig, default `2_000`) — reconnect window for any other disconnect reason.
- `ignoreReasons` (presenceConfig, default `['ping timeout']`) — disconnect reasons we treat as no-ops (no timer, no peer notify).
- `allowReasons` (presenceConfig, default `['transport close', 'transport error']`) — disconnect reasons that earn the generous `transportCloseMs` window.
- `afkTimeoutMs` (presenceConfig, default `5 * 60_000`) — idle threshold for the default `'afk'` activity event; set to `0` to disable.
- `activitySampleIntervalMs` (presenceConfig, default `15_000`) — how often the server-side sampler walks every socket and fires registered activity events (well below `afkTimeoutMs`); set to `0` to disable the sampler.

## Production AFK / activity events

The activity-event system is wired end-to-end (gated by `socketActivityBroadcaster`):
1. **Client** (`socketInitializer.ts`) emits a throttled `activity` socket event on real user interaction (pointer/key/scroll/touch).
2. **Server** (`@luckystack/server` `loadSocket`) calls `recordActivity(socket.id)` on connect + each `activity`/`intentionalReconnect`, `clearActivity` on disconnect, and `startActivitySampler({ io })` once.
3. **Sampler** feeds an `ActivitySample` per socket to `dispatchActivitySample` every `activitySampleIntervalMs`; the built-in `'afk'` event fires when `now - lastActivity > afkTimeoutMs` and notifies roommates via `informRoomPeers` (`{ userId, endTime }` — never the session token).

To build e.g. a game that pauses on AFK and kicks after a grace period, register a custom event:
```ts
import { registerActivityEvent, unregisterActivityEvent } from '@luckystack/presence';
// add a longer-threshold "kick" event alongside the built-in 'afk'
registerActivityEvent('afk-kick', {
  trigger: (s) => s.now - s.lastActivity > 5 * 60_000, // 5 min idle
  refractoryMs: 60_000,
  onTrigger: async (s) => { /* leave room / disconnect s.socketId, end the match */ },
});
```

## Peer dependencies

- **Required runtime**: `@luckystack/core`, `@luckystack/login` (session lookup + token extraction + hook registry).
- **Peer (server entry)**: `socket.io@^4.8.0`.
- **Peer (client entry only, optional)**: `react@^19.2.0`, `react-router-dom@^7.0.0` (imported by `LocationProvider` — `useLocation` / `Outlet`).
- Wired automatically by `@luckystack/server` — manual `initActivityBroadcaster` only needed for non-standard hosts.

## Related

- Architecture deep-dive: `/docs/ARCHITECTURE_SOCKET.md`, `/docs/ARCHITECTURE_SESSION.md`
- README (consumer quickstart): `./README.md`
- Hook registry: `@luckystack/core` (`registerHook` / `dispatchHook`)
- Session lookup: `@luckystack/login` (`getSession`, `deleteSession`)
