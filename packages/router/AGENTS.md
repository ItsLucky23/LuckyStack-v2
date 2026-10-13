# @luckystack/router — agent guidance

Use for a multi-instance service topology or deliberate development-to-staging fallback, not for an ordinary single-server deployment where a platform load balancer suffices. See `README.md` for starting the router and `docs/` for the security and failover rationale.

Run the router on Node while Bun's HTTP upgrade sockets cannot deliver proxy writes; otherwise WebSocket traffic can silently disappear even when HTTP health looks good. Explicitly pin backend ports for per-preset routing; default HTTP ports can collapse distinct backends onto one target. Never allow a client URL or an untrusted Host header to override the configured upstream origin. Treat staging fallback, Redis handshake and synchronized environment hash drift as operational safety boundaries, not convenience paths. Use trusted proxy ingress configuration rather than assuming arbitrary forwarding headers are authentic.
