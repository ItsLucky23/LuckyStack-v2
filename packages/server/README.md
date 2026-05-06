# @luckystack/server

> One-call server bootstrap for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). HTTP + Socket.io + framework routes (`/api/*`, `/sync/*`, `/_health`, `/_test/reset`, `/auth/*`, `/uploads/*`) wired together. Your `server.ts` shrinks to ~20 lines.

## Install

```bash
npm install @luckystack/server @luckystack/core @luckystack/api @luckystack/login @luckystack/sync @luckystack/presence socket.io
```

## Quickstart

```ts
import 'dotenv/config';
import '../config';            // your registerProjectConfig(...)
import '../deploy.config';     // your registerDeployConfig(...)

import { initializeSentry } from '@luckystack/sentry';
import { registerPresenceHooks } from '@luckystack/presence';
import { createLuckyStackServer } from '@luckystack/server';
import { serveFile, serveFavicon } from './prod/serveFile';

initializeSentry();
registerPresenceHooks();

const server = await createLuckyStackServer({
  serveFile,
  serveFavicon,
});

await server.listen();
```

That's the entire server entry point. The package handles devkit hot reload + console init in dev mode automatically — opt out with `enableDevTools: false` if you have your own.

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

## What it wires

- **HTTP server** with CORS + security headers, OPTIONS preflight, method validation, cookie sliding.
- **Socket.io server** attached to the HTTP server, with optional Redis adapter when configured in deploy config.
- **Framework routes:** `/_health`, `/_test/reset` (test mode only), `/api/*` and `/sync/*` (with SSE streaming), `/auth/api`, `/auth/callback/*`, `/uploads/*`, `/assets/*`.
- **Presence broadcasting** (when enabled in project config): connect / disconnect / reconnect, location updates, peer notifications.
- **Boot UUID** written on startup so the load-balancer (`@luckystack/router`) can detect rolling restarts.
- **Dev tools** in non-production: devkit hot reload, console initializer.

## Public API

| Export | Purpose |
| --- | --- |
| `createLuckyStackServer(options)` | Factory that returns `{ httpServer, ioServer, listen }`. |
| Types: `CreateLuckyStackServerOptions`, `RunningLuckyStackServer`, `RouteContext`, `StaticFileHandler`, `FaviconHandler`, `CustomRouteHandler` | For typing your handlers. |

## Dependencies

- Runtime: `@luckystack/api`, `@luckystack/core`, `@luckystack/login`, `@luckystack/presence`, `@luckystack/sync`
- Peer: `socket.io`

## License

MIT — see [LICENSE](../../LICENSE).
