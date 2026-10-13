# HTTP request architecture

Raw HTTP dispatch has two distinct phases: ordinary routes see parsed input, while early routes can receive the untouched request stream. That early seam exists for signatures over exact webhook bytes and for streaming or multipart uploads that do not fit the normal parsed-body limit. See `packages/server/src/httpHandler.ts` and [the server package guide](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/packages/server/README.md) for current dispatch and API details.

## Trust boundaries

- Origin checks and, in cookie mode, CSRF checks precede custom route handling. A stop-capable request hook is not an origin exemption; it cannot grant a blocked request access.
- Server-to-server callers often have no browser origin. An explicit origin exemption skips the origin gate and the cookie-mode CSRF gate for that path; it is **not authentication**. Verify a webhook signature over the raw bytes, use a shared secret or mTLS, and add rate limits as appropriate. Keep exempt prefixes narrow and away from framework auth/API/sync routes; otherwise the exemption can punch a hole in their protection.
- An early route that reads the body owns completing the response; it cannot pass an already-drained stream onward to normal parsing. It also owns appropriate authentication, input-size and streaming limits rather than relying on a later parser or route handler to enforce them.
- In split deployments, a custom route's predicate does not tell a router which service owns it. Declare ownership in the topology and validate that the service has a binding; otherwise the router cannot deliver the request reliably. See [multi-instance architecture](./ARCHITECTURE_MULTI_INSTANCE.md).

## Routed invocation keeps the declared method

When typed API calls are routed over HTTP, each route keeps the HTTP method it declares. That is what makes routed invocation an HTTP transport: caches, proxies, CDNs and the router treat a GET as a GET. A GET has no body, so its payload travels JSON-encoded in one reserved query field; the encoding preserves nested objects, numbers and booleans instead of flattening them to strings.

The consequence: **on routed HTTP a GET route's payload is part of the URL.** It reaches access logs, proxy logs, browser history and outgoing `Referer` headers, and URL length limits apply. Over the socket transport the same payload sat inside a WebSocket frame that nothing logs by default, so switching a project to routed HTTP silently widens the logging surface of every GET route.

- Never put secrets, tokens or personal data in a GET route's input. Declare such a route as `POST` so the body carries it.
- Audit GET routes before switching transport. A project that cannot change its routes and needs those payloads out of URLs stays on the socket transport.
- Tunnelling every routed call as `POST` was rejected: it discards the declared method for every route to protect the few that should not have been GET, and it breaks HTTP caching for read routes. Scrubbing payloads from logs is not the framework's job; those logs belong to the proxies and browsers on the path. See ADR 0062.

For typed APIs use [API architecture](./ARCHITECTURE_API.md); early custom routes should be reserved for requirements the standard parsed route cannot satisfy.
