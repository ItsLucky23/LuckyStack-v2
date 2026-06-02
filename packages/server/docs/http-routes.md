# HTTP Routes

> Deep specs. Bron: `packages/server/src/httpHandler.ts`, `packages/server/src/httpRoutes/*.ts`, `packages/server/src/customRoutesRegistry.ts`. Bijgewerkt: 2026-05-20.

## Overview

`@luckystack/server` ships every HTTP route the framework needs: liveness / readiness / health probes, CSRF token issue + middleware, the destructive test-reset endpoint, favicon, uploads, OAuth (`/auth/api` + `/auth/callback`), the dispatcher to `/api/*` and `/sync/*`, custom routes, and a static-file SPA fallback. The orchestrator in `httpHandler.ts` runs them as two ordered tables (PRE_PARAMS and POST_PARAMS). Each handler matches its own route path and returns `boolean`. First handler to return `true` (or end the response) terminates dispatch.

Pre-params handlers (no body parse) run first so probes, favicon, and CSRF stay cheap:

1. `handleCsrfRoute` — `/auth/csrf`
2. `handleFaviconRoute` — `/favicon.ico`
3. `handleLivezRoute` — `projectConfig.http.liveEndpoint` (default `/livez`)
4. `handleReadyzRoute` — `projectConfig.http.readyEndpoint` (default `/readyz`)
5. `handleHealthRoute` — `projectConfig.http.healthEndpoint` (default `/_health`)
6. `handleTestResetRoute` — `projectConfig.http.testResetEndpoint` (default `/_test/reset`)

Post-params handlers (after body parsing) run next:

1. `handleUploadsRoute` — `/uploads/*`
2. `handleAuthApiRoute` — `/auth/api/*`
3. `handleAuthCallbackRoute` — `/auth/callback/*`
4. `handleApiRoute` — `/api/*` (delegates to `@luckystack/api`)
5. `handleSyncRoute` — `/sync/*` (delegates to `@luckystack/sync`)
6. `handleCustomRoutes` — every handler from `registerCustomRoute(...)` + `options.customRoutes`
7. `handleStaticAndSpaFallback` — `/assets/*`, known extensions, SPA `index.html`

A custom-route registry sits in front of the static fallback. Both the legacy `customRoutes` option on `CreateLuckyStackServerOptions` and the global `registerCustomRoute(...)` registry are honored. Errors in custom handlers are caught and reported as `500 server.customRouteFailed`; the request loop is never crashed by a misbehaving handler.

## Framework route reference

| Route | Method(s) | Handler | Response (success) | Response (failure) |
| --- | --- | --- | --- | --- |
| `/auth/csrf` | GET | `handleCsrfRoute` | `200 { status: 'success', csrfToken }` | `401 auth.unauthenticated` |
| `/favicon.ico` | GET | `handleFaviconRoute` | Whatever `options.serveFavicon(res)` writes | `404` empty when no handler supplied |
| `/livez` | GET | `handleLivezRoute` | `200 { status: 'live' }` | Always 200 when reachable |
| `/readyz` | GET | `handleReadyzRoute` | `200 { status: 'ready', checks: {...} }` | `503 { status: 'not-ready', checks: {...} }` |
| `/_health` | GET | `handleHealthRoute` | `200 { status: 'ok', bootUuid, envKey, synchronizedHashes }` | `503 { status: 'degraded', ... }` when boot UUID is missing |
| `/_test/reset` | POST | `handleTestResetRoute` | `200 { status: 'success', cleared: string[] }` | `404 notFound` or `403 auth.forbidden` — see `security-defaults.md` |
| `/uploads/*` | GET | `handleUploadsRoute` | Avatar bytes via `@luckystack/core` `serveAvatar` | `404` from `serveAvatar` when missing |
| `/auth/api/*` | POST | `handleAuthApiRoute` | OAuth redirect (`302`) or credentials login envelope | Rate-limited envelope, `200` envelope with `status:false, reason` |
| `/auth/callback/*` | GET | `handleAuthCallbackRoute` | `302` to `redirectUrl` with session cookie or token | `401 'Login failed'` plain text |
| `/api/*` | GET / POST / PUT / DELETE | `handleApiRoute` | JSON envelope from `@luckystack/api` `handleHttpApiRequest`, or SSE stream | `400 api.invalidName`, `500 api.invalidRequestFormat` |
| `/sync/*` | POST | `handleSyncRoute` | JSON envelope from `@luckystack/sync` `handleHttpSyncRequest`, or SSE stream | `405 sync.methodNotAllowed`, `400 sync.invalidName`, `500 sync.invalidRequestFormat` |
| `/assets/*`, `*.{png,jpg,jpeg,gif,svg,html,css,js}` | GET | `handleStaticAndSpaFallback` | Whatever `options.serveFile` writes (URL temporarily rewritten) | `404` when no `serveFile` is wired |
| Any other extension-less path | GET | `handleStaticAndSpaFallback` | SPA fallback (rewrite URL to `/`, call `serveFile`) | `404` when no `serveFile` |

