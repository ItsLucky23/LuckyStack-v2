# HTTP proxy boundaries

The router streams request and response bodies instead of buffering large uploads, leaving backpressure to Node's streams. Once headers are sent, an upstream failure must not present a truncated success as a complete response. Consult the proxy source for retry, timeout, forwarding header and error-response details.

**Origin pinning prevents server-side request forgery.** A client-supplied absolute or protocol-relative URL must not redirect the proxy to an attacker host; assembled upstream URLs must remain bound to the configured service target. Strip hop-by-hop headers and trust forwarding data only from a controlled TLS terminator/private ingress. The router itself is not a certificate-terminating edge. WebSocket upgrade forwarding has its own handshake requirements; run this proxy on Node until the Bun socket limitation is resolved. See `post-proxy-response-hook.md` for logging without exposing bodies.
