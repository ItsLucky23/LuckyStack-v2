# SESSION_STATE — read me first

> Branch: `chore/package-split-prep` · Base: `master` · Date written: 2026-06-08
> **For a fresh AI:** read `CLAUDE.md` first, then this file top-to-bottom, then
> `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md`. This file is self-sufficient — it has
> the full plan for the next initiative plus the current repo state.

---

## 0. TL;DR — where we are & what's next

- **Published on npm: 0.1.8. Working tree: 0.2.0, UNCOMMITTED, unpublished.** All
  automated gates GREEN: `build:packages` 14/14 · `test:unit` 772/772 ·
  `.smoke-test/run.mjs` MATRIX (full + no-presence) GREEN · `lint:packages` 0/0.
- **The 0.2.0 architecture is DONE**: login/presence/sync are genuine OPTIONAL
  peers; the server auto-degrades when one is absent (§3 below).
- **THE NEXT BIG INITIATIVE (planned, not started): "install-anything-anytime."**
  A consumer installs a BASE set, then later `npm i @luckystack/<pkg>` (or
  `npx luckystack add <feature>`) + sets env + restarts → it just works, with ZERO
  manual wiring. Flip Sentry / OAuth providers / login on or off at any time.
  The complete plan is §5–§8. **Implementation has NOT begun** — tomorrow start at §8 step 1.

---

## 1. The goal (user's words, locked)

> "I can either install all packages OR just the base package list, and then later
> run `npm i @luckystack/presence` and it works as well. Same for Sentry (don't
> want it now, want it later — no problem), for the OAuth providers, and for the
> login package. It should be possible to add anything at any moment."

The dial: **install everything (Django-style) ↔ base-only + à-la-carte (FastAPI-style).**

---

## 2. Decisions LOCKED (2026-06-08, via AskUserQuestion)

