# docs-coverage — Verified & Merged Audit Findings
Sources: reports/docs-coverage.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
22 findings merged across the two scans. **20 CONFIRMED, 1 PARTIALLY-FIXED, 1 REFUTED, 0 ALREADY-FIXED.** This area is almost entirely about doc/code agreement, and commit 302cbf1 ("fixed bugs on login page and wizard/cli flow") touched code, not the cross-cutting reference docs — so essentially nothing the scans flagged has been fixed. The `reports/` scan (which had a verification pass) was accurate and holds up against current code; the `review/v0.2.0/*` scan overlaps it on a handful of per-package CLAUDE.md items (QUA-006, QUA-027, QUA-064, MIS-027) and those are all still live too. The biggest live issue remains **H1 — the `registerSessionProvider` session-provider registry (the central 0.2.0 decoupling seam) is documented nowhere consumer-facing**, compounded by **D2/D8** (api/sync CLAUDE.md + ARCHITECTURE_SESSION.md still claim a hard `@luckystack/login` runtime coupling that no longer exists) and **M1/D5** (ARCHITECTURE_API.md's sync pipeline + hook tables describe hooks that never fire — one with authorization implications). The only thing the older `review/` scan got slightly stale on: D9's create-app flag drift is now *partially* fixed (the per-package CLAUDE.md added `--no-presence`/`--ai-browser` since the scan, though `--i18n`/`--ai-docs` are still undocumented).

## Findings

### M1 — ARCHITECTURE_API.md sync pipeline row documents hooks that never fire (authz-gap risk) · severity: med · status: CONFIRMED
- **Sources:** reports(M1)
- **Current location:** `docs/ARCHITECTURE_API.md:407` (sync pipeline row); handler `packages/sync/src/handleSyncRequest.ts:357,384,393,528`
- **Original claim:** The doc's "Sync request" pipeline lists `auth → rate-limit → preApiValidate → validate → postApiValidate → preApiExecute → _server → postApiExecute → preSyncFanout → fanout → postSyncFanout` and says the order is "fixed and identical for the socket and HTTP transports". The sync handler never dispatches `preApiValidate`/`postApiValidate`/`preApiExecute`/`postApiExecute`.
- **Verification (current code):** `ARCHITECTURE_API.md:403` still reads "The hook dispatch order is fixed and identical for the socket and HTTP transports"; line 407 still lists the `preApiValidate … postApiExecute` chain for sync. Grep of `handleSyncRequest.ts` shows the real dispatch sequence is `preSyncAuthorize` (357) → `postSyncAuthorize` (384) → `applySyncRateLimits` (393) → `_server` → `preSyncFanout` (528) → `postSyncFanout` (606). None of the four api-pipeline hooks the doc names are dispatched on the sync path.
- **Verdict & why:** CONFIRMED. A consumer registering `preApiExecute` to enforce an extra authorization predicate (the doc's stated use of stop hooks) believes sync routes are covered — they are not. Doc-induced authz gap, not a code bug. Medium is the right severity.
- **Recommendation:** Rewrite the sync row to match `handleSyncRequest.ts` (`auth → preSyncAuthorize → postSyncAuthorize → rate-limit → validate → _server → preSyncFanout → fanout → postSyncFanout`) and delete the "identical for both transports" claim for sync (see L1).

### L1 — `postSyncAuthorize` fires on socket transport but not HTTP fallback; asymmetry undocumented · severity: low · status: CONFIRMED
- **Sources:** reports(L1)
- **Current location:** `packages/sync/src/handleSyncRequest.ts:384` (dispatches) vs `packages/sync/src/handleHttpSyncRequest.ts:313` (dispatches `preSyncAuthorize` only, no `postSyncAuthorize`)
- **Original claim:** `postSyncAuthorize` is dispatched on the socket path but not the HTTP path; audit/metrics subscribers silently miss HTTP syncs and the hook appears in no consumer doc.
- **Verification (current code):** `handleSyncRequest.ts:380-384` dispatches `postSyncAuthorize` (comment: "Observational mirror of preSyncAuthorize"). `handleHttpSyncRequest.ts` grep returns only `preSyncAuthorize` (line 313) — no `postSyncAuthorize` dispatch. The hook is absent from `docs/ARCHITECTURE_EXTENSION_POINTS.md` (grep for `postSyncAuthorize` = 0 hits) and from `ARCHITECTURE_API.md`'s hook table.
- **Verdict & why:** CONFIRMED. Real transport asymmetry plus a documentation gap. Low severity is correct (observational hook).
- **Recommendation:** Dispatch `postSyncAuthorize` on the HTTP path too, or document the asymmetry and add the hook to the hook tables.

### H1 — `registerSessionProvider` (the 0.2.0 session-decoupling seam) is documented nowhere consumer-facing · severity: high · status: CONFIRMED
- **Sources:** reports(H1)
- **Current location:** `packages/core/src/index.ts:221-230` (exports); `packages/core/CLAUDE.md` (no row); `docs/ARCHITECTURE_EXTENSION_POINTS.md` (no entry); `docs/ARCHITECTURE_SESSION.md:5` (stale)
- **Original claim:** core exports `registerSessionProvider`, `getRegisteredSessionProvider`, `readSession`, `writeSession`, `removeSession`, `performLogout`, etc.; api/sync resolve sessions exclusively through this registry; login registers itself into it — yet none of it appears in `packages/core/CLAUDE.md`, EXTENSION_POINTS, or ARCHITECTURE_SESSION.md.
- **Verification (current code):** `packages/core/src/index.ts:221-230` exports the full set from `./sessionProviderRegistry`. `packages/api/src/handleApiRequest.ts:4` `import { readSession, performLogout } from '@luckystack/core'`; `packages/sync/src/handleSyncRequest.ts:5` `import { readSession } from "@luckystack/core"`. Grep of `packages/core/CLAUDE.md` for `registerSessionProvider`/`readSession`/`SessionProvider` = 0 hits. Same grep on `docs/ARCHITECTURE_EXTENSION_POINTS.md` = 0 hits. `ARCHITECTURE_SESSION.md:5` still says "sessions are managed by `@luckystack/login` … Import session helpers from the package".
- **Verdict & why:** CONFIRMED, and the most important live issue in this area. A fresh AI cannot learn how api/sync resolve sessions without login installed, nor that a custom auth system plugs in here. The EXTENSION_POINTS doc claims (line 3) to list "every registry, adapter slot, and hook" — the single most important new 0.2.0 seam is the one it omits.
- **Recommendation:** Add a `registerSessionProvider` row to `packages/core/CLAUDE.md` Function Index, a session-provider section to `ARCHITECTURE_EXTENSION_POINTS.md`, and rewrite `ARCHITECTURE_SESSION.md:5` to describe core's `readSession`-through-registered-provider model (login optional).

### H2 — Login email-change/password pre-hooks typed + dispatched but absent from both cross-cutting hook docs · severity: med · status: CONFIRMED
- **Sources:** reports(H2)
- **Current location:** `packages/login/src/hookPayloads.ts:162-168`; `docs/ARCHITECTURE_EXTENSION_POINTS.md:77`; `docs/ARCHITECTURE_API.md` feature-package hook table
- **Original claim:** `prePasswordResetCompleted`, `prePasswordChanged`, `preEmailChange`, `postEmailChangeRequested`, `postEmailChanged` are registered in `HookPayloads` and dispatched from shipped auth pages, but the cross-cutting hook references list only the older set ending at `passwordChanged`.
- **Verification (current code):** `hookPayloads.ts:162-168` registers all five. `ARCHITECTURE_EXTENSION_POINTS.md:77` login-hooks list still ends at `passwordChanged` (grep for `preEmailChange`/`postEmailChanged` in EXTENSION_POINTS = 0 hits). Only `packages/login/CLAUDE.md` covers them.
- **Verdict & why:** CONFIRMED. Real typed/dispatched extension points invisible in the two reference docs an AI consults first.
- **Recommendation:** Add the five email-change/password hooks to `ARCHITECTURE_EXTENSION_POINTS.md` login-hooks list and to `ARCHITECTURE_API.md`'s feature-package hook table.

### H3 — Several core barrel exports missing from `packages/core/CLAUDE.md` Function Index · severity: med · status: CONFIRMED
- **Sources:** reports(H3)
- **Current location:** `packages/core/src/index.ts` (exports at 3, 4, 6, 8, 9, 15-19, 140, 218, 258-266); `packages/core/CLAUDE.md` (no rows)
- **Original claim:** `tryCatchSync`, `deepMerge`/`isPlainObject`, `createRegistry`, `escapeHtml`, `ensurePeerDepInstalled`/`loadPeer`, the error-formatter registry, `registerStrayPrefixCommand`, the sync-abort cancel registry, `resolveClientIp`/`UNKNOWN_CLIENT_IP`, and the session-provider registry are all exported but undocumented in core's CLAUDE.md.
- **Verification (current code):** Confirmed exported (e.g. `index.ts:3 tryCatchSync`, `:4 deepMerge/isPlainObject`, `:6 createRegistry`, `:8 escapeHtml`, `:16 registerErrorFormatter`, `:218 resolveClientIp/UNKNOWN_CLIENT_IP`, `:259 registerSyncAbortController`). Grep of `packages/core/CLAUDE.md` for any of these symbols = 0 hits.
- **Verdict & why:** CONFIRMED. The per-package CLAUDE.md is the index a fresh AI is told to rely on (Rule 12); these extension surfaces are invisible there.
- **Recommendation:** Add Function Index rows for the missing exports; note which symbols live only on the `/client` subpath (`registerMiddlewareHandler`/`registerPageMiddleware`).

### H4 / QUA-064 — devkit consumer-override docs reference symbols not exported from the barrel + wrong chokidar version · severity: med · status: CONFIRMED
- **Sources:** reports(H4) + review(QUA-064)
- **Current location:** `docs/ARCHITECTURE_EXTENSION_POINTS.md:232,234`; `packages/devkit/CLAUDE.md:57-59,103`; barrel `packages/devkit/src/index.ts`
- **Original claim:** `extractValidation(filePath)` and `assertNoDuplicatePageRoutes`/`collectDuplicatePageRoutes`/`formatDuplicatePageRouteIssues` are documented as devkit consumer symbols but are not in the barrel; devkit CLAUDE.md also cites `chokidar@^4.0.3` (actual `^5.0.0`).
- **Verification (current code):** Grep of `packages/devkit/src/index.ts` shows `registerTemplateKind` (38) and `registerTemplateRule` (37) ARE exported, but `assertNoDuplicatePageRoutes`/`extractValidation`/`collectDuplicatePageRoutes` are NOT. `EXTENSION_POINTS.md:232,234` still document `extractValidation` and `assertNoDuplicatePageRoutes` as importable. `packages/devkit/package.json` declares `chokidar ^5.0.0`; CLAUDE.md still says `^4.0.3`.
- **Verdict & why:** CONFIRMED (both scans agree). An AI following devkit's own contract file gets import errors. The two scans cover slightly different symbol sets — union them.
- **Recommendation:** Either export the duplicate-page-route trio + `extractValidation` (useful for consumer build scripts) or move them to an Internal-modules table in both docs; fix the chokidar line to `^5.0.0`.

### H5 — `asOAuthUserData` documented as a login surface but not exported from the barrel · severity: med · status: CONFIRMED
- **Sources:** reports(H5)
- **Current location:** `packages/login/CLAUDE.md:84`; defined at `packages/login/src/oauthProviders.ts:17`; barrel `packages/login/src/index.ts`
- **Original claim:** `packages/login/CLAUDE.md:84` documents `asOAuthUserData(value)` as a helper for writing custom providers, but it is not re-exported from `@luckystack/login`.
- **Verification (current code):** Grep of `packages/login/src/index.ts` for `asOAuthUserData` = 0 hits (NOT in barrel). It is defined/exported only at module level in `oauthProviders.ts`.
- **Verdict & why:** CONFIRMED. The documented consumer use (custom provider) cannot import it from the package.
- **Recommendation:** Add `asOAuthUserData` to the login barrel re-export block, or remove the consumer-facing claim from `packages/login/CLAUDE.md:84`.

### D1 — `docs/PACKAGE_OVERVIEW.md` omits `@luckystack/cli` entirely · severity: med · status: CONFIRMED
- **Sources:** reports(D1)
- **Current location:** `docs/PACKAGE_OVERVIEW.md` (no `@luckystack/cli` row); `packages/cli/package.json` (`"name": "@luckystack/cli"`, `"private": false`)
- **Original claim:** cli is a 15th publishable package that LUCKYSTACK_ADD_GUIDE.md depends on (`npx luckystack add`), but it is absent from PACKAGE_OVERVIEW — the canonical pre-install lookup table — and the "I want to…" cheatsheet.
- **Verification (current code):** Grep of `docs/PACKAGE_OVERVIEW.md` for `@luckystack/cli` = 0 hits. Root `CLAUDE.md:30` says "publishes as 15 `@luckystack/*` packages", which is only correct WITH cli.
- **Verdict & why:** CONFIRMED. The designated pre-install lookup cannot surface cli, so an AI can't discover the `luckystack add` entry point.
- **Recommendation:** Add a `@luckystack/cli` row to PACKAGE_OVERVIEW (use-case + peer-deps) and a cheatsheet line ("add login pages / a feature later").

### D2 — api/sync CLAUDE.md claim `@luckystack/login` is a required runtime dep (removed in 0.2.0) · severity: med · status: CONFIRMED
- **Sources:** reports(D2)
- **Current location:** `packages/api/CLAUDE.md:51,79,105`; `packages/sync/CLAUDE.md:88`; package.json files
- **Original claim:** Both CLAUDE.md files list `@luckystack/login` as a required runtime dep and name `getSession` as the session source, but the 0.2.0 decoupling removed that — both use core's `readSession`.
- **Verification (current code):** `packages/api/CLAUDE.md:79` "Required (runtime deps): `@luckystack/core`, `@luckystack/login`, `@luckystack/error-tracking`"; `:51` "`getSession(token)`"; `:105` "Session source: `@luckystack/login`". `packages/sync/CLAUDE.md:88` "Required: …`@luckystack/login`…". But `packages/api/package.json` deps = `core` + `error-tracking` only; same for sync; both import `readSession` from `@luckystack/core` (handleApiRequest.ts:4, handleSyncRequest.ts:5) — no `@luckystack/login` import anywhere in either `src/`.
- **Verdict & why:** CONFIRMED. Directly contradicts the 0.2.0 "packages are independent" goal a fresh AI would advise on.
- **Recommendation:** Rewrite the api/sync CLAUDE.md dependency + session-source sections to reference core's `readSession`/session-provider registry; login becomes the default *provider*, not a hard dep.

### D3 — `docs/DEVELOPER_GUIDE.md` references files/dirs that don't exist · severity: low · status: CONFIRMED
- **Sources:** reports(D3)
- **Current location:** `docs/DEVELOPER_GUIDE.md:247,253,257`; `server/config/` and `functions/`
- **Original claim:** The guide cites `server/config/runtimeConfig.ts`, `server/functions/*.ts`, and `server/sockets/` — none of which exist; the injected shims live in root `functions/`.
- **Verification (current code):** `DEVELOPER_GUIDE.md:257` "centralized in `server/config/runtimeConfig.ts`" — `server/config/` contains only `presetLoader.ts`. `:247`/`:253` reference `server/functions/*.ts` — `functions/` (db.ts, redis.ts, sentry.ts, session.ts) lives at repo root, not under `server/`.
- **Verdict & why:** CONFIRMED. Copy-following the guide's paths fails.
- **Recommendation:** Update the guide to the real `server/` subtree (auth, bootstrap, config, dev, hooks, prod, utils) and the root `functions/` shim location.

### D4 — `docs/ARCHITECTURE_EXTENSION_POINTS.md` has multiple stale/wrong entries · severity: med · status: CONFIRMED
- **Sources:** reports(D4)
- **Current location:** `docs/ARCHITECTURE_EXTENSION_POINTS.md:22,46,232,265,514`
- **Original claim:** (a) `:514` `import { logger } from '@luckystack/core'` — no `logger` value exported. (b) `:22` `registerAvatarConfig` "uploads dir + max size" — actual shape `{ formats, cacheControl }`. (c) `:265` says new template kinds are "a future extension" — contradicted by shipped `registerTemplateKind`/`registerTemplateRule`. (d) hook table omits `postSyncAuthorize`. (e) secret-manager section omits `reloadSecretManagerFromFiles()`.
- **Verification (current code):** (a) `:514` still `import { logger }`; core exports `getLogger`/`registerLogger`/`createDevLogger` (index.ts:175-179), no `logger` value — snippet won't compile. (b) `:22` still "uploads dir + max size"; `avatarConfig.ts:8-25` is `{ formats, cacheControl }`. (c) `:265` still "that's a future extension"; `registerTemplateKind`/`registerTemplateRule` are exported (devkit index.ts:37-38). (d) hook table has `preSyncAuthorize` (:46) but no `postSyncAuthorize`. (e) `reloadSecretManagerFromFiles` exported (secret-manager index.ts:379); grep in EXTENSION_POINTS = 0 hits.
- **Verdict & why:** CONFIRMED on all five sub-items.
- **Recommendation:** Fix the `logger` import to `getLogger`, correct the `AvatarConfig` description, replace the "future extension" template-kind paragraph with the shipped `registerTemplateKind`/`registerTemplateRule` mechanism, add `postSyncAuthorize` to the hook table, and add `reloadSecretManagerFromFiles` to the secret-manager section.

### D5 — `docs/ARCHITECTURE_API.md` hook reference incomplete/wrong beyond M1 · severity: med · status: CONFIRMED
- **Sources:** reports(D5)
- **Current location:** `docs/ARCHITECTURE_API.md:446` (preSyncFanout row) + hook table `:437-451`; `packages/sync/src/handleSyncRequest.ts:488,528`
- **Original claim:** `:446` "`preSyncFanout` | Before `_server_v{n}.ts` runs" is wrong (dispatched after `_server`); the table omits `transformApiResponse`, `preSyncAuthorize`/`postSyncAuthorize`, and `preSyncStream`/`postSyncStream`.
- **Verification (current code):** `ARCHITECTURE_API.md:446` still reads "Before `_server_v{n}.ts` runs". In `handleSyncRequest.ts`, `serverOutput = serverSyncResult` at line 488 and `preSyncFanout` dispatches at line 528 — i.e. AFTER `_server`. `packages/sync/CLAUDE.md:62` correctly says "After `_server` runs", so the two docs contradict each other. The hook table (437-451) lists no `preSyncAuthorize`/`postSyncAuthorize`/`transformApiResponse`/`preSyncStream`/`postSyncStream` rows.
- **Verdict & why:** CONFIRMED. Three docs disagree on `preSyncFanout` timing; the doc-stated order is the wrong one.
- **Recommendation:** Fix the `preSyncFanout` row to "After `_server` runs, before fanout" and add the missing hook rows.

### D6 — `docs/PACKAGE_OVERVIEW.md` peer-dependency table drifted from real package.json · severity: med · status: CONFIRMED
- **Sources:** reports(D6)
- **Current location:** `docs/PACKAGE_OVERVIEW.md:11,26,44,46,47`; corresponding package.json files
- **Original claim:** devkit row says `typescript@^6.0.0` + optional `tsx`; presence/test-runner omit optional `@luckystack/login`; docs-ui row says "none" optional peer; server row omits optional `login, presence, sync`; mcp tool list omits `who_calls`.
- **Verification (current code):** devkit `package.json` peer is `typescript >=5.7.3 <7.0.0` (not `^6.0.0`) and declares no `tsx` peer; PACKAGE_OVERVIEW:44 still says `typescript@^6.0.0` + optional `tsx`. presence `peerDependenciesMeta` has optional `@luckystack/login` — omitted at :26. test-runner has optional `@luckystack/login` — omitted at :45. docs-ui `peerDependenciesMeta` has optional `@luckystack/server` — PACKAGE_OVERVIEW:46 says "none". server `peerDependenciesMeta` declares optional `login, presence, sync` (plus devkit/docs-ui/email/error-tracking) — :11 lists only the latter four. mcp registers `who_calls` (mcp index.ts:96, 9 tools total) — :47 lists 8 tools, no `who_calls`.
- **Verdict & why:** CONFIRMED on every sub-row.
- **Recommendation:** Reconcile each row against the real `peerDependencies`/`peerDependenciesMeta`; add `who_calls` to the mcp tool list (also missing from `packages/mcp/CLAUDE.md`).

### D7 — Root `CLAUDE.md:30` Project Snapshot version claims are stale · severity: low · status: CONFIRMED
- **Sources:** reports(D7)
- **Current location:** root `CLAUDE.md:30`; root `package.json`
- **Original claim:** Snapshot says "Prisma 6.5 … TypeScript 5.7"; actual `@prisma/client ^6.19.3`, `prisma ^6.19.3`, `typescript ^6.0.0`.
- **Verification (current code):** root `package.json` confirms `@prisma/client ^6.19.3`, `prisma ^6.19.3`, `typescript ^6.0.0`. `CLAUDE.md:30` still reads "Prisma 6.5 … TypeScript 5.7".
- **Verdict & why:** CONFIRMED. An AI choosing version-sensitive APIs from the snapshot is a TS major off.
- **Recommendation:** Update the snapshot to Prisma 6.19 / TypeScript 6.

### D8 — `docs/ARCHITECTURE_SESSION.md` predates the session-provider split (companion to H1) · severity: med · status: CONFIRMED
- **Sources:** reports(D8)
- **Current location:** `docs/ARCHITECTURE_SESSION.md:5` (and the :233 flow table)
- **Original claim:** The doc says sessions are managed by `@luckystack/login` and api/sync resolve via `getSession`; the runtime truth is core's `readSession` through the registered provider, with login optional. No answer for `auth: { login: true }` routes when login is absent.
- **Verification (current code):** `ARCHITECTURE_SESSION.md:5` still reads "sessions are managed by `@luckystack/login` … Import session helpers from the package". api/sync use core's `readSession` (verified under H1/D2). The doc gives no account of the login-not-installed state that `packages/server/CLAUDE.md` ("auth.disabled") implies is supported.
- **Verdict & why:** CONFIRMED. Same root cause as H1, different doc.
- **Recommendation:** Rewrite to the registry model and add a "what happens when login is not installed" subsection.

### D9 — Minor link/flag drift across several CLAUDE.md files · severity: low · status: PARTIALLY-FIXED
- **Sources:** reports(D9)
- **Current location:** `packages/login/CLAUDE.md:188`; `packages/create-luckystack-app/CLAUDE.md:31`; `packages/test-runner/CLAUDE.md:88,91`; (devkit chokidar item is now folded into H4/QUA-064)
- **Original claim:** (a) login CLAUDE.md:188 links a non-existent `/.claude/CLAUDE.md`. (b) create-app CLAUDE.md `VALID_FLAGS` list omits `--i18n/--no-i18n` and `--ai-docs/--no-ai-docs`. (c) test-runner CLAUDE.md cites `core@^0.1.0` (actual `^0.2.0`) and "Optional: geen" (actual optional `@luckystack/login@^0.2.0`).
- **Verification (current code):** (a) `login/CLAUDE.md:188` still `[/.claude/CLAUDE.md](../../.claude/CLAUDE.md)`; `ls .claude/CLAUDE.md` → does not exist. STILL LIVE. (b) `create-app/CLAUDE.md:31` now lists `--no-install, --no-prompt, --no-presence, --ai-browser=…, --help/-h` — `--no-presence` and `--ai-browser` have been ADDED since the scan, but `--i18n/--no-i18n` and `--ai-docs/--no-ai-docs` (present in `src/index.ts:68`) are STILL omitted. PARTIALLY FIXED. (c) `test-runner/CLAUDE.md:88` still `@luckystack/core@^0.1.0` (actual dependency `^0.2.0`, package.json:56); `:91` still "Optional: geen" (actual optional `@luckystack/login@^0.2.0`). STILL LIVE.
- **Verdict & why:** PARTIALLY-FIXED. The create-app flag list improved since the older scan but is still incomplete; the login link and the test-runner version/optional-peer claims are fully live.
- **Recommendation:** Fix the login link to `/CLAUDE.md`; add `--i18n/--no-i18n` and `--ai-docs/--no-ai-docs` to create-app's CLAUDE.md flag list; bump test-runner CLAUDE.md to `core@^0.2.0` and add optional peer `@luckystack/login@^0.2.0`.

### QUA-006 — Consumer-shipped framework-docs CLAUDE.md is a verbatim repo copy (wrong scripts + nonexistent components) · severity: high · status: CONFIRMED
- **Sources:** review(QUA-006)
- **Current location:** `packages/create-luckystack-app/framework-docs/CLAUDE.md:54,148,150`; `packages/create-luckystack-app/template/package.json`; `template/src/_components/`
- **Original claim:** `bundleFrameworkDocs.mjs` copies the repo-root CLAUDE.md byte-for-byte into every scaffold's root; that file mandates `npm run ai:index` (absent from the template) and a Component Reference table pointing at `Navbar`/`Middleware` components the template doesn't have.
- **Verification (current code):** `framework-docs/CLAUDE.md:54` autonomous-commands list includes `npm run ai:index`; `:62`/`:66` claim the pre-commit hook regenerates `ai:index`. But `template/package.json` scripts have `ai:capabilities`, `ai:project-index`, `ai:decisions`, `ai:lint` — NO `ai:index`. `framework-docs/CLAUDE.md:148,150` list `Navbar (./Navbar.tsx)` and `Middleware (./Middleware.tsx)`; `template/src/_components/` contains only `Avatar.tsx, ConfirmMenu.tsx, ErrorPage.tsx, LoginForm.tsx, MenuHandler.tsx` + `dropdown/ inputs/ templates/` subfolders — no `Navbar.tsx` or `Middleware.tsx`, and `Dropdown`/`TemplateProvider` live under subfolders the table doesn't reflect.
- **Verdict & why:** CONFIRMED, high. For a framework whose north star is AI-driven consumers, the primary AI contract file is materially wrong on the consumer's first session.
- **Recommendation:** Maintain a consumer-adapted CLAUDE.md (transform during `bundleFrameworkDocs.mjs`): strip/remap framework-only commands and regenerate the Component Reference table from the template tree; add a build-time assertion that every `./X.tsx` in the table exists under `template/src/_components`.

### QUA-027 — `docs/cli-flags.md` (create-app) stale: missing flags + claims no `--flag=value` support · severity: med · status: CONFIRMED
- **Sources:** review(QUA-027)
- **Current location:** `packages/create-luckystack-app/docs/cli-flags.md:11,25,52,66`; `packages/create-luckystack-app/src/index.ts:61-69`
- **Original claim:** The deep-dive flag doc documents only `--no-install/--no-prompt/--help/-h`, states "no support for --flag=value", and pastes an old 4-entry `VALID_FLAGS`. Actual flags include the value flag `--ai-browser=<…>` and `--no-presence`.
- **Verification (current code):** `cli-flags.md:11` "There is no support for `--flag=value` syntax"; `:25` `const VALID_FLAGS = ['--no-install', '--no-prompt', '--help', '-h']`; `:52` "`--no-install=true` is therefore an unknown flag"; `:66` error example lists only the 4 flags. Actual `src/index.ts:61-69` `VALID_FLAGS` includes `--no-presence`, `--i18n`, `--no-i18n`, `--ai-docs`, `--no-ai-docs`, and `--ai-browser=<all|agent-browser|none>` (a genuine value flag).
- **Verdict & why:** CONFIRMED. The authoritative flag reference is materially wrong, including the blanket "no value flags" statement that `--ai-browser=` violates.
- **Recommendation:** Rewrite cli-flags.md to the current `VALID_FLAGS`, document `--ai-browser=<value>` as a value flag, and remove the "no --flag=value" claim; sync the CLAUDE.md `CliArgs` row.

### MIS-027 — sync package CLAUDE.md hook table omits 3 of 7 dispatched hooks · severity: low · status: CONFIRMED
- **Sources:** review(MIS-027)
- **Current location:** `packages/sync/CLAUDE.md:57-64`; `packages/sync/src/handleSyncRequest.ts:384`, `packages/sync/src/_shared/streamEmitters.ts:24-26`
- **Original claim:** The "Hooks dispatched by the server handler" table lists only `preSyncAuthorize`, `preSyncFanout`, `postSyncFanout`, `rateLimitExceeded`; it omits `postSyncAuthorize`, `preSyncStream`, `postSyncStream`.
- **Verification (current code):** `sync/CLAUDE.md:61-64` lists exactly those 4 hooks. The handler dispatches `postSyncAuthorize` (handleSyncRequest.ts:384), and `streamEmitters.ts:24-26` dispatches `preSyncStream`/`postSyncStream` (per reports L1/D5 these are real). 3 of 7 are undocumented.
- **Verdict & why:** CONFIRMED. The per-package INDEX an AI reads first hides three real extension points. (Overlaps reports D5/L1 on the same missing hooks, but this is the sync-CLAUDE.md surface specifically.)
- **Recommendation:** Add `postSyncAuthorize`, `preSyncStream`, `postSyncStream` rows to `packages/sync/CLAUDE.md` and mirror in `docs/server-vs-client-handlers.md` / streaming docs.

### CAL-1 — Spot-checks that are accurate (calibration, REFUTED-as-defect) · severity: low · status: REFUTED
- **Sources:** reports(verified-accurate spot checks)
- **Current location:** `packages/cli/CLAUDE.md`, `packages/server/CLAUDE.md`, `packages/presence/CLAUDE.md`, `packages/secret-manager/CLAUDE.md`, `docs/LUCKYSTACK_ADD_GUIDE.md`
- **Original claim:** reports/ explicitly calls these out as doc/code-accurate (cli flags/commands, server `OPTIONAL_PACKAGES`, presence, secret-manager, add-guide matrix, `registerTestLayer/Fixture/Reporter`, `mountDocsUi`).
- **Verification (current code):** Not a defect — recorded as REFUTED-as-defect (i.e. confirmed NOT broken) to keep coverage honest. Spot-confirmed `registerTemplateKind`/`registerTemplateRule` exist (devkit index.ts:37-38) and server `peerDependenciesMeta` matches its CLAUDE.md OPTIONAL_PACKAGES intent.
- **Verdict & why:** REFUTED as a finding — these surfaces agree with code; they are the calibration baseline showing the per-package CLAUDE.md layer is mostly strong and the drift is concentrated in the cross-cutting reference docs.
- **Recommendation:** None.
