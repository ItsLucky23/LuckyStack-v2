# @luckystack/server

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

One-call server bootstrap for a LuckyStack project. Wires together a raw Node.js HTTP server, Socket.io (with optional Redis adapter), framework routes (`/api/*`, `/sync/*`, `/_health`, `/livez`, `/readyz`, `/_test/reset`, `/auth/*`, `/uploads/*`, `/csrf-token`), CSRF middleware, CORS + security headers, presence broadcasting, and dev-only hot reload. Consumer's `server.ts` shrinks to roughly twenty lines. Boots are gated by `verifyBootstrap` so missing registrations surface a single readable error instead of mid-request crashes.

## When to USE this package

- Project needs the full LuckyStack runtime (HTTP + sockets + framework routes wired in one call).
- Multi-bundle or multi-service deploys that need positional argv parsing (`npm run server -- <bundles> <port>`) and merged runtime maps across presets.
- Consumers that want framework-shipped health / liveness / readiness probes, CSRF protection, and dev hot reload without building plumbing themselves.
- Adding project-specific HTTP endpoints via `registerCustomRoute(...)` or the `customRoutes` option without forking the package.
- Plugins / framework packages that ship socket-lifecycle behavior via the exported hook payload types (e.g. `@luckystack/presence`).

## When to NOT suggest this (yet)

- Standalone microservices that do not use the LuckyStack registries (project config, deploy config, runtime maps, localized normalizer) — there is nothing for `verifyBootstrap` to verify, and the wiring overhead buys nothing.
- A pure router / load-balancer process — use `@luckystack/router` instead; `@luckystack/server` is for the actual service nodes behind the router.
- Build-time tooling, code generation, or migration scripts that never accept HTTP / socket traffic.
- Replacing the HTTP layer with Express / Fastify — the package owns the raw Node HTTP server and dispatch table; bringing a second framework on top breaks the route handler contract.

## Function Index

