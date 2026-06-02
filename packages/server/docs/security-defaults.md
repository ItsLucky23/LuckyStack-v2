# Security Defaults

> Deep specs. Bron: `packages/server/src/httpHandler.ts`, `packages/server/src/httpRoutes/csrfMiddleware.ts`, `packages/server/src/httpRoutes/testResetRoute.ts`, `packages/server/src/securityHeadersRegistry.ts`, `packages/server/src/errorFormatterRegistry.ts`. Bijgewerkt: 2026-05-20.

## Overview

`@luckystack/server` ships four fail-closed defenses out of the box:

1. **Origin policy.** No `Host` fallback — non-browser callers cannot silently bypass CORS on state-changing methods.
2. **Security headers.** Framework defaults are emitted for every response. A consumer-registered builder may override or extend.
3. **CSRF middleware.** Cookie-mode state-changing requests to `/api/*`, `/sync/*`, and `/auth/api/*` require a CSRF header (default `x-csrf-token`, renamable via `registerCsrfConfig({ headerName })` from `@luckystack/core`) matching the session-bound token; mismatches return 403 and dispatch the `csrfMismatch` hook.
4. **`/_test/reset` fail-closed.** Requires `NODE_ENV` to be exactly `development` or `test` AND a non-empty `TEST_RESET_TOKEN` env var. An unset token does NOT mean "no auth"; it means the route is permanently 403.

Plus two extension seams:

- `registerSecurityHeaders(builder)` — append / override headers per request.
- `registerErrorFormatter(formatter)` — shape the JSON error envelope globally.

## CORS / origin policy

Lives in `enforceOriginPolicy` (`httpHandler.ts`):

- `origin = req.headers.origin ?? req.headers.referer ?? ''`. There is intentionally NO `Host` fallback.
- For state-changing methods (anything other than GET / HEAD / OPTIONS) with no `Origin` and no `Referer`: respond `403 'Forbidden'` (text/plain) and stop dispatch.
- For any method when an explicit `Origin` / `Referer` is supplied but `allowedOrigin(origin)` returns false: respond `403 'Forbidden'` and stop.
- Read-only methods (GET / HEAD / OPTIONS) without an origin header pass through — this keeps health probes and asset fetches from non-browser tooling working.

When `curl`-testing a write endpoint, attach `-H 'Origin: https://your-allowed-origin'` (the allow-list lives in `projectConfig.http.cors.allowedOrigins` and is enforced by `allowedOrigin` in `@luckystack/core`).

## Security headers

`setSecurityHeaders` in `httpHandler.ts` writes the framework defaults from `projectConfig.http`:

| Header | Source | Notes |
| --- | --- | --- |
| `Access-Control-Allow-Origin` | resolved `origin` (or `''`) | Mirrors the origin policy's resolved value. |
| `Access-Control-Allow-Methods` | `cors.allowedMethods` |  |
| `Access-Control-Allow-Headers` | `cors.allowedHeaders` |  |
| `Access-Control-Expose-Headers` | `cors.exposedHeaders` |  |
| `Access-Control-Allow-Credentials` | `cors.credentials ? 'true' : (omitted)` |  |
| `Referrer-Policy` | `securityHeaders.referrerPolicy` |  |
| `X-Frame-Options` | `securityHeaders.frameOptions` |  |
| `X-XSS-Protection` | `securityHeaders.xssProtection` |  |
| `X-Content-Type-Options` | `securityHeaders.contentTypeOptions` |  |

After defaults, the registered builder (if any) runs. Errors in the builder are caught and logged via `getLogger().warn('securityHeadersBuilder threw — falling back to defaults', { err })`; the request continues with defaults intact.

### API — `registerSecurityHeaders(builder | null)`

**Signature:**

```typescript
export type SecurityHeadersBuilder = (
  req: IncomingMessage,
) => Record<string, string> | null | undefined;

export const registerSecurityHeaders = (builder: SecurityHeadersBuilder | null): void;
export const getSecurityHeadersBuilder = (): SecurityHeadersBuilder | null;
```

**Behavior:**

