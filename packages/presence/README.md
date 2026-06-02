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

## Configuring presence behavior

Presence ships its own config registry (`registerPresenceConfig`) so each install can tune disconnect grace + reason handling independently of the project-wide config:

```ts
import { registerPresenceConfig } from '@luckystack/presence';

registerPresenceConfig({
  disconnectTimers: {
    tabSwitchMs: 20_000,       // intentional tab switch — short reconnect window
    transportCloseMs: 60_000,  // network blip / refresh — generous window
    defaultMs: 2_000,          // unexpected disconnect — short window
  },
  ignoreReasons: ['ping timeout'],                    // never tear down on these
  allowReasons: ['transport close', 'transport error'], // grant the long reconnect window
});
```

Read the merged config back via `getPresenceConfig()`. Without overrides, the registry returns `DEFAULT_PRESENCE_CONFIG`.

Activity broadcasting itself is gated on `ProjectConfig.socketActivityBroadcaster` (in `@luckystack/core`'s `registerProjectConfig({...})`). Set it to `true` to enable peer notifications; the disconnect-grace machinery runs regardless.

## Hooks

`informRoomPeers` dispatches `prePresenceUpdate` before iterating peers and `postPresenceUpdate` after the `userAfk` / `userBack` socket emits complete. Both are async hooks; consumers register via `registerHook(...)` from `@luckystack/core`.

```ts
import { registerHook } from '@luckystack/core';

registerHook('postPresenceUpdate', async ({ userId, kind, roomCodes, recipientCount }) => {
  // Audit / analytics — kind is 'afk' | 'back'.
});
```

Payloads (augmented onto `HookPayloads` via `packages/presence/src/hookPayloads.ts`):

- `prePresenceUpdate` — `{ token, userId, kind: 'afk' | 'back', roomCodes }`
- `postPresenceUpdate` — `{ token, userId, kind, roomCodes, recipientCount }` — `recipientCount` reflects how many peer sockets actually received the event.

## Public API

| Export | Purpose |
| --- | --- |
| `registerPresenceHooks()` | One-shot wiring at server boot. |
| `socketLeaveRoom({ token, socket, newPath })` | Programmatic room leave with peer notification. |
| `initActivityBroadcaster({ token, socket })` | Manual init for the broadcaster (wired automatically by `@luckystack/server`). |
| `socketConnected({ token, io })` / `socketDisconnecting({ token, reason, socket })` | Lifecycle helpers. |
| `clientSwitchedTab` (`Set<string>`) | Token-set of clients backgrounded without disconnecting. |
| State maps: `disconnectTimers`, `tempDisconnectedSockets` | Inspect reconnect timer state. The `disconnectReasonsWeIgnore` / `disconnectReasonsWeAllow` exports were removed in pass-2 (2026-05-07); configure those via `registerPresenceConfig({ ignoreReasons, allowReasons })` instead. |
| `registerPresenceConfig(input)` / `getPresenceConfig()` / `DEFAULT_PRESENCE_CONFIG` | Presence-specific config registry. Types: `PresenceConfig`, `PresenceConfigInput`, `DisconnectTimers`. |

## Client subpath: `@luckystack/presence/client`

Browser-safe React surface. Currently exposes a single component used by the project's template wrapper:

```tsx
import { SocketStatusIndicator } from '@luckystack/presence/client';
import { useSocketStatus } from 'src/_providers/socketStatusProvider';
import { useTranslator } from 'src/_functions/translator';

const { socketStatus } = useSocketStatus();
const translate = useTranslator();

<SocketStatusIndicator
  status={socketStatus.self.status}
  reconnectAttempt={socketStatus.self.reconnectAttempt}
  label={translate({ key: 'presence.statusLabel' })}
  formatStatus={(status, reconnectAttempt) => {
    const base = translate({ key: `presence.status.${status.toLowerCase()}` });
    if (status === 'RECONNECTING' && reconnectAttempt !== undefined) {
      return `${base} (${String(reconnectAttempt)})`;
    }
    return base;
  }}
/>
```

### Props

| Prop | Type | Notes |
| --- | --- | --- |
| `status` | `SOCKETSTATUS` | Required. One of `'STARTUP' \| 'CONNECTED' \| 'DISCONNECTED' \| 'RECONNECTING' \| 'AFK'`. |
| `reconnectAttempt?` | `number` | Optional retry count; only meaningful while `status === 'RECONNECTING'`. |
| `label?` | `string` | Optional pre-translated prefix string (e.g. `"Socket status:"`). Wire your own translator and pass the result. |
| `formatStatus?` | `(status: SOCKETSTATUS, reconnectAttempt: number \| undefined) => string` | Optional formatter that takes the raw status + attempt count and returns the localized text to render. **Strongly recommended** — without it, the raw `SOCKETSTATUS` enum (e.g. `RECONNECTING`) is rendered as English. |

`SocketStatusIndicator` self-gates on `getProjectConfig().socketStatusIndicator` — it returns `null` when the flag is `false`, so callers can render unconditionally. Flip `socketStatusIndicator: true` in your `registerProjectConfig({ ... })` to show the floating badge.

The badge color uses theme tokens (`bg-correct` / `bg-warning` / `bg-wrong` paired with `text-common-primary`), so it follows the project palette in light + dark mode without per-mode overrides.

## Related architecture docs

- [`docs/ARCHITECTURE_SOCKET.md`](../../docs/ARCHITECTURE_SOCKET.md) — disconnect lifecycle, socket-status indicator, room model.
- [`docs/ARCHITECTURE_SESSION.md`](../../docs/ARCHITECTURE_SESSION.md) — single-session enforcement integration.

## Dependencies

- Runtime: `@luckystack/core`, `@luckystack/login`
- Peer (canonical ranges, standardized 2026-05-07):
  - `socket.io@^4.8.0` (server entry only)
  - `react@^19.2.0` (`/client` entry only)

## License

MIT — see [LICENSE](../../LICENSE).
