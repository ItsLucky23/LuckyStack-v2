# SESSION_STATE

> Branch: `chore/package-split-prep` · Base: `master`
> **Pick up here: publish `@luckystack/* 0.1.3` (fixes a fresh-install-broken 0.1.2), runtime-test, commit+tag — then keep working through the remaining build-output problems.**

## Session summary

Continued the publish cycle on a new device. A real fresh `npx create-luckystack-app` install surfaced more bugs the compile/lint smoke gate misses (all RUNTIME). User triaged 8 issues; **7 fixed → 0.1.3**, the 8th (package opt-out) scoped out as a separate refactor with a design doc.

**Fixed this session (all verified: build 14/14 · lint 0/0 · `.smoke-test` GREEN):**
- **#1 validator ESM** — `packages/create-luckystack-app/template/src/reset-password/_api/sendReset_v1.ts:1` used `import { isEmail } from 'validator'` (CJS → named ESM import throws at server start). Now default-import + `validator.isEmail()` (mirrors `settings/_api/requestEmailChange_v1.ts`).
- **#2 `process is not defined`** — `packages/create-luckystack-app/template/config.ts:7` read `process.env` top-level (+ `EXTERNAL_ORIGINS` at line ~54); Vite bundles it to the browser with no `process` shim → client crash. Added browser-safe `env()` guard + `window.location.origin` for client `backendUrl`.
- **#3 MongoDB URL** — `packages/create-luckystack-app/src/index.ts` `DATABASE_URL_BY_PROVIDER.mongodb` now emits `?replicaSet=rs0&directConnection=true` (bare URL fails with Prisma). env.local comment shows the richer auth+rs form.
- **#4 OAuth env DEV+PROD** — new `buildOAuthEnvVars()` in `index.ts` emits uncommented `DEV_*` + unprefixed pairs per SELECTED provider (matches `env(prodKey, devKey)` in `luckystack/login/oauthProviders.ts`). New `{{OAUTH_ENV_VARS}}` placeholder in `_dot_env_dot_local_template`.
- **#5 EXTERNAL_ORIGINS** — new `OAUTH_PROVIDER_ORIGINS` map + `{{EXTERNAL_ORIGINS}}` placeholder in `_dot_env_template`; auto-filled from selected providers (OAuth callback Referer must pass the origin gate).
- **#6 `REDIS_USERNAME` → `REDIS_USER`** — `packages/core/src/redis.ts` (×3), `packages/server/src/createServer.ts:120` errmsg, root `.env_template`, template `_dot_env_dot_local_template`, docs (`packages/core/docs/redis-adapter.md`, `app-bootstrap.md:378`, `CLAUDE.md`).
- **#8 page_dashboard runtime crash** — `packages/create-luckystack-app/template/_dot_luckystack/templates/page_dashboard.template.tsx:14` injected `template = 'dashboard'`, but `TemplateProvider.tsx:20` only knows `'home' | 'plain'` → `Templates['dashboard']` undefined → crash. Aligned injected value to `'home'`.

**Version bump:** all 14 `packages/*/package.json` → **0.1.3** (versions + internal `^0.1.3` refs). Re-ran build+smoke = GREEN.

**Housekeeping:** `docs/AI_QUICK_INDEX.md` regenerated; branch-log entry added (entries → 104) + `branch-logs/INDEX.md` updated.

## Current state

- **0.1.2 is the live `@latest`** and is itself broken on fresh install (#1/#2/#8 are runtime bugs present in 0.1.2 too). Publishing 0.1.3 fixes this.
- **0.1.3 is built + smoke-GREEN locally but NOT published.** `npm run publish:dry` will now validate (it failed earlier only because versions were still 0.1.2).
- **Nothing is committed.** No `v0.1.3` tag.
- **#7 (package opt-out) is NOT implemented** — blocked by `@luckystack/server` hard-depending on login/presence/sync and importing them statically (incl. CSRF↔session↔login coupling). Full design written in `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md` (own branch `refactor/optional-server-packages`, security review, ~0.2.0).
- **`.smoke-test/` gate is compile/lint only** — it did NOT catch #1/#2/#8 (all runtime). Design doc §8 proposes adding a runtime boot smoke.
- Uncommitted parallel work in `src/workspaces/**` (~29 files) is NOT ours — keep it out of any 0.1.3 commit.
- `package-lock.json` + `docs/AI_CAPABILITIES.md` still show 0.1.2 (refresh with `npm install`; not needed for publish).

## Next steps

1. **Publish 0.1.3** (user-driven, see User action). After publish, the broken-on-install 0.1.2 `@latest` is superseded.
2. **Fresh runtime test**: `npx create-luckystack-app@0.1.3 testfix && cd testfix && npm i && npm run server` — confirm server starts WITHOUT the validator error, client loads WITHOUT `process is not defined`, and a page under `src/admin/...` uses the sidebar (`home`) layout without crashing.
3. **Commit everything + tag `v0.1.3`** (exclude `src/workspaces/**`). Optionally `npm deprecate "create-luckystack-app@0.1.2" "broken scaffold on fresh install; use >=0.1.3"`.
4. **Continue triaging the remaining build-output problems** (the user has MORE to tackle next session — gather them from a fresh `npx create-luckystack-app@0.1.3` install + `npm run build`/`npm run server` output). Same pattern: the smoke gate misses runtime issues, so drive from the real install.
5. Later / separate branch: implement `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md` (#7) — make login/presence/sync optional peers + lazy wiring + double-submit-CSRF fallback.

## User action required

- **Publish (only you can — login + OTP):**
  ```
  npm login            # as lucky23m; set 2FA to "Authorization only" to avoid per-package OTP
  npm whoami           # -> lucky23m
  npm run publish:dry  # expect 14/14 validated
  npm run publish:packages
  ```
- **Runtime-test the fresh 0.1.3 install** (step 2 above) — this is the real verification of #1/#2/#8, which the smoke gate cannot catch.
- **Decide** whether to commit+tag `v0.1.3` now or after the runtime test passes.
- For next session: collect the remaining build-output errors from the fresh install so we can triage them.
