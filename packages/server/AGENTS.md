# @luckystack/server — design context

Server owns boot order and the single HTTP/Socket.io security perimeter. Use the high-level bootstrap for normal deployments, and the lower-level entry only when taking responsibility for the missing registrations and checks. Source: `src/bootstrap.ts`, `src/createServer.ts`, `src/verifyBootstrap.ts`.

Never treat CORS as authentication. The HTTP origin gate has no Host-header fallback; requests without a browser-attributable origin are rejected for state changes unless deliberately exempted. Exemptions for signed webhooks remove the origin/CSRF check, not the requirement to verify the caller in the route. Keep cookie-mode CSRF protection on state-changing custom routes and login bootstrap exceptions narrowly defined. Socket origin/auth checks and HTTP route checks are separate boundaries. Source: `src/httpHandler.ts`, `src/httpRoutes/csrfMiddleware.ts`, `src/originExemptRegistry.ts`, `src/loadSocket.ts`.

The test-reset endpoint must fail closed outside explicit test/development mode and without a secret. Its scoped targets come from core's shared list so server and test-runner cannot drift; an unknown target is an error, and the unscoped reset keeps its meaning (ADR 0064). Do not allow development map loading or tools to leak into production. See `docs/security-defaults.md`, `docs/runtime-maps.md`, `../login/AGENTS.md`.
