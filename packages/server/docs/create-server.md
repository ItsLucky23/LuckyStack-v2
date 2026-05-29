# Create Server (`createLuckyStackServer` + `bootstrapLuckyStack`)

> Deep specs. Bron: `packages/server/src/createServer.ts`, `packages/server/src/bootstrap.ts`, `packages/server/src/verifyBootstrap.ts`, `packages/server/src/hookPayloads.ts`, `packages/server/src/types.ts`. Bijgewerkt: 2026-05-20.

## Overview

`@luckystack/server` exposes two boot entries:

- `bootstrapLuckyStack(options)` — high-level, auto-imports the project's `luckystack/<package>/*.ts` overlay folder in topological order, then delegates to `createLuckyStackServer`. This is what `create-luckystack-app` scaffolds and what most apps should call.
- `createLuckyStackServer(options)` — low-level factory. Skips overlay loading; the caller is responsible for getting every framework registry populated (project config, deploy config, runtime maps, OAuth providers, etc.) before it runs. Returns `{ httpServer, ioServer, listen }`.

Both honor an explicit pre-flight check via `verifyBootstrap(requirements?)`, which fails fast when a critical registration was forgotten. `createLuckyStackServer` invokes it internally so direct callers don't have to.

Boot order (effective for both entries):

1. `bootstrapLuckyStack` only: load overlay files (`core` -> `deploy` -> `login` -> `sentry` -> `presence` -> `docs-ui` -> `server`, each folder topologically followed by alphabetical `*.ts`).
2. If `options.loadGeneratedMaps` was supplied, register the framework-shipped runtime-maps provider before `verifyBootstrap` so the boot check sees it.
3. `verifyBootstrap` runs (using the per-call `requireDeployConfig` / `requireServicesConfig` / `requireOAuthProviders` flags). Throws a single descriptive `Error` if anything is missing.
4. Resolve `port` (`options.port` -> argv-parsed -> `SERVER_PORT` -> `80`) and `ip` (`options.ip` -> `SERVER_IP` -> `127.0.0.1`); register them with `registerBindAddress` so framework consumers see the resolved values.
5. In dev mode (`enableDevTools !== false` and `NODE_ENV !== 'production'`): `initConsolelog()` + dynamic-import `@luckystack/devkit` -> `initializeAll()` + `setupWatchers()`. Install `SIGINT` / `SIGTERM` handlers that force-exit.
6. `writeBootUuid()` writes a fresh boot UUID to Redis so `/_health` becomes truthful and the router can detect rolling restarts.
7. Construct `http.createServer(handleHttpRequest)` and `loadSocket(httpServer, { maxHttpBufferSize })`.
8. Return `{ httpServer, ioServer, listen }`. The HTTP server has NOT started listening yet; the caller invokes `listen()` to bind.

## API Reference

### `createLuckyStackServer(options?: CreateLuckyStackServerOptions): Promise<RunningLuckyStackServer>`

**Signature:**

```typescript
export const createLuckyStackServer = async (
  options: CreateLuckyStackServerOptions = {}
): Promise<RunningLuckyStackServer>;
```

