# API Request Lifecycle

> Last updated: 2026-05-20

## Overview

`@luckystack/api` exposes two transport adapters — `handleApiRequest` (socket.io) and `handleHttpApiRequest` (raw HTTP) — that share an identical 13-step pipeline. The pipeline takes a transport payload, resolves it to a registered route in the runtime maps emitted by `@luckystack/devkit`, runs authentication / rate-limit / input-validation gates, dispatches a fixed set of lifecycle hooks, executes the route's `main(...)` function under a `tryCatch` boundary, then normalizes the result into a localized envelope before emitting it on the wire.

Both transports are pure functions over the runtime maps + session state. Neither one mutates module state or constructs the io server — the socket and HTTP listeners in `@luckystack/server` import these handlers and feed them messages. Consumers building a third transport (queue worker, gRPC bridge, Lambda adapter) should call the same handlers with a synthetic `Socket` or with the HTTP signature so they get the identical contract.

The full ordering is authoritative. Deviating in a fork breaks every downstream consumer that relies on the hook payloads firing in a known order (audit handlers, rate-limit dashboards, response-mutating middleware).

## Pipeline order (13 steps)

Both transports execute the same sequence. The HTTP transport adds one extra step (method check).

1. **Parse message / payload shape.** Socket transport calls `validateApiMessage` to confirm `responseIndex` is present and `name` / `data` are well-typed. HTTP transport inline-checks `name` (string) and `data` (object); rejects with `api.invalidName` / `api.invalidDataObject` if either is malformed.
2. **`getSession(token)` + `setSentryUser(...)`.** Reads the session from `@luckystack/login`, identifies the user to every registered error tracker via `setSentryUser`. Preferred locale is also extracted here from `x-language` / `accept-language` headers using `extractLanguageFromHeader`.
3. **`parseTransportRouteName({ value, prefix: 'api' })`.** Rejects names that are not of the form `api/<page>/<name>/v<N>`. Returns the normalized name used downstream as `resolvedName`. Bad shapes return `routing.invalidServiceRouteName` with the original `name` echoed back as `errorParams[0].value`.
4. **Built-in `system/logout` shortcut (socket only).** When the parsed route normalizes to `system/logout`, the handler calls `logout({ token, socket, userId })` from `@luckystack/login` and short-circuits with a `{ status: 'success', httpStatus: 200, result: true }` envelope. HTTP transport does not have this shortcut — logout over HTTP goes through the normal route execution.
5. **`getRuntimeApiMaps()` + route lookup.** Reads the registered `apisObject` / `functionsObject`. Missing routes return `api.notFound` with `404`.
6. **`checkApiAuth({ apiEntry, user, name })`.** Two-stage auth gate: first checks `auth.login` (returns `auth.required` + `401` if missing), then runs `validateRequest({ auth, user })` which evaluates `auth.additional[]` predicates. Failures return `auth.forbidden` (or the predicate's overridden `errorCode`) with the predicate's `httpStatus` or `403` fallback. See [`./auth-flow.md`](./auth-flow.md).
7. **`applyApiRateLimits(...)`.** Two-bucket rate limit: per-route (uses the route's `rateLimit` export, or `rateLimiting.defaultApiLimit` fallback) keyed by `<token|ip>:<id>:api:<route>`, then a global per-IP bucket keyed by `ip:<ip>:api:all` (uses `rateLimiting.defaultIpLimit`). Either rejection emits `rateLimitExceeded` and returns `api.rateLimitExceeded` + `429`. See [`./rate-limiting.md`](./rate-limiting.md).
8. **HTTP-only: method check.** `expectedMethod = apiEntry.httpMethod ?? inferHttpMethod(resolvedName)`. Mismatched methods return `api.methodNotAllowed` + `405` with `errorParams: [{ key: 'method', value: expectedMethod }]`. Method check runs after auth + rate limit, on purpose — unauthenticated callers should not learn whether a method-incorrect route exists.
9. **`preApiValidate` hook → `validateInputByType(...)` → `postApiValidate` hook.** Hook fires before validation runs (handlers can mutate `data`, can NOT stop). `validateInputByType` checks the payload against the Zod-equivalent schema derived from the route's `inputType` text. On the socket transport only, the per-route `validation: 'relaxed'` or `validation: { input: 'skip' }` flag skips validation entirely (useful for third-party webhooks). Validation failures return the generic `api.invalidInputType` code — the validator's message is NOT echoed to the client (that would let unauthenticated callers enumerate the input schema); it travels to the `postApiValidate` hook (`validation.message`) and the dev logs instead. `postApiValidate` always fires with the resulting validation result, even on skip.
10. **`preApiExecute` hook.** Last gate before execution. A handler may return a `HookStopSignal` (`{ stop: true, errorCode, httpStatus? }`) to abort. Stop signals are normalized into a localized error envelope using the signal's `errorCode` (or `403` if no `httpStatus`).
11. **`executeApiHandler(...)`.** Wraps `apiEntry.main({ data, user, functions, stream })` in `tryCatch` (which captures any thrown error to Sentry via the active `@luckystack/error-tracking` adapter) and in a `startSpan(name, 'api.request')` (HTTP variant uses `'api.request.http'`). Records `durationMs`.
12. **`postApiExecute` hook.** Observation point. Receives `result`, `error`, and `durationMs`. Use for audit logging, metrics, or post-run side effects. Cannot mutate the response.
13. **`buildApiResponseEnvelope` → `preApiRespond` → `transformApiResponse` → emit → `postApiRespond`.** The envelope normalizer maps the raw handler result to a wire envelope, inferring `httpStatus` via `defaultHttpStatusForResponse`. `preApiRespond` lets handlers mutate `payload.response` in place or return a stop signal that converts to a localized error envelope. `transformApiResponse` is the dedicated mutation hook (PII redaction, response signing, schema injection) that fires after `preApiRespond` but before emit. Emit happens via `socket.emit(buildApiResponseEventName(responseIndex), ...)` (socket) or as the HTTP response body (HTTP). `postApiRespond` is observation-only and fires after emit.

## API Reference

### `handleApiRequest({ msg, socket, token })`

Socket.io transport adapter. Default export.

**Signature**

```ts
import handleApiRequest from '@luckystack/api';
import type { apiMessage } from '@luckystack/core';
import type { Socket } from 'socket.io';

export default async function handleApiRequest(args: {
  msg: apiMessage;
  socket: Socket;
  token: string | null;
}): Promise<void>;
```

**Parameters**

| Field | Type | Notes |
| --- | --- | --- |
| `msg` | `apiMessage` | The raw transport envelope. Required fields: `name` (string, `api/<page>/<name>/v<N>`), `data` (object), `responseIndex` (number, used to build the response event name). |
| `socket` | `Socket` | Live socket.io socket. Used for `socket.emit`, `socket.handshake.headers`, and `socket.handshake.address` (for the global IP rate-limit bucket). |
| `token` | `string \| null` | Session token from the socket handshake (`extractTokenFromSocket`). Drives `getSession`, the per-route rate-limit bucket key, and the `system/logout` shortcut. |

**Returns**

`Promise<void>`. The response is delivered by `socket.emit(buildApiResponseEventName(responseIndex), envelope)`. The function resolves once `postApiRespond` has completed.

**Behavior highlights**

- Treats `responseIndex` as the response correlation token; clients listen on `buildApiResponseEventName(responseIndex)`.
- Reads `x-language` / `accept-language` from `socket.handshake.headers` for locale extraction.
- Honors a per-route `validation: 'relaxed'` / `{ input: 'skip' }` flag (HTTP transport does not — webhook-style endpoints typically live on HTTP and pre-date this flag).
- Built-in route: `system/logout` exits with a success envelope after calling `logout(...)` from `@luckystack/login`.
- Stream emission: routes that call `stream(payload)` from their `main(...)` cause `socket.emit(buildApiStreamEventName(responseIndex), payload)`. Stream payloads are typed as `Record<string, unknown>` at the transport layer; consumers narrow against the generated `ApiStream<P, N, V>` type.

**Errors / framework-emitted error codes**

| `errorCode` | When | HTTP status |
| --- | --- | --- |
| `api.invalidRequest` | `name` or `data` missing / wrong type. | 400 |
| `routing.invalidServiceRouteName` | `name` is not `api/<page>/<name>/v<N>`. | 400 |
| `api.notFound` | Route not registered in runtime maps. | 404 |
| `auth.required` | `auth.login` is `true` and `user?.id` is missing. | 401 |
| `auth.forbidden` | `auth.additional[]` predicate rejects. | 403 |
| `auth.invalidCondition` | `auth.additional[]` references a session key that is not on the session shape. Setup error. | 500 |
| `api.rateLimitExceeded` | Per-route or per-IP bucket rejects. `errorParams[0].value` is `resetIn` (seconds). | 429 |
| `api.invalidInputType` | `validateInputByType` rejects the payload. Generic code only — the validator's message is routed to the `postApiValidate` hook + dev logs, never echoed to the client (schema-enumeration guard). | 400 |
| `api.internalServerError` | `main(...)` threw. | 500 |
| `api.emptyResponse` | `main(...)` returned `null` or `undefined`. | 500 |
| `api.invalidResponseStatus` | Handler returned an object whose `status` is neither `'success'` nor `'error'`. | 500 |

**Example**

```ts
import handleApiRequest from '@luckystack/api';
import { extractTokenFromSocket } from '@luckystack/core';

io.on('connection', (socket) => {
  socket.on('apiRequest', (msg) => {
    void handleApiRequest({
      msg,
      socket,
      token: extractTokenFromSocket(socket),
    });
  });
});
```

### `handleHttpApiRequest({ name, data, token, ... })`

HTTP transport adapter. Same pipeline as the socket variant plus HTTP-method validation.

**Signature**

```ts
import { handleHttpApiRequest } from '@luckystack/api';
import type { HttpMethod } from '@luckystack/core';

export type ApiHttpStreamEvent = Record<string, unknown>;

export async function handleHttpApiRequest(params: {
  name: string;
  data: Record<string, unknown>;
  token: string | null;
  requesterIp?: string;
  xLanguageHeader?: string | string[];
  acceptLanguageHeader?: string | string[];
  method?: HttpMethod;
  stream?: (payload: ApiHttpStreamEvent) => void;
}): Promise<ApiNetworkResponse>;
```

**Parameters**

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Route name. May be passed with or without the `api/` prefix; the handler normalizes both. |
| `data` | `Record<string, unknown>` | Request payload. Must be an object (arrays, primitives rejected). |
| `token` | `string \| null` | Session token from cookie or `Authorization: Bearer`. |
| `requesterIp` | `string` (optional) | IP used by the global per-IP rate-limit bucket. Falls back to `'unknown'` when omitted; production callers should always pass it. |
| `xLanguageHeader` | `string \| string[]` (optional) | Forwarded to `extractLanguageFromHeader`. Takes precedence over `acceptLanguageHeader`. |
| `acceptLanguageHeader` | `string \| string[]` (optional) | Standard `Accept-Language` header. |
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'DELETE'` (default `'POST'`) | HTTP method on the wire. Compared against the route's declared `httpMethod` or the inferred method from `inferHttpMethod`. |
| `stream` | `(payload) => void` (optional) | Callback invoked once per `stream(payload)` call from the route's `main`. The server's HTTP listener wraps this into SSE events (`event: stream`). Streaming endpoints emit a final `event: final` carrying the full envelope. |

**Returns**

`Promise<ApiNetworkResponse>` — exactly one of:

```ts
type ApiNetworkResponse =
  | ({ status: 'success'; httpStatus: number } & Record<string, unknown>)
  | {
      status: 'error';
      httpStatus: number;
      message: string;
      errorCode: string;
      errorParams?: { key: string; value: string | number | boolean }[];
    };
```

The `httpStatus` is guaranteed to be a number (the socket variant returns the envelope with `httpStatus` as a hint; the HTTP variant materializes it for the response writer to use).

**Behavior highlights**

- Same auth → rate-limit → validate → execute → respond order as the socket variant, with method check inserted between rate-limit and validate.
- Method inference (`inferHttpMethod`): names starting with `get*` / `fetch*` / `list*` → `GET`, `delete*` / `remove*` → `DELETE`, `update*` / `edit*` / `patch*` → `PUT`, everything else → `POST`. Per-route `httpMethod` export overrides the inference.
- Does NOT honor the per-route `validation: 'relaxed'` flag. Public webhooks that need looser validation must use the socket variant or model their inputs structurally.
- Streaming over SSE: the `stream` callback is invoked synchronously each time the route's `main` calls `stream(payload)`. The server-side SSE writer (in `@luckystack/server`) emits each callback as `event: stream\ndata: <json>` and the final envelope as `event: final\ndata: <json>`.
- The function dispatches `preApiRespond` and `postApiRespond` in `handleHttpApiRequest` itself (wrapping the inner runner), so the same response-mutation contract applies to both transports.

**Errors / framework-emitted error codes**

Same set as the socket variant, plus:

| `errorCode` | When | HTTP status |
| --- | --- | --- |
| `api.invalidName` | `name` missing or not a string. | 400 |
| `api.invalidDataObject` | `data` missing, null, or not an object. | 400 |
| `api.methodNotAllowed` | Request method does not match the route's declared or inferred HTTP method. `errorParams[0].value` is the expected method. | 405 |

**Example**

```ts
import { handleHttpApiRequest } from '@luckystack/api';

httpServer.on('request', async (req, res) => {
  if (!req.url?.startsWith('/api/')) return;

  const token = extractTokenFromRequest(req);
  const body = await readJson(req);
  const name = req.url.slice('/api/'.length).replace(/\?.*$/, '');

  const result = await handleHttpApiRequest({
    name,
    data: body,
    token,
    requesterIp: req.socket.remoteAddress ?? undefined,
    xLanguageHeader: req.headers['x-language'],
    acceptLanguageHeader: req.headers['accept-language'],
    method: req.method as HttpMethod,
  });

  res.statusCode = result.httpStatus;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(result));
});
```

### Type: `ApiHttpStreamEvent`

```ts
export type ApiHttpStreamEvent = Record<string, unknown>;
```

Wire-level shape of payloads emitted from `stream(...)` over the HTTP transport. Routes narrow this against the generated `ApiStream<P, N, V>` type at the call site. Bridge code (SSE writers, custom queue adapters) should treat it as opaque key/value.

## Internal pipeline helpers

Not exported. Listed for traceability against the source.

| Helper | File | Role |
| --- | --- | --- |
| `validateApiMessage` | `handleApiRequest.ts` | Rejects malformed socket envelopes. |
| `checkApiAuth` | `handleApiRequest.ts` | Wraps `auth.login` gate + `validateRequest`. |
| `applyApiRateLimits` | `handleApiRequest.ts` | Per-route + global per-IP bucket. Fires `rateLimitExceeded` on reject. |
| `executeApiHandler` | `handleApiRequest.ts` | `tryCatch` + `startSpan` wrap around `apiEntry.main(...)`. |
| `buildApiResponseEnvelope` | `handleApiRequest.ts` | Normalizes success / error result to wire envelope with inferred `httpStatus`. |
| `emitApiResult` | `handleApiRequest.ts` | Runs `preApiRespond` / `transformApiResponse` / `postApiRespond` hooks and emits on the socket. |
| `warnIfInputTypeMissing` | both | Dev-only one-shot warning when a route lacks a generated `inputType`. |
| `runHandleHttpApiRequestInner` | `handleHttpApiRequest.ts` | The core inner pipeline for the HTTP transport. |
| `isRuntimeApiResult` | `handleHttpApiRequest.ts` | Type guard rejecting handler returns whose `status` is not `'success'` / `'error'`. |

## Hooks dispatched

In pipeline order:

| Hook | Stoppable | Payload (key fields) |
| --- | --- | --- |
| `preApiValidate` | yes | `routeName`, `data`, `user` |
| `postApiValidate` | no | `routeName`, `data`, `user`, `validation: { status, message? }` |
| `preApiExecute` | yes | `routeName`, `data`, `user` |
| `postApiExecute` | no | `routeName`, `data`, `user`, `result`, `error`, `durationMs` |
| `preApiRespond` | no (mutates `response`) | `routeName`, `user`, `response: ApiResponseEnvelope` |
| `transformApiResponse` | no (mutates `response`) | `routeName`, `user`, `response` |
| `postApiRespond` | no | `routeName`, `user`, `response` |
| `rateLimitExceeded` | no | `scope: 'route' \| 'user' \| 'ip'`, `key`, `limit`, `windowMs`, `count`, `route?`, `userId?`, `ip?` |

Handlers register via `registerHook(name, handler)` from `@luckystack/core`. Stop signals are `{ stop: true, errorCode, httpStatus? }`. For deeper hook contract details see `@luckystack/core/docs/hooks.md`.

## Config keys

Read at request time via `getProjectConfig()`. Never captured at module load.

| Key | Type | Effect |
| --- | --- | --- |
| `logging.devLogs` | `boolean` | Gates verbose per-request `getLogger().debug/warn/error` output. |
| `logging.stream` | `boolean` | Gates `emitStream` payload logging. |
| `dev.warnOnMissingInputType` | `boolean` | Toggles the one-shot `warnIfInputTypeMissing` developer hint. |
| `rateLimiting.defaultApiLimit` | `number \| false` | Per-route fallback when the route does not export `rateLimit`. `false` disables the per-route bucket. |
| `rateLimiting.defaultIpLimit` | `number \| false` | Global per-IP bucket across all API routes. `false` disables. |
| `rateLimiting.windowMs` | `number` | Window size for both buckets. |

No environment variables are read directly by this package. Secrets and toggles travel through `@luckystack/core`'s config registry.

## Edge cases

- **Missing `responseIndex` (socket).** Returns silently after a dev-log warning. The client will never get a response — by design, since we have no channel to send it on.
- **Malformed `msg` (socket).** Returns silently if `msg` is not an object. Logs to dev-log.
- **Unknown route after `parseTransportRouteName` succeeds.** Returns `api.notFound` with the original (pre-normalization) name in `errorParams[0].value` so audit handlers can correlate.
- **Empty handler return.** Treated as an error: `api.emptyResponse` + `500`. Handlers must return an `{ status: 'success' }` or `{ status: 'error' }` object.
- **Invalid `status` from handler.** Treated as an error: `api.invalidResponseStatus` + `500`.
- **`preApiRespond` stop signal.** The original envelope is discarded; a fresh error envelope is built from the signal's `errorCode` + `httpStatus`. The replacement envelope still flows through `transformApiResponse` and `postApiRespond`.
- **Streaming + error.** If `main(...)` throws after one or more `stream(...)` calls, the stream events were already on the wire — the final envelope is the error response. SSE clients must handle the mixed sequence.

## Related

- README: [`../README.md`](../README.md)
- Routing conventions: [`./routing-conventions.md`](./routing-conventions.md)
- Auth flow: [`./auth-flow.md`](./auth-flow.md)
- Rate limiting: [`./rate-limiting.md`](./rate-limiting.md)
- Error handling: [`./error-handling.md`](./error-handling.md)
- Generated types: [`./generated-types.md`](./generated-types.md)
- Architecture deep-dive: [`/docs/ARCHITECTURE_API.md`](../../../docs/ARCHITECTURE_API.md)
- Hook contract: `@luckystack/core/docs/hooks.md`
