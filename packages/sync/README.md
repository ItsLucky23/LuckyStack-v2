# @luckystack/sync

Server-authoritative, room-based realtime updates with socket and HTTP/SSE transports. Install with `npm install @luckystack/sync socket.io socket.io-client`; add optional React and Prisma peers only when those surfaces are used (see `package.json`). Browser callers import `@luckystack/sync/client`.

Use a server handler for shared mutations and an optional recipient handler only when individual recipients need different output. Choosing a receiver is an authorization decision, not just routing; maintain sender-side checks even when recipient filtering exists. See [design context](./AGENTS.md), [server vs recipient](./docs/server-vs-client-handlers.md), [room authorization](./docs/room-fanout.md) and [version rationale](./docs/version-policy.md). Source and generated maps own the API surface.
