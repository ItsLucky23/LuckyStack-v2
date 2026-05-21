# LuckyStack Package Overview

> Quick reference voor AI agents en developers: welk `@luckystack/*` package los je waarmee op?
> Voor diepe details per package: zie `packages/<name>/CLAUDE.md`.

## Core Packages

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/core` | Foundation: socket-first transport contracts, DI registries (config, prisma, redis, notifier, email, error-tracker, logger, runtime maps), hooks bus, and cross-cutting primitives (`tryCatch`, rate limiter, CORS, validateRequest, offline queue, CSRF). | `@prisma/client@^6.19.0`, `ioredis@^5.10.0`, `socket.io@^4.8.0`, `socket.io-client@^4.8.0`, `zod@^3.25.0` | `react@^19.0.0`, `react-dom@^19.0.0`, `react-router-dom@^7.0.0`, `sonner@^2.0.0` |
| `@luckystack/server` | One-call server bootstrap that wires raw Node HTTP, Socket.io (+ Redis adapter), framework routes (`/api/*`, `/sync/*`, `/_health`, `/livez`, `/readyz`, `/_test/reset`, `/auth/*`), CSRF, CORS, security headers, and dev hot reload. | `@prisma/client@^6.19.0` (via core), `socket.io@^4.8.0` | `@luckystack/error-tracking`, `@luckystack/email`, `@luckystack/docs-ui`, `@luckystack/devkit` (dev-only) |
| `@luckystack/api` | Transport-agnostic API request layer for file-based `_api/` routes — handles auth, rate limit, Zod validation, hook dispatch, and response normalization for both socket and HTTP transports. | `@prisma/client@^6.19.0` (via core), `socket.io@^4.8.0` | none |
| `@luckystack/sync` | Real-time room-based fanout over Socket.io (+ HTTP/SSE fallback) for file-based `_sync/` routes with streaming primitives and an offline-replay queue. | `@prisma/client@^6.19.0` (via core), `socket.io@^4.8.0`, `socket.io-client@^4.8.0` | `react@^19.2.0` (only `/client` subpath) |

## Auth & Sessions

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/login` | Credentials + OAuth (Google, GitHub, Discord, Facebook, Microsoft, custom) auth, Redis-backed sessions, single-session enforcement, password-reset primitives, pluggable `UserAdapter` / `SessionAdapter`. | `@prisma/client@^6.19.0`, `socket.io@^4.8.0` | `@luckystack/email` (only when `auth.forgotPassword === 'framework'`) |

## Communication

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/email` | Pluggable transactional email with Console / Resend / SMTP adapters, named template registry, `preEmailSend` / `postEmailSend` hooks, multi-sender slots. | none | `resend` (for `ResendSender`), `nodemailer` (for `SmtpSender`) |
| `@luckystack/presence` | Presence + activity awareness: AFK detection, disconnect grace windows, room-peer `userAfk` / `userBack` notifications, reconnect hooks, pluggable activity events. | `socket.io@^4.8.0` | `react@^19.2.0`, `react-router-dom` (only `/client` subpath for `SocketStatusIndicator` + `LocationProvider`) |

## Observability

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/error-tracking` | Pluggable server error-tracking with built-in Sentry / Datadog / PostHog adapters and multi-tracker fan-out (per-adapter throws are swallowed). | none | `@sentry/node@^10.48.0`, `dd-trace@^5.0.0`, `hot-shots@^10.0.0`, `posthog-node@^4.0.0` |

## Infrastructure & Deployment

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/router` | Optional standalone HTTP + WebSocket load-balancer for multi-instance / preset-bundle deploys with boot-UUID handshake, Redis-backed health state, and dev-to-staging fallback proxy. | `ioredis@^5.10.0` | none |

## Dev Tools

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/devkit` | Dev-time file-based route discovery, hot reload, TypeScript-program-backed type-map + Zod schema emission, supervisor process restart, and `luckystack-validate-deploy` CLI. | `typescript@~5.7.3`, `zod@^3.25.0`, `@prisma/client@^6.19.0` | `tsx` (supervisor child process) |
| `@luckystack/test-runner` | Generated-type-driven sweep that walks every API endpoint and runs four progressive layers: contract smoke, auth enforcement, rate-limit, and crash-resistance fuzz. | `zod@^3.25.0` | none |
| `@luckystack/docs-ui` | Dev-only Swagger-style browser at `/_docs` that renders `apiDocs.generated.json` with method, auth, rate limit, input/output shape, and optional inline try-it-out. | none (composes with `@luckystack/server` `customRoutes`) | none |

## Utilities

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `@luckystack/env-resolver` | Wiring client (not a secret manager) that populates `process.env` at boot from an external env-server using committed V-references (e.g. `OPENAITOKEN=OPENAITOKEN_V4`); supports `local` / `remote` / `hybrid` modes. The external secret-manager server itself lives in a separate, project-independent git repository (not yet implemented). | none (uses global `fetch`, requires Node >= 20) | any `fetch` polyfill (e.g. `undici`) for non-Node-20 hosts |

## Scaffolding

| Package | Use case | Required peers | Optional peers |
|---|---|---|---|
| `create-luckystack-app` | Interactive scaffold CLI for new LuckyStack projects (`npx create-luckystack-app <name>`); copies template, runs `npm install` + `npx prisma generate`. | none (Node >= 20, npm on PATH) | none |

## "I want to..." cheatsheet

Quick lookup: feature -> which package(s) to suggest.

| I want to... | Suggest installing |
|---|---|
| Add OAuth login | `@luckystack/login` (+ `@luckystack/email` voor framework-mode password reset) |
| Add real-time updates / multiplayer | `@luckystack/sync` |
| Track user presence (online / AFK) | `@luckystack/presence` |
| Send transactional emails | `@luckystack/email` |
| Add error tracking | `@luckystack/error-tracking` |
| Run multi-instance load-balanced | `@luckystack/router` |
| Add API endpoints | `@luckystack/api` (auto-wired via `@luckystack/server`; create `src/{page}/_api/{name}_v{N}.ts`) |
| Bootstrap a new project | `npx create-luckystack-app` |
| Run integration tests | `@luckystack/test-runner` |
| Browse generated docs in dev | `@luckystack/docs-ui` |
| Resolve env vars from remote source | `@luckystack/env-resolver` |
| Hot-reload + type-map gen in dev | `@luckystack/devkit` |

## Decision Matrix

| Scenario | Required packages | Optional add-ons |
|---|---|---|
| Minimal API server | `core` + `server` + `api` | `error-tracking` |
| Full social app | `core` + `server` + `api` + `sync` + `login` + `presence` | `email`, `error-tracking` |
| Public REST API | `core` + `server` + `api` | `error-tracking`, `docs-ui` |
| Multi-tenant SaaS | `core` + `server` + `api` + `sync` + `login` + `email` | `error-tracking`, `presence`, `router` |

---

> Voor consumers — als deze documentatie stale wordt na een framework-update: run `npm run ai:index` om `AI_QUICK_INDEX.md` te regenereren, of consider `npx @luckystack/sync-docs` (toekomstig CLI tool).