**Parameters:**

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `port` | `number \| string` | `getParsedPort()` -> `SERVER_PORT` -> `80` | HTTP listen port. String coerced via `parseInt(_, 10)`. |
| `ip` | `string` | `process.env.SERVER_IP ?? '127.0.0.1'` | Bind address. Registered with `registerBindAddress` so `checkOrigin` and other framework code see the resolved value. |
| `serveFile` | `StaticFileHandler` | none | Catch-all GET handler (Vite output, SPA `index.html`). Called for `/assets/*`, known static extensions, and the final SPA fallback. Without it the static fallback returns `404`. |
| `serveFavicon` | `FaviconHandler` | none | Handler for `/favicon.ico`. Without it the route returns `404`. |
| `customRoutes` | `CustomRouteHandler` | none | Inline custom-route hook. Composed after the registry handlers from `registerCustomRoute(...)`; first one to return `true` wins. |
| `enableDevTools` | `boolean` | `NODE_ENV !== 'production'` | Toggles `initConsolelog()` + devkit hot reload + REPL. Pass `false` to opt out. |
| `maxHttpBufferSize` | `number` | `5 * 1024 * 1024` | Forwarded to Socket.io. Raise for large payloads. |
| `requireDeployConfig` | `boolean` | `false` | When `true`, `verifyBootstrap` fails if no `DeployConfig` was registered. |
| `requireServicesConfig` | `boolean` | `false` | When `true`, `verifyBootstrap` fails if no `ServicesConfig` was registered (router topology). |
| `requireOAuthProviders` | `boolean` | `false` | When `true`, `verifyBootstrap` fails if only the default `credentials` provider is registered. |
| `loadGeneratedMaps` | `(preset: string) => Promise<unknown>` | none | Callback that resolves a generated runtime-maps module per preset. Triggers `registerProdRuntimeMapsProvider` internally. Required because dynamic-import resolution is module-scoped — the framework cannot resolve a relative path on the consumer's behalf. |
| `runtimeMapsPreset` | `string \| string[]` | argv -> `'default'` | Overrides the argv-derived preset list. |

**Returns:** `RunningLuckyStackServer`:

```typescript
interface RunningLuckyStackServer {
  httpServer: http.Server;
  ioServer: socket.io.Server;
  listen: (callback?: () => void) => Promise<http.Server>;
}
```

`listen()` resolves when the HTTP server is bound. Logs `Server is running on http://<ip>:<port>/` when `projectConfig.logging.socketStartup` or `projectConfig.logging.devLogs` is enabled. It is safe to call once; calling twice yields a Node `ERR_SERVER_ALREADY_LISTEN` from the underlying `httpServer.listen`.

**Behavior (execution order):**

- Auto-register prod runtime-maps provider if `loadGeneratedMaps` is set.
- Run `verifyBootstrap` (may throw).
- Resolve port + ip; call `registerBindAddress({ ip, port })`.
- If dev-tools enabled: load console initializer + devkit (`initializeAll`, `setupWatchers`); attach SIGINT / SIGTERM force-exit handlers.
- `await writeBootUuid()`.
- Create `http.Server` whose request handler is `handleHttpRequest(req, res, options)` (see `request-pipeline.md`).
- `loadSocket(httpServer, { maxHttpBufferSize })` attaches the Socket.io server.
- Return `{ httpServer, ioServer, listen }` without listening.

**Errors / Edge cases:**

- Throws (from `verifyBootstrap`) when a required registry is missing — single multi-line `Error`.
- Dev-only branch dynamically imports `@luckystack/devkit`; production bundles exclude it so the import is never reached when `NODE_ENV === 'production'`.
- `enableDevTools: true` in production loads devkit; this is supported but unusual.
- SIGINT / SIGTERM handlers are installed only when dev-tools branch runs.
- `writeBootUuid` failures bubble — boot will abort if Redis is unreachable at start.

**Example — direct boot (skip overlay):**

```typescript
import 'dotenv/config';
import './config';
import './deploy.config';
import { initializeSentry } from '@luckystack/error-tracking';
import { registerPresenceHooks } from '@luckystack/presence';
import { createLuckyStackServer } from '@luckystack/server';
import { serveFile, serveFavicon } from './prod/serveFile';

initializeSentry();
registerPresenceHooks();

const server = await createLuckyStackServer({
  serveFile,
  serveFavicon,
  loadGeneratedMaps: (preset) => import(`./prod/generatedApis.${preset}`),
  requireDeployConfig: true,
});
await server.listen();
```

---

### `bootstrapLuckyStack(options?: BootstrapLuckyStackOptions): Promise<RunningLuckyStackServer>`

**Signature:**

```typescript
export const bootstrapLuckyStack = async (
  options: BootstrapLuckyStackOptions = {}
): Promise<RunningLuckyStackServer>;
```

