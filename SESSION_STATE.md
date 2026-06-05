# SESSION_STATE

> Branch: `chore/package-split-prep` · Base: `master`
> **Pick up here: publish 0.1.4 (blocked only by an npm 2FA setting), runtime-test per the checklist, THEN start the 0.2.0 work — point D below.**

## Session Summary

Continued hardening the `npx create-luckystack-app` first-run experience on top of the already-published 0.1.3. A real fresh install surfaced 8 issues; 6 were fixed and committed as **0.1.4**, plus a follow-up that made **every optional feature opt-in / enable-later**. All work is committed on `chore/package-split-prep` (two commits) and validated (875 tests pass, fresh-scaffold smoke GREEN, `publish:dry` 14/14). **0.1.4 is NOT published yet** — the publish run failed purely on an npm auth/2FA setting, not on code. The next big phase (0.2.0) is making packages genuinely optional (point **D**).

## Completed Tasks

**Commit `120bb7a` — 6 fixes + 0.1.4 bump:**
- **A — CORS dev localhost**: `packages/create-luckystack-app/template/config.ts` now sets `cors.allowLocalhost: dev`, so the Vite dev frontend on `localhost:5173` (and any port) reaches the backend.
- **B+H — env-driven OAuth buttons**: new framework endpoint `GET /auth/providers` (`packages/server/src/httpRoutes/authProvidersRoute.ts` + wired into `httpHandler.ts` pre-params dispatch, + unit test `authProvidersRoute.test.ts`); template `luckystack/login/oauthProviders.ts` registers EVERY built-in by env presence; `template/src/_components/LoginForm.tsx` fetches the list and renders buttons (no secrets to the browser).
- **F — transparent template rules**: `template/_dot_luckystack/templates/templateRules.ts` inlines the dashboard regex + worked examples instead of the hidden `DEFAULT_DASHBOARD_PATH_PATTERN` import.
- **G — enable-later Sentry**: `template/luckystack/sentry/init.ts` overlay calls the env-driven `initializeSentry()`.
- **C — arrow-key installer**: zero-dep wizard in `packages/create-luckystack-app/src/index.ts` (↑/↓ move · Enter select · Space toggle · ← back), numbered fallback on non-TTY.
- **E — opt-in AI instructions**: new `aiInstructions` scaffold choice gates the framework-docs copy + installs a consumer pre-commit AI-index hook (`installAiIndexHook`) + `prepare` hooksPath script.
- All 14 `packages/*/package.json` bumped to **0.1.4** (versions + internal `^0.1.4` refs).

