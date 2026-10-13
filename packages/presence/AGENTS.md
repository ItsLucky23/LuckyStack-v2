# @luckystack/presence — design context

Presence models transient connection/activity state, not durable identity or access revocation. A disconnect grace period prevents refreshes and network blips from looking like a departure. The browser's intentional-disconnect signal is client-asserted; session TTL and explicit logout, not disconnect cleanup, bound authorization. Source: `src/activity/lifecycle.ts`, `src/presenceConfig.ts`.

Resolve identity and rooms from the server-side session before notifying peers; never broadcast a raw session token. Keep room formatting consistent with tenant isolation and use adapter-aware socket enumeration so peers on other instances are not invisible (`src/activity/peerNotifier.ts`, `../core/src/roomNameFormatterRegistry.ts`). Do not forward arbitrary URL query strings through location updates; they may contain secrets (`src/client/LocationProvider.tsx`). Use the `/client` subpath in browser bundles, not the server barrel.

See `docs/disconnect-grace.md`, `docs/peer-notifier.md`, `../login/AGENTS.md`.