> The CSRF header name clients must send (for the `/auth/csrf` route above) is configurable: it comes from `getCsrfConfig().headerName` (default `x-csrf-token`), renamable via `registerCsrfConfig({ headerName })` from `@luckystack/core`.

## API Reference — handlers

All handlers conform to:

```typescript
type HttpRouteHandler = (ctx: HttpRouteContext) => Promise<boolean>;

interface HttpRouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  options: CreateLuckyStackServerOptions;
  routePath: string;
  queryString: string | undefined;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  token: string | null;
  requestId: string;
  sessionCookieOptions: string;
  params: object;
}
```

A handler returns `true` (or simply ends `res`) to short-circuit dispatch; returning `false` falls through to the next handler.

### `handleLivezRoute(ctx)`

**Behavior:**

- Matches when `routePath === projectConfig.http.liveEndpoint` (default `/livez`).
- Always emits `200 application/json { status: 'live' }`.

**Edge cases:** no downstream dependencies; succeeds as long as the Node event loop is responsive.

### `handleReadyzRoute(ctx)`

**Behavior:**

- Matches when `routePath === projectConfig.http.readyEndpoint` (default `/readyz`).
- Sequentially checks: `readBootUuid()` (Redis), `redis.ping()`, and a Prisma probe.
- Prisma probe is provider-agnostic: tries `$queryRaw\`SELECT 1\`` first, then `$runCommandRaw({ ping: 1 })`. Detecting the active provider via private fields drifts between Prisma majors, so the handler probes by capability.
- Returns `200 { status: 'ready', checks }` only when all three pass; `503 { status: 'not-ready', checks: { bootUuid, redis, prisma } }` otherwise.

**Edge cases:**

- `redis.ping()` errors are swallowed and surface as `redis: false`.
- A Prisma client with neither raw method available results in `prismaOk = false`.

### `handleHealthRoute(ctx)`

**Behavior:**

- Matches when `routePath === projectConfig.http.healthEndpoint` (default `/_health`).
- Reads `bootUuid`, `resolveEnvKey()`, and `computeSynchronizedEnvHashes()` from `@luckystack/core`.
- Returns `200 { status: 'ok', bootUuid, envKey, synchronizedHashes }` when boot UUID is present, otherwise `503 { status: 'degraded', ... }`.
- Consumed by `@luckystack/router` to verify shared-Redis topology after a rolling restart.

### `handleCsrfRoute(ctx)`

**Behavior:**

- Matches `routePath === '/auth/csrf'`.
- Requires a session token (cookie or `Authorization`). Returns `401 auth.unauthenticated` when missing or when `getSession(token)` does not resolve a valid session.
- On success returns `200 { status: 'success', csrfToken }`.

**Note:** the matching middleware is `enforceCsrfOnStateChangingRequest` (see `request-pipeline.md`). This route only issues tokens.

### `handleFaviconRoute(ctx)`

**Behavior:**

- Matches `routePath === '/favicon.ico'`.
- Delegates to `options.serveFavicon(res)`. Without that option, returns an empty `404`.

### `handleUploadsRoute(ctx)`

**Behavior:**

- Matches every path starting with `/uploads/`.
- Delegates to `serveAvatar({ routePath, res })` from `@luckystack/core`. Response (and `404` on miss) is owned by `serveAvatar`.

### `handleAuthApiRoute(ctx)`

**Behavior:**

- Matches `routePath` starting with `/auth/api`.
- Looks up the provider via `getOAuthProviders().find((p) => p.name === routePath.split('/')[3])`.
- For full OAuth providers (`isFullOAuthProvider(provider)`):
  - `createOAuthState(provider.name)` produces a CSRF state token; failure returns `500 login.oauthStateInitFailed`.
  - Builds the provider's authorization URL with `client_id`, `redirect_uri`, `scope`, `response_type=code`, `prompt=select_account`, `state`, and emits a `302`.
- For credentials provider:
  - Applies an IP-keyed rate limit (`key: ip:<remote>:auth:credentials`) using `projectConfig.rateLimiting.defaultApiLimit` + `windowMs`. On hit, dispatches `rateLimitExceeded` hook and returns `{ status: false, reason: 'api.rateLimitExceeded', errorParams: [{ key: 'seconds', value: resetIn }] }`.
  - Calls `loginWithCredentials(params)`. On success: delete existing session, choose cookie-based vs header-based token via `x-session-based-token` header (overrides `projectConfig.session.basedToken`), then emit `Set-Cookie` or `X-Session-Token`.
  - Final envelope: `{ status, reason, session, authenticated }`.

