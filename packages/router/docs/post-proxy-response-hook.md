# `preProxyRequest` / `postProxyResponse` hooks

The router exposes two extension points via `@luckystack/core`'s hook bus:

- **`preProxyRequest`** — fires just before the upstream HTTP request is sent.
- **`postProxyResponse`** — fires when the upstream response begins streaming back to the client.

Both hooks dispatch from `createHttpProxy` in `packages/router/src/httpProxy.ts`. The WebSocket upgrade proxy does **not** currently dispatch these hooks (the WS handshake bypasses the regular request lifecycle).

Source: `packages/router/src/hookPayloads.ts`, `packages/router/src/httpProxy.ts`.

## Payload shapes

```ts
// packages/router/src/hookPayloads.ts
export interface PreProxyRequestPayload {
  service: string;        // Resolved service key the request is being routed to.
  pathname: string;       // Original request path (before URL rewriting).
  method: string;         // Uppercase HTTP method (or 'GET' when req.method is undefined).
  target: string;         // Upstream URL the request will be forwarded to.
  viaFallback: boolean;   // True when local was unhealthy/unowned and we routed via fallback env.
}

export type PostProxyResponseErrorCause =
  | 'network'         // Connection refused, reset, host unreachable, DNS failure, etc.
  | 'timeout'         // ETIMEDOUT / ESOCKETTIMEDOUT.
  | 'upstream-throw' // Upstream threw a non-system error before headers arrived.
  | 'unknown';        // Error did not expose a `code` we could classify.

export interface PostProxyResponseError {
  message: string;                       // Underlying error message.
  code?: string;                         // Node.js error code (e.g. 'ECONNREFUSED') when available.
  cause?: PostProxyResponseErrorCause;  // Bucket so consumers do not have to sniff `code`.
}

export interface PostProxyResponsePayload extends PreProxyRequestPayload {
  statusCode: number;                // HTTP status returned by upstream. 0 when no response (error path).
  latencyMs: number;                  // Proxy entry → upstream response start (or failure).
  error?: PostProxyResponseError;    // Present only on the error path; absent on the happy path.
}
```

Both interfaces are registered into core via a module augmentation in `hookPayloads.ts`:

```ts
declare module '@luckystack/core' {
  interface HookPayloads {
    preProxyRequest: PreProxyRequestPayload;
    postProxyResponse: PostProxyResponsePayload;
  }
}
```

The augmentation is loaded automatically when `import '@luckystack/router'` runs because `packages/router/src/index.ts` starts with `import './hookPayloads'`. Consumers who only depend on `@luckystack/router` for the types can also import the payload types directly:

```ts
import type {
  PreProxyRequestPayload,
  PostProxyResponsePayload,
  PostProxyResponseError,
  PostProxyResponseErrorCause,
} from '@luckystack/router';
```

## Dispatch points

Both hooks are dispatched via `dispatchHook(...)` from `@luckystack/core`. The proxy `void`-prefixes the call so it does not await handler resolution — a slow consumer cannot stall the response.

```ts
// In createHttpProxy:
const proxyStart = Date.now();

// Before transport.request:
void dispatchHook('preProxyRequest', {
  service,
  pathname,
  method: req.method ?? 'GET',
  target: resolved.target,
  viaFallback: resolved.viaFallback,
});

// In the upstream-response callback (after headers arrive) — happy path:
void dispatchHook('postProxyResponse', {
  service, pathname, method: req.method ?? 'GET',
  target: resolved.target,
  viaFallback: resolved.viaFallback,
  statusCode: upstream.statusCode ?? 0,
  latencyMs: Date.now() - proxyStart,
});

// In the `'error'` handler — error path (network failure, timeout, upstream throw):
void dispatchHook('postProxyResponse', {
  service, pathname, method: req.method ?? 'GET',
  target: resolved.target,
  viaFallback: resolved.viaFallback,
  statusCode: 0,                              // No HTTP response was received.
  latencyMs: Date.now() - proxyStart,
  error: {
    message: err.message,
    code: readErrorCode(err),                 // e.g. 'ECONNREFUSED', when available.
    cause: inferErrorCause(readErrorCode(err)),
  },
});
```