**Parameters:** extends `CreateLuckyStackServerOptions` with:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `overlayRoot` | `string` | `'luckystack'` | Folder name (relative to `ROOT_DIR` from `@luckystack/core`) that holds the per-package overlay files. Absolute paths are honored as-is. |
| `skipOverlayLoad` | `boolean` | `false` | Skip auto-loading the overlay folder. Useful for tests or hand-built registries. |

**Returns:** identical to `createLuckyStackServer`.

**Behavior:**

- If `skipOverlayLoad !== true` and `<ROOT_DIR>/<overlayRoot>` exists, walk the canonical package order (`core`, `deploy`, `login`, `sentry`, `presence`, `docs-ui`, `server`).
- Inside each package folder: import `index.ts`/`index.js` first if present, then every remaining `*.ts` / `*.js` file in alphabetical order. Each file is responsible for its own side-effect registration.
- Then delegate to `createLuckyStackServer(options)`.

**Errors / Edge cases:**

- Missing `<overlayRoot>` folder is non-fatal — the function returns silently so projects can use the legacy single-file `config.ts` layout.
- Missing per-package subfolders (e.g. no `luckystack/docs-ui/`) are silently skipped.
- Import errors from overlay files bubble up unchanged; fix the failing module.

**Example — recommended scaffolded boot:**

```typescript
import '@luckystack/server/parseArgv';
import 'dotenv/config';
import './config';
import './deploy.config';
import { bootstrapLuckyStack, verifyBootstrap } from '@luckystack/server';
import { serveFile, serveFavicon } from './prod/serveFile';

const server = await bootstrapLuckyStack({
  serveFile,
  serveFavicon,
  loadGeneratedMaps: (preset) => import(`./prod/generatedApis.${preset}`),
});

await verifyBootstrap({
  requireDeployConfig: true,
  requireOAuthProviders: true,
});

await server.listen();
```

---

### `verifyBootstrap(requirements?: BootstrapRequirements): Promise<void>`

**Signature:**

```typescript
export const verifyBootstrap = async (
  requirements: BootstrapRequirements = {},
): Promise<void>;
```

**Parameters:**

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `requireDeployConfig` | `boolean` | `false` | Fail unless `registerDeployConfig` has been called. |
| `requireServicesConfig` | `boolean` | `false` | Fail unless `registerServicesConfig` has been called. |
| `requireOAuthProviders` | `boolean` | `false` | Fail unless an OAuth provider beyond the default `credentials` entry has been registered. |

**Returns:** `Promise<void>` — resolves silently when every required registry is in place.

**Behavior:**

- Builds a `missing[]` array. Checks in this order:
  1. `isProjectConfigRegistered()` — always required.
  2. `isDeployConfigRegistered()` — only when `requireDeployConfig`.
  3. `isServicesConfigRegistered()` (lazy import) — only when `requireServicesConfig`.
  4. `getOAuthProviders().length > 1` (lazy import from `@luckystack/login`) — only when `requireOAuthProviders`. Default registry length is `1` (`credentials`).
  5. `isRuntimeMapsProviderRegistered()` — hard-fail in production, loud `getLogger().warn(...)` in dev/test.
  6. `isLocalizedNormalizerRegistered()` — hard-fail in production, warn in dev/test.
- If `missing.length === 0`: return. Otherwise throw a single `Error` whose message lists every missing registration with a one-line remediation hint and points at `docs/ARCHITECTURE_PACKAGING.md`.

**Errors / Edge cases:**

- Throws synchronously after building the missing list. No partial-state recovery.
- The `RuntimeMapsProvider` warning in dev is intentional: devkit hot-reload normally registers one, so missing it during a bare boot is informational, not fatal.
- The `LocalizedNormalizer` warning in dev means error responses will surface the raw `errorCode` string instead of localized copy.

**Example:**

```typescript
import { verifyBootstrap } from '@luckystack/server';

await verifyBootstrap({
  requireDeployConfig: true,
  requireServicesConfig: false,
  requireOAuthProviders: true,
});
```

## Hook payload types

