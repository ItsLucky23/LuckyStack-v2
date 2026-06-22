# HTTP proxy

`createHttpProxy({ resolver, missingServiceErrorCode })` returns an `(req, res) => void` handler suitable for `http.createServer(...)`. It resolves a service key from the incoming request, looks up the target backend, forwards the request, and streams the upstream response back to the client.

A sibling `createWsProxy({ resolver })` handles the `'upgrade'` event for WebSocket clients.

Source: `packages/router/src/httpProxy.ts`, `packages/router/src/wsProxy.ts`.

## Request lifecycle

1. **Parse the URL.** `pathname = req.url ?? '/'`.
2. **Resolve the service key.** `resolveServiceKey({ pathname, headers, host })` invokes the registered custom resolver (if any), then falls back to `parseServiceFromPath` which extracts the first non-transport path segment:
   - `/api/<service>/<name>/v<n>` → `<service>`
   - `/sync/<service>/<name>/v<n>` → `<service>`
   - `/<service>/...` → `<service>`
3. **Look up the target.** `resolver.resolve(service)` returns `{ target, viaFallback, resolvedEnvKey }` or `null`. Resolution order: local binding if owned and healthy → fallback env binding → null. See `resolveTarget.ts` for the precise rules.

   **Boot-time guard: explicit ports required.** `createServiceTargetResolver` validates every binding URL in `deploy.config.ts > environments.<envKey>.bindings.<service>` at startup. A binding URL without an explicit port (e.g. `https://api.example.com` instead of `https://api.example.com:443`) throws and aborts the router boot. The error message names the offending service + env so the misconfigured slot is obvious. Rationale: the router relies on per-preset port pinning to keep multi-instance backends distinct — falling back on the protocol-default port (80 / 443) silently collapses two presets onto the same upstream target.
4. **Choose transport.** `https.request` when the target URL starts with `https:`, otherwise `http.request`. The default port is `443` for https and `80` for http when the URL omits an explicit port.
5. **Build the upstream request.** Strip hop-by-hop headers, inject forwarding headers, and call `transport.request(options, onUpstream)`.
6. **Dispatch `preProxyRequest`.** Hook fires fire-and-forget before the upstream call lands.
7. **Pipe.** `req.pipe(forwardRequest)` streams the client body upstream. On upstream response, `upstream.pipe(res)` streams the response body back. No buffering, so large uploads/downloads do not multiply memory.
8. **Dispatch `postProxyResponse`.** Fires once the upstream response headers arrive (right when the body starts streaming) on the happy path, **or** when the upstream transport emits `'error'` before a response (`statusCode: 0`, `error` field populated). `latencyMs` is measured from step 1 (proxy entry) to whichever happens. Consumers branch on `payload.error` to distinguish failure events.

## SSRF / host-pinning guards

Two defense-in-depth checks prevent the proxy from being used as an open relay:

**`isOriginFormTarget(pathname)`** (step 1 of the lifecycle) — rejects any request URL that is not a strict origin-form path (a single leading `/`). Absolute-form (`http://host/...`), protocol-relative (`//host`), and authority-form targets would cause `new URL(pathname, resolved.target)` to re-host the upstream to an attacker-supplied origin. These are rejected with `400 routing.invalidRequestPath` before service resolution begins.

**`isHostPinned(targetUrl, resolved.target)`** (after service resolution) — re-validates that the `hostname`+`port` in the assembled upstream URL still matches the binding the resolver returned. A custom `ServiceResolver` that ignores the path could theoretically move the upstream; this guard catches that. Mismatches are rejected with `502`.

## Hop-by-hop header stripping

The proxy strips these headers from both the upstream request and the response (per RFC 7230 §6.1):

```text
connection
keep-alive
proxy-authenticate
proxy-authorization
te
trailer
transfer-encoding
upgrade
```

(The WebSocket proxy in `wsProxy.ts` strips the same set **except** `upgrade`, which must be preserved verbatim along with `connection: Upgrade` to complete the WS handshake.)

## Injected headers

The proxy adds the following on every forwarded HTTP request:

| Header | Value | Purpose |
| --- | --- | --- |
| `x-forwarded-host` | `req.headers.host ?? ''` | Lets the backend know the public hostname even though it sees the router's internal `Host`. Reflected verbatim from the inbound `Host` header; backends building absolute URLs from it should validate the value against an allowlist. |
| `x-forwarded-proto` | `normalizeForwardedProto(req.headers['x-forwarded-proto'])` | Strips any inbound `x-forwarded-proto` and emits a normalized single value (`'https'` or `'http'`). The inbound header is never trusted or forwarded verbatim — a multi-hop chain cannot spoof the scheme seen by the backend. |
| `x-luckystack-resolved-env` | `resolved.resolvedEnvKey` | Which env owns the binding (current env or the fallback env key). Useful for audit logs and per-env metrics on the backend side. |
| `x-luckystack-via-fallback` | `'1'` when `viaFallback`, else `'0'` | `1` means the local binding was missing or unhealthy and the request was routed to the fallback env. |

The WebSocket proxy injects the same four headers plus `connection: Upgrade` and `upgrade: websocket`.

## HTTPS vs HTTP transport

```ts
const targetUrl = new URL(pathname, resolved.target);
const transport = targetUrl.protocol === 'https:' ? https : http;
```

