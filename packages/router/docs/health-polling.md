# Health and shared state

Health probes determine whether local service bindings can accept new traffic; Redis-backed state keeps multiple router replicas from making contradictory fallback decisions. A local-only health view can be acceptable for a single development router, not for replicated or split/fallback deployments. Split/fallback must fail closed when shared health cannot initialize rather than silently routing with inconsistent views.

A health change affects new target selection, not an already proxied HTTP request or established socket. Monitor fallback usage and recovery, since a green probe alone does not prove sessions and synchronized configuration agree; the boot handshake protects a different topology boundary. See the poller source for exact probes, ownership, timing and keys rather than a copied sequence.