- Last-write-wins; subsequent calls replace the prior builder. Pass `null` to unregister.
- Builder is invoked for every request after framework defaults. A returned object's entries are written via `res.setHeader(name, value)` so they REPLACE same-name defaults (per Node semantics).
- A nullish return (`null` / `undefined`) means "use defaults only".

**Example:**

```typescript
import { registerSecurityHeaders } from '@luckystack/server';

registerSecurityHeaders((req) => ({
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; script-src 'self'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Permissions-Policy': 'camera=(), microphone=()',
}));
```

## CSRF middleware

Lives in `enforceCsrfOnStateChangingRequest` (`csrfMiddleware.ts`). Runs after origin/security-header setup but BEFORE route dispatch.

**Activation predicate (all required):**

- `projectConfig.session.basedToken === false` (cookie mode).
- HTTP method is NOT `GET` and NOT `OPTIONS`.
- `routePath` starts with `/api/`, `/sync/`, or `/auth/api/`.
- `routePath` does NOT start with `/auth/callback`.
- A session token was extracted from the request.

When the predicate is true:

1. `getSession(token)` resolves the session. If no session, skip middleware (downstream auth check rejects).
2. Read the configured CSRF header (`getCsrfConfig().headerName`, default `x-csrf-token`; first value when array).
3. If provided and equal to `session.csrfToken`, allow.
4. Otherwise: dispatch the `csrfMismatch` hook with `{ route, method, requestId, userId, providedToken: Boolean(provided) }` (note: presence-only, never the value), then respond `403 application/json { status: 'error', errorCode: 'auth.csrfMismatch', message: 'CSRF token missing or invalid. Fetch /auth/csrf first.' }`.

Token issue: `GET /auth/csrf` (`csrfRoute.ts`) returns `{ status: 'success', csrfToken }`. The `apiRequest` helper in `@luckystack/core/client` fetches it once per session and attaches it to every state-changing request automatically.

## `/_test/reset` fail-closed contract

Source: `httpRoutes/testResetRoute.ts`.

**Activation predicate (both required):**

1. `process.env.NODE_ENV` is exactly `'development'` OR `'test'`. Any other value (including unset / `'production'` / `'staging'`) returns `404 { status: 'error', errorCode: 'notFound' }`. This is the fail-closed gate — `NODE_ENV !== 'production'` is NOT a sufficient check.
2. `process.env.TEST_RESET_TOKEN` is non-empty AND `req.headers['x-test-reset-token'] === process.env.TEST_RESET_TOKEN`. Any mismatch (including an unset token) returns `403 { status: 'error', errorCode: 'auth.forbidden' }`.

**Authorization header — actual source-of-truth:**

The handler reads `req.headers['x-test-reset-token']`. Wire your test client to send:

```
x-test-reset-token: <value of TEST_RESET_TOKEN>
```

(The README quickstart mentions `Authorization: Bearer ${TOKEN}` — the running code reads `x-test-reset-token`. Use that header.)

**What the reset clears:**

| Step | Action |
| --- | --- |
| 1 | `clearAllRateLimits()` — purges in-memory + Redis rate-limit counters. Always reported in `cleared`. |
| 2 | `redis SCAN` + `DEL` keys matching `<projectName>-session:*`. Reported as `'sessions'` when at least one key is deleted. |
| 3 | `redis SCAN` + `DEL` keys matching `<projectName>-activeUsers:*`. Reported as `'activeUsers'` when at least one key is deleted. |
| 4 (opt-in) | When `?include=hooks` is supplied, `clearAllHooks()` empties every framework hook registration. Reported as `'hooks'`. |

`getProjectName()` (from `@luckystack/core`) is the single source of truth for the key prefix — same helper used by `session.ts` and `rateLimiter.ts`.

**Response:** `200 application/json { status: 'success', cleared: string[] }`. The `cleared` array reflects which subsystems reported deletions.

**Errors / edge cases:**

