# @luckystack/presence

> Presence and activity awareness for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). AFK detection, room-peer notifications, lifecycle (connect / disconnect / reconnect), and single-session enforcement integration. For multiplayer and collaborative apps.

## Install

```bash
npm install @luckystack/presence @luckystack/core @luckystack/login socket.io
```

## Quickstart

Call `registerPresenceHooks()` once at boot, before `createLuckyStackServer`.

```ts
import { registerPresenceHooks } from '@luckystack/presence';
import { createLuckyStackServer } from '@luckystack/server';

registerPresenceHooks();

const server = await createLuckyStackServer({
  /* ... */
});
await server.listen();
```

This wires:
- **`postLogout`** — clears disconnect timers + temp-disconnected socket state for the logged-out user.
- **Activity broadcasting** — when `ProjectConfig.socketActivityBroadcaster` is enabled, peer notifications are sent to roommates on join/leave/idle.
- **Disconnect grace period** — short-lived disconnects (network blip, tab switch) are buffered and reconciled on reconnect rather than emitting noisy presence churn.

## Configuring activity broadcasting

In your `registerProjectConfig({ ... })`:

```ts
{
  socketActivityBroadcaster: true,
  locationProviderEnabled: true,
}
```

Without these flags the presence hooks are still registered, but no peer notifications fire — useful when you want disconnect-grace behavior without the broadcast overhead.

## Public API

| Export | Purpose |
| --- | --- |
| `registerPresenceHooks()` | One-shot wiring at server boot. |
| `socketLeaveRoom(socket, roomCode)` | Programmatic room leave with peer notification. |
| `initAcitivityBroadcaster(io)` | Manual init for the broadcaster (wired automatically by `@luckystack/server`). |
| `socketConnected(socket)` / `socketDisconnecting(socket, reason)` | Lifecycle helpers. |
| `clientSwitchedTab(socket, tab)` | Mark a client as backgrounded without disconnecting. |
| State maps: `disconnectTimers`, `tempDisconnectedSockets`, `disconnectReasonsWeIgnore`, `disconnectReasonsWeAllow` | Inspect or extend reconnect behavior. |

## Client subpath: `@luckystack/presence/client`

Browser-safe React surface. Currently exposes a single component used by the project's template wrapper:

```tsx
import { SocketStatusIndicator } from '@luckystack/presence/client';
import { useSocketStatus } from 'src/_providers/socketStatusProvider';

const { socketStatus } = useSocketStatus();

<SocketStatusIndicator
  status={socketStatus.self.status}
  reconnectAttempt={socketStatus.self.reconnectAttempt}
  label="Socket status:"
/>
```

`SocketStatusIndicator` self-gates on `getProjectConfig().socketStatusIndicator` — it returns `null` when the flag is `false`, so callers can render unconditionally. Flip `socketStatusIndicator: true` in your `registerProjectConfig({ ... })` to show the floating badge.

## Dependencies

- Runtime: `@luckystack/core`, `@luckystack/login`
- Peer: `socket.io` (server entry, optional), `react@^19` (`/client` entry, optional)

## License

MIT — see [LICENSE](../../LICENSE).