## When each hook fires

| Condition | `preProxyRequest` | `postProxyResponse` | `payload.error` |
| --- | --- | --- | --- |
| URL had no parseable service segment (400 `routing.invalidRequestPath`) | No | No | — |
| Service resolved but no binding (502 `serviceNotAssigned`) | No | No | — |
| Service resolved, upstream request started, network error before response | Yes | **Yes** (`statusCode: 0`) | Present |
| Service resolved, upstream returned a response (any status, including 4xx/5xx) | Yes | Yes | Absent |
| Service resolved, upstream returned a response, then the connection dropped mid-body | Yes | Yes (headers arrived already) | Absent |

`preProxyRequest` and `postProxyResponse` now fire as a matched pair for every request that reaches the upstream transport. Consumers distinguish success from failure by inspecting `payload.error` (or equivalently `payload.statusCode === 0`) instead of correlating a missing `postProxyResponse`.

## `statusCode`, `latencyMs`, and `error` semantics

- **`statusCode === 0`** indicates the error path — no HTTP response was ever received (network failure, timeout, or upstream threw before headers). On the happy path the value is always the upstream's real `statusCode`; the `?? 0` fallback on the happy-path emission is a defensive default and intentionally aligned with the error-path sentinel.
- **`error`** is populated **only** on the error path. Branch on `payload.error` (or equivalently `payload.statusCode === 0`) to distinguish failure events from success events. The field carries:
  - `message` — the underlying error message.
  - `code` — the Node.js error code (e.g. `'ECONNREFUSED'`, `'ETIMEDOUT'`) when the error exposes one.
  - `cause` — a coarse classification (`'network' | 'timeout' | 'upstream-throw' | 'unknown'`) so consumers can bucket failures without sniffing `code`.
- **`latencyMs`** measures the interval between proxy entry (`proxyStart = Date.now()`) and either upstream response-headers arrival (happy path) or the transport `'error'` event (failure path). It does **not** include client-side body delivery time. For end-to-end latency, the consumer must capture body-finished timing themselves by adding an additional listener — the hook bus is not invoked again at body end.

### Distinguishing success vs failure events

```ts
import { registerHook } from '@luckystack/core';
import type { PostProxyResponsePayload } from '@luckystack/router';

registerHook('postProxyResponse', async (payload: PostProxyResponsePayload) => {
  if (payload.error) {
    metrics.increment('proxy.upstream_failure', {
      service: payload.service,
      cause: payload.error.cause ?? 'unknown',
      code: payload.error.code ?? 'none',
    });
    return;
  }
  metrics.observe('proxy.latency_ms', payload.latencyMs, {
    service: payload.service,
    statusBucket: `${Math.floor(payload.statusCode / 100)}xx`,
    viaFallback: payload.viaFallback,
  });
});
```

## `viaFallback`

`viaFallback === true` means the resolver chose the fallback env's binding instead of the local env's binding. Two scenarios produce this:

1. The service is not "owned locally" (preset key doesn't include it).
2. The service is owned locally but the local target is unhealthy and `routing.enableUnhealthyFallback` is on.

Use this field to:

- Tag latency metrics so local-vs-fallback paths are graphed separately.
- Surface a warning banner in dashboards when the production router is unexpectedly serving via fallback.
- Audit cross-env traffic for compliance.

## Consumer registration

Hooks are registered through `@luckystack/core`'s hook-bus API (see core's `dispatchHook` / hook registry). The exact registration call is `registerHook(name, handler)` or `registerHooks({ ... })` depending on which core helper your bootstrap uses. Handlers receive the payload object and may be async — the dispatcher fires them in registration order.

