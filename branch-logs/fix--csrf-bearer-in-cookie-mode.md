# Branch log — fix/csrf-bearer-in-cookie-mode

## 2026-11-25 12:20 — bearer-only requests skip CSRF in cookie mode (server 0.18.1)

**User prompt (summary):** handoff from a Flexbuddy colleague: the app runs in cookie mode (`SameSite=Strict`) and must also run in an iframe inside AFAS InSite, where the cookie is not sent. The iframe client uses token mode (`sessionStorage` + `Authorization: Bearer`) against the cookie-mode server with `http.acceptBearerInCookieMode: true`. Every write got `auth.csrfMismatch`. Fix when clear, full send: PR, council, merge to `main`, npm release.

**What I did:**
- The CSRF gate exempts a request in cookie mode when `acceptBearerInCookieMode` is on, the request has a bearer header and it has no session cookie under the effective (prefixed) name. With the cookie, with or without a bearer, the check stays as it was. Token mode and the default (setting off) do not change.
- Core exports `extractBearerToken(req)`; `extractTokenFromRequest` uses it, so the bearer parsing has one source.
- ADR 0091, a line in `docs/ARCHITECTURE_HTTP.md`, the JSDoc of `acceptBearerInCookieMode`, changelogs of server and core.

**Files touched:** `packages/server/src/httpRoutes/{csrfMiddleware.ts,csrfMiddleware.test.ts}`, `packages/core/src/{extractTokenFromRequest.ts,index.ts,projectConfig.ts}`, `packages/{server,core}/CHANGELOG.md`, `docs/ARCHITECTURE_HTTP.md`, `docs/decisions/0091-header-only-bearer-skips-csrf-in-cookie-mode.md`.

**Notes / decisions:**
- Council (Claude Opus 5.5, GPT-6.2 Sol, GPT-6.2 Astra, effort high), 2 rounds: 8/6/7 → 9/9/9, all AKKOORD. Round 1 added: the exemption needs `@luckystack/login` (without it a dummy bearer skipped the double-submit check for custom routes with their own cookie); an empty session cookie counts as absent (safe, the ADR first said the reverse). Refused as scope: an integration test through `httpHandler`.
- Implemented as the colleague proposed; no separate setting, because `acceptBearerInCookieMode` is already the opt-in (ADR 0091 lists the rejected options).
- Tests: setting off → bearer-only POST 403; setting on → bearer-only allowed, cookie-only 403, cookie + bearer 403, login absent bearer-only allowed; token mode unchanged.
- Open for the consumer: the OAuth callback still delivers cookie or token from the server's `session.basedToken`, so an OAuth login inside the iframe gets a cookie that the iframe does not send. Credentials and second-factor login honour `x-session-based-token` per request.
- `registerProjectConfig` rebuilds from the defaults on every call; a client that switches `session.basedToken` at boot must pass its full config, not only the changed key.
