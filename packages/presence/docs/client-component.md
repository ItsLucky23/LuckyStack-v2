# Client Components (`@luckystack/presence/client`)

> Browser-safe React surface of `@luckystack/presence`. The root barrel pulls socket.io and Node APIs, so client bundles must import from `@luckystack/presence/client`. Two components ship today: `SocketStatusIndicator` (floating badge showing the live socket status) and `LocationProvider` (route wrapper that emits `updateLocation` on every pathname change).

## Why a separate entry point

`@luckystack/presence` (the server entry) imports `socket.io`, `@luckystack/login`, and the activity-broadcaster machinery. Vite happily bundles that into a client build but the runtime would crash at first import. The `/client` subpath only depends on `react` + `react-router-dom` + `@luckystack/core/client`, which are all browser-safe.

Both components self-gate on `ProjectConfig` flags — they read `getProjectConfig()` from `@luckystack/core/client` and return `null` / no-op when the flag is `false`. Callers render them unconditionally; the flag is the single switch.

## `SocketStatusIndicator`

Floating top-right badge that visualizes the current socket status. Rendered inside the `dashboard` template by default; gated by `projectConfig.socketStatusIndicator`.

### Import

```tsx
import {
  SocketStatusIndicator,
  type SocketStatusIndicatorProps,
} from '@luckystack/presence/client';
```

### Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | `SOCKETSTATUS` | yes | One of `'STARTUP' \| 'CONNECTED' \| 'DISCONNECTED' \| 'RECONNECTING' \| 'AFK'`. Re-exported from `@luckystack/core/client`. |
| `reconnectAttempt` | `number \| undefined` | no | Retry counter. Only meaningful while `status === 'RECONNECTING'`. The default renderer appends `(attempt N)`. |
| `label` | `string \| undefined` | no | Pre-translated prefix, e.g. `"Socket status:"`. Rendered verbatim before the status text. |
| `formatStatus` | `(status, reconnectAttempt) => string` | no (strongly recommended) | Custom renderer. Without it, the raw `SOCKETSTATUS` enum value is rendered as English — fine for dev, ugly for prod. Wire your i18n translator here. |
| `position` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | no | Corner to anchor the floating badge to. Defaults to `'top-right'`. Use when the default corner collides with app chrome. |
| `className` | `string \| undefined` | no | Extra classes appended AFTER the defaults (so they win on conflict) — override size, shape, `z-index`, or make it clickable (`pointer-events-auto`). |

### Render branches

1. `getProjectConfig().socketStatusIndicator === false` → returns `null`. The component renders nothing; callers can mount unconditionally.
2. `status` outside the known enum → falls back to `bg-wrong` + the on-tint text token. Safe but visually noisy; treat as a "you forgot to map this status" hint.
3. `formatStatus` provided → its return value is rendered. Use it for i18n.
4. `formatStatus` omitted + `status === 'RECONNECTING'` + `reconnectAttempt !== undefined` → renders `RECONNECTING (attempt N)`.
5. Else → renders the raw status enum value.

### Status → tint mapping

```ts
const STATUS_TINT: Record<SOCKETSTATUS, 'bg-warning' | 'bg-correct' | 'bg-wrong'> = {
  STARTUP: 'bg-warning',
  CONNECTED: 'bg-correct',
  DISCONNECTED: 'bg-wrong',
  RECONNECTING: 'bg-warning',
  AFK: 'bg-warning',
};
```

Each tint pairs with `text-common-primary` so the badge color matches the project palette in both light and dark mode without per-mode overrides. The badge uses Tailwind tokens from `src/index.css`'s `@theme` — see [`docs/ARCHITECTURE_PACKAGING.md`](../../../docs/ARCHITECTURE_PACKAGING.md) for the token contract.

### Usage in the dashboard template

The framework's dashboard template wires this for you. The pattern (which you can replicate elsewhere):

```tsx
import { SocketStatusIndicator } from '@luckystack/presence/client';
import { useSocketStatus } from 'src/_providers/SocketStatusProvider';
import { useTranslator } from 'src/_functions/translator';

export default function DashboardChrome({ children }: { children: React.ReactNode }) {
  const { socketStatus } = useSocketStatus();
  const translate = useTranslator();

  return (
    <div className={`relative w-full h-full`}>
      <SocketStatusIndicator
        status={socketStatus.self.status}
        reconnectAttempt={socketStatus.self.reconnectAttempt}
        label={translate({ key: `presence.statusLabel` })}
        formatStatus={(status, reconnectAttempt) => {
          const base = translate({ key: `presence.status.${status.toLowerCase()}` });
          if (status === 'RECONNECTING' && reconnectAttempt !== undefined) {
            return `${base} (${String(reconnectAttempt)})`;
          }
          return base;
        }}
      />
      {children}
    </div>
  );
}
```

Notes:

- The component must be rendered inside a relatively-positioned parent. The Tailwind class is `absolute` + the corner from `position` (default `top-2 right-2`); without a positioned ancestor the badge anchors to the body.
- `pointer-events-none` is set so the badge never intercepts clicks. Hovering and clicking through to UI underneath works.
- `z-50` keeps it above page-level modals but below `@luckystack/core` overlays that use `z-[51]`.

### Custom palette

To override the tint mapping without forking the component, wrap it:

```tsx
function CustomIndicator(props: SocketStatusIndicatorProps) {
  return (
    <div className={`custom-badge-wrapper`}>
      <SocketStatusIndicator {...props} />
    </div>
  );
}
```

