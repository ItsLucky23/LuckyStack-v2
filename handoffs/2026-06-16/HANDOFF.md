# Handoff 2026-06-16 solo

## Session overview

Branch `chore/package-split-prep`. Session goal: fix the full authentication routing stack after it was reported that Google OAuth always redirected to port 80, query params were lost when navigating between login and register, and after a Google OAuth callback the browser landed on `:5173` even when the user was on `:5174`. Two pre-existing TypeScript build errors were also blocking the packages build. Everything was fixed, committed (`f611aac`), and verified via a 14-test API smoke suite that runs without a browser.

## Timeline

- Read session summary from previous context; confirmed 5 pending tasks in auth routing.
- Fixed `packages/core/src/react/Middleware.tsx:106` — `loginRedirectUrl ?? '/'` to satisfy TS2769.
- Ran `npm run build` → new failure in `packages/server/src/httpRoutes/csrfMiddleware.ts:96`.
- Fixed `csrfMiddleware.ts:96` — added `csrfSession.csrfToken &&` guard before `timingSafeStringEqual`.
- Ran `npm run build` again → 16/16 packages OK + Vite OK + `dist/server.js` 526.5 KB.
- Staged the 7 substantive changed files + branch-log files; committed with pre-commit hook clean.
- Started backend (`npm run server` — port 80) and frontend (`npm run client` — landed on port 5175 as 5173/5174 already in use).
- Attempted Playwright MCP and Chrome DevTools MCP — both failed (Chrome not installed).
- Found Playwright Chromium at `C:\Users\MathijsYouComm\AppData\Local\ms-playwright\chromium-1228\` but MCP uses `chrome` channel, not `chromium`, so still unusable from MCP.
- Wrote `scripts/testLoginFlows.mjs` — pure Node fetch-based smoke suite.
- First run: 7 passed / 4 failed — all failures from missing `Origin` header (browser origin gate).
- Added `Origin: http://localhost:5175` + `X-Session-Based-Token: true` headers to POST helper.
- Second run: 12 passed / 1 failed — `/auth/csrf` 401 (test logic wrong, not a bug).
- Diagnosed: cookie-mode + no session token = correct 401 per `csrfRoute.ts:40-44`.
- Fixed test to: (a) assert 401 for unauth = correct, (b) register in cookie mode, capture `Set-Cookie`, hit `/auth/csrf` with the cookie.
- Final run: 14/14 passed.

## Done

- `packages/core/src/react/Middleware.tsx` — `loginRedirectUrl ?? '/'` (TS2769 pre-existing build error).
- `packages/server/src/httpRoutes/csrfMiddleware.ts` — null-guard `csrfSession.csrfToken &&` before timing-safe compare (TS2345 pre-existing build error).
- `config.ts` — `oauthCallbackBase` is now dynamic in dev: `http://localhost:${env('SERVER_PORT') ?? '80'}`. Production unchanged (uses `resolvedEnvironment.backendUrl`).
- `src/admin/page.tsx` — added missing `export const template = 'dashboard'`. Without it, `TemplateProvider` defaulted to `PlainTemplate` (no `<Middleware>` in tree), making `/admin` accessible without login.
- `packages/login/src/login.ts` — (a) `OAuthStateEntry` extended with `returnUrl?: string`; (b) `createOAuthState` accepts `options.returnUrl` and stores it in the Redis state entry; (c) `isAllowedRedirectUrl` now also passes when `cfg.http.cors.allowLocalhost && hostname === 'localhost'` (was only checking `allowedOrigins`); (d) `loginCallback` reads `stateEntry.returnUrl`, validates with `isAllowedRedirectUrl`, and uses it as the primary redirect target.
- `packages/server/src/httpRoutes/authApiRoute.ts` — reads `?return_url` query param from the OAuth initiation request and passes it to `createOAuthState`.
- `src/_components/LoginForm.tsx` — (a) `useLocation().search` imported and wired into the login↔register `<Link>` so `?backend=8080` is preserved; (b) OAuth button encodes `return_url = window.location.origin + loginRedirectUrl` as a query param; (c) after credentials auth, redirect appends `search` to preserve dev overrides.
- `scripts/testLoginFlows.mjs` — 14-case API smoke suite (health, providers, register, login, wrong-password, Google OAuth redirect + state, redirect_uri port, CSRF unauth + auth, rate limit).
- Commit `f611aac` on `chore/package-split-prep` — all 7 code files + branch-log in one clean commit.

