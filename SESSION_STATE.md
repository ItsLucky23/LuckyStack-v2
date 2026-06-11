# SESSION_STATE — read me first

> Branch: `chore/package-split-prep` · Base: `master` · Last rewritten: 2026-06-10 (end of the
> big browser-test + hardening session). For a fresh AI: read `CLAUDE.md` first, then this file
> top-to-bottom. Blow-by-blow detail lives in `branch-logs/chore--package-split-prep.md`
> (parts 1–9r) and `docs/audits/`. Canonical architecture spec for the optional-package model:
> `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md`.

---

## 0. TL;DR — where we are

- **Published on npm: 0.1.8. Working tree: 0.2.0 (15 packages incl. `@luckystack/cli`), UNCOMMITTED, unpublished.** ~190+ uncommitted files.
- **All automated gates GREEN (2026-06-10):** `lint` 0 (client/server/packages) · `build:packages` 15/15 · full `npm run build` exit 0 · `test:unit` **782/782**.
- **This session = frontend testing + a long bug-fix/hardening pass.** 12 numbered findings + 1 warning fixed (F1–F12, W1) plus dev-perf/UX fixes (env diagnostics, Vite polling, lazy-loading, login layout-shift, navbar glitch). The login matrix (4 scenarios), the full playground sweep, cookie-mode, and forgot-password were all verified in a browser.
- **NEXT (answer to "should we test `.smoke-test/app`?"): YES — and it's REQUIRED before publishing 0.2.0.** Several of this session's most important bugs only manifested in the **dist/tarball/consumer path**, NOT in the framework repo (which runs from source). See §4.

---

## 1. What this session did (2026-06-10) — the fixes

> All browser-verified unless marked. Framework src + the create-luckystack-app template + the
> `@luckystack/cli` login assets were kept in sync (mirror) where the file ships to consumers.

| # | Fix | Where |
|---|---|---|
| **F1** | Register now AUTO-LOGS-IN (was: account created but bounced to /login). Mints token + session, returns `newToken`. | `packages/login/src/login.ts` |
| **F3** | Playground "offline" demo simulates a network blip (`engine.close()` → `transport close` → long grace) instead of `socket.disconnect()` which (with presence on) killed the session after 2s. | `src/playground/page.tsx` + presenceConfig doc |
| **F4** | Logout now CLEARS the HttpOnly cookie — sockets can't `Set-Cookie`, so a new `POST /auth/logout` route + a client call on logout expire it. | `packages/server/.../authLogoutRoute.ts` (+ test), `src/_sockets/socketInitializer.ts` |
| **F5** | Cookie-mode login clears any stale sessionStorage token (was confusing client mode-detection). | `LoginForm.tsx` ×3 |
| **W1** | Suppressed the spurious "Sync event … has no registered callback" warning for streaming-only routes. | `packages/sync/src/syncRequest.ts` |
| **F6** | Password-reset email link used the BACKEND origin (`localhost:80`) instead of the FRONTEND. `config.ts` `app.publicUrl` now = detected public origin. | `config.ts` |
| **F7** | **PUBLISH-CRITICAL:** tsup `splitting:false` gave each package entry a PRIVATE copy of shared registry state → `@luckystack/login/register` registered OAuth providers into a registry the server couldn't see → **OAuth buttons NEVER appeared in consumer installs.** `splitting:true` across all 10 multi-entry packages. | every `packages/*/tsup.config.ts` |
| **F8** | Consumers had NO dev file/env watch — devkit's supervisor was never built/exposed. Now shipped as the **`luckystack-dev`** bin; template `server` script uses it (`server:once` = old behaviour). | `packages/devkit` (+ bin, supervisor entry), template `package.json` |
| **F9** | Supervised restarts served STALE env: the supervisor imported `@luckystack/core`, whose import-time `bootstrapEnv()` polluted its env snapshot (inlined by tsup) → `.env` edits never reached the child. Supervisor now imports NOTHING from core (pure `dotenv.parse`) + a guard test. | `packages/devkit/src/supervisor.ts` |
| **F10** | **REPORT-ONLY (not fixed):** `src/settings/_api/listSessions_v1.ts` returns full raw session tokens to the client (own tokens only, no cross-user leak). Should mask/opaque-id. Consumer demo code — left for the user. | `src/settings/_api/listSessions_v1.ts` |
| **F11** | Cookie-mode CSRF fetch used the FRONTEND origin in split-origin dev → `/auth/csrf` hit the SPA fallback (HTML, not JSON). Now prefers the socket's backend URI. | `packages/core/src/csrf.ts` |
| **F12** | Google OAuth `redirect_uri_mismatch`: the legacy consumer overlay `luckystack/login/oauthProviders.ts` hand-built the callback from `SERVER_IP` → `127.0.0.1:80` (Google had `localhost:80`). Now uses `getProjectConfig().oauthCallbackBase`. | `luckystack/login/oauthProviders.ts` |

