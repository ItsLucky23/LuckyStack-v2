# API architecture

<!-- @covers packages/api/src -->

LuckyStack uses one typed API contract across Socket.io and routed HTTP/SSE. The transport can change without redefining route authorization, validation, rate limits, errors, streaming, or the caller's generated types. In a split deployment, invocation belongs to the service that owns the route; the browser's socket remains connected for realtime delivery. See [multi-instance architecture](./ARCHITECTURE_MULTI_INSTANCE.md).

## Boundaries that matter

- Authenticate **before** validating a route or its input. Otherwise unauthenticated callers can learn which routes exist and what input they expect. Apply the same boundary to both transports and to hooks that can stop execution.
- HTTP writes in cookie mode need CSRF protection; a socket-only assumption is unsafe once the same API is reachable over HTTP. See [HTTP architecture](./ARCHITECTURE_HTTP.md) and [session architecture](./ARCHITECTURE_SESSION.md).
- Never put exception text in a translated error code. Use stable translation keys, keep dynamic context separate, and avoid leaking secrets through errors or hooks. Framework error envelopes must remain safe on either transport.
- Wire inputs must represent values JSON can actually carry: a date arrives as text, not a `Date` instance, and binary values can acquire different shapes across HTTP and Socket.io. Validate and convert at the handler boundary; use explicit serializable outputs.
- Routed HTTP keeps each route's declared method, so a GET carries its payload in the URL. Over the socket transport that payload sat inside a frame; on routed HTTP it reaches access logs, proxy logs, browser history and `Referer`. Keep secrets and personal data out of GET routes, and audit them before switching transport. See [HTTP architecture](./ARCHITECTURE_HTTP.md) and ADR 0062.
- Keep generated route/version types rather than hiding typed calls behind permissive wrappers. When type generation lags behind source edits, regenerate and fix the source rather than bypassing type checking. The generated map is derived from source, not a second hand-maintained contract.
- The in-memory offline queue defers requests during disconnection; replay is not proof that a non-idempotent write is safe to perform twice. The socket-readiness gate remains relevant even when API invocation uses HTTP because the same client depends on the socket for realtime state.

## Extension trade-off

Lifecycle hooks let consumers observe or intercept work without forking the API package. Keep authorization and redaction in the request boundary, not only in presentation code; observability hooks must not turn failures into secrets in logs. The actual hook names, ordering, payloads and public route API are defined by `packages/api/src/` and `packages/core/src/`; see [extension points](./ARCHITECTURE_EXTENSION_POINTS.md) for why registries exist.

For adoption read the installed API package's README; the [framework package guide](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/packages/api/README.md) is available without a monorepo checkout. Exact handler contracts live in the installed declarations. For route naming and discovery, see [routing](./ARCHITECTURE_ROUTING.md).