```ts
import { registerHook } from '@luckystack/core';
import type { PostProxyResponsePayload } from '@luckystack/router';

registerHook('postProxyResponse', async (payload: PostProxyResponsePayload) => {
  // Example: log slow proxied requests.
  if (payload.latencyMs > 500) {
    getLogger().warn('[proxy] slow upstream', {
      service: payload.service,
      pathname: payload.pathname,
      method: payload.method,
      statusCode: payload.statusCode,
      latencyMs: payload.latencyMs,
      viaFallback: payload.viaFallback,
    });
  }
});
```

Side-effect-only — the hook bus does not collect return values. Throwing inside a handler is suppressed by the dispatcher (`void`-prefixed call site) so it cannot crash the proxy.

## Use cases

- **Tracing IDs.** Use `preProxyRequest` to attach a trace ID to the upstream call (via a registered request mutation point if your tracing library supports it) and to start a span. Use `postProxyResponse` to close the span with `statusCode` and `latencyMs`.
- **Sentry / error-tracking breadcrumbs.** Add a breadcrumb on `preProxyRequest` so cross-env routing decisions show up in error reports.
- **OpenTelemetry spans.** Same as tracing — open in `preProxyRequest`, close in `postProxyResponse`. `service` and `viaFallback` make excellent span attributes.
- **Audit logging for cross-env routing.** Filter `postProxyResponse` events where `viaFallback === true` and write to an append-only log. Useful for compliance audits ("which staging targets did production fall through to last quarter?").
- **Latency metrics.** Feed `latencyMs` into a histogram keyed on `service` + `viaFallback`. Detect regressions per-service.
- **Status-code SLOs.** Count 5xx responses per service via `statusCode >= 500 && !payload.error` in `postProxyResponse`. Combine with `payload.error` events (which arrive on the same hook) to get a complete error-rate picture without correlating across two hooks.
- **Path redaction in logs.** If `pathname` contains tokens/IDs, redact in the handler before logging — the payload is shared across handlers, do not mutate it.

## Adding custom hook payload fields

If your own framework extension needs additional payload fields on these hooks, module-augment the `HookPayloads` interface in your own package:

```ts
// my-package/src/hookPayloads.ts
declare module '@luckystack/core' {
  interface HookPayloads {
    preProxyRequest: PreProxyRequestPayload & { myField?: string };
    postProxyResponse: PostProxyResponsePayload & { myField?: string };
  }
}
```

The proxy will not populate the new fields — that's your responsibility. Either pre-register a `preProxyRequest` handler that mutates a parallel store, or fork the proxy if you need fields baked in.

Prefer adding fields to a **separate** hook (e.g. your own `'myPackage.somethingHappened'`) over reshaping the router's payloads. The interfaces above are stable surface — don't tighten them without coordination with the framework.

## Concurrency and isolation

Hook handlers run inline with the request — the proxy fires `dispatchHook` synchronously before piping. If `dispatchHook` returns a promise (when handlers are async), the proxy does not await it; the promise is detached via `void`. This means:

- Handlers see payloads in dispatch order (FIFO within a single request).
- Multiple concurrent requests dispatch independently — handler reentrancy is your responsibility.
- A handler that throws asynchronously will produce an unhandled rejection unless it catches internally. Wrap your handler bodies in `tryCatch` per the repo-wide rule.

## Hook bus location

`dispatchHook` lives in `@luckystack/core` (search `dispatchHook` / `hookBus` under `packages/core/src/`). The registration helpers (`registerHook`, `clearHooks`, etc.) are exported from the same module. The router only imports `dispatchHook` — registration is always done on the consumer side.

## Related

- `packages/router/src/hookPayloads.ts` — payload interfaces + module augmentation.
- `packages/router/src/httpProxy.ts` — dispatch sites and timing.
- `packages/core` — `dispatchHook`, `HookPayloads`, registration API.
- `packages/router/docs/http-proxy.md` — full request lifecycle and where the hooks sit in it.
- `packages/router/AI_INDEX.md` — package-level hook contract.