**Dev experience / perf (this session, mostly framework-repo only):**
- **Env dual-file footgun:** the "value won't change" confusion was a key defined in BOTH `.env` and `.env.local` (`.env.local` overrides; deleting from one resurfaces the other). Added opt-in `LUCKYSTACK_ENV_DEBUG=1` (logs every multi-file key + winner at boot) + template comments + the agreed **one-key-per-file** convention (memory saved).
- **Vite `usePolling` was pegging a CPU core** → now off by default (`VITE_USE_POLLING=1` to re-enable for WSL/Docker); `.smoke-test`/`dist`/`.cache` added to the dev-watch ignore.
- **`@vitejs/plugin-react-swc` → `@vitejs/plugin-react`** (rolldown-vite oxc; silences the startup hint). Framework-repo only — the template runs stable Vite 6 where swc is correct.
- **Login UI layout-shift:** the OAuth buttons popped in after the `/auth/providers` fetch → now the whole form is gated behind a spinner until the fetch resolves. (×3 copies.)
- **LAZY-LOADED PAGES (big one):** `main.tsx` eager-globbed ALL pages on every route → even `/login` pulled in ~127 modules (playground, workspaces, every component), and Chrome DevTools froze ~10s parsing their source-maps. Converted to React-Router-7 `lazy`; `/login` now loads **17** modules. Splat (`/foo/*`) handled via a per-page wildcard route (no eager metadata read). Template mirrored. Prod build now code-splits per page.
- **Navbar animation glitch on playground:** the sidebar toggled `relative`↔`absolute`, jumping the content 14px each toggle. Now always-overlay + a constant `md:pl-14` on content → only the overlay width animates, content never moves.

**Earlier this branch (pre-session, parts 1–8):** the package split into 15 `@luckystack/*` packages, security audits + fixes, the new UI input components (TextField/Toggle/Checkbox/DatePicker/Popover), production AFK/presence, AI browser-testing tooling, the `bin` `./dist`→`dist` publish fix. See the branch-log.

---

## 2. State of play before you touch anything

- Start: `npm run server` + `npm run client` (server-start is normally YOUR action; this session the user granted standing autonomy). Backend `http://localhost:80`, frontend Vite `http://localhost:5173`.
- `config.ts` currently: `sessionBasedToken: false` (cookie mode), `allowMultipleSessions: true`, presence (`socketActivityBroadcaster`) + `socketStatusIndicator` ON.
- Test accounts (dev DB): `lstest+76702@example.com` / `LsTest!76702#Aa` · `lstest+90210@example.com` / `LsTest!90210#Bb` · `mathijsvanmelick3@gmail.com` (Google OAuth + the password-reset test; pw last set to `LsNieuw!2026#Zz`).
- `.env` = public keys only; secrets in `.env.local` (one-key-per-file). NEVER read `.env.local` unless the user re-grants it.

---

## 3. Verified GREEN this session (don't re-do unless you changed it)

- **Login matrix 4/4** (sessionBasedToken × allowMultipleSessions): token location, multi-session kick + `sessionReplaced`, register auto-login, cookie-clear-on-kick, supersede-on-relogin.
- **Playground full sweep:** notifications, buttons, confirm dialogs (basic/typed/stacked), dropdown+search, multiselect, lifecycle hooks, rate-limit (3 ok / 7 limited), health probes, error boundary, streaming (31 chunks), offline queue.
- **Cookie token-mode:** HttpOnly+SameSite=Strict, CSRF 403-without/200-with header.
- **Forgot-password e2e** (real Resend delivery): token form, old-pw rejected, new-pw login, one-shot token.
- **Presence/AFK** at the wire level: `userAfk {userId, endTime}` — no token in the payload.

---

## 4. NEXT — `.smoke-test/app` verification for 0.2.0 (REQUIRED before publish)