| Function / Export | One-liner | Deep doc |
|---|---|---|
| `createLuckyStackServer(options)` | Lower-level factory that returns `{ httpServer, ioServer, listen, stop, close }`. Wires HTTP + Socket.io + framework routes; installs a persistent `httpServer.on('error')` listener and (in prod) SIGTERM/SIGINT → graceful `stop()`. | -> docs/create-server.md |
| `RunningLuckyStackServer.stop(options?)` / `.close(options?)` | Graceful shutdown (MIS-016). Stops accepting new connections, dispatches the core `preServerStop` hook, flushes error-trackers (bounded by a per-step timeout race), then closes io + http + the Redis-adapter pub/sub clients. Each step isolated + time-bounded so one hanging step can't stall shutdown. Idempotent. `options`: `{ reason?, timeoutMs? }` (default `timeoutMs` 10000). | -> docs/create-server.md |
| `bootstrapLuckyStack(options)` | High-level entry: auto-imports `luckystack/<pkg>/*.ts` overlay in topological order, then delegates to `createLuckyStackServer`. An overlay file that fails to import (classic: it imports a package removed via `luckystack remove`) aborts boot with an ACTIONABLE error naming the file, instead of a raw ERR_MODULE_NOT_FOUND. | -> docs/create-server.md |
| `OVERLAY_ORDER` (exported const) | The canonical overlay walk order (`core, deploy, login, email, sentry, presence, cron, docs-ui, server`). Exported so the consumer's `scripts/bundleServer.mjs` imports it at build time — a hardcoded bundler copy once silently dropped the cron slot from prod; `overlayOrderParity.test.ts` pins the bundlers' fallback lists to this. | -> docs/create-server.md |
| `registerOverlayLoader(loader)` | Production-bundle seam: the server bundler (`scripts/bundleServer.mjs`) generates an entry that statically imports the overlay files and registers this loader; `bootstrapLuckyStack` then runs it INSTEAD of the runtime `.ts` folder walk (plain `node` cannot import `.ts` — ERR_UNKNOWN_FILE_EXTENSION). | -> docs/create-server.md |
| `verifyBootstrap(requirements?)` | Pre-flight check for ProjectConfig / DeployConfig / ServicesConfig / OAuth / RuntimeMapsProvider / LocalizedNormalizer. Throws one descriptive `Error`. | -> docs/create-server.md |
| `parseServerArgv(argv)` | Pure parser: validates positional `<bundles> [port]` and returns `{ bundles, port }`. Throws on malformed input. | -> docs/argv-parsing.md |
| `applyServerArgv()` | Side-effect runner: parses `process.argv.slice(2)`, stores bundles + port, writes `process.env.SERVER_PORT` for downstream env readers. Idempotent. | -> docs/argv-parsing.md |
| `getParsedBundles()` | Returns the preset list parsed by `applyServerArgv()` (empty array before first call). | -> docs/argv-parsing.md |
| `getParsedPort()` | Returns the port parsed by `applyServerArgv()` (`null` if argv omitted it). | -> docs/argv-parsing.md |
| `@luckystack/server/parseArgv` (side-effect import) | First-line import that runs `applyServerArgv()` before any module reads `process.env.SERVER_PORT` (notably `config.ts`). | -> docs/argv-parsing.md |
| `createProdRuntimeMapsProvider(options)` | Build a `RuntimeMapsProvider` that loads generated maps in prod and delegates to devkit discovery in dev. Returns the provider without registering. | -> docs/runtime-maps.md |
| `registerProdRuntimeMapsProvider(options)` | Convenience wrapper: builds the provider AND calls `registerRuntimeMapsProvider`. Most consumers want this. | -> docs/runtime-maps.md |
| `registerCustomRoute(handler, options?)` | Append a custom HTTP route handler. `options.phase`: `'post-params'` (default, runs after body parse) or `'pre-params'` (runs before `getParams`, raw `req` stream intact — webhooks + streaming uploads). | -> /docs/ARCHITECTURE_HTTP.md |
| `getCustomRoutes()` | Read the `'post-params'` registry snapshot (the default phase). | -> /docs/ARCHITECTURE_HTTP.md |
| `getPreParamsCustomRoutes()` | Read the `'pre-params'` registry snapshot. | -> /docs/ARCHITECTURE_HTTP.md |
| `clearCustomRoutes()` | Clear both phases (used by test resets). | -> /docs/ARCHITECTURE_HTTP.md |
| `registerOriginExemptPath({ pathPrefix })` | Exempt a path prefix from the browser origin gate so a server-to-server webhook (no `Origin`/`Referer`) reaches its handler. Empty/fail-closed by default. **Exemption ≠ auth** — the handler MUST verify a signature/secret. | -> /docs/ARCHITECTURE_HTTP.md |
| `getOriginExemptPaths()` / `clearOriginExemptPaths()` / `isOriginExemptPath(routePath)` | Read / clear / test the exempt-path registry. | -> /docs/ARCHITECTURE_HTTP.md |
| `registerSecurityHeaders(builder)` | Override / extend the security-headers builder applied to every HTTP response. | -> docs/security-defaults.md |
| `getSecurityHeadersBuilder()` | Read the currently registered builder (defaults to framework headers when no override set). | -> docs/security-defaults.md |
| `registerErrorFormatter(formatter)` | Override the JSON error shape returned by framework error responses. | -> docs/security-defaults.md |
| `getErrorFormatter()` | Read the currently registered formatter. | -> docs/security-defaults.md |
| Route handler: `handleLivezRoute` | Liveness probe at `projectConfig.http.liveEndpoint`. Always 200 when reachable. | -> docs/http-routes.md |
| Route handler: `handleReadyzRoute` | Readiness probe: boot UUID + Redis ping + database check (ADR 0020: a registered `registerDbHealthCheck` probe wins; else the built-in Prisma ping when Prisma is registered/resolvable; else `'skipped'` so a deliberately DB-less project can go ready). Response `checks.database` = tri-state, `checks.prisma` kept for compat. | -> docs/http-routes.md |
| Route handler: `handleHealthRoute` | Health endpoint: returns boot UUID + env hashes for router topology checks. | -> docs/http-routes.md |
| Route handler: `handleTestResetRoute` | Destructive test reset. Fail-closed on `NODE_ENV` and `TEST_RESET_TOKEN`. | -> docs/security-defaults.md |
| Hook payload: `OnSocketConnectPayload` | Payload type for `onSocketConnect` lifecycle hook handlers. | -> docs/create-server.md |
| Hook payload: `OnSocketDisconnectPayload` | Payload type for `onSocketDisconnect` lifecycle hook handlers. | -> docs/create-server.md |
| Hook payload: `PreRoomJoinPayload` | Payload type for `preRoomJoin` hook handlers. | -> docs/create-server.md |
| Hook payload: `PostRoomJoinPayload` | Payload type for `postRoomJoin` hook handlers. | -> docs/create-server.md |
| Hook payload: `PreRoomLeavePayload` | Payload type for `preRoomLeave` hook handlers. | -> docs/create-server.md |
| Hook payload: `PostRoomLeavePayload` | Payload type for `postRoomLeave` hook handlers. | -> docs/create-server.md |
| Hook payload: `OnLocationUpdatePayload` | Payload type for `onLocationUpdate` hook handlers. | -> docs/create-server.md |
| Types: `CreateLuckyStackServerOptions`, `BootstrapLuckyStackOptions`, `BootstrapRequirements`, `RunningLuckyStackServer`, `StopLuckyStackServerOptions`, `RouteContext`, `StaticFileHandler`, `FaviconHandler`, `CustomRouteHandler`, `ProdRuntimeMapsLoaderOptions`, `ParsedServerArgv`, `SecurityHeadersBuilder`, `ErrorFormatter`, `ErrorFormatterContext` | Handler + option typing. | -> docs/create-server.md |

