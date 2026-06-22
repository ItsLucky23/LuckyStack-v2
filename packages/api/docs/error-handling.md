# Error Handling

> Last updated: 2026-05-20

## Overview

`@luckystack/api` produces a strict, two-shape response envelope. Every code path through the handler — malformed input, auth failure, rate-limit rejection, handler throw, handler return — ends in either `{ status: 'success', ... }` or `{ status: 'error', errorCode, errorParams?, httpStatus, message }`. The transformation from raw failure to wire envelope flows through three layers:

1. **`tryCatch`** wraps the handler's `main(...)` call. Errors are captured (auto-forwarded to Sentry / any registered tracker with context), and the tuple `[error, result]` is returned to the pipeline. Raw exceptions never reach the client.
2. **`buildApiResponseEnvelope`** (socket) / **`buildNetworkError`** (HTTP) maps the raw handler result to a wire envelope, inferring `httpStatus` via `defaultHttpStatusForResponse` and routing the error fields through `normalizeErrorResponse`.
3. **`normalizeErrorResponse`** renders the localized `message` field from the `errorCode` + `errorParams`, using the project-registered translate function. Locale is extracted in priority order: `x-language` header → `accept-language` header → `user.language`.

This means: a handler can return `{ status: 'error', errorCode: 'organization.notFound', errorParams: [{ key: 'id', value: orgId }] }` and the framework renders `Organization "abc123" not found` (or its translation) automatically. Business-logic errors and framework-emitted errors share the same envelope shape.

Logging is uniform: every handler exception is logged via `getLogger().error(...)` with the route name and transport in the context tag, plus a stack via `tryCatch`'s capture. Dev-only warn logs are gated by `logging.devLogs`.

## API Reference

### `executeApiHandler` (internal, socket transport)

**Signature**:

```ts
const executeApiHandler = async (params: {
  apiEntry: RuntimeApiEntry;
  normalizedData: Record<string, unknown>;
  user: SessionLayout | null;
  functionsObject: Record<string, unknown>;
  resolvedName: string;
  name: string;
  emitStream: (payload?: ApiStreamPayload) => void;
}): Promise<{
  error: Error | null;
  result: RuntimeApiResponse | undefined;
  durationMs: number;
}>;
```

**Behavior**:

- Calls `apiEntry.main({ data, user, functions, stream })` inside `tryCatch(..., undefined, { handler, api, userId, transport })`.
- The third argument to `tryCatch` is the auto-capture context — recorded on the registered error tracker alongside the exception.
- Span open/close is handled by hook subscribers in `@luckystack/error-tracking` (registered on `preApiExecute` / `postApiExecute`) — NOT by a direct `startSpan` call here.
- Returns `{ error, result, durationMs }`. Caller decides what to do with each.

The HTTP transport has no extracted helper — the same flow is inlined.

### `tryCatch` (re-exported from `@luckystack/core`)

**Signature** (paraphrased):

```ts
async function tryCatch<T>(
  fn: () => Promise<T>,
  fallback?: T,
  captureContext?: Record<string, unknown>,
): Promise<[Error | null, T | null]>;
```

**Behavior**: invokes `fn`; on throw, captures the error via `captureExceptionAcrossTrackers(error, captureContext)`, and returns `[error, null]`. On success, returns `[null, result]`. Used as the universal error boundary across the framework — never use raw `try / catch`.

### `buildApiResponseEnvelope` (internal, socket transport)

**Signature**:

```ts
const buildApiResponseEnvelope = (params: {
  resolvedName: string;
  error: Error | null;
  result: RuntimeApiResponse | undefined;
  preferredLocale: string | undefined;
  user: SessionLayout | null;
}): { status: 'success' | 'error'; httpStatus?: number; [key: string]: unknown };
```

**Behavior**:

| Condition | Returns |
| --- | --- |
| `error` is non-null | Localized error envelope with `errorCode: 'api.internalServerError'`, `httpStatus: 500`. |
| `result` is `null` or `undefined` | Localized error envelope with `errorCode: 'api.emptyResponse'`, `httpStatus: 500`. |
| `result.status` is neither `'success'` nor `'error'` | Localized error envelope with `errorCode: 'api.invalidResponseStatus'`, `httpStatus: 500`. |
| `result.status === 'error'` | Pass through `normalizeErrorResponse({ response: result, ..., fallbackHttpStatus: defaultHttpStatusForResponse(...) })`. |
| `result.status === 'success'` | Spread `result`, set `httpStatus` via `defaultHttpStatusForResponse({ status: 'success', explicitHttpStatus: result.httpStatus })`. |

All four error branches and the success branch produce a fully-formed envelope ready to emit.

### `buildNetworkError` (internal closure in `handleHttpApiRequest`)

The HTTP-side equivalent. Same shape as the socket's localized-error path, but the return is typed `ApiNetworkResponse` (which has a non-optional `httpStatus: number`). Used at every HTTP early-return.

### `normalizeErrorResponse` (re-exported from `@luckystack/core`)

**Signature**:

```ts
function normalizeErrorResponse(params: {
  response: { status: 'error'; errorCode?: string; errorParams?: [...]; httpStatus?: number; message?: string };
  preferredLocale?: string | null;
  userLanguage?: string | null;
  fallbackHttpStatus?: number;
}): {
  status: 'error';
  httpStatus: number;
  errorCode: string;
  errorParams?: [...];
  message: string;
};
```

**Behavior**:

- Dispatches the `preErrorNormalize` sync hook so consumers can remap `errorCode` (e.g. rewrite `auth.required` → `session.expired`).
- Resolves the locale: `preferredLocale ?? userLanguage ?? defaultLanguage`.
- Calls the registered localized normalizer (set by `registerLocalizedNormalizer` from the project's `server/utils/responseNormalizer.ts`) with the `errorCode` + `errorParams` to render `message`.
- Falls back to the raw `errorCode` string when no normalizer is registered or the key is missing from the locale.
- Sets `httpStatus` to `response.httpStatus ?? fallbackHttpStatus ?? 500`.
- Dispatches the `postErrorNormalize` sync hook so consumers can rewrite the final shape (e.g. strip stack details, add a correlation ID).
- Returns the localized envelope.

### `defaultHttpStatusForResponse` (re-exported from `@luckystack/core`)

**Signature**:

```ts
function defaultHttpStatusForResponse(params: {
  status: 'success' | 'error';
  explicitHttpStatus?: number;
}): number;
```

**Behavior**: returns `explicitHttpStatus` when present; otherwise `200` for `'success'` and `500` for `'error'`. The handler's per-response `httpStatus` (set inside `main`) always wins.

### Error-tracker identity + tracing spans (hook-based, via `@luckystack/error-tracking`)

These are no longer direct calls inside the handler. As of 0.2.x:

- **Identity**: `setCurrentErrorTrackerIdentity({ id, email, username })` is called immediately after `readSession` to populate the per-request ALS scope opened by `runWithErrorTrackerIdentityScope`. Hook subscribers registered by `@luckystack/error-tracking` (on `preApiValidate` or `preApiExecute`) read this scope and forward it to the underlying tracker (Sentry, Datadog, etc.) — there is no direct `setSentryUser` call in the handler.
- **Spans**: tracing spans are opened and closed by hook subscribers registered on `preApiExecute` / `postApiExecute`. The handler no longer calls `startSpan` or `span.end()` directly. This decouples the transport from the instrumentation library.

## Framework-emitted error codes

| Code | Origin | HTTP status | Notes |
| --- | --- | --- | --- |
| `api.invalidRequest` | `validateApiMessage` (socket) | 400 | Malformed socket envelope. |
| `api.invalidName` | HTTP entry validation | 400 | `name` missing or not a string. |
| `api.invalidDataObject` | HTTP entry validation | 400 | `data` missing, null, or not an object. |
| `routing.invalidServiceRouteName` | `parseTransportRouteName` | 400 | Route name does not match `api/<page>/<name>/v<N>`. `errorParams[0].value` echoes the original name. |
| `api.notFound` | runtime map lookup | 404 | Route not registered. `errorParams[0].value` echoes the name. |
| `auth.required` | `checkApiAuth` | 401 | `auth.login: true` and no session. |
| `auth.forbidden` | `validateRequest` predicate | 403 | Predicate rejected. May carry custom `errorCode` from a future custom validator. |
| `auth.invalidCondition` | `validateRequest` | 500 | `auth.additional[].key` is not on the session shape. Setup error. |
| `api.rateLimitExceeded` | `applyApiRateLimits` | 429 | `errorParams[0]` is `{ key: 'seconds', value: resetIn }`. |
| `api.methodNotAllowed` | HTTP method check | 405 | `errorParams[0]` is `{ key: 'method', value: expectedMethod }`. |
| `api.invalidInputType` | `validateInputByType` | 400 | Generic code only — the raw validator message is NOT echoed to the client (it would leak the input schema to unauthenticated callers). The detailed message is routed to the `postApiValidate` hook + dev logs. |
| `api.internalServerError` | `tryCatch` caught a throw | 500 | The original exception is on the registered tracker; not in the wire envelope. |
| `api.emptyResponse` | `normalizeApiResponse` | 500 | Handler returned `null` or `undefined`. |
| `api.invalidResponseStatus` | `normalizeApiResponse` | 500 | Handler returned an object whose `status` is not `'success'` / `'error'`. |

Consumer-emitted error codes (returned from `main(...)`) flow through `normalizeErrorResponse` unchanged. Consumers should register translations for the framework codes above plus their own.

## Stop signals

`preApiExecute` and `preApiRespond` hook handlers may return a `HookStopSignal`:

```ts
return { stop: true, errorCode: 'organization.disabled', httpStatus: 403 };
```

When the dispatcher sees a stop signal:

- `preApiExecute`: the handler short-circuits before `main(...)` runs. The envelope is built as `normalizeErrorResponse({ response: { errorCode }, fallbackHttpStatus: signal.httpStatus ?? 403 })`.
- `preApiRespond`: the already-built envelope is discarded; a fresh localized envelope is built from the signal. `transformApiResponse` and `postApiRespond` still fire on the replacement.

Other lifecycle hooks (`preApiValidate`, `postApiValidate`, `postApiExecute`, `transformApiResponse`, `postApiRespond`) do not honor stop signals — they are pre-validation observation, post-execution observation, or pure mutation slots.

## Locale extraction

Order of precedence for the `preferredLocale` argument that flows into `normalizeErrorResponse`:

1. **Socket transport**: `extractLanguageFromHeader(socket.handshake.headers['x-language'])` → `extractLanguageFromHeader(socket.handshake.headers['accept-language'])`.
2. **HTTP transport**: `extractLanguageFromHeader(params.xLanguageHeader)` → `extractLanguageFromHeader(params.acceptLanguageHeader)`. The HTTP listener in `@luckystack/server` is responsible for passing these headers in.
3. **Fallback**: `user.language` (from the session) when both headers are absent.
4. **Final fallback**: `defaultLanguage` from `projectConfig` when there is no session.

`extractLanguageFromHeader` returns the first valid locale token (`en`, `nl`, `de`, `fr`) from a possibly multi-value header, or `undefined`. The localized normalizer also implements its own fallback chain.

## Logging

Every error path logs at the appropriate level:

| Level | When |
| --- | --- |
| `getLogger().debug(...)` | Successful route completion, when `logging.devLogs` is on. |
| `getLogger().warn(...)` | Auth failures, rate-limit exceeded, method mismatch, validation failures, empty returns, malformed envelopes. All gated by `logging.devLogs`. |
| `getLogger().error(...)` | Handler exceptions caught by `tryCatch`. Always logged regardless of `devLogs`. Carries `{ route, transport }` context. |

The error tracker (registered via `@luckystack/error-tracking`) receives every `tryCatch` capture automatically with the context tags (`handler`, `api`, `userId`, `transport`).

## What is NOT handled here

- **Business-logic errors inside `main(...)`.** Routes return `{ status: 'error', errorCode: '...' }` directly. The envelope normalizer renders them — no thrown exception, no Sentry capture. This is by design: business outcomes (validation failures in domain code, "user already exists") are not "errors" in the tracking sense.
- **Localization of `errorCode` strings.** That is the consumer's responsibility — `registerLocalizedNormalizer` from the project's `server/utils/responseNormalizer.ts` provides the translate function backed by JSON locale files in `src/_locales/`.
- **Frontend error rendering.** The client's `apiRequest` returns the normalized envelope. UI code consumes `result.errorCode` + `result.message` and decides how to render (toast via `notify`, inline form error, redirect).
- **Hook handler errors.** Failures inside a `dispatchHook` handler are isolated by the hook bus — they log via `getLogger()` + the tracker but do not affect the main pipeline.

## Hooks dispatched

The error-handling layer fires:

| Hook | Stoppable | Payload |
| --- | --- | --- |
| `preApiRespond` | yes (becomes localized error) | `{ routeName, user, response }` — last chance to mutate or replace the envelope. |
| `transformApiResponse` | no (mutate `response`) | `{ routeName, user, response }` — pure mutation slot. |
| `postApiRespond` | no | `{ routeName, user, response }` — observation after emit. |
| `preErrorNormalize` | no (sync; mutate `response`) | `{ response: ErrorResponseInput }` — fires inside `normalizeErrorResponse`. |
| `postErrorNormalize` | no (sync; mutate `normalized`) | `{ normalized: NormalizedErrorResponse }` — fires before `normalizeErrorResponse` returns. |

See [`./api-request-lifecycle.md`](./api-request-lifecycle.md) for the full hook order and `@luckystack/core/docs/hooks.md` for hook bus semantics.

## Config keys

| Key | Effect |
| --- | --- |
| `logging.devLogs` | Gates verbose per-request `debug` / `warn` logs. Handler-exception `error` logs always emit. |
| `defaultLanguage` | Final fallback locale for `normalizeErrorResponse`. |
| (registered via DI) | The localized normalizer is registered by the project's boot code. Without one, error responses still carry `errorCode` but `message` falls back to the raw key. |

## Edge cases

- **Handler returns `{ status: 'error' }` with no `errorCode`.** `normalizeErrorResponse` treats it as having a missing key — the rendered `message` falls back to the raw value (an empty string or the key literal). Always include `errorCode`.
- **Handler returns `httpStatus: 0` or a non-number.** `defaultHttpStatusForResponse` only treats `typeof === 'number'` as explicit; non-numbers fall back to 200/500 per the success/error branch.
- **Stop signal with no `httpStatus`.** Falls back to `403` for both `preApiExecute` and `preApiRespond` stops.
- **`tryCatch` caught a non-Error throw.** The framework wraps non-Error throws into an Error before capture; the client always gets `api.internalServerError`. The tracker receives the wrapped Error with the original `cause`.
- **`preApiRespond` stop on an already-error envelope.** The original error envelope is replaced by the stop signal's error envelope. Use this pattern to remap error codes (`auth.required` → `session.expired`) — but prefer the sync `preErrorNormalize` hook for code remapping since it runs in a single place.
- **HTTP request with no `requesterIp` and no token.** The per-route bucket keys on `ip:anonymous:...` (per route) and `ip:unknown:...` (global). All such requests share these buckets. Front your server with a load balancer that always sets `X-Forwarded-For`.

## Related

- API request lifecycle: [`./api-request-lifecycle.md`](./api-request-lifecycle.md)
- Auth flow: [`./auth-flow.md`](./auth-flow.md)
- Rate limiting: [`./rate-limiting.md`](./rate-limiting.md)
- Generated types: [`./generated-types.md`](./generated-types.md)
- Architecture: [`/docs/ARCHITECTURE_API.md`](../../../docs/ARCHITECTURE_API.md) (see "Error Code Rules", "Framework-emitted error codes", "Response Contract")
- Hooks: `@luckystack/core/docs/hooks.md`
- Error-tracker registry: `@luckystack/core/docs/error-tracker-registry.md`
