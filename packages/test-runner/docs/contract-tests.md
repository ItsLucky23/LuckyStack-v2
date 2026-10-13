# Endpoint contract tests

Generated route maps drive a smoke check over the API surface so tests catch mismatches between generated input schemas and live handlers. Endpoint-specific side effects and business rules still require application tests. Serial execution reduces interference from shared rate-limit state and makes failures easier to attribute; do not assume a parallel sweep is interchangeable.

## Probes follow the project transport

A route is only meaningfully tested over the path real users hit (ADR 0064). API routes go over HTTP. Sync routes go over the project's own `transport.invocation`: Socket.io in a socket-mode project (the default), the routed `/sync/*` HTTP path in a routed-HTTP project; the caller may override this. The CSRF layer always probes sync over HTTP, because CSRF is an HTTP-only guard. Layer-5 `ctx.callSync` follows the same rule, so a socket-mode project's custom sync tests run through the socket pipeline and differences between the two pipelines surface as failures instead of being masked.

- Sync routes are swept only when the sweep receives the generated sync metadata (and sync input schemas for valid samples). Without it the sweep warns and covers API routes only.
- All sync probes in one run target a single throwaway room that the sweep's own session joins, so room-membership enforcement sees a member rather than rejecting every probe.
- Sockets the runner opens on the caller's session close as an intentional disconnect, the signal a real client sends; a plain close would let presence log that session out shortly after the sweep.
- GET probes carry their payload in the query string under the reserved key the real client uses (ADR 0062); `fetch` cannot send a GET body, and dropping the payload made every GET route with a required field fail validation.

## Sweep boundaries

A route filter narrows the selection before any request is sent; filtered-out routes are never called. An authenticated sweep calls every selected route with its own session, logout-type routes included: a route that destroys the current session (logout, account deletion, session revoke) leaves every later layer running anonymously, so skip such routes explicitly.

The test process must load environment files and resolve configured secret pointers before importing code that creates database clients. The live server's resolved environment is isolated from the runner process. The loader callback is intentionally deferred until after local env layers are available. Consult the runner source for current return shapes and schema sampling; a sampled valid payload is not exhaustive input coverage.
