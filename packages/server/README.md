# @luckystack/server

> One-call server bootstrap for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). HTTP + Socket.io + framework routes (`/api/*`, `/sync/*`, `/_health`, `/_test/reset`, `/auth/*`, `/uploads/*`) wired together. Your `server.ts` shrinks to ~20 lines.

## Install

```bash
npm install @luckystack/server @luckystack/core @luckystack/api @luckystack/login @luckystack/sync @luckystack/presence socket.io
```

## Quickstart — recommended (`bootstrapLuckyStack`)

`bootstrapLuckyStack` is a thin wrapper around `createLuckyStackServer` that auto-imports your `luckystack/<pkg>/*.ts` overlay files in topological order before listening, so registries (DI, hooks, providers) are populated by the time the HTTP server boots. This is what `create-luckystack-app` scaffolds.

```ts
import 'dotenv/config';
import '../config';            // your registerProjectConfig(...)
import '../deploy.config';     // your registerDeployConfig(...)
import '../services.config';   // your registerServicesConfig(...)

import { bootstrapLuckyStack } from '@luckystack/server';
import { serveFile, serveFavicon } from './prod/serveFile';

const server = await bootstrapLuckyStack({
  serveFile,
  serveFavicon,
});

await server.listen();
```

The bootstrap call runs (in order):

1. Auto-imports `luckystack/core/*.ts`, `luckystack/deploy/*.ts`, `luckystack/login/*.ts`, `luckystack/sentry/*.ts`, `luckystack/presence/*.ts`, `luckystack/docs-ui/*.ts`, `luckystack/server/*.ts` (topologically sorted, then alphabetically inside each folder).
2. Hands off to `createLuckyStackServer(options)`.

Set `skipOverlayLoad: true` to handle every registration yourself, or `overlayRoot: 'custom-folder'` to load from somewhere other than `./luckystack`.

### Pre-flight check — `verifyBootstrap`

Call `verifyBootstrap` **after** the overlay loads (or after your manual registrations) and **before** `server.listen()` if you want to fail fast on missing registrations instead of silent runtime crashes:

```ts
import { bootstrapLuckyStack, verifyBootstrap } from '@luckystack/server';

const server = await bootstrapLuckyStack({ serveFile, serveFavicon });

await verifyBootstrap({
  requireDeployConfig: true,    // single-instance deploys can omit this
  requireServicesConfig: true,  // only true when the router will run
  requireOAuthProviders: true,  // false if you only use credentials login
});

await server.listen();
```

`verifyBootstrap` throws a single descriptive `Error` listing every missing registration. The full check covers:

- `ProjectConfig` — always required.
- `DeployConfig` — when `requireDeployConfig: true`.
- `ServicesConfig` — when `requireServicesConfig: true`.
- OAuth providers — when `requireOAuthProviders: true` and only the default `credentials` entry has been registered.
- `RuntimeMapsProvider` — hard-fails in production; loud-warns in dev because devkit hot-reload normally registers one. Without it, every API/sync request silently resolves to `notFound`.
- `LocalizedNormalizer` — hard-fails in production; warns in dev. Without it, error responses degrade to `errorCode`-as-message (no i18n).

## Lower-level entry — `createLuckyStackServer`

Use this directly when you want to control the order of imports yourself or skip the overlay convention:

```ts
import { initializeSentry } from '@luckystack/error-tracking';
import { registerPresenceHooks } from '@luckystack/presence';
import { createLuckyStackServer } from '@luckystack/server';

initializeSentry();
registerPresenceHooks();

const server = await createLuckyStackServer({
  serveFile,
  serveFavicon,
});
await server.listen();
```

Both entries handle devkit hot reload + console init in dev mode automatically — opt out with `enableDevTools: false` if you have your own.

## Options