- Malformed `req.url` is detected with `URL.canParse(rawUrl, base)`. When false, `?include=hooks` is treated as absent.
- Redis `SCAN`+`DEL` errors are swallowed per pattern — the cleared array simply omits the label.
- The hook-clear is opt-in because clearing every hook also removes framework-internal registrations (e.g. presence's `postLogout`).

**Example — invoking from a test runner:**

```bash
curl -X POST http://127.0.0.1:80/_test/reset \
  -H 'x-test-reset-token: dev-secret-123' \
  -H 'Origin: http://127.0.0.1:80'
```

`.env.local` (dev / test only):

```
NODE_ENV=development
TEST_RESET_TOKEN=dev-secret-123
```

`@luckystack/test-runner`'s `resetServerState` reads the same env var.

## Error formatter

Lives in `errorFormatterRegistry.ts`. The framework normalizes errors via `normalizeErrorResponse` from `@luckystack/core` (i18n + envelope shape). The registered formatter is the GLOBAL hook — per-endpoint `errorFormatter` exports on route files take precedence.

**Resolution order at error time:**

1. Per-endpoint `errorFormatter` export (when the route file declares one).
2. Global formatter from `registerErrorFormatter(...)`.
3. Framework default `normalizeErrorResponse`.

### API — `registerErrorFormatter(formatter | null)`

**Signature:**

```typescript
export interface ErrorFormatterContext {
  routeName: string;
  transport: 'socket' | 'http';
  userId?: string | null;
}

export type ErrorFormatter = (
  error: {
    status: 'error';
    errorCode: string;
    message?: string;
    httpStatus?: number;
    [key: string]: unknown;
  },
  ctx: ErrorFormatterContext,
) => Record<string, unknown>;

export const registerErrorFormatter = (formatter: ErrorFormatter | null): void;
export const getErrorFormatter = (): ErrorFormatter | null;
```

**Behavior:**

- Receives the already-normalized envelope plus `{ routeName, transport, userId? }`.
- Return a (possibly extended) object that the framework emits verbatim.
- Pass `null` to unregister.

**Example — add correlation IDs + a legacy alias key:**

```typescript
import { registerErrorFormatter } from '@luckystack/server';

registerErrorFormatter((error, ctx) => ({
  ...error,
  // legacy clients expect `reason`; new clients read `errorCode`.
  reason: error.errorCode,
  correlationId: ctx.routeName + ':' + (ctx.userId ?? 'anon'),
}));
```

## Hooks dispatched

| Hook | Payload | When |
| --- | --- | --- |
| `csrfMismatch` | `{ route, method, requestId, userId, providedToken: boolean }` | CSRF middleware rejects a write. `providedToken` is `Boolean(value)` — never the token itself. |
| `preHttpRequest` | `{ method, url, requestId, origin, headers }` | Every request before dispatch; can stop with `HookStopSignal`. `headers` excludes `authorization`, `cookie`, `set-cookie`, `x-csrf-token`. |
| `rateLimitExceeded` | `{ scope, key, limit, windowMs, count, route, ip }` | Credentials login (`handleAuthApiRoute`). |

## Config keys

| Source | Key | Effect |
| --- | --- | --- |
| env | `NODE_ENV` | Gates `/_test/reset` — must be exactly `'development'` or `'test'`. |
| env | `TEST_RESET_TOKEN` | Required for `/_test/reset` to be reachable. Compared against `x-test-reset-token`. |
| env | `SECURE` | When `'true'`, session cookies are emitted with `Secure;`. |
| config | `projectConfig.http.cors.*` | `Access-Control-*` headers. |
| config | `projectConfig.http.securityHeaders.*` | `Referrer-Policy`, `X-Frame-Options`, `X-XSS-Protection`, `X-Content-Type-Options`. |
| config | `projectConfig.session.basedToken` | Switches cookie-mode (CSRF enforced) vs header-mode (CSRF skipped — header transport already binds to the request). |
| config | `projectConfig.http.testResetEndpoint` | Path for `handleTestResetRoute`. Default `/_test/reset`. |

## Related

- Function INDEX: `packages/server/CLAUDE.md`
- Request pipeline: `packages/server/docs/request-pipeline.md`
- HTTP routes: `packages/server/docs/http-routes.md`
- Architecture: `docs/ARCHITECTURE_API.md`, `docs/ARCHITECTURE_AUTH.md`
- README: `packages/server/README.md`