## In Progress

- (none)

## Blockers

- Playwright MCP and Chrome DevTools MCP both require Google Chrome installed at the standard path. Chromium (via `ms-playwright`) is present but the MCP servers use `channel: 'chrome'` which looks for the Google Chrome binary specifically. The MCP config would need to be changed to use `channel: 'chromium'` or a `executablePath` override for browser-based UI testing to work.
- Google OAuth full round-trip (click → Google login → callback → redirect) cannot be automated without browser + Google account password. User must test this manually.

## Next Steps

1. **Manual Google OAuth test** — open `http://localhost:5175` (or whatever frontend port), click "Continue with Google", log in as `mathijsvanmelick3@gmail.com`, and verify you land on the correct frontend origin (same port you started from) at `/playground`.
2. **Test query param preservation manually** — navigate to `http://localhost:5175/login?backend=8080`, click the "Create one now" link, verify URL becomes `/register?backend=8080`; log in with credentials and verify the `?backend=8080` param survives in the redirect URL.
3. **Google Cloud Console** — user has already added ports 8080, 4000, and 4100 to Authorized Redirect URIs. If testing with `SERVER_PORT=8080`, use `http://localhost:8080/auth/callback/google`.
4. **Smoke suite** — `.smoke-test/run.mjs` (Laag 2 from prior task list). Delete the four stale app directories first if they exist: `.smoke-test/app-full`, `.smoke-test/app-no-presence`, `.smoke-test/app-no-i18n`, `.smoke-test/app-auth-none`.
5. **Browser-test scaffolded app** — after smoke suite passes, test the `app-full` output in a browser (Laag 3 from prior task list).
6. **Publish v0.2.0** — once smoke + manual Google OAuth confirmed. Run `npm run bump` then `npm run publish:packages`.

## Open Questions

- Should `scripts/testLoginFlows.mjs` be kept permanently (as a regression guard runnable with `node scripts/testLoginFlows.mjs`) or deleted now that the immediate fix is verified? It currently lives outside the `npm run test` framework (no `@luckystack/test-runner` integration). Options: (a) keep as-is for quick manual regression checks, (b) convert to a proper `testAll` integration test, (c) delete.
- The Playwright / Chrome DevTools MCP integration is currently broken because Chrome is not installed on this machine. Worth installing Chrome, or configuring the MCP to use the already-present Playwright Chromium? See MCP config in `.claude/settings.json`.

## Files Touched

**Modified**
```
config.ts
src/admin/page.tsx
src/_components/LoginForm.tsx
packages/core/src/react/Middleware.tsx
packages/login/src/login.ts
packages/server/src/httpRoutes/authApiRoute.ts
packages/server/src/httpRoutes/csrfMiddleware.ts
branch-logs/chore--package-split-prep.md
branch-logs/INDEX.md
```

**Added**
```
scripts/testLoginFlows.mjs
handoffs/2026-06-16/HANDOFF.md
```

**Auto-regenerated by pre-commit hook (committed)**
```
docs/AI_QUICK_INDEX.md
docs/AI_CAPABILITIES.md
docs/AI_PROJECT_INDEX.md
docs/AI_DECISIONS_INDEX.md
docs/AI_RUNBOOKS.md
docs/AI_PRODUCT_OVERVIEW.md
docs/ai-graph.json
```

## User testing checklist

- [ ] Start backend: `npm run server` (port 80 default, or `SERVER_PORT=8080 npm run server` for 8080).
- [ ] Start frontend: `npm run client`.
- [ ] Navigate to login page. Verify login and register tabs both show correctly.
- [ ] Click login→register link and back — verify `?backend=` param (if present) stays in the URL both ways.
- [ ] Register a new account with email + password. Verify success toast and redirect to `/playground`.
- [ ] Log out, log back in with the same credentials. Verify redirect to `/playground`.
- [ ] Click "Continue with Google", complete Google login as `mathijsvanmelick3@gmail.com`. Verify you land on the same frontend origin you started from (not a different port).
- [ ] Run `node scripts/testLoginFlows.mjs` — expect `14 passed / 0 failed`.
- [ ] Navigate directly to `/admin` while logged out — verify you are redirected to login (not shown the page).