```ts
interface CreateLuckyStackServerOptions {
  port?: number | string;          // default: process.env.SERVER_PORT ?? 80
  ip?: string;                     // default: process.env.SERVER_IP ?? '127.0.0.1'
  serveFile?: StaticFileHandler;   // catch-all for non-framework GETs (Vite output, SPA fallback)
  serveFavicon?: FaviconHandler;   // /favicon.ico
  customRoutes?: CustomRouteHandler; // pre-fallback hook; return true to mark handled
  enableDevTools?: boolean;        // default: NODE_ENV !== 'production'
  maxHttpBufferSize?: number;      // default: 5 MB
}
```

`customRoutes` runs before the static file serving, so you can add project-specific HTTP endpoints (webhooks, OG image generation, etc.) without forking the package. Return `true` if you ended the response.

You can also register custom routes globally via `registerCustomRoute(handler)` — the bootstrap call composes every registered handler into the running server. This is what `@luckystack/docs-ui` uses to mount `/_docs`.

```ts
import { registerCustomRoute } from '@luckystack/server';

registerCustomRoute(async (req, res) => {
  if (req.url !== '/healthz') return false;
  res.statusCode = 200;
  res.end('ok');
  return true;
});
```

## What it wires

- **HTTP server** with CORS + security headers, OPTIONS preflight, method validation, cookie sliding, CSRF middleware.
- **Socket.io server** attached to the HTTP server, with optional Redis adapter when configured in deploy config.
- **Framework routes:** `/_health`, `/livez`, `/readyz`, `/_test/reset` (dev/test only), `/api/*` and `/sync/*` (with SSE streaming), `/auth/api`, `/auth/callback/*`, `/uploads/*`, `/assets/*`, `/csrf-token`.
- **Presence broadcasting** (when enabled in project config): connect / disconnect / reconnect, location updates, peer notifications.
- **Boot UUID** written on startup so the load-balancer (`@luckystack/router`) can detect rolling restarts.
- **Dev tools** in non-production: devkit hot reload, console initializer.

### HTTP route handler layout

`handleHttpRequest` is now a thin (~190-line) orchestrator that sets up CORS / origin / security headers, runs the CSRF middleware, then dispatches a route-handler table. Each handler matches its own route path and returns `boolean` (handled or not). The handlers live in `packages/server/src/httpRoutes/`:

| File | Routes |
| --- | --- |
| `csrfMiddleware.ts` + `csrfRoute.ts` | CSRF guard on writes + `GET /csrf-token` |
| `healthRoutes.ts` | `/livez`, `/readyz`, `/_health` |
| `testResetRoute.ts` | `/_test/reset` (dev/test only — see Security below) |
| `faviconRoute.ts` | `/favicon.ico` |
| `uploadsRoute.ts` | `/uploads/*` (avatar serving via `serveAvatar`) |
| `authApiRoute.ts` | `/auth/api/*` |
| `authCallbackRoute.ts` | `/auth/callback/*` |
| `apiRoute.ts` | `/api/*` (delegates to `@luckystack/api`'s `handleHttpApiRequest`) |
| `syncRoute.ts` | `/sync/*` (delegates to `@luckystack/sync`'s `handleHttpSyncRequest`) |
| `customRoutes.ts` | Calls every handler registered via `registerCustomRoute(...)` and the inline `customRoutes` option |
| `staticRoutes.ts` | Final fallback to the consumer's `serveFile(...)` (Vite SPA, etc.) |

Top-level `handleHttpRequest` + `dispatchRoutes(handlers, ctx)` are the only orchestration; everything else is a flat list of single-purpose handlers. SSE handling, error fall-through, and dispatch order are preserved.

### Security defaults that may surprise you

- **CORS fail-closed.** If neither `Origin` nor `Referer` is present, only read-only methods (GET, HEAD, OPTIONS) are allowed; state-changing methods are rejected with 403. Earlier builds fell back to `Host`, which silently bypassed CORS for non-browser callers (`curl`, server-to-server). When you `curl` a write endpoint, set `-H 'Origin: https://your-allowed-origin'`.
- **`/_test/reset` is fail-closed.** It requires both `NODE_ENV` to be exactly `development` or `test` AND a non-empty `TEST_RESET_TOKEN` env var. Any other state returns 403 (no silent allow-list). Wire `TEST_RESET_TOKEN` in your dev/test `.env.local` and pass it as the `x-test-reset-token: ${TOKEN}` header on the reset call. `@luckystack/test-runner`'s `resetServerState` reads the same env var.
- **CSRF middleware.** Writes to `/api/*` and `/sync/*` require an `x-csrf-token` header that matches the value minted on the session record (mirrored via `GET /auth/csrf`). The `apiRequest` helper in `@luckystack/core/client` attaches it automatically. Rejections dispatch the `csrfMismatch` hook before returning 403; the payload contains presence-only token info, never the value. The header name, token length, and cookie options are customisable via `registerCsrfConfig({ headerName, tokenLength, cookieOptions })` from `@luckystack/core` — see `packages/core/docs/csrf-config.md`.

## Public API

| Export | Purpose |
| --- | --- |
| `bootstrapLuckyStack(options)` | High-level entry: verifies config, auto-imports overlay, then calls `createLuckyStackServer`. |
| `createLuckyStackServer(options)` | Lower-level factory that returns `{ httpServer, ioServer, listen }`. |
| `verifyBootstrap(requirements?)` | Pre-flight check for project/deploy/services config and required env keys. |
| `registerCustomRoute(handler)` / `getCustomRoutes()` / `clearCustomRoutes()` | Global custom-route registry composed by `bootstrapLuckyStack`. |
| Hook payload types: `OnSocketConnectPayload`, `OnSocketDisconnectPayload`, `PreRoomJoinPayload`, `PostRoomJoinPayload`, `PreRoomLeavePayload`, `PostRoomLeavePayload`, `OnLocationUpdatePayload` | For socket-lifecycle hook handlers. |
| Types: `CreateLuckyStackServerOptions`, `BootstrapLuckyStackOptions`, `BootstrapRequirements`, `RunningLuckyStackServer`, `RouteContext`, `StaticFileHandler`, `FaviconHandler`, `CustomRouteHandler` | Handler typing. |

## Dependencies

- Runtime: `@luckystack/api`, `@luckystack/core`, `@luckystack/login`, `@luckystack/presence`, `@luckystack/sync`
- Peer (canonical ranges, standardized 2026-05-07):
  - `@prisma/client@^6.19.0` (transitively required via `@luckystack/core`)
  - `socket.io@^4.8.0`
- Optional peer: `@luckystack/error-tracking`, `@luckystack/email`, `@luckystack/docs-ui` — bootstrap auto-detects them but does not require them.

## Selecting bundles + port at runtime

`@luckystack/server/parseArgv` is a side-effect-only entrypoint. Import it as the **first line** of your `server.ts` so positional CLI args are parsed before any module that reads `process.env.SERVER_PORT` at load time (notably your project's `config.ts`).

```ts
// server.ts
import '@luckystack/server/parseArgv';
// ...rest of your bootstrap
```

Argv shape: `<bundle[,bundle...]> [port]`

```bash
npm run server                              # default preset, port 80
npm run server -- billing                   # one bundle, port 80
npm run server -- billing,vehicles 4001     # merge bundles, listen on 4001
```

When multiple presets are passed, the framework loads each preset's generated route map and shallow-merges `apis` / `syncs` / `functions`. Key collisions across presets throw at boot (services must own exactly one preset).

## Related architecture docs

- [`docs/ARCHITECTURE_PACKAGING.md`](../../docs/ARCHITECTURE_PACKAGING.md) — package split, multi-service builds, preset bundles.
- [`docs/ARCHITECTURE_SOCKET.md`](../../docs/ARCHITECTURE_SOCKET.md) — Socket.io setup, Redis adapter, room model.
- [`docs/HOSTING.md`](../../docs/HOSTING.md) — multi-instance deployment, `@luckystack/router`, health probes.

## License

MIT — see [LICENSE](../../LICENSE).
