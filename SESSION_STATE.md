# SESSION_STATE

> Branch: `chore/package-split-prep` · Base: `master`
> **Pick up here: everything below is committed but NOT published. The one blocker is the npm 2FA wall — publishing 0.1.5 turns all of this from "fixed in repo" into "fixed for the user".**

## Session summary

Iterative runtime-testing of `npx create-luckystack-app` against a real scaffold surfaced a series of bugs; all fixed and folded into the still-unpublished **0.1.5**. Started the session believing 0.1.4 needed publishing — discovered all 14 packages were **already live at 0.1.4** on npm (published 2026-06-05 13:35 UTC; SESSION_STATE's "nothing published" note was stale).

Commits this session (oldest → newest):
- `26f6793` — **AI-docs bundling + Windows OAuth toggle.** "Include AI docs" silently no-op'd because the copy block read from the monorepo root (absent in a published install). Now bundled into the package as `framework-docs/` at build time (new `packages/create-luckystack-app/scripts/bundleFrameworkDocs.mjs`, wired into `build`, added to `files`, gitignored). Space-toggle now accepts the raw `' '` string for Windows consoles. New reusable `scripts/setPackageVersions.mjs` bumped all 14 to 0.1.5.
- `01adcce` — **4 fresh-scaffold bugs:** (1a) LoginForm treated the 403 CSRF body `{status:'error'}` (truthy string) as success → now `status === true` only (`template/src/_components/LoginForm.tsx`); (1b) OAuth landed on backend port → DNS default + new root `template/src/page.tsx`; (2) dashboard white-on-white → `:root` uses theme tokens (`template/src/index.css`); (3) OAuth logos 404'd → shipped `template/public/*.png`.
- `5e2eb97` — **Installer "Next" row.** Multi-select now: Space/Enter toggles the highlighted provider, a trailing non-selectable "Next" row confirms (`packages/create-luckystack-app/src/index.ts` `runWizard`).
- `c12b6fc` — **CSRF exempt on credentials bootstrap** (`packages/server/src/httpRoutes/csrfMiddleware.ts:~30`). User chose "allow re-login while signed in". `POST /auth/api/credentials` no longer CSRF-blocked (safe: session cookie is `SameSite=Strict`). Removed the login/register page guards added in `5182675` (they blocked re-login).
- `85813f5` — **Removed `DNS`, split backend vs public origin** (user-driven architecture fix). `template/config.ts` now derives `backendOrigin = http://localhost:${SERVER_PORT}` (for OAuth `redirect_uri`) and `publicUrl` (dev `:5173`, prod `PUBLIC_URL`; for landing/email/CORS). `template/luckystack/login/oauthProviders.ts` uses `oauthCallbackBase`; `packages/server/src/httpRoutes/authCallbackRoute.ts` redirects to `app.publicUrl`; `packages/core/src/env.ts` dropped `DNS`.
- `dfc3593` — **Docs sweep** for the DNS removal (login README/docs, CLAUDE.md DNS rows, `docs/ARCHITECTURE_AUTH.md`, `docs/HOSTING.md` → `PUBLIC_URL`, `packages/server/docs/http-routes.md`, root `README.md`).

Decisions made (via AskUserQuestion):
- Multi-select confirm UX = dedicated "Next" row (Claude-CLI style).
- CSRF on re-login = exempt the bootstrap endpoint (not page guards).
- Public-origin home after removing DNS = `config.ts` `app.publicUrl`.

## Current state

- **Working tree:** clean except `.claude/settings.local.json` (intentionally uncommitted). All session work committed.
- **All 14 packages on npm @ 0.1.4** (live since 2026-06-05). **0.1.5 is fully prepared in the repo but UNPUBLISHED.**
- **Verified green:** `npm run build:packages` 14/14 · `npm run test:unit` 757/757 · `.smoke-test/run.mjs` GREEN (typecheck 0 / build / lint 0) · runtime OAuth-origin derivation check (dev callback `http://localhost:80/auth/callback/google`, landing `:5173`; prod both = `PUBLIC_URL`).
- **The user's current TEST project predates these fixes** — it still shows csrfMismatch (when signed in) and the old OAuth redirect model, because 0.1.5 isn't on npm.
- **Known gap (reported, not fixed):** `microsoft.png` does not exist anywhere in the repo, so a Microsoft OAuth button would still 404.
- **Left intentionally as-is:** the framework's OWN reference app (`config.ts` multi-instance `dnsEnvironmentMap`, `luckystack/login/oauthProviders.ts`) still reads `DNS` (works — core env is `loose()`); separate projects (`ui-builder/`, `src/workspaces/` prototype, `handoff/`, `sparring/`).

## Next steps

1. **Publish 0.1.5** (blocked on npm 2FA — see User action). After auth is fixed, run `npm run publish:packages` (builds + publishes all 14 in dependency order). Nothing partially published, so the run is clean.
2. **After publish:** user upgrades their test project (`npm update @luckystack/*` or re-scaffold via `npx create-luckystack-app@0.1.5`) and re-tests the full flow.
3. **Re-test checklist on the upgraded project:** installer "Next" row; CSRF — re-login/register while signed in (no more csrfMismatch); OAuth — register `http://localhost:80/auth/callback/google` in Google (the backend origin), confirm landing on `:5173/dashboard`; dashboard text readable; OAuth logos load; "include AI docs" copies CLAUDE.md/docs/skills/.claude/commands.
4. **Optional follow-ups:** add a `microsoft.png` to repo `public/` if Microsoft OAuth is wanted; consider making `@luckystack/server`'s `authCallbackRoute` honor `loginRedirectUrl` after OAuth (currently lands on the public-origin root, papered over by the new root `/` page).
5. **Then 0.2.0 (Point D):** optional server packages refactor per `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md` — user wants PLAN FIRST.

## User action required

- **Clear the npm 2FA wall to publish 0.1.5.** On npmjs.com set Two-Factor Auth to **"Authorization only"** (Account → Two-Factor Authentication), then tell the assistant to run `npm run publish:packages`. (Fallback: `npm config set auth-type legacy` then publish, entering the OTP in the terminal.)
- **For OAuth in the CURRENT (pre-0.1.5) project**, the only working option is the old workaround: set `DNS=http://localhost:5173` and register `http://localhost:5173/auth/callback/google` in Google. The clean `:80` backend-origin model only exists after upgrading to 0.1.5.
- **To test login/register in the current project now:** log out / clear the session cookie first (csrfMismatch only fires when already signed in).
