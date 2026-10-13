# @luckystack/presence

Presence and activity awareness for collaborative LuckyStack apps. Install with `npm install @luckystack/presence`; add optional `socket.io` and `@luckystack/login` for server session integration, or `react` and `react-router-dom` for browser components (see `package.json`). Import browser components from `@luckystack/presence/client`; enable presence during server boot before accepting connections. See `src/register.ts`, `src/client/index.ts`.

Presence is advisory, not proof of identity or revocation. Graceful disconnect handling prevents refreshes from appearing as departures; session TTL and logout remain the access controls. Peer notifications derive identity from sessions, not browser claims. See [design context](./AGENTS.md), [disconnect trust](./docs/disconnect-grace.md) and [peer safety](./docs/peer-notifier.md).