**Why it's required, not optional:** the framework repo runs every `@luckystack/*` package from **source** (Vite aliases / tsx). Consumers run them from the **built dist tarballs**. Three of this session's most important bugs — **F7** (splitting → OAuth registry), **F8** (the supervisor bin), **F9** (supervisor env snapshot) — only exist on the dist/consumer path. The framework repo looked healthy the whole time. So a consumer-context check is the only thing that proves these are actually fixed for a real install.

### 4.1 The offline gate (fast)
`.smoke-test/run.mjs` re-packs all 14 tarballs, scaffolds a fresh consumer project against them, and runs the consumer gates (generateArtifacts → typecheck → build → lint) + the AI-browser scaffold asserts.
```
npm run build:packages          # ensure dist is current (this session changed login/server/core/devkit/sync)
node .smoke-test/run.mjs         # GREEN = "ready to publish" (offline)
```
⚠️ **`run.mjs` WIPES `.smoke-test/app` — including its `.env.local` with the user's real OAuth/Resend keys.** Copy those out first if you want them back.

### 4.2 The end-to-end consumer check (the part that proves F7/F8/F9)
The offline gate doesn't run the app. After it's green, in the FRESH scaffold:
- `npm run server` (the new `luckystack-dev` supervisor) + `npm run client`.
- **F8/F9:** edit a value in `.env` while the server runs → the supervised child restarts AND serves the NEW value (no stale env). Remove a key → its effect is gone (mind the one-key-per-file rule).
- **F7:** set `DEV_GOOGLE_CLIENT_ID`/`SECRET` (+ restart) → the **Google button appears** on `/login` (this is the bug that was invisible in consumer installs before). `curl /auth/providers` lists `google`.
- **F1/F4/F5/F11:** register → auto-login; cookie-mode logout clears the cookie; CSRF works.
- **Lazy-loading + login-shift + (no navbar in the base template):** `/login` loads few modules; the form doesn't pop-in.
- **CLI bins:** `npx luckystack --help`, `npx luckystack-dev` (supervisor), `npx create-luckystack-app --help` all resolve.
- **`luckystack add` round-trip** (see `docs/LUCKYSTACK_ADD_GUIDE.md`).

### 4.3 The full create-luckystack-app matrix (post- or pre-publish)
See `docs/` + the original §4 checklist in the git history: default scaffold, `--no-prompt`, `--ai-browser=all|none`, opt-out cleanliness, AI-docs shipped.

---

## 5. Publish blocker + your actions

- **Nothing committed or published.** Working tree at 0.2.0.
- After §4 is green: commit, then publish. **Publish is gated on the npm 2FA wall** — on npmjs.com set Two-Factor Auth to "Authorization only", then `npm run publish:packages` (builds + publishes the 15 in dependency order). Fallback: `npm config set auth-type legacy` + OTP.
- A human security review of the CSRF double-submit fallback (login-absent path, `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md` §7) is wise before publish.
- Re-run `publish:dry` (should be 0 warnings after the `bin` fix from part 8).

---

## 6. Open / report-only items (the user decides)

- **F10:** `listSessions_v1.ts` returns raw session tokens to the client — mask them (consumer demo code).
- **The user's personal `.env`** still has (or had) OAuth secrets duplicated from `.env.local`. Convention is one-key-per-file; the user may want to clean `.env`. (Offered; not done.)
- **DevTools lag:** lazy-loading cut `/login` from ~127→17 modules; ask the user whether DevTools is now acceptable. Fully eliminating it would require bundling dev (breaks HMR).
- **Cosmetic:** ~11 em-dashes in `.env.local` COMMENT lines got mangled to `?` by an earlier `Set-Content -Encoding ascii` (harmless; offered to clean).
- **Splat + lazy-loading:** the per-page `/*` wildcard means a splat page (only `src/workspaces`, a not-yet-active prototype) remounts on subpath nav instead of keeping a persistent shell. Fine for now; a build-time route manifest would be the "proper" fix if splat shells matter later.

---

## 7. Key references

- Full work log: `branch-logs/chore--package-split-prep.md` (parts 1–9r).
- Optional-package architecture: `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md`. Adding features later: `docs/LUCKYSTACK_ADD_GUIDE.md`.
- Audits + cleared backlog: `docs/audits/*` (esp. `REAUDIT_2026-06-09.md`).
- AI browser testing: `docs/AI_BROWSER_TESTING.md`. Package matrix: `docs/PACKAGE_OVERVIEW.md`.
- Workspaces (separate prototype, KEEP): `handoff/`, `sparring/`, `src/workspaces/`, `ui-builder/`.