**Commit `39c9f0a` — every optional feature is enable-later:**
- Framework: added `'email'` to `OVERLAY_ORDER` in `packages/server/src/bootstrap.ts`.
- `template/luckystack/email/init.ts` (new): registers `autoSelectEmailSender()` when `@luckystack/email` is installed (Resend/SMTP/Console by env); silent no-op when absent.
- `template/luckystack/sentry/posthog.ts` (new): registers PostHog adapter when `POSTHOG_KEY` set (lazy `posthog-node`).
- `template/server/server.ts`: commented `dd-trace` first-import block + adapter registration (Datadog must load first, can't overlay).
- `template/_dot_env_dot_local_template`: `{{EMAIL_ENV_VARS}}` + `{{MONITORING_ENV_VARS}}` with full commented enable-later sections.
- `packages/create-luckystack-app/src/index.ts`: `buildMonitoringEnvVars` / `buildEmailEnvVars` (env-block generators) + `injectOptionalDeps` (adds the SELECTED provider's npm deps before install — `@sentry/node` / `posthog-node` / `dd-trace`+`hot-shots` / `@luckystack/email`+`resend`/`nodemailer`).

**Verification done this session:**
- `npm run test:unit` → 757/757 · `npm run test:integration` → 5/5 · live sweep (`TEST_BASE_URL=http://localhost:4100 npm run test`) → 113 passed / 0 failed / 11 skipped (skips are login-required-route rate-limits needing `TEST_AUTH_TOKEN`, + 2 routes over the cap). **Total 875 passed, 0 failed.**
- `.smoke-test/run.mjs` → SMOKE GREEN (typecheck + build + lint). `npm run publish:dry` → validated 14/14 at 0.1.4.

## Pending Logic / Known Bugs

- **PUBLISH BLOCKED (not code):** `npm run publish:packages` fails with a 404 on `/-/v1/done?authId=...`. Root cause: `npm whoami` = `lucky23m` (logged in, token present in `C:\Users\MathijsYouComm\.npmrc`), but `auth-type=web` (npm 11) + 2FA likely on **"Authorization and writes"** → npm wants a per-publish 2FA via a browser flow that doesn't complete. **Nothing was published in the failed runs** ("Already done this run: (none)"; the 404 confirms `@luckystack/core@0.1.4` isn't on npm), so re-running after the fix is safe.
- **Reported but intentionally NOT auto-fixed earlier, now DONE** in `39c9f0a` (monitoring/email scaffold choices were dead) — no longer pending.
- 11 rate-limit sweep cases stay skipped without a `TEST_AUTH_TOKEN` (login-required routes) and a cap override for 2 routes (`playground/echo`, `playground/throwError`, rateLimit 60 > default 50). Not failures.

## Exact Next Step

**Publish 0.1.4:** on npmjs.com set Two-Factor Auth to **"Authorization only"** (Account → Two-Factor Authentication), then run `npm run publish:packages`. You're already logged in as `lucky23m`; this builds + publishes all 14 at 0.1.4 in dependency order without per-package OTP. (Fallback if you keep 2FA-on-writes: `npm config set auth-type legacy` then publish, entering the OTP in the terminal.) After publish, runtime-test a fresh `npx create-luckystack-app@0.1.4` per the checklist below.

## Technical State

**Files modified this session (all committed):**
- `packages/server/src/httpHandler.ts` — wired `handleAuthProvidersRoute` into pre-params routes.
- `packages/server/src/httpRoutes/authProvidersRoute.ts` (new) + `.test.ts` (new) — `GET /auth/providers`.
- `packages/server/src/bootstrap.ts` — `'email'` added to `OVERLAY_ORDER`.
- `packages/create-luckystack-app/src/index.ts` — arrow-key wizard, `aiInstructions` choice, `installAiIndexHook`, `buildMonitoringEnvVars`/`buildEmailEnvVars`, `injectOptionalDeps`.
- `template/config.ts` (allowLocalhost), `template/src/_components/LoginForm.tsx` (fetch providers), `template/_dot_luckystack/templates/templateRules.ts` (inlined regex), `template/_dot_env_dot_local_template` (email+monitoring blocks), `template/server/server.ts` (dd-trace block), `template/luckystack/login/oauthProviders.ts` (env-driven), `template/luckystack/sentry/init.ts` (new), `template/luckystack/sentry/posthog.ts` (new), `template/luckystack/email/init.ts` (new).
- All 14 `packages/*/package.json` → 0.1.4. `branch-logs/chore--package-split-prep.md` + `INDEX.md` (entries → 106).

**Dev-only / cleanup:** none in shipped code. `.claude/settings.local.json` is modified locally but intentionally NOT committed. Leftover `.smoke-test/app*` dirs (gitignored) and a `test-results.json` from the sweep — harmless.

**Environment:** working tree clean except `.claude/settings.local.json`. User has a dev server on `http://localhost:4100` (TEST_BASE_URL=http://localhost:4100). NOTE: continuing from a DIFFERENT device (home) — repo + branch are pushed-or-local; pull the branch first.

---

## ⭐ Point D — the 0.2.0 vision (user explicitly asked to remember this)

**Make `@luckystack/*` packages genuinely OPTIONAL** so LuckyStack can be used either like Python **FastAPI** (lean — spin up APIs fast) OR like **Django** (all-in-one — 90% of what you need already there). The `create-luckystack-app` installer becomes the dial between those two modes.

Concretely for 0.2.0:
1. **D — optional server packages refactor**: `@luckystack/server` currently hard-imports `login`/`presence`/`sync` as `dependencies` AND statically across `httpHandler`/`loadSocket`/auth routes/`csrfMiddleware` (CSRF reads `getSession` from login). Real opt-out = move them to optional peers + lazy/conditional wiring + a **double-submit-cookie CSRF fallback** when login is absent. Full design already written: **`docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md`**. Own branch **`refactor/optional-server-packages`**, needs a **security review**.
2. **Per-package selection in the installer**: let the user select EACH `@luckystack` package individually, each with a description + "you can also install it later" info.

**User's chosen approach for D: PLAN FIRST.** At the start of the 0.2.0 work, re-read `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md` and produce a concrete step-by-step plan + security-review checklist for approval BEFORE writing code. (Also captured in memory: `project_luckystack_0_1_4_deferred.md`.)

## 0.1.4 manual-test checklist (after publish)

1. **Installer UX**: arrow-keys ↑/↓, Enter, Space (OAuth multi-select), ← back; answered steps collapse to `✔`.
2. **CORS**: Vite frontend at `localhost:5173` loads, no `cors: origin not allowed`.
3. **OAuth buttons**: scaffold with google+github → fill `DEV_*_CLIENT_ID/SECRET` → buttons appear; `GET /auth/providers` returns the list.
4. **AI instructions**: Yes → CLAUDE.md/docs/luckystack/skills/.claude/commands/branch-logs/README + `.githooks/pre-commit` + `prepare` script; No → clean project.
5. **Scaffold pre-activation**: pick monitoring=sentry + email=resend → `package.json` has `@sentry/node`+`@luckystack/email`+`resend`; chosen keys uncommented in `.env.local`, others commented.
6. **Enable-later**: Console email → mail in terminal; Sentry/PostHog/Datadog per the `.env.local` comments.
7. **Template rules**: empty `src/admin/page.tsx` → dashboard template; `src/about/page.tsx` → plain.
8. **Regression**: `npm run server` starts clean (no validator/`process` errors); `src/admin` page uses sidebar layout; `npm run build` passes.
