# LuckyStack v2

A **socket-first full-stack framework** for building real-time web applications with React and Node.js.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.8-black)](https://socket.io/)
[![Tailwind](https://img.shields.io/badge/Tailwind-4.0-38B2AC)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6.5-2D3748)](https://www.prisma.io/)

---

## What is LuckyStack?

LuckyStack is a custom full-stack framework that takes a **socket-first approach** to client-server communication. WebSockets are the primary path, with HTTP API/sync fallback endpoints when needed, enabling:

- **Real-time sync** between clients in the same room
- **Multiplayer awareness** (AFK detection, user presence)
- **Unified RPC-style API calls** with automatic session handling
- **Built-in authentication** (credentials + OAuth providers)

## Key Features

| Feature                | Description                                                         |
| ---------------------- | ------------------------------------------------------------------- |
| **Socket-First**       | Socket.io-first communication with HTTP fallback                    |
| **Authentication**     | Credentials + Google, GitHub, Discord, Facebook, Microsoft OAuth    |
| **Room System**        | Join rooms for targeted real-time sync                              |
| **Activity Awareness** | Track user AFK status and presence                                  |
| **File-Based Routing** | Next.js-style page and API routing                                  |
| **Tailwind v4**        | Modern CSS with custom theming                                      |
| **Redis Sessions**     | Scalable session storage                                            |
| **Prisma**             | Type-safe DB access (MongoDB, MySQL, PostgreSQL, SQLite)            |
| **Sentry Integration** | Optional error monitoring for client and server                     |
| **Multi-instance**     | Redis-backed Socket.io adapter; optional `@luckystack/router` proxy |

---

## Quick Start

### Prerequisites

- Node.js 20+
- A Redis instance (local or hosted) — required for sessions and the Socket.io adapter
- A database supported by Prisma (MongoDB, MySQL, PostgreSQL, or SQLite)

### Scaffold a new project

```bash
npx create-luckystack-app my-app
cd my-app

# Two terminals:
npm run server    # backend (Node.js + Socket.io)
npm run client    # frontend (Vite)
```

Open `http://localhost:5173`. The scaffolder writes a small project (~30 files) — framework internals live in `node_modules/@luckystack/*`.

### Working inside this monorepo

If you cloned this repository to contribute to the framework itself:

```bash
git clone https://github.com/ItsLucky23/LuckyStack-v2
cd LuckyStack-v2
npm install
npm run build       # builds every workspace package
cp .env_template .env
cp .env.local_template .env.local
```

`config.ts`, `services.config.ts`, and `deploy.config.ts` are tracked. Update them directly for project-level changes; secrets go in `.env.local`.

A Docker Compose file is included for spinning up Redis + the framework's own dev playground (`docker compose up`). Most contributors do not need it day-to-day.

### Access the App

You can change the ports in the `.env` file.

- **Frontend:** http://localhost:5173
- **Backend:** http://localhost:80

---

## Documentation

| Document                                                       | Description                                          |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| [Routing architecture](./docs/ARCHITECTURE_ROUTING.md)         | File-based routing (pages, APIs, syncs)              |
| [API architecture](./docs/ARCHITECTURE_API.md)                 | API request lifecycle, transport, hooks              |
| [Sync architecture](./docs/ARCHITECTURE_SYNC.md)               | Real-time sync events, fanout, streaming             |
| [Authentication architecture](./docs/ARCHITECTURE_AUTH.md)     | OAuth + credentials flows, providers, middleware     |
| [Session architecture](./docs/ARCHITECTURE_SESSION.md)         | Redis-backed sessions and lifecycle                  |
| [Socket architecture](./docs/ARCHITECTURE_SOCKET.md)           | Socket.io setup, Redis adapter, room model           |
| [Email architecture](./docs/ARCHITECTURE_EMAIL.md)             | `@luckystack/email` adapters and forgot-password     |
| [Monitoring architecture](./docs/MONITORING.md)                | Strategy spec for `@luckystack/monitoring` (planned) |
| [Packaging architecture](./docs/ARCHITECTURE_PACKAGING.md)     | Package-split, hooks, multi-service builds           |
| [Developer guide](./docs/DEVELOPER_GUIDE.md)                   | Getting started inside the monorepo                  |
| [Hosting guide](./docs/HOSTING.md)                             | Deployment, Docker, multi-instance routing           |
| [Streaming reconstruction](./docs/STREAMING_RECONSTRUCTION.md) | Recreating the streaming demo page                   |

### Packages

The framework lives in `packages/` and is consumed as a set of `@luckystack/*` workspace packages. Each Tier-A package carries its own README:

| Package                                                          | Purpose                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------- |
| [`@luckystack/core`](./packages/core/README.md)                  | Foundation: project config, hooks, session types      |
| [`@luckystack/server`](./packages/server/README.md)              | One-call HTTP + Socket.io bootstrap                   |
| [`@luckystack/api`](./packages/api/README.md)                    | API request handlers (Socket.io + HTTP)               |
| [`@luckystack/sync`](./packages/sync/README.md)                  | Real-time sync transport + streaming primitives       |
| [`@luckystack/login`](./packages/login/README.md)                | Credentials + OAuth + sessions                        |
| [`@luckystack/presence`](./packages/presence/README.md)          | Activity awareness + disconnect grace                 |
| [`@luckystack/email`](./packages/email/README.md)                | Pluggable transactional email                         |
| [`@luckystack/error-tracking`](./packages/error-tracking/README.md) | Optional error-tracking (Sentry-backed)            |
| [`@luckystack/test-runner`](./packages/test-runner/README.md)    | Generated-type-driven contract / auth / fuzz tests    |
| [`@luckystack/docs-ui`](./packages/docs-ui/README.md)            | Dev-only `/_docs` API browser                         |
| [`create-luckystack-app`](./packages/create-luckystack-app/README.md) | Project scaffolder                               |

---

## Project Structure

```
LuckyStack-v2/
├── packages/                  # Framework workspaces (all 13 are Tier-A publishable)
│   ├── core/                  # Project config, hooks, session types
│   ├── server/                # bootstrapLuckyStack / createLuckyStackServer
│   ├── api/                   # API request handlers
│   ├── sync/                  # Sync transport + streaming
│   ├── login/                 # Credentials + OAuth + sessions
│   ├── presence/              # Activity / disconnect grace
│   ├── email/                 # Transactional email adapters
│   ├── error-tracking/        # Optional error-tracking (Sentry-backed)
│   ├── test-runner/           # Contract / auth / rate-limit / fuzz tests
│   ├── docs-ui/               # Dev-only /_docs browser
│   ├── create-luckystack-app/ # Project scaffolder
│   ├── devkit/                # Dev-time tooling (hot reload, type emitter, validate-deploy CLI)
│   └── router/                # Optional multi-instance proxy (Redis-backed health)
│
├── server/                    # This repo's own server entry (consumer of @luckystack/server)
│   ├── server.ts              # ~25 lines: calls bootstrapLuckyStack(...)
│   ├── prod/runtimeMaps.ts    # REPL-only helper (preset selection lives in @luckystack/server)
│   └── prod/generatedApis.*.ts # Per-preset route maps emitted by build (selected via argv)
│
├── luckystack/                # Overlay folder (consumer-style hooks + DI registries)
├── src/                       # Frontend (React 19) + page-local _api / _sync
├── prisma/schema.prisma       # User model
├── scripts/                   # Build / generation scripts (typegen, Zod emit, packaging)
├── config.ts                  # registerProjectConfig({...})
├── services.config.ts         # services + presets
├── deploy.config.ts           # resources + bindings + fallback routing
└── docs/                      # Architecture documentation
```

---

## API vs Sync

LuckyStack distinguishes between two types of server communication:

Route naming contract:

- Request helpers use service-first names (`service/name`) and explicit versions.
- Invalid helper names are rejected with `routing.invalidServiceRouteName`.

### API Requests

Server-only operations (database queries, external APIs):

```typescript
// Client
const result = await apiRequest({
  name: "settings/getUserData",
  version: "v1",
  data: { userId: "123" },
});

// Server: src/settings/_api/getUserData_v1.ts
export const auth = { login: true };
export const main = async ({ data, user, functions }) => {
  return await functions.prisma.user.findUnique({ where: { id: data.userId } });
};
```

### Sync Requests

Real-time events between clients:

```typescript
// Client: Send to all users in room
await syncRequest({
  name: "game/cursorMove",
  version: "v1",
  data: { x: 100, y: 200 },
  receiver: "room-abc123",
  ignoreSelf: true,
});

// All other clients in the room receive the event
```

---

## Scripts

| Command                  | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `npm run client`         | Start Vite dev server                             |
| `npm run server`         | Start Node.js server (calls `bootstrapLuckyStack`) |
| `npm run build`          | Build all `@luckystack/*` packages + the project  |
| `npm run prod`           | Run the production server                         |
| `docker compose up`      | Optional: start the bundled Redis dev stack       |

---

## Configuration

### Environment Variables

See [`.env_template`](./.env_template) for all available options:

- `NODE_ENV` - development or production
- `PUBLIC_URL` - Public origin (prod only; dev auto-derives the Vite origin). OAuth callbacks use the backend origin from `SERVER_IP`/`SERVER_PORT`.
- `REDIS_HOST` / `REDIS_PASSWORD` / `REDIS_PORT` - Redis connection
- `DATABASE_URL` - MongoDB connection string
- `SENTRY_DSN` / `VITE_SENTRY_DSN` - Error monitoring DSNs (server/client)
- `SENTRY_ENABLED` / `VITE_SENTRY_ENABLED` - Optional development override

Environment file model:

- `.env_template` and `.env` are safe config context and can contain placeholder values such as `ID_IN_ENV_LOCAL` and `SECRET_IN_ENV_LOCAL`
- `.env.local_template` is the template for local secrets
- `.env.local` stores real secrets and overrides `.env` via `dotenv`
- Keep non-secret server config in `.env` so AI tooling can understand expected keys without exposing real values

### OAuth Setup

1. Create OAuth apps at each provider
2. Set callback URLs to `https://your-domain.com/auth/callback/{provider}`
3. Keep placeholders in `.env` and add real client ID/secret values to `.env.local`

Supported: Google, GitHub, Discord, Facebook

---

## Tech Stack

| Layer          | Technology                              |
| -------------- | --------------------------------------- |
| **Frontend**   | React 19, React Router 7, TailwindCSS 4 |
| **Backend**    | Node.js (raw HTTP), Socket.io           |
| **Database**   | Prisma 6.5 (MongoDB / MySQL / PostgreSQL / SQLite) |
| **Sessions**   | Redis                                   |
| **Auth**       | Built-in credentials + OAuth + bcryptjs |
| **Icons**      | Lucide React, Font Awesome              |
| **Monitoring** | Sentry (optional)                       |
| **Build**      | Vite, TypeScript, tsx, tsup             |

---

## License

MIT

---

## Links

- [GitBook Documentation](https://lucky23.gitbook.io/luckystack/)
