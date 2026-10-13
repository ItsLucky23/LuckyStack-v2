# @luckystack/core

Shared foundation for LuckyStack transport, configuration, session types and framework extension points. Install with `npm install @luckystack/core ioredis socket.io socket.io-client zod`. Add the optional `@prisma/client` only when using the default Prisma integration (see `package.json`). Import browser code from `@luckystack/core/client`, never the server barrel.

Register project infrastructure before starting the server; let `@luckystack/server` handle ordinary bootstrapping. Keep cookie and bearer session modes distinct: cookie-backed writes require origin and CSRF protection. See [design context](./AGENTS.md), [configuration rationale](./docs/config-registry.md), and [security rationale](./docs/socket-bootstrap.md). Types, exports and defaults are in `src/` and `package.json`.
