# Branch log — fix/cloudflare-redirect-forbidden

## 2026-11-10 — Foreign page load no longer answers 403 (Cloudflare tunnel / login redirect)

**User prompt (summary):** behind a Cloudflare tunnel or with Cloudflare as login, the redirect to the app answers "Forbidden"; a reload or adding `/` to the URL works. Give better Cloudflare support.

**What I did:**
- Traced the "Forbidden" text to the HTTP origin gate: it takes the origin from `Referer` when `Origin` is absent and answered 403 to every method for a non-allowed origin. A page load after an external login carries the login site's `Referer`; a reload or typed URL does not. In development Vite serves the pages, so the gate never saw them.
- A GET without `Origin` and with a foreign `Referer` now goes only to the static/SPA handler, with no CORS reflection and no session cookie refresh. `/api/`, `/sync/`, `/auth/`, `/uploads/`, custom routes, foreign CORS reads and state-changing requests keep the 403.
- Regression test with a real HTTP server; the two page-load cases fail on the old handler.
- ADR 0087 as `proposed` (security-boundary change not yet confirmed by the user), server CHANGELOG, `security-defaults.md`.

**Files touched:** `packages/server/src/httpHandler.ts`, `packages/server/src/httpHandler.foreignOrigin.test.ts`, `packages/server/CHANGELOG.md`, `packages/server/docs/security-defaults.md`, `docs/decisions/0087-a-foreign-page-load-gets-only-public-static-content.md`.

**Notes / decisions:**
- `npm run verify` green (2888 tests). Not tested through a real Cloudflare tunnel or in a browser.
- Open: the OAuth callback `/auth/callback/*` still answers 403 when a provider sends a foreign `Referer`; a custom route linked from another site now gets the SPA shell instead of 403.

## 2026-11-12 — OAuth callback accepts a foreign Referer; ADR 0087 accepted

**User prompt (summary):** answers to the open questions: accept ADR 0087, also let the OAuth callback through for a foreign `Referer`, release both fixes as 0.16.1.

**What I did:**
- A GET without `Origin` to `/auth/callback/<provider>` now runs the normal pipeline with no CORS reflection. The login `state` check, bound to the `ls-oauth-state` cookie, stays the protection. A foreign `Origin` header or a POST keeps the 403.
- Test: a callback with a Google `Referer` reaches the login and gets 401 from the state check; foreign `Origin` and POST get 403.
- ADR 0087 set to `accepted` and extended with the callback exception; server CHANGELOG and `security-defaults.md` updated.

**Files touched:** `packages/server/src/httpHandler.ts`, `packages/server/src/httpHandler.foreignOrigin.test.ts`, `packages/server/CHANGELOG.md`, `packages/server/docs/security-defaults.md`, `docs/decisions/0087-a-foreign-page-load-gets-only-public-static-content.md`.
