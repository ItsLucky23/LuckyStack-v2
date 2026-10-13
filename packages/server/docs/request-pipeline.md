# Request pipeline

Apply the origin policy and security headers before dispatching HTTP routes; apply cookie-mode CSRF protection before executing state-changing handlers. A missing browser origin on a write must not become a Host-derived same-origin assumption. Keep HTTP and Socket.io policies explicit rather than assuming the HTTP handler protects socket handshakes. Source: `../src/httpHandler.ts`, `../src/loadSocket.ts`, `../src/httpRoutes/csrfMiddleware.ts`.

Per-route error formatting must not change authorization outcomes. Streaming must preserve failure signalling after partial delivery; see `../src/sse.ts` and `../../sync/docs/streaming.md`. For route selection consult `../src/httpRoutes/` rather than a hand-maintained execution tour.
