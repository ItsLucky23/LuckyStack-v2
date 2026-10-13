# Session architecture

Sessions live behind `@luckystack/login`'s storage adapter. Storage can change without moving the policy for login, expiry, lifecycle events and CSRF into a database driver. The default adapter uses Redis; the current adapter contract and settings live in [the login package guide](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/packages/login/README.md) and `packages/login/src/session.ts`.

## Credential boundaries

- A session token is a bearer credential. Cookie mode keeps it `HttpOnly` and out of page JavaScript. Browser-held token mode explicitly accepts JavaScript exposure for tab-scoped workflows; it is not equivalent protection. The client-visible **session object** must omit the raw token in both modes; the dedicated login/OAuth handoff supplies it only in browser-held mode. ADR 0018 records this decision.
- Never serialize a raw token into the stored session value or broadcast it inside a session-update payload. Separating the storage key from the session projection reduces accidental exposure in client data, logs and adapters.
- Authenticate each protected API/sync request using the active adapter, not a cached browser claim. Cookie-mode HTTP writes also need CSRF protection because the browser sends cookies automatically. See [API](./ARCHITECTURE_API.md) and [HTTP](./ARCHITECTURE_HTTP.md).
- Active sessions may have their expiry extended on validated use, but adapters must report honestly when a refresh did not apply. A storage TTL cannot be inferred merely from the existence of a client tab. Single-session policy may revoke another device; multi-session policy expands the number of valid credentials to manage.
- Shared deployments must agree on session storage and cookie secrets. Separate, healthy Redis instances are not a shared session store; a user can appear logged out when traffic switches backends. See [multi-instance](./ARCHITECTURE_MULTI_INSTANCE.md).

Review adapter-specific key formats and current expiry values in source rather than copying them here.
