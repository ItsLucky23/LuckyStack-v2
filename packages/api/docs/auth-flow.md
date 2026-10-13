# API authentication

API reads the session from core/login, then applies each route's authorization policy. Auth is not a property of transport: sockets and HTTP must both enforce it, and HTTP method declarations do not restrict socket calls. Route lookup must happen to discover auth policy; do not promise to conceal route names, which are also published in client maps. What must remain private is predicate detail, schema diagnostics and protected data. See `../src/handleApiRequest.ts`, `../src/handleHttpApiRequest.ts`, `../../core/src/validateRequest.ts`.

Resolve user identity from the session, not the request payload. Keep error-tracker identity request-scoped so concurrent requests do not contaminate one another (`../../core/src/errorTrackerIdentity.ts`). The built-in logout shortcut is not an ordinary API route; do not assume route hooks alone observe or authorize it. See `../src/handleApiRequest.ts` and `../../login/src/logout.ts`.