The choice is purely on the upstream URL scheme. The router itself listens over plain HTTP — it is designed to sit behind a TLS-terminating proxy (Cloud Run, ALB, Caddy, nginx). Do not add cert-loading logic here.

## Error responses

The proxy emits structured JSON error responses with `errorCode` strings that match the framework-wide convention (suitable for i18n on the client). Three error paths exist:

| Path | Status | `errorCode` | When it fires |
| --- | --- | --- | --- |
| `routing.invalidRequestPath` | 400 | `routing.invalidRequestPath` | `resolveServiceKey` returned `null` (URL had no parseable service segment, and no custom resolver claimed it). |
| missing service | 502 | configurable via `routing.missingServiceErrorCode` (default `serviceNotAssigned`) | Service key parsed, but neither the local env nor the fallback env had a binding for it. Body includes `errorParams: [{ key: 'service', value: <service> }]`. |
| `routing.upstreamUnreachable` | 502 | `routing.upstreamUnreachable` | `transport.request` emitted `'error'` before the upstream response started. Body includes `service` and `message` in `errorParams`. Already-headers-sent responses are simply closed with `res.end()`. |

Body shape (matches the framework's response envelope):

```json
{
  "status": "error",
  "errorCode": "routing.invalidRequestPath",
  "errorParams": [{ "key": "service", "value": "vehicles" }]
}
```

`content-type: application/json` is set on every error response.

## Streaming semantics

- **Request body.** `req.pipe(forwardRequest)` — no buffering. Aborting the client request aborts the upstream side too.
- **Response body.** `upstream.pipe(res)` — same. Backpressure is honored by Node's stream machinery.
- **Headers.** Each upstream header is copied except for the hop-by-hop set. `undefined` values are skipped.
- **Status code.** `res.statusCode = upstream.statusCode ?? 502`. A response with no status (network failure mid-stream) collapses to 502.

The proxy never reads or rewrites the body. If you need redaction or compression, install it on the upstream side or post-process via the `postProxyResponse` hook on a separate channel (it does not get a body handle).

## Hook dispatch points

```ts
//? Before transport.request — fires for every well-formed request that
//? resolved to a target, even if the upstream call later errors.
void dispatchHook('preProxyRequest', {
  service,
  pathname,
  method: req.method ?? 'GET',
  target: resolved.target,
  viaFallback: resolved.viaFallback,
});

//? Inside the upstream-response callback — fires when headers arrive (happy path).
void dispatchHook('postProxyResponse', {
  service, pathname, method, target, viaFallback,
  statusCode: upstream.statusCode ?? 0,
  latencyMs: Date.now() - proxyStart,
});

//? Inside the `'error'` handler — fires when the upstream transport fails
//? before a response arrives (network error, timeout, upstream throw).
//? `statusCode` is 0 and `error` carries the underlying failure detail.
void dispatchHook('postProxyResponse', {
  service, pathname, method, target, viaFallback,
  statusCode: 0,
  latencyMs: Date.now() - proxyStart,
  error: { message: err.message, code, cause },
});
```

Both calls are `void`-prefixed — the proxy does not await them, so a slow hook handler cannot stall the response. See `post-proxy-response-hook.md` for full payload semantics and consumer registration.

## WebSocket upgrade path (how it differs)

`createWsProxy({ resolver, wsTargetService = 'system' })` returns an `'upgrade'` handler. Differences from the HTTP path:

- **No service-key parsing.** Socket.io clients connect to `/socket.io/?...`, so the path has no service segment. The upgrade is pinned to the `system` service (override with `wsTargetService`).
- **Manual handshake forwarding.** The router opens an upstream `http.request` with `connection: Upgrade` + `upgrade: websocket`, waits for the upstream's `'upgrade'` event, writes the upstream's `HTTP/1.1 101 Switching Protocols` status line and headers verbatim to the client socket, flushes any trailing bytes (`upstreamHead`), then bidirectionally `pipe`s the two raw sockets.
- **Socket.io Redis adapter required.** Rooms fan out across backend instances via Redis pub/sub on the Socket.io side, so it doesn't matter which backend holds a given client socket. The router does not balance individual upgrades.
- **Errors.** On resolve failure or upstream error, the router writes `HTTP/1.1 502 Bad Gateway\r\n\r\n` to the client socket and destroys it. No JSON error envelope — at the WS layer there is no body channel before the handshake completes.

## Performance notes

- All paths use Node's native `http`/`https` modules. No `node-fetch`, no `undici` wrapper. Connection reuse follows Node's default agent (keep-alive on, default 256 sockets per host).
- The proxy does not retry. A transient upstream error surfaces immediately as 502 / `routing.upstreamUnreachable`. Retry policy belongs in the client (`apiRequest` from `@luckystack/core/client` has its own backoff for socket reconnects).
- `setHeader` / `pipe` are O(1) per header / per chunk — there is no buffering on the hot path.

## Related

- `packages/router/src/httpProxy.ts` — HTTP proxy implementation.
- `packages/router/src/wsProxy.ts` — WebSocket upgrade proxy.
- `packages/router/src/resolveTarget.ts` — service-key parsing + target resolution.
- `packages/router/docs/post-proxy-response-hook.md` — `preProxyRequest` / `postProxyResponse` consumer docs.
- `packages/router/docs/health-polling.md` — how `resolver.resolve(...)` picks local vs fallback.
- `packages/router/docs/boot-uuid-failover.md` — boot-time guard that prevents routing to a stale topology.