For placement or shape, prefer the `position` / `className` props over forking. If you need to change the actual tint tokens, copy the component into your project and adjust `STATUS_TINT`. The source is ~60 lines (`packages/presence/src/client/SocketStatusIndicator.tsx`).

### Config gate

```ts
import { registerProjectConfig } from '@luckystack/core';

registerProjectConfig({
  socketStatusIndicator: true,
});
```

`false` keeps the indicator entirely off your render tree. The default for a fresh install is `false`.

## `LocationProvider`

Route wrapper that emits `socketEventNames.updateLocation` on every `react-router` pathname change. The server uses it to know "which page is this user on" for presence-aware UIs ("John is on /settings"). Gated by `projectConfig.locationProviderEnabled`.

### Import

```tsx
import LocationProvider from '@luckystack/presence/client';
// or as a named import:
import { LocationProvider } from '@luckystack/presence/client';
```

### Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `searchParamFilter` | `string[] \| ((key, value) => boolean) \| undefined` | no | Which query-string keys may be forwarded. Omitted/empty = **send no search params** (the secure default). Pass an allowlist array, or a predicate for finer control. |

### Behavior

1. Renders `<Outlet />` from `react-router-dom`. It is a transparent wrapper — mount it inside the route tree wherever you want path-change tracking to start.
2. Listens to `useLocation().pathname`. On every change:
   - If `getProjectConfig().locationProviderEnabled === false`, returns immediately. No emit.
   - Builds `searchParams` from `globalThis.location.search` **filtered by `searchParamFilter`** — by default this is empty (no query keys forwarded).
   - Awaits `waitForSocket()` (from `@luckystack/core/client`). If the socket never connects, returns.
   - Emits `socket.emit(socketEventNames.updateLocation, { pathName, searchParams })`.

### Security: query strings are NOT forwarded by default

URLs routinely carry secrets — password-reset tokens, OAuth `code`/`state`, invite codes. The server **persists** `searchParams` on the session and may fan it out to peers, so `LocationProvider` sends **no** query params unless you opt specific keys in via `searchParamFilter`. Only allowlist keys you know are non-sensitive:

```tsx
// forward just the harmless `tab` + `view` keys
<LocationProvider searchParamFilter={['tab', 'view']} />

// or a predicate
<LocationProvider searchParamFilter={(key) => key.startsWith('ui_')} />
```

Never blanket-forward the whole query string.

The server-side handler (in `@luckystack/server`'s `loadSocket.ts`) updates the session's `location` field and dispatches `onLocationUpdate`. When `activityBroadcasterEnabled` is also true, it calls `socketLeaveRoom` first to refresh peer-room state.

### Usage in the route tree

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LocationProvider from '@luckystack/presence/client';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<LocationProvider />}>
          <Route path={`/`} element={<HomePage />} />
          <Route path={`/settings/*`} element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

Mount it once near the top of the route tree. Mounting it inside multiple routes will emit duplicate `updateLocation` events on every navigation.

### Config gate

```ts
registerProjectConfig({
  locationProviderEnabled: true,
});
```

`false` (default) keeps the component mounted but inert: it still renders `<Outlet />`, just without emitting socket events. This is intentional so you can leave the provider in the tree across environments and flip the flag per-deploy.

### Combined with `socketActivityBroadcaster`

`LocationProvider` works on its own (just session location tracking). When combined with `projectConfig.socketActivityBroadcaster === true`, the server's `updateLocation` handler also calls `socketLeaveRoom`, opening the door for per-page room churn / peer notifications. The two flags are independent: enable just the provider for "where is John?", or both for "John just walked into the editor room."

## `SOCKETSTATUS` reference

Re-exported from `@luckystack/core/client`. The presence client subpath does not redefine it; consumers should always import the type from there to keep the discriminated union aligned with the socket-status provider's reducer.

```ts
import type { SOCKETSTATUS } from '@luckystack/core/client';
```

Values and their typical UX:

- `STARTUP` — Initial state. Provider has been mounted but the socket has not yet established. Badge is yellow.
- `CONNECTED` — Healthy. Badge is green.
- `DISCONNECTED` — Definitively offline (terminal). Badge is red. Common after a `forceDisconnect` from the server.
- `RECONNECTING` — Transport is retrying. `reconnectAttempt` is meaningful. Badge is yellow.
- `AFK` — Peer-reported away. Badge is yellow.

## Common mistakes

- Importing `@luckystack/presence` (no `/client`) into a client bundle. The build will succeed but the runtime crashes on `socket.io` imports.
- Calling `SocketStatusIndicator` outside a positioned ancestor. The badge floats to the body which usually breaks the dashboard layout.
- Forgetting `formatStatus`. The raw `SOCKETSTATUS` enum values are English; the badge will read `RECONNECTING (attempt 2)` instead of `Opnieuw verbinden (poging 2)` for Dutch users.
- Mounting `LocationProvider` inside a child route. Pathname changes outside the child route will not fire. Mount it as high in the tree as possible.

## See also

- [`docs/server-handlers.md`](./server-handlers.md) — server-side handling of `updateLocation`.
- `packages/presence/src/client/SocketStatusIndicator.tsx` — source.
- `packages/presence/src/client/LocationProvider.tsx` — source.
- `@luckystack/core/client` — `SOCKETSTATUS`, `socket`, `waitForSocket`, `getProjectConfig`.
- `src/_providers/SocketStatusProvider.tsx` (installer) — owns the live `socketStatus.self` state.