## Config keys (env vars + registerProjectConfig slots)

- Port precedence — `options.port` → positional argv → `options.defaultPort` (the scaffold passes `config.ports.backend`) → legacy `SERVER_PORT` → `80`. Inputs must be integer ports in `0..65535`. After bind, `httpServer.address().port` is authoritative (including `listen(0)`). In dev, that port is advertised to `node_modules/.luckystack/dev-server.json`; cleanup removes it only when the exiting PID still owns it. The Vite proxy follows the advertisement for HTTP + WebSocket requests.
- `SERVER_IP` (env, optional, default `127.0.0.1`) — bind address fallback when `options.ip` is omitted.
- `NODE_ENV` (env, required for security-sensitive branches) — `development` / `test` toggle devkit hot reload + REPL and gate `/_test/reset`.
- `TEST_RESET_TOKEN` (env, required for `/_test/reset` to be reachable at all) — must match the `x-test-reset-token` request header. No fallback "no auth" mode.
- `projectConfig.http.healthEndpoint` (config) — path served by `handleHealthRoute`. Default `/_health`.
- `projectConfig.http.liveEndpoint` (config) — path served by `handleLivezRoute`. Default `/livez`.
- `projectConfig.http.readyEndpoint` (config) — path served by `handleReadyzRoute`. Default `/readyz`.
- `projectConfig.http.testResetEndpoint` (config) — path served by `handleTestResetRoute`. Default `/_test/reset`.
- `projectConfig.logging.socketStartup` / `projectConfig.logging.devLogs` (config) — gate the boot log line emitted by `listen()`.
- Positional argv `<bundles> [port]` — preset list (merged in `createProdRuntimeMapsProvider`) and listen port.

## Peer dependencies

- **Required (runtime deps)**: `@luckystack/api`, `@luckystack/core`.
- **Peer (canonical ranges)**: `@prisma/client@^6.19.0` (transitive via core), `socket.io@^4.8.0`.
- **Optional (all auto-detected by `bootstrapLuckyStack`; the server degrades gracefully when absent — `auth.disabled` / `sync.disabled`, presence skipped)**: `@luckystack/login`, `@luckystack/presence`, `@luckystack/sync`, `@luckystack/error-tracking`, `@luckystack/email`, `@luckystack/cron`, `@luckystack/docs-ui`, `@luckystack/devkit` (dev-only, dynamically imported by the `enableDevTools` branch).
  - **0.2.0 install-anything-anytime**: `bootstrapLuckyStack` runs an auto-detect phase BEFORE the consumer overlay that imports each installed optional package's `@luckystack/<pkg>/register` side-effect subpath (`OPTIONAL_PACKAGES` in `capabilities.ts` = `login, email, error-tracking, presence, cron, docs-ui`). So `npm i @luckystack/<pkg>` + env + restart self-wires the BACKEND with zero code edits. Detection uses `import.meta.resolve` (the `@luckystack/*` exports maps are import-only — a CJS `require.resolve` reports them absent). Client-side mounts (presence JSX, login pages) need `npx luckystack add <feature>` (`@luckystack/cli`) because Vite can't statically import an uninstalled package and file-routing only scans `src/`.

## Related

- Architecture deep-dives: `/docs/ARCHITECTURE_API.md`, `/docs/ARCHITECTURE_SOCKET.md`, `/docs/ARCHITECTURE_PACKAGING.md`, `/docs/HOSTING.md`.
- README (consumer quickstart): `./README.md`.