1. **Login UI delivery = `npx luckystack add login` generator.** `npm i @luckystack/login`
   auto-wires the auth BACKEND (routes + session + OAuth-by-env). The editable
   pages (`/login`, `/register`, `/reset-password`, `/settings/**` + their `_api`)
   + `LoginForm` are copied into the consumer's `src/` by the generator (shadcn-style;
   the consumer owns + edits them; they match the project's `SessionLayout`). NOT a
   package-mounted page (file-based routing scans `src/`; node_modules can't inject routes).
2. **The add command = a NEW dedicated CLI: `npx luckystack add <feature>`.** A
   lightweight new package (`@luckystack/cli`, or a `bin` on an existing package).
   It is the INVERSE of the scaffold's `pruneOptionalPackages`.
3. **`luckystack add` does NOT replace `npm i`** — it WRAPS it. For backend-only /
   zero-UI features (sync, email, error-tracking, oauth-by-env, docs-ui, login-backend)
   a plain `npm i @luckystack/<pkg>` is enough (boot auto-detect wires it). For
   features that need `src/` assets (login pages, presence JSX mounts), `luckystack add`
   runs `npm i` AND injects the folders/files into `src/`. So: `add` = `npm i` + src injection.
4. **BASE set = `@luckystack/core` + `@luckystack/api` + `@luckystack/server` +
   `@luckystack/error-tracking`** (+ peers `@prisma/client`, `socket.io`).
   error-tracking is a thin adapter (heavy `@sentry/node` stays an optional peer),
   so Sentry/PostHog stay pure env+restart. login / presence / sync / email / docs-ui = à-la-carte.
5. **Scope tonight = PLANNING + this doc only.** Implementation is "everything in one
   push" tomorrow (decision was option 2), but executed in the verifiable sequence in §8.
6. **(internal, not asked — going with the design recommendations):**
   - Optional-package list = a hardcoded `OPTIONAL_PACKAGES` constant in `@luckystack/server`
     (mirrors `capabilities.ts` + `OVERLAY_ORDER`), NOT a node_modules dir scan.
   - Override precedence = **last-writer-wins**: auto-detect `./register` phase runs
     FIRST, the consumer overlay folder runs SECOND so a hand-written overlay overrides.
   - Auto-detect is **server-side** + targeted **client** conditional dynamic-imports
     (sync bridge); no generic client registry yet.

---

## 3. What's ALREADY DONE (0.2.0, in the working tree, uncommitted)

**Core decouple (the foundation install-anytime builds on):**
- `@luckystack/core/src/sessionProviderRegistry.ts` — `registerSessionProvider` +
  null-safe `readSession`/`writeSession`/`removeSession`/`performLogout` (return
  null/no-op when login absent). Exported from core index + client.
- `@luckystack/login` registers its session impl into core at module load (index.ts).
- `api`/`sync`/`presence`/`server` read sessions via core, NOT login. login dropped
  from api/sync deps; optional peer of presence (type-only import) + server.
- `@luckystack/server/src/capabilities.ts` — `createRequire().resolve` guard +
  cached lazy `getLogin`/`getPresence`/`getSync`. Server routes degrade:
  `auth.disabled` (login absent), `sync.disabled` (sync absent), presence skipped.
- **CSRF**: login-present path unchanged (session-bound); login-absent path =
  stateless double-submit (`csrfMiddleware.ts` + `csrfRoute.ts`); `csrfMiddleware.test.ts` (10 tests).
- All 14 packages at **0.2.0** (`npm run bump minor`).

**Installer (Phase 4) — presence opt-out DONE + verified:**
- `create-luckystack-app`: wizard asks "Install @luckystack/presence?"; `--no-presence` flag;
  `pruneOptionalPackages()` drops the dep + rewrites `main.tsx` (LocationProvider→Outlet)
  + `TemplateProvider.tsx` (drops SocketStatusIndicator + orphaned wiring).
- `.smoke-test/run.mjs` is now a MATRIX (full + no-presence), each: scaffold →
  prune-assert → install → typecheck → build → lint. Both GREEN.

**Also this session (0.1.x patch fixes folded into 0.2.0):** port-conflict truthful
boot + `SERVER_PORT_AUTO_INCREMENT`; `npm run bump`; package.json trim + `npm run help`;
OAuth env-comments in `.env.local`; OAuth redirect→`loginRedirectUrl`; session supersede
on re-login; sessionStorage-mode login fixes (OAuth `?token=` pickup in `main.tsx`,
`saveSession` returns `{ok}`, credentials Bearer); `public/microsoft.png` added.

---

## 4. Target architecture — install-anything-anytime (3 layers)

**Layer 1 — package self-wiring via a `./register` subpath.** Each optional package
ships a side-effect entry `@luckystack/<pkg>/register` that performs its OWN default
env-driven wiring, idempotently. The logic currently in the consumer overlay files
(`luckystack/<pkg>/*.ts`) MOVES INTO the packages:
- `@luckystack/login/register`: force session-provider register; guard-register
  `defaultPrismaUserAdapter`; run the OAuth env-scan loop (from `oauthProviders.ts`)
  reading `callbackUrl` from `getProjectConfig()` (new `oauthCallbackBase` slot), NOT
  the consumer's `../../config`.
- `@luckystack/email/register`: `autoSelectEmailSender()` + `registerEmailSender` (body
  of `email/init.ts`), already env-driven; register into `default` + `transactional` slots.
- `@luckystack/error-tracking/register`: `initializeSentry()` + PostHog env-scan (env-gated no-ops).
- `@luckystack/presence/register`: `registerPresenceHooks()` + default AFK event.
- `@luckystack/docs-ui/register`: `registerCustomRoute` for its self-contained HTML route (auto-mounts).

**Layer 2 — boot auto-detect phase in `@luckystack/server`.** Add an `OPTIONAL_PACKAGES`
constant. In `bootstrapLuckyStack`, BEFORE `loadOverlayFolder` (so overlay overrides),
iterate the list and for each package resolvable via `createRequire().resolve`,
`await import('@luckystack/<pkg>/register')`. Force `await getLogin()` once when
`capabilities.login` so login self-registers even in an app that never imports it.
→ **`npm i <pkg>` + env + restart = server-side wiring lights up, zero code edits.**

**Layer 3 — client side** (Node auto-detect can't reach Vite):
- **sync receive bridge**: move the inline listener (consumer `socketInitializer.ts`
  ~L228-282) INTO `@luckystack/sync/client` as idempotent `attachSyncReceiver(socket)`.
  The always-present `socketInitializer` does a `tryCatch` dynamic
  `import('@luckystack/sync/client')` in the connect effect and attaches only on
  success — DECOUPLED from the presence/activity flag (today entangled ~L159).
  → sync client add-later becomes pure `npm i`.
- **presence mounts** (`<LocationProvider/>` root in `main.tsx`, `<SocketStatusIndicator/>`
  in `TemplateProvider`) + **login pages**: CANNOT be pure `npm i` (JSX mount points +
  routable pages live in consumer `src/`; Vite breaks on a static import of an
  uninstalled package). Delivered by `npx luckystack add <feature>`.

**Prerequisite cleanup (do FIRST, zero behavior change):** switch template `config.ts`
to import `BaseSessionLayout`/`AuthProps` from `@luckystack/core` (already exported)
instead of `@luckystack/login`, so `config.ts` compiles identically with or without
login. Add `oauthCallbackBase` + `socketStatusIndicator` slots to `projectConfig`.

---

## 5. Per-feature: can it be pure `npm i`?

| Feature | Pure `npm i`? | How it arrives |
|---|---|---|
| error-tracking (Sentry/PostHog) | yes (in BASE) | env (`SENTRY_DSN`) + restart; `./register` auto-wires |
| email (Resend/SMTP) | yes | `npm i @luckystack/email <driver>` + env + restart |
| OAuth provider (google, …) | yes | set provider env vars + restart (env-scan in login/register) |
| sync | yes (after L3 bridge) | `npm i @luckystack/sync` (+ migrate app code to `@luckystack/sync/client`) |
| docs-ui | yes | `npm i @luckystack/docs-ui` + `./register` customRoute |
| login BACKEND (auth routes, session, OAuth) | yes | `npm i @luckystack/login` + env + restart |
| login PAGES (/login,/register,/settings + LoginForm) | **no** | `npx luckystack add login` (copies editable pages into `src/`) |
| presence SERVER (lifecycle/hooks) | yes | `npm i @luckystack/presence` + `./register` |
| presence CLIENT mounts (LocationProvider, SocketStatusIndicator) | **no** | `npx luckystack add presence` (injects JSX mounts) |
| Datadog | **no** | `dd-trace` must be the process's first import → `NODE_OPTIONS=--import @luckystack/error-tracking/datadog-preload` (documented in `.env.local`) |

---

## 6. The `luckystack add` CLI (new `@luckystack/cli`)

The inverse of `create-luckystack-app`'s `pruneOptionalPackages`. `npx luckystack add <feature>`:
1. `npm install`s the peer package(s).
2. Copies the consumer-`src/` surfaces packages can't inject — login pages/_api +
   `LoginForm`, presence JSX mounts — from **package-shipped `assets/`** bundles,
   idempotently (skip-if-exists).
3. Applies the inverse idempotent JSX edits to `main.tsx` / `TemplateProvider.tsx`
   (re-add the mount the pruner removes), and flips the relevant `config.ts` values.
4. (login) optionally has the generated `/login` page import `LoginForm` from
   `@luckystack/login/client` so it's a thin, swappable wrapper.

**Packages must ship**: (a) `./register` side-effect subpath; (b) client packages an
idempotent attach fn from `/client` (`attachSyncReceiver`); (c) login must ship
`LoginForm` + provider icons from `/client` AND the page/_api templates as `assets/`
(login currently ships ZERO `.tsx` — must add). A future `luckystack remove <feature>`
can reuse the existing pruner logic.

---

## 7. BASE vs à-la-carte package set

- **BASE (always)**: `@luckystack/core`, `@luckystack/api`, `@luckystack/server`,
  `@luckystack/error-tracking` (+ peers `@prisma/client`, `socket.io`; `@luckystack/devkit` dev-only).
- **À-la-carte**: `login`, `presence`, `sync`, `email`, `docs-ui`, `secret-manager`,
  `router`, `test-runner`.
- The scaffold should offer a "base / full / custom" choice; `create-luckystack-app`'s
  `pruneOptionalPackages` already removes deselected packages (presence done; extend to the rest).

---

## 8. IMPLEMENTATION SEQUENCE (start here tomorrow)

> Verify after EACH step: `npm run lint:packages` 0/0 · `npm run build:packages` 14/14 ·
> `npm run test:unit` (keep ≥772) · `.smoke-test/run.mjs` MATRIX green. The smoke matrix
> is the safety net for "did I break the default install." Extend it with a `base-only`
> combo as you go. Do NOT regress the default full install.

1. **Prereq decouple (small, zero behavior change).** Template `config.ts`:
   import `BaseSessionLayout`/`AuthProps` from `@luckystack/core` (not login). Add
   `oauthCallbackBase` + `socketStatusIndicator` slots to `projectConfig`
   (`packages/core/src/projectConfig.ts`).
2. **Boot auto-detect phase (medium — the spine).** `@luckystack/server`:
   `OPTIONAL_PACKAGES` constant + register-import loop in `bootstrapLuckyStack` (find it
   under `packages/server/src/`, ~`bootstrap.ts`), BEFORE `loadOverlayFolder`,
   resolve-guarded `await import('@luckystack/<pkg>/register')`. Force `getLogin()` when present.
3. **Easy env-driven `./register` entries first (small each).** `@luckystack/email/register`
   + `@luckystack/error-tracking/register` (relocate `template/luckystack/{email,sentry}/*` bodies).
   Verify pure `npm i` + env on a base-only app (add the base-only smoke combo).
4. **`@luckystack/login/register` (medium).** Relocate the OAuth env-scan into the package
   (callbackUrl from `getProjectConfig()`); force `getLogin()` at boot; drop the duplicate
   `config.ts` `providers` array (drive credentials-form visibility from `/auth/providers`);
   delete the boilerplate `template/luckystack/login/userAdapter.ts` overlay. Backend login → pure `npm i`.
5. **`@luckystack/presence/register` (small).** `registerPresenceHooks()` via auto-detect;
   REMOVE the manual `registerPresenceHooks()` call in the dev repo `server.ts` (kills divergence).
6. **sync client bridge (medium).** Extract `attachSyncReceiver` into `@luckystack/sync/client`;
   make `socketInitializer` conditionally dynamic-import it (tryCatch), decoupled from the
   presence/activity flag. Client sync add-later → pure `npm i`.
7. **`@luckystack/cli` — `luckystack add` (large).** New package with `bin`. Implements
   `add login` + `add presence` (copy assets into `src/`, inverse JSX edits, npm install).
   Ship the page/_api/LoginForm/icon `assets/` in `@luckystack/login`; ship presence mount
   assets. Idempotent skip-if-exists. Add smoke combos that scaffold base-only then
   `luckystack add login` / `add presence` and re-run the gates.
8. **docs-ui `./register` + docs sweep (small).** Dormant `@luckystack/docs-ui/register`
   (auto-mount in dev). Update `packages/server/CLAUDE.md` to move login/presence/sync from
   Required → Optional. Update `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md` status.

**Datadog (separate, medium):** standardize on `NODE_OPTIONS=--import
@luckystack/error-tracking/datadog-preload`, documented in `.env.local_template`.

---

## 9. INVARIANTS / gotchas (don't get burned)

- **Never regress the default full install.** The smoke matrix `full` combo must stay green.
- **Vite cannot statically import an uninstalled package** — that's why presence mounts +
  login pages need the CLI, not pure `npm i`. Client optional deps use `tryCatch` dynamic import.
- **Scaffold file edits hit CRLF on Windows** — `create-luckystack-app`'s `editScaffoldFile`
  normalizes `\r\n`→`\n` before matching; do the same in the `luckystack add` CLI.
- **Override precedence**: auto-detect `./register` runs BEFORE the overlay folder so a
  consumer overlay (last writer) overrides. `register*` are last-writer-wins already.
- **peer-dep-guard policy** (memory `feedback_peer_dep_guard_policy`): an env key set with
  its peer NOT installed = hard boot crash, never silent fallthrough. Exception:
  secret-manager fails OPEN. Keep `./register` entries env-gated no-ops when env absent.
- **Strict typing** (memory `feedback_strict_typing_policy`): zero `as any`/`as unknown`;
  no disabled lint rules; document structural exceptions.
- `BaseSessionLayout`/`AuthProps` are exported from BOTH `@luckystack/core` (index + client)
  and re-exported by login — use the CORE ones in template/config to stay login-agnostic.

---

## 10. TEST CHECKLIST (manual — user will run when able)

> Legend: [repo] = this repo (`npm run server` + `npm run client`); [scaffold] = fresh
> `npx create-luckystack-app`; the framework sample `config.ts` defaults `sessionBasedToken: true` (sessionStorage mode).

**Login matrix (both cookie AND sessionStorage modes):** fresh credentials login →
/dashboard; re-login to another account WHILE logged in → success, no bounce, session is
new account; OAuth login → /dashboard, session adopted, no `?token=` left in URL; OAuth
while logged in → no session loss; register while logged in → no corruption.
**Optional packages:** default full install works (login/OAuth/sync/presence); no-presence
scaffold builds + runs (no AFK/status-indicator, room join/leave still work).
**Dev/tooling:** `npm run server` truthful port-in-use error; `SERVER_PORT_AUTO_INCREMENT=1`
boots on next free port; `npm run help`; `npm run bump patch -- --dry-run`.

---

## 11. PUBLISH BLOCKER + user actions

- **Nothing committed or published.** Working tree at 0.2.0.
- **Publish is blocked on the npm 2FA wall.** On npmjs.com set Two-Factor Auth to
  "Authorization only", then `npm run publish:packages` (builds + publishes 14 in dep order).
  Fallback: `npm config set auth-type legacy` then publish with the OTP.
- A human **security review of the CSRF double-submit fallback** is wise before publish (design §7).

---

## 12. Key file references (verified this session)

- Core session registry: `packages/core/src/sessionProviderRegistry.ts` (+ index L209 area, client.ts).
- Server capability layer: `packages/server/src/capabilities.ts`.
- CSRF: `packages/server/src/httpRoutes/{csrfMiddleware,csrfRoute}.ts` (+ `.test.ts`).
- Scaffold + pruner: `packages/create-luckystack-app/src/index.ts`
  (`pruneOptionalPackages`, `editScaffoldFile`, `dropDependency`, `--no-presence`).
- Smoke matrix: `.smoke-test/run.mjs` (COMBOS array).
- Overlay model (to relocate into packages): `luckystack/{login,server,docs-ui,core}/*` +
  `template/luckystack/**` + `template/server/server.ts`.
- Bootstrap/auto-import overlay: `packages/server/src/` (`bootstrap.ts` — `loadOverlayFolder`, `OVERLAY_ORDER`).
- OAuth env-scan to relocate: `template/luckystack/login/oauthProviders.ts` (~L35-78; L27 reads `../../config`).
- Design spec (canonical, ships to consumers): `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md`.
- Reusable design workflow: `.claude/workflows/install-anytime-design.mjs` (re-run for refresh).
