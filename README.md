# LuckyStack v2

A **socket-first full-stack framework** for real-time React applications on raw Node.js + Socket.io.

[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.8-black)](https://socket.io/)
[![Tailwind](https://img.shields.io/badge/Tailwind-4-38B2AC)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6.19-2D3748)](https://www.prisma.io/)

## What LuckyStack provides

- Socket.io-first typed API and sync requests with HTTP/SSE fallback.
- File-based pages, `_api/` handlers, and `_sync/` handlers.
- Credentials, OAuth, password-reset, email-code, and 2FA primitives.
- Pluggable user and session adapters; Prisma and Redis are the defaults, not mandatory storage choices.
- Prisma, Drizzle, MikroORM, or bring-your-own data-layer scaffolds.
- Room-based realtime fanout, presence/AFK, reconnect handling, and multi-instance Redis fanout.
- Pluggable transactional email and error tracking (Sentry, Datadog, PostHog, or custom adapters).
- Optional router, cron scheduler, secret manager, API docs UI, test runner, and AI-context tooling.
- npm and Bun scaffold/install support; Node remains required for the standalone router while Bun's WebSocket proxy primitive is unavailable.

## Quick start

Requirements depend on your selections:

- Node.js 20+.
- npm or Bun.
- Redis when using Redis-backed features such as the default session adapter, OAuth/reset state, cron, Redis rate limiting, or multi-instance Socket.io fanout.
- A database only when the selected data layer/features require one.

```bash
npx create-luckystack-app my-app
cd my-app

# Fill .env.local from its template, then use two terminals:
npm run server
npm run client
```

Open <http://localhost:5173>. The wizard selects the ORM, database, auth, email, monitoring, optional packages, package manager, and AI tooling. Framework internals remain in `node_modules/@luckystack/*`.

For scripted scaffolds:

```bash
npx create-luckystack-app my-app \
  --no-prompt \
  --orm=drizzle \
  --db=postgresql \
  --pm=npm \
  --auth=credentials \
  --error-tracking
```

See [`packages/create-luckystack-app/README.md`](./packages/create-luckystack-app/README.md) for every option.

## Framework development

```bash
git clone https://github.com/ItsLucky23/LuckyStack-v2
cd LuckyStack-v2
npm install
npm run build
cp .env_template .env
cp .env.local_template .env.local
```

- Change frontend/backend defaults in `config.ports.ts`.
- Override one backend boot with `npm run server -- <preset> <port>`.
- Keep public configuration in `.env`; real secrets belong in `.env.local`.
- Do not use a `SERVER_PORT` env setting—the listen port comes from `config.ports.ts`, positional argv, or server options.

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/PACKAGE_OVERVIEW.md`](./docs/PACKAGE_OVERVIEW.md) | Package use cases and peer-dependency matrix |
| [`docs/ARCHITECTURE_ROUTING.md`](./docs/ARCHITECTURE_ROUTING.md) | File-based pages, APIs, and sync events |
| [`docs/ARCHITECTURE_API.md`](./docs/ARCHITECTURE_API.md) | Typed API lifecycle and transports |
| [`docs/ARCHITECTURE_SYNC.md`](./docs/ARCHITECTURE_SYNC.md) | Realtime sync, fanout, and streaming |
| [`docs/ARCHITECTURE_AUTH.md`](./docs/ARCHITECTURE_AUTH.md) | Credentials/OAuth/2FA flows |
| [`docs/ARCHITECTURE_SESSION.md`](./docs/ARCHITECTURE_SESSION.md) | Session adapter contract and Redis default |
| [`docs/ARCHITECTURE_HTTP.md`](./docs/ARCHITECTURE_HTTP.md) | HTTP pipeline, custom routes, webhooks, and CSRF boundaries |
| [`docs/ARCHITECTURE_MULTI_INSTANCE.md`](./docs/ARCHITECTURE_MULTI_INSTANCE.md) | Router, routed invocation, shared Redis, and scaling |
| [`docs/ARCHITECTURE_PACKAGING.md`](./docs/ARCHITECTURE_PACKAGING.md) | Package boundaries, overlays, and generated artifacts |
| [`docs/HOSTING.md`](./docs/HOSTING.md) | Node/Bun, Docker, reverse proxies, and deployment |
| [`docs/DEVELOPER_GUIDE.md`](./docs/DEVELOPER_GUIDE.md) | Monorepo contributor workflow |

## Published packages

LuckyStack publishes 16 scoped packages plus `create-luckystack-app`:

| Package | Purpose |
| --- | --- |
| [`@luckystack/core`](./packages/core/README.md) | Registries, transport contracts, hooks, CSRF, rate limiting, shared primitives |
| [`@luckystack/server`](./packages/server/README.md) | Raw HTTP + Socket.io bootstrap and framework routes |
| [`@luckystack/api`](./packages/api/README.md) | Typed API execution over Socket.io and HTTP |
| [`@luckystack/sync`](./packages/sync/README.md) | Realtime sync, routed invocation, streaming, offline replay |
| [`@luckystack/login`](./packages/login/README.md) | Credentials/OAuth/2FA and pluggable user/session adapters |
| [`@luckystack/presence`](./packages/presence/README.md) | Presence, AFK, reconnect, and room awareness |
| [`@luckystack/email`](./packages/email/README.md) | Console, Resend, and SMTP email adapters |
| [`@luckystack/error-tracking`](./packages/error-tracking/README.md) | Multi-backend error-tracker adapters and instrumentation |
| [`@luckystack/cron`](./packages/cron/README.md) | Leader-elected, best-effort Redis cron scheduler |
| [`@luckystack/router`](./packages/router/README.md) | Standalone multi-service HTTP/WebSocket router |
| [`@luckystack/devkit`](./packages/devkit/README.md) | Route discovery, type generation, hot reload, deploy validation |
| [`@luckystack/test-runner`](./packages/test-runner/README.md) | Contract/auth/rate-limit/fuzz/business-logic test sweeps |
| [`@luckystack/docs-ui`](./packages/docs-ui/README.md) | Development API explorer |
| [`@luckystack/secret-manager`](./packages/secret-manager/README.md) | Rotation-aware external secret resolution |
| [`@luckystack/mcp`](./packages/mcp/README.md) | Read-only AI-context MCP server |
| [`@luckystack/cli`](./packages/cli/README.md) | Add/remove/manage/update features and Docker assets |
| [`create-luckystack-app`](./packages/create-luckystack-app/README.md) | Fresh-project scaffolder |

`packages/env-resolver/` is a reserved unpublished placeholder and has no `package.json`.

## API versus sync

Use API handlers for request/response work such as database queries or external APIs:

```ts
const response = await apiRequest({
  name: 'settings/getUserData',
  version: 'v1',
  data: { userId: '123' },
});
```

Use sync handlers for room-scoped realtime events and streaming:

```ts
await syncRequest({
  name: 'game/cursorMove',
  version: 'v1',
  data: { x: 100, y: 200 },
  receiver: 'room-abc123',
  ignoreSelf: true,
});
```

Split deployments can keep one realtime Socket.io ingress while routing typed invocation to the owning service with `transport.invocation: 'routed-http'`.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run client` | Start the Vite client |
| `npm run server` | Start the supervised backend |
| `npm run test:unit` | Run package and framework unit tests |
| `npm run build` | Build all 17 publishable packages plus the sample app |
| `npm run pack:dry` | Validate package tarballs |
| `npm run prod` | Run the production server bundle |
| `docker compose up` | Start the generated production-like container topology |

## License

MIT
