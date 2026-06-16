# @luckystack/api

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

`@luckystack/api` is the transport-agnostic API request layer for LuckyStack. It exposes two handler entry points — one for socket.io (`handleApiRequest`) and one for raw HTTP (`handleHttpApiRequest`) — that share an identical pipeline: route resolution against the generated runtime map, session lookup, auth check, rate limiting, input validation (Zod from generated types), hook dispatch, handler execution with `tryCatch`-wrapped error capture, and response normalization (localized error envelopes, default HTTP status inference, streaming via SSE on the HTTP side).

> ✅ **Runtime input validation now runs in production** (api F1 / core CORE-01). `validateInputByType` (in `@luckystack/core`) used to short-circuit to `{ status: 'success' }` in production; it now runs the structural validator against the build-time-resolved generated type text. The expensive dev-only TypeScript-compiler RESOLVER is still skipped in prod (it can't run there), but the pre-resolved type is validated directly — so a route typed `data: { userId: string }` rejects a malformed prod payload exactly as in dev. Gated by `validation.runtimeMode` (default `'enforce'`); set `validation.runtimeMode: 'off'` to restore the old prod no-op. If the generated type still carries an `__RUNTIME_UNRESOLVED__::` marker (artifacts not regenerated before shipping), validation surfaces it as a LOUD error (regenerate artifacts) rather than silently passing. `validation: 'relaxed'` / `{ input: 'skip' }` still skips validation per-route (now honored on BOTH transports).

Routes are discovered by `@luckystack/devkit` from `src/{page}/_api/{name}_v{N}.ts` files and surfaced at runtime via `getRuntimeApiMaps()` (from `@luckystack/core`). Consumers normally do not call these handlers directly — `@luckystack/server` wires them into the socket.io server and the HTTP request listener.

## When to USE this package

- You are building a custom transport (queue worker, gRPC bridge, Lambda adapter) and need to invoke the LuckyStack API pipeline for a registered route.
- You are extending the framework with a new hook in the API request lifecycle (`preApiValidate`, `preApiExecute`, `preApiRespond`, `transformApiResponse`, `postApiRespond`, etc.).
- You need to understand or document the exact ordering of auth -> rate limit -> validate -> execute -> respond.

## When to NOT suggest this (yet)

- Writing a new app-level API endpoint: create a file under `src/{page}/_api/{name}_v{N}.ts` instead. The handler in this package will pick it up automatically.
- Client-side request invocation: use `apiRequest` from `@luckystack/core` (client subpath), not anything from this package.
- Plain Express/Koa middleware: this package assumes the LuckyStack runtime maps + hook system. Do not graft it onto an unrelated server framework.
- Changing the request envelope shape: that contract lives in `@luckystack/core` (response normalization, error codes, locale extraction). Edit there, not here.

## Function Index

| Function / Export | One-liner | Deep doc |
| --- | --- | --- |
| `handleApiRequest({ msg, socket, token })` (default export) | Socket.io transport adapter. Validates `apiMessage`, resolves the route via `getRuntimeApiMaps`, runs the full pipeline, emits the response on the `buildApiResponseEventName(responseIndex)` channel. Also handles the built-in `system/logout` shortcut. | -> docs/api-request-lifecycle.md |
| `handleHttpApiRequest({ name, data, token, requesterIp?, xLanguageHeader?, acceptLanguageHeader?, method?, stream? })` | HTTP transport adapter for `/api/*` POST/GET/PUT/DELETE. Same pipeline as the socket variant plus HTTP-method validation (`inferHttpMethod` or route-declared `httpMethod`). Returns `ApiNetworkResponse` and optionally pipes stream events via the provided `stream` callback (SSE on the server side). | -> docs/api-request-lifecycle.md |
| Type: `ApiHttpStreamEvent` | Shape of stream payloads emitted by streaming HTTP endpoints (alias of `Record<string, unknown>` extended with route-specific keys). Consumers writing SSE bridges import this. | -> docs/api-request-lifecycle.md |

### Internal pipeline helpers (not exported, listed for AI context)

These live inside `handleApiRequest.ts` / `handleHttpApiRequest.ts` and are referenced in deep docs:

| Helper | Role |
| --- | --- |
| `validateApiMessage` | Rejects malformed socket envelopes (missing `responseIndex`, non-object/array data). |
| `checkApiAuth` | `auth.login` gate + null-safe `validateRequest` for additional auth predicates (an anonymous caller on a public route with `additional` predicates is cleanly forbidden, not a throw — api F4). Dispatches the `apiAuthRejected` hook (`void`) on every fail path (api F9). |
| `applyApiRateLimits` | Per-route bucket (`apiEntry.rateLimit` or `defaultApiLimit`, keyed on the validated `user.id` or the resolved IP — never the raw token; basis overridable via `rateLimiting.identity`) + global per-IP bucket (`defaultIpLimit`, skippable for loopback in dev via `rateLimiting.skipLoopbackInDev`). Fires `rateLimitExceeded` hook on reject. |
| `applyGlobalIpRateLimit` | Shared global per-IP `ip:<ip>:api:all` bucket helper; also applied to the built-in `system/logout` shortcut so it can't be spammed uncapped. |
| `executeApiHandler` | Wraps `apiEntry.main(...)` in `tryCatch`. Span open/close + identity propagation moved to `preApiExecute`/`postApiExecute` hook subscribers in `@luckystack/error-tracking` (no direct `startSpan` in this handler). |
| `normalizeApiResponse` (in `_shared/responseEnvelope.ts`) | Normalizes success/error result into the wire envelope, inferring `httpStatus` via `defaultHttpStatusForResponse`. |
| `emitApiResult` | Runs `preApiRespond` / `transformApiResponse` / `postApiRespond` hooks and emits on the socket. |
| `warnIfInputTypeMissing` (in `_shared/inputTypeWarning.ts`) | Dev-only one-shot warning when a strict-mode route has no generated `inputType` (Zod validation effectively disabled). |

## Pipeline order (authoritative)

Both transports execute the same sequence. Deviating is a breaking change.

1. Parse message / payload shape (`validateApiMessage` / inline checks; rejects arrays).
2. `readSession(token)` -> resolve `user` (may be null on public routes). Identity propagation to error trackers happens later via the `preApiExecute` hook subscriber, NOT a direct `setSentryUser` here.
3. `parseTransportRouteName` (rejects invalid `api/<page>/<name>/v<N>` shapes).
4. Built-in `system/logout` shortcut (socket transport only; now subject to the global per-IP bucket first).
5. `getRuntimeApiMaps()` -> reject with `api.notFound` if the route is unknown.
6. `checkApiAuth` (login + `validateRequest`).
7. `applyApiRateLimits` (per-route -> global IP).
8. **HTTP-only**: method check (`inferHttpMethod` vs `method`). The `httpMethod` route export and the `inferHttpMethod` heuristic are **HTTP-only**. The socket transport does NOT enforce the declared HTTP method — all routes are callable over WebSocket regardless of method declaration (socket.io has no method concept). Do not rely on `httpMethod` for authorization; use `auth` predicates or `preSocketMessage` for socket-specific gates.
9. `preApiValidate` hook -> `validateInputByType` (skippable on BOTH transports via `validation: 'relaxed'` or `{ input: 'skip' }`) -> `postApiValidate` hook. `validateInputByType` now runs the structural validator in production too (gated by `validation.runtimeMode`, default `'enforce'`); set `validation.runtimeMode: 'off'` to restore the old prod no-op. See the caveat at the top.
10. `preApiExecute` hook (stop-signal aborts with localized error).
11. `executeApiHandler` (wrapped in `tryCatch`; span/identity via the `pre/postApiExecute` hook subscribers, not a direct span here).
12. `postApiExecute` hook (gets `result`, `error`, `durationMs`).
13. `normalizeApiResponse` -> `preApiRespond` -> `transformApiResponse` -> emit -> `postApiRespond`.

## Config keys

Read at request time via `getProjectConfig()` (from `@luckystack/core`). All live under `projectConfig`:

- `logging.devLogs` — gate for verbose per-request `getLogger().debug/warn/error` output.
- `logging.stream` — gate for `emitStream` payload logging.
- `dev.warnOnMissingInputType` — toggles the one-shot `warnIfInputTypeMissing` developer hint.
- `rateLimiting.defaultApiLimit` — fallback per-route limit when an API file does not export `rateLimit`. `false` disables.
- `rateLimiting.defaultIpLimit` — global per-IP bucket across all API routes. `false` disables.
- `rateLimiting.windowMs` — window for both buckets.
- `rateLimiting.skipLoopbackInDev` — when `true` (default `false`), skips ONLY the global per-IP ABUSE bucket for loopback IPs in non-production (per-route bucket still applies). Lets a dev / the test runner hammer localhost without tripping the cross-route cap. Gated on this explicit flag (not inferred from `NODE_ENV` + a spoofable address) and on `isLoopbackIp(resolvedIp)`.
- `rateLimiting.identity` — optional `(params) => { scope: 'user'|'ip'|'custom'; id } | null` callback that overrides the per-route bucket BASIS (api-key / tenant). Returning `null` falls back to the default (validated `user.id`, else resolved IP — NEVER the raw token).

No environment variables are read directly by this package — secrets and toggles travel through `@luckystack/core`'s config layer.

## Peer dependencies

- **Required (runtime deps)**: `@luckystack/core`, `@luckystack/error-tracking`. **`@luckystack/login` is NOT a dependency** (0.2.0 decoupling) — sessions resolve through core's `readSession` / session-provider registry, with login as the default *provider* (optional package), not a hard runtime dep.
- **Required (peer)**:
  - `@prisma/client@^6.19.0` (transitively required via `@luckystack/core` session storage).
  - `socket.io@^4.8.0` (only consumed for the `Socket` type — the HTTP entry point does not need a live socket.io instance at call time).
- **No optional peers.** Streaming uses an injected callback, not an external SSE library.

## Hooks consumed

This package only dispatches hooks (it does not register any). Consumers register handlers via `dispatchHook` / the hook registry in `@luckystack/core`. Hooks emitted, in order:

- `preSocketMessage` — (socket transport only) at the very top, before session lookup / route resolution / auth. Stop signal rejects the message. Transport-level seam mirroring `preHttpRequest`; `channel: 'api'`.
- `preApiValidate` — before Zod validation runs.
- `postApiValidate` — after validation, with `validation: { status, message? }`.
- `preApiExecute` — may return a stop signal (`errorCode`, `httpStatus?`) to short-circuit.
- `postApiExecute` — observation point with `result`, `error`, `durationMs`.
- `preApiRespond` — last chance to mutate or swap `payload.response`; stop signal converts to localized error.
- `transformApiResponse` — purely mutative; runs between `preApiRespond` and socket/HTTP emit.
- `postApiRespond` — observation-only; response is already on the wire.
- `rateLimitExceeded` — fires when a bucket rejects (scope: `route` | `user` | `ip`).
- `apiAuthRejected` — fires on every auth-fail path (login required, `additional[]` predicate failed, or a misconfigured predicate). Observational (`void`-dispatched, stop signal ignored); payload `{ routeName, reason, userId, ip?, transport?, failedKey? }`. Lets abuse-detection / audit subscribers see failed authorizations (e.g. credential-stuffing) without forking the handler.

Deep behavior for each hook lives in `@luckystack/core`'s hook registry doc.

## Related

- Architecture deep dives: `/docs/ARCHITECTURE_API.md`, `/docs/ARCHITECTURE_ROUTING.md`.
- Consumer quickstart: `./README.md`.
- Generated-type contract: `/docs/ARCHITECTURE_ROUTING.md` (see "Generated maps") and root `CLAUDE.md` rule 16 (no `unknown`/`any` casts).
- Session source: `@luckystack/core`'s session-provider registry — `readSession(token)` / `performLogout(...)` (see `docs/ARCHITECTURE_SESSION.md`). `@luckystack/login` is the DEFAULT provider when installed, not a hard dep. Shared types `BaseSessionLayout` / `AuthProps` come from `@luckystack/core`.
- Runtime map source: `@luckystack/core` `getRuntimeApiMaps()` + `@luckystack/devkit` emitter.