**Errors:** unknown provider -> `{ status: false, reason: 'login.providerNotFound' }`; thrown errors bubble to the outer `httpHandler` error path.

### `handleAuthCallbackRoute(ctx)`

**Behavior:**

- Matches `routePath` starting with `/auth/callback`.
- Computes `baseLocation = process.env.DNS || projectConfig.app.publicUrl || '/'` (the `||` is intentional — empty `DNS` falls through; `??` would shadow `app.publicUrl`).
- Delegates to `loginCallback(routePath, req, res, { defaultRedirectUrl })` from `@luckystack/login`.
- On failure: `401 'Login failed'`.
- On success: delete existing session, then redirect (`302`). With `projectConfig.session.basedToken: true` the token rides as `?token=...` in the query; otherwise it's emitted as a session cookie.

### `handleApiRoute(ctx)`

**Behavior:**

- Matches every path starting with `/api/`.
- Detects SSE intent via `shouldUseHttpStream({ acceptHeader, queryString })`: returns true if `Accept` contains `text/event-stream` or `?<projectConfig.http.stream.queryParam>=<enabledValue>` (or `=1`). When true, initializes an SSE response header and tracks client disconnect via `req.on('close', ...)`.
- Strips `/api/` prefix; empty name -> `400 api.invalidName` (or SSE `final` event with same payload).
- Calls `handleHttpApiRequest({ name, data, token, requesterIp, xLanguageHeader, acceptLanguageHeader, method, stream? })` from `@luckystack/api`. The `stream` callback emits `event: stream` SSE frames during long-running calls.
- Emits the result (`event: final` for SSE, or `JSON.stringify(result)` + `res.writeHead(result.httpStatus)` for non-SSE).

**Errors:** any thrown error is logged + captured to Sentry, `apiError` hook dispatched, and the envelope `500 api.invalidRequestFormat` is returned (over SSE or JSON).

### `handleSyncRoute(ctx)`

**Behavior:**

- Matches every path starting with `/sync/`.
- Only `POST` is allowed; other methods return `405 sync.methodNotAllowed`.
- Normalizes params into `{ data, receiver, ignoreSelf?, cb? }`. Empty `receiver` is allowed (`''`).
- Calls `handleHttpSyncRequest({ name: 'sync/<rest>', cb, data, receiver, ignoreSelf, token, requesterIp, xLanguageHeader, acceptLanguageHeader, stream? })` from `@luckystack/sync`.
- SSE handling mirrors `handleApiRoute`.

**Errors:** mirrors `handleApiRoute` — logs, Sentry, `syncError` hook, returns `500 sync.invalidRequestFormat`.

### `handleCustomRoutes(ctx)`

**Behavior:**

- Iterates every handler registered via `registerCustomRoute(...)` in registration order; first one to return `true` or end the response wins.
- If none handled, falls back to the inline `options.customRoutes` if provided.
- Each handler is wrapped in `tryCatch` — on throw it logs via `getLogger().error`, calls `captureException`, and emits `500 server.customRouteFailed` (returning `true` so dispatch stops).

### `handleStaticAndSpaFallback(ctx)`

**Behavior:**

- `/assets/*` paths: slice from the first `/assets/` occurrence, temporarily rewrite `req.url` to the asset path, call `options.serveFile`, restore `req.url`. Without `serveFile`, returns `404 Not Found`.
- Paths matching `KNOWN_STATIC_FILE_REGEX` (`/^\/(assets\/[a-zA-Z0-9_\-/]+|[a-zA-Z0-9_\-]+)\.(png|jpg|jpeg|gif|svg|html|css|js)$/`): call `serveFile` directly without URL rewrite.
- Other paths that have an extension `path.extname(routePath)`: `404 Not Found` (text/plain).
- Extensionless paths (SPA routes): rewrite `req.url` to `/`, call `serveFile`. Without `serveFile`, returns `404 Not Found`.

**Why the rewrite around `serveFile`:** consumers (Vite, custom static middleware) read `req.url`. We swap then restore so downstream loggers / metrics see the original URL.

## Custom-route registry

```typescript
export const registerCustomRoute: (handler: CustomRouteHandler) => void;
export const getCustomRoutes: () => readonly CustomRouteHandler[];
export const clearCustomRoutes: () => void;
```