Module augmentation in `hookPayloads.ts` extends `@luckystack/core`'s `HookPayloads` interface, so `dispatchHook` / `registerHook` accept these names with the correct payload typing.

| Hook name | Payload type | When it fires |
| --- | --- | --- |
| `onSocketConnect` | `OnSocketConnectPayload` (`{ socketId, token, ip }`) | Notification: every successful Socket.io connection. |
| `onSocketDisconnect` | `OnSocketDisconnectPayload` (`{ socketId, token, reason }`) | Notification: every Socket.io disconnect (with reason string). |
| `preRoomJoin` | `PreRoomJoinPayload` (`{ token, room }`) | Before the user joins a room. May stop with `HookStopSignal`. |
| `postRoomJoin` | `PostRoomJoinPayload` (`{ token, room, allRooms }`) | After a successful join. |
| `preRoomLeave` | `PreRoomLeavePayload` (`{ token, room }`) | Before the user leaves a room. May stop. |
| `postRoomLeave` | `PostRoomLeavePayload` (`{ token, room, allRooms }`) | After a successful leave. |
| `onLocationUpdate` | `OnLocationUpdatePayload` (`{ token, oldLocation?, newLocation }`) | When the presence layer reports a location change. |

Naming convention (also documented in `hookPayloads.ts`):

- `on*` — pure notifications; return values are ignored.
- `pre*` — may return a `HookStopSignal` (`{ errorCode: string; httpStatus?: number }`) to abort the main flow.
- `post*` — fire after the side-effect succeeds.

## Types

```typescript
export interface CreateLuckyStackServerOptions { /* see table above */ }

export interface BootstrapLuckyStackOptions extends CreateLuckyStackServerOptions {
  overlayRoot?: string;
  skipOverlayLoad?: boolean;
}

export interface BootstrapRequirements {
  requireDeployConfig?: boolean;
  requireServicesConfig?: boolean;
  requireOAuthProviders?: boolean;
}

export interface RunningLuckyStackServer {
  httpServer: http.Server;
  ioServer: socket.io.Server;
  listen: (callback?: () => void) => Promise<http.Server>;
}

export interface RouteContext {
  routePath: string;
  method: string;
  queryString: string | undefined;
  token: string | null;
}

export type StaticFileHandler = (req: IncomingMessage, res: ServerResponse) => unknown;
export type FaviconHandler = (res: ServerResponse) => unknown;
export type CustomRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
) => Promise<boolean> | boolean;
```

## Config keys consumed at boot

| Source | Key | Effect |
| --- | --- | --- |
| env | `SERVER_PORT` | Port fallback when neither `options.port` nor argv supplies one. |
| env | `SERVER_IP` | IP fallback. |
| env | `NODE_ENV` | Switches `enableDevTools` default, dynamic-import branch for devkit, and `verifyBootstrap` warn-vs-throw for runtime-maps / localized normalizer. |
| env | `SECURE` | When `'true'`, session cookies are emitted with the `Secure;` flag (see `request-pipeline.md`). |
| config | `projectConfig.logging.socketStartup` / `projectConfig.logging.devLogs` | Gates the "Server is running on ..." log line emitted by `listen()`. |
| config | `projectConfig.http.*` | Route paths + cookie + CORS + stream settings consumed at request time (not at boot). |
| argv | `<bundles> [port]` | Parsed by `applyServerArgv()` and surfaced via `getParsedBundles()` / `getParsedPort()`. |

## Related

- Function INDEX: `packages/server/CLAUDE.md`
- README (consumer quickstart): `packages/server/README.md`
- Argv parsing: `packages/server/docs/argv-parsing.md`
- Runtime maps: `packages/server/docs/runtime-maps.md`
- Request pipeline: `packages/server/docs/request-pipeline.md`
- HTTP routes: `packages/server/docs/http-routes.md`
- Security: `packages/server/docs/security-defaults.md`
- Architecture: `docs/ARCHITECTURE_PACKAGING.md`, `docs/ARCHITECTURE_SOCKET.md`, `docs/HOSTING.md`