- `registerCustomRoute(handler)` — appends to an in-memory array. Called by overlay packages (`@luckystack/docs-ui` mounts `/_docs` this way).
- `getCustomRoutes()` — read snapshot; iterated by `handleCustomRoutes`.
- `clearCustomRoutes()` — empty the array; used by `@luckystack/test-runner`'s reset flow.

The handler signature:

```typescript
type CustomRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
) => Promise<boolean> | boolean;

interface RouteContext {
  routePath: string;
  method: string;
  queryString: string | undefined;
  token: string | null;
}
```

Return `true` (or end the response) when handled. Throws are caught and emit `500 server.customRouteFailed`.

**Example — webhook receiver:**

```typescript
import { registerCustomRoute } from '@luckystack/server';

registerCustomRoute(async (req, res, ctx) => {
  if (ctx.routePath !== '/webhooks/stripe') return false;
  if (ctx.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return true;
  }
  // verify signature, process body ...
  res.writeHead(200);
  res.end('ok');
  return true;
});
```

**Example — health alias for an external monitor:**

```typescript
registerCustomRoute(async (_req, res, ctx) => {
  if (ctx.routePath !== '/healthz') return false;
  res.statusCode = 200;
  res.end('ok');
  return true;
});
```

## SSE streaming

`/api/*` and `/sync/*` both support Server-Sent Events when the client opts in. Helpers live in `packages/server/src/sse.ts`:

| Helper | Behavior |
| --- | --- |
| `shouldUseHttpStream({ acceptHeader, queryString })` | Returns `true` if `Accept` includes `text/event-stream` OR the query string contains `<projectConfig.http.stream.queryParam>=<enabledValue>` (or `=1`). |
| `initSseResponse(res)` | Writes `200` with `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`. Emits `projectConfig.http.stream.connectedComment` as a keepalive comment if configured. |
| `sendSseEvent({ res, event, data })` | Writes `event: <event>\ndata: <json>\n\n`. No-op once `res.writableEnded`. |

Lifecycle in `handleApiRoute` / `handleSyncRoute`:

1. Decide SSE vs JSON via `shouldUseHttpStream`.
2. If SSE, call `initSseResponse(res)` and `req.on('close', () => { streamClosed = true; })`.
3. Pass a `stream` callback to `handleHttpApiRequest` / `handleHttpSyncRequest` that emits `event: stream` frames while the request is processing.
4. On completion, emit `event: final` with the result envelope and call `res.end()`.
5. On error, emit `event: error` with the `500 *.invalidRequestFormat` envelope.

## Hooks dispatched

| Hook | Payload | When |
| --- | --- | --- |
| `rateLimitExceeded` | `{ scope, key, limit, windowMs, count, route, ip }` | `handleAuthApiRoute` credentials path when IP limit is exceeded. |
| `apiError` | `{ route, method, requestId, error }` | `handleApiRoute` outer error path. |
| `syncError` | `{ route, method, requestId, error }` | `handleSyncRoute` outer error path. |
| `csrfMismatch` | `{ route, method, requestId, userId, providedToken }` | `enforceCsrfOnStateChangingRequest` (see `request-pipeline.md`). |
| `preHttpRequest` | `{ method, url, requestId, origin, headers }` | Every incoming request before dispatch (see `request-pipeline.md`). |

## Config keys consumed

| Source | Key | Effect |
| --- | --- | --- |
| config | `projectConfig.http.healthEndpoint` | Default `/_health`. |
| config | `projectConfig.http.liveEndpoint` | Default `/livez`. |
| config | `projectConfig.http.readyEndpoint` | Default `/readyz`. |
| config | `projectConfig.http.testResetEndpoint` | Default `/_test/reset`. |
| config | `projectConfig.http.stream.queryParam` / `enabledValue` / `connectedComment` | SSE opt-in query parameter + initial keepalive comment. |
| config | `projectConfig.http.sessionCookieName` | Cookie name written by `/auth/api` / `/auth/callback`. |
| config | `projectConfig.session.basedToken` | Cookie vs header token transport. |
| config | `projectConfig.rateLimiting.defaultApiLimit` / `windowMs` | Credentials login rate limit. |
| env | `DNS` | Legacy public origin override for callback redirect. |
| env | `TEST_RESET_TOKEN` | Consumed by `/_test/reset` — see `security-defaults.md`. |

## Related

- Function INDEX: `packages/server/CLAUDE.md`
- Request pipeline: `packages/server/docs/request-pipeline.md`
- Security defaults: `packages/server/docs/security-defaults.md`
- API delegate: `docs/ARCHITECTURE_API.md`
- Sync delegate: `docs/ARCHITECTURE_SYNC.md`
- README: `packages/server/README.md`
