# create-app-template — Verified & Merged Audit Findings
Sources: reports/create-app-template.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary

Of the ~30 distinct findings merged across both scans, the security core of the reports/ scan holds up entirely: the two HIGH credential-exposure issues (settings/listSessions returns raw device tokens; system/session returns the full session incl. token) are **CONFIRMED** in current code, and the leftover `console.log(user)` in `session_v1.ts` is still shipped (CONFIRMED). The functional day-one defects also remain live: the Home shell's `/logout` link is still a 404 (no `/logout` page exists), `npm run prod` still references a `dist/server.js` nothing builds, `scaffold:page` still emits `template = 'dashboard'` (a value absent from the `'home' | 'plain'` union → render crash) AND still accepts `..` traversal, the template's non-capturing `tryCatch` still drops error reporting, the shipped CLAUDE.md still documents `ai:index`/`Navbar`/`Middleware`/`'plain' | 'dashboard'` that don't exist in the scaffold, and the Windows `spawnSync('npm.cmd', …, { shell:false })` EINVAL bug is unchanged. The single biggest thing the **older review/ scan got wrong**: CFG-01 (high — "no non-interactive flags, scaffold hard-locked to Mongo+credentials") and QUA-061 ("--ai-browser ignored by the wizard") are now **ALREADY-FIXED** — commit 302cbf1 added a full `--db/--auth/--oauth/--email/--monitoring/--i18n/--ai-docs` flag set that pre-seeds and skips the matching wizard steps, and QUA-005's headline ("wizard answers silently discarded") is now **PARTIALLY-FIXED** because authMode/i18n choices are honored via `editScaffoldFile`/`pruneOptionalPackages` (the named `{{AUTH_MODE}}`/`{{I18N_ENABLED}}` template placeholders remain cosmetically dead). Biggest live issue: the H1/H2 credential exposure (any XSS → multi-device token theft, defeating the HttpOnly default the template otherwise preserves).

## Findings

### H1 — settings/listSessions returns raw session tokens of ALL devices to browser JS · severity: high · status: CONFIRMED
- **Sources:** reports(#H1, adversarial-CONFIRMED) / review(SEC-16) — both
- **Current location:** `packages/create-luckystack-app/template/src/settings/_api/listSessions_v1.ts:32-36`
- **Original claim:** The handler serializes the raw Redis `token` per active session back to the client, handing every device's cookie credential to page JS and converting any XSS into multi-device session hijack.
- **Verification (current code):** Lines 28-37 still `redis.smembers(activeKey)` then return `{ token, expiresInSeconds, isCurrent }` per session, `result: { sessions }`. No hashing/opaque-id. reports/ adversarially confirmed the result reaches the client unsanitized via `responseEnvelope.ts` (`...result` spread) and `settings/page.tsx` stores it. Default mode is `sessionBasedToken: false` (HttpOnly cookie) per `config.ts:51`.
- **Verdict & why:** CONFIRMED. review/ rated this medium-ish/undecided; reports/ rated it High. reports/ is right — in the default cookie mode the token IS the credential, so this is a real HttpOnly-bypass. The two scans agree on the defect; the higher severity is correct.
- **Recommendation:** Return an opaque identifier (e.g. `sha256(token).slice(0,12)`) and have `revokeSession_v1` resolve it server-side by iterating the activeUsers set. Apply to template + cli asset + consumer demo together.

### H2 — system/session returns the full session object including token (and csrfToken) to the client · severity: high · status: CONFIRMED
- **Sources:** reports(#H2, adversarial-CONFIRMED) / review(SEC-14) — both
- **Current location:** `packages/create-luckystack-app/template/src/_api/session_v1.ts:14-19`
- **Original claim:** `main` returns `result: user` verbatim; `SessionLayout` includes `token` (and per review/ `csrfToken`), so the HttpOnly cookie credential is exposed to page JS on every SPA mount.
- **Verification (current code):** Confirmed — `main = ({ user }) => { console.log(user); return { status: 'success', result: user }; }`. `SessionLayout` (config.ts:140-144) requires `token: string`. The object is returned whole with no field stripping.
- **Verdict & why:** CONFIRMED. review/ said medium, reports/ said high. reports/ is right for the same reason as H1. (Note: current `SessionLayout` does NOT declare a `csrfToken` field, so review/'s "+ csrfToken" sub-claim is not borne out by the template's type — the `token` exposure is the real defect.)
- **Recommendation:** `const { token: _t, ...publicUser } = user; return { status:'success', result: publicUser };`, or ship a `toPublicSession()` helper in `@luckystack/core`.

### M1 — Debug `console.log(user)` logs the full session (token + PII) on every session fetch · severity: medium · status: CONFIRMED
- **Sources:** reports(#M1) / review(SEC-15) — both
- **Current location:** `packages/create-luckystack-app/template/src/_api/session_v1.ts:15`
- **Original claim:** Leftover debug line streams the session token, email, name to server stdout on the most frequently-hit endpoint (fired on each SPA mount). review/ frames it as framework↔template drift (the repo's own `src/_api/session_v1.ts` lacks the line).
- **Verification (current code):** `console.log(user);` is present, unchanged, at line 15.
- **Verdict & why:** CONFIRMED. Both scans agree; it is a live secrets-into-logs defect.
- **Recommendation:** Delete the line (or gate behind `logging.devLogs` with token/PII redacted) and re-sync with the repo copy.

### Hard-1 — `npm run prod` cannot work: nothing builds `dist/server.js` · severity: high · status: CONFIRMED
- **Sources:** reports(Hard block 1)
- **Current location:** `packages/create-luckystack-app/template/package.json:13-14`
- **Original claim:** `"prod": "node dist/server.js"` but the only build is `"build": "vite build"`, which bundles the client and never compiles `server/server.ts`. No server build step exists in `template/scripts/`.
- **Verification (current code):** Confirmed. `build` is `vite build`; `prod` is `node dist/server.js`; `server` is `luckystack-dev` (dev only) and `server:once` runs `tsx … server/server.ts` (dev). No `tsc`/`esbuild`/`tsup`/`bundleServer` step produces `dist/server.js`. (See QUA-016 cross-area: even the framework's `bundleServer.mjs` overlay-prod story is unresolved.)
- **Verdict & why:** CONFIRMED. The template is structurally dev-only as shipped; a consumer following the scripts has no scaffold→prod path.
- **Recommendation:** Add a server bundle step (esbuild/tsup of `server/server.ts` → `dist/server.js`) wired into `build`, or document the prod build explicitly.

### Hard-2 — `scaffold:page` generates a crashing page (`template = 'dashboard'` not in the `'home' | 'plain'` union) · severity: high · status: CONFIRMED
- **Sources:** reports(Hard block 2) / review(CFG-43 touches same file, different angle)
- **Current location:** `packages/create-luckystack-app/template/scripts/scaffoldPage.mjs:179` (vs `template/src/_components/templates/TemplateProvider.tsx:20`)
- **Original claim:** The inline dashboard template writes `export const template = 'dashboard'` while the shipped union is `'home' | 'plain'`; `Templates['dashboard']` is `undefined` → React "Element type is invalid" crash.
- **Verification (current code):** Confirmed. scaffoldPage.mjs line 179 (PAGE_DASHBOARD_TEMPLATE) emits `export const template = 'dashboard';`. TemplateProvider.tsx line 20 declares `export type Template = 'home' | 'plain'` and `Templates = { home, plain }` (line 22-25) — no `dashboard` key. The path heuristic (line 125) routes `admin|dashboard|settings|billing|account|profile` paths to this crashing template.
- **Verdict & why:** CONFIRMED. A page scaffolded under any dashboard-shaped path renders `<undefined>` and crashes.
- **Recommendation:** Change the inline dashboard template to `template = 'home'` (or add a real `dashboard` template to the union), and single-source the inline templates with the `_dot_luckystack`/devkit blueprints to stop divergence.

### M3 — Shipped "Sign out" link is a dead `/logout` route — clicking it never terminates the session · severity: medium · status: CONFIRMED
- **Sources:** reports(#M3)
- **Current location:** `packages/create-luckystack-app/template/src/_components/templates/Home.tsx:23`
- **Original claim:** `<Link to="/logout">` lands on the 404 ErrorPage; no `/logout` page ships and routing has no `/logout` handler; the real logout is the `system/logout` API which nothing in the UI calls.
- **Verification (current code):** Confirmed — Home.tsx:23 still renders `<Link to="/logout">`. Glob for `template/src/**/logout/**` returns no files; the page list contains no `logout/page.tsx`. So the link 404s and the session (cookie + Redis) stays active.
- **Verdict & why:** CONFIRMED. A session-termination failure shipped as every project's signed-in shell.
- **Recommendation:** Replace the link with a handler calling `apiRequest({ name: 'system/logout' })`, or ship a `/logout` page that does so.

### M2 — `SECURE=false` shipped undocumented — production cookies default to non-Secure · severity: medium · status: CONFIRMED
- **Sources:** reports(#M2) / review(docs-gap 4)
- **Current location:** `packages/create-luckystack-app/template/_dot_env_template:15`
- **Original claim:** The single line `SECURE=false` has no comment while every other key is documented; a consumer who sets `PUBLIC_URL` but never learns `SECURE` ships session cookies without the Secure attribute (MITM/downgrade).
- **Verification (current code):** Confirmed — line 15 is bare `SECURE=false` with no explanatory comment; the surrounding `PUBLIC_URL`/`EXTERNAL_ORIGINS` keys have multi-line comments.
- **Verdict & why:** CONFIRMED. Live documentation/security gap.
- **Recommendation:** Document the key ("set SECURE=true in production / behind TLS") and/or fail loudly at boot when `NODE_ENV=production && SECURE=false`.

### M4 — Internal audit/handoff reports + framework-only generated indexes ship into every consumer project · severity: medium · status: CONFIRMED
- **Sources:** reports(#M4)
- **Current location:** `packages/create-luckystack-app/scripts/bundleFrameworkDocs.mjs:31`
- **Original claim:** `['docs','docs',true]` copies the ENTIRE repo `docs/` into the tarball, bundling `audits/SECURITY_AUDIT.md` (a list of known-unfixed weaknesses), handoff/publish-readiness docs, `_archive/`, and the framework's own `AI_PROJECT_INDEX.md`/`ai-graph.json` into `docs/luckystack/`.
- **Verification (current code):** Confirmed — `ENTRIES` at line 29-35 still copies `docs` wholesale (`['docs', 'docs', true]`) with `fs.cpSync(src, dst, { recursive: true })`. No allow-list/exclusion.
- **Verdict & why:** CONFIRMED. Every scaffold carries a stale, dated list of the framework's known weaknesses plus maintainer-internal noise that misleads consumer AI reading `docs/luckystack/` as authority.
- **Recommendation:** Switch to an allow-list (ARCHITECTURE_*, guides, protocols) or at minimum exclude `audits/`, `_archive/`, `HANDOFF-*`, `PUBLISH_READINESS_AUDIT.md`, and the framework-specific generated indexes.

### QUA-004 — `npm install` / `prisma generate` silently fail on Windows (spawnSync `.cmd` with `shell:false` → EINVAL) · severity: high · status: CONFIRMED
- **Sources:** review(QUA-004)
- **Current location:** `packages/create-luckystack-app/src/index.ts:905, 918`
- **Original claim:** `spawnSync('npm.cmd'/'npx.cmd', …, { shell:false })` on win32 throws EINVAL on Node ≥20.12.2 (CVE-2024-27980 fix); `result.error` is never checked and prisma generate runs anyway after install already failed.
- **Verification (current code):** Confirmed — line 905 `spawnSync(npmCmd, ['install'], { cwd, stdio:'inherit', shell: false })` with `npmCmd = 'npm.cmd'` on win32; line 918 same for `npx.cmd prisma generate`. `engines.node` is `>=20.19.0` (template) / `>=20` (package), and CI tests node 20 & 22 — all affected. The current dir is Windows (`win32`), so the flagship `npx create-luckystack-app` writes files but never installs deps here.
- **Verdict & why:** CONFIRMED. Real, platform-specific, high-impact (silent dep-install failure on the primary onboarding path on Windows).
- **Recommendation:** Use `shell: true` for the npm/npx spawns (args are static literals — no injection risk) or spawn `cmd.exe /c …`; log `result.error?.message`; skip prisma generate when install failed.

### QUA-006 — Consumer-shipped CLAUDE.md is a verbatim framework copy (references `ai:index`, `Navbar`/`Middleware`/`'plain'|'dashboard'` that don't exist in the scaffold) · severity: high · status: CONFIRMED
- **Sources:** reports(docs-gap 1, 2) / review(QUA-006) — both
- **Current location:** `packages/create-luckystack-app/scripts/bundleFrameworkDocs.mjs:30` → `framework-docs/CLAUDE.md:54,142-151,282`; consumer copy wired at `src/index.ts:1533`
- **Original claim:** bundleFrameworkDocs copies repo-root CLAUDE.md byte-for-byte; it mandates `npm run ai:index` (no such script in `template/package.json`), and the Component Reference table points at `Navbar`/`Middleware`/`Dropdown`/`TemplateProvider` at `./X.tsx` paths and templates `'plain' / 'dashboard'` that don't match the scaffold (`'home' | 'plain'`, components under subfolders, Middleware from `@luckystack/core/client`).
- **Verification (current code):** Confirmed — `framework-docs/CLAUDE.md` line 54 lists `npm run ai:index` as autonomous; lines 142/148/150/151 reference `./Dropdown.tsx`, `./Navbar.tsx`, `./Middleware.tsx`, `./TemplateProvider.tsx` with `'plain' / 'dashboard'`; line 282 repeats `'plain'` / `'dashboard'`. `template/package.json:17-23` has `ai:capabilities|project-index|decisions|runbooks|product|graph|lint` but NO `ai:index`. Template ships no `Navbar.tsx`; TemplateProvider union is `'home' | 'plain'`.
- **Verdict & why:** CONFIRMED. For a 100%-AI-driven consumer this is materially wrong on the first session. Both scans agree; high is justified given the AI-contract role.
- **Recommendation:** Transform CLAUDE.md during bundleFrameworkDocs (strip framework-only commands, regenerate the component table from the template tree) + add a build-time assertion that every `./X.tsx` referenced exists under `template/src/_components`.

### QUA-005 — Wizard template variables (AUTH_MODE / I18N_ENABLED / EMAIL/MONITORING/OAUTH) · severity: high (claimed) · status: PARTIALLY-FIXED
- **Sources:** review(QUA-005)
- **Current location:** `packages/create-luckystack-app/src/index.ts:1492-1500` (var map) + `:1318-1394` (editScaffoldFile honoring); placeholders unused in `template/` tree
- **Original claim:** AUTH_MODE/I18N_ENABLED/EMAIL_PROVIDER/MONITORING_PROVIDER/OAUTH_PROVIDERS are documented as substituted template vars but never used in `template/`; choosing `authMode='none'` or `i18n='No'` changes nothing — full auth stack ships regardless.
- **Verification (current code):** Mixed. The named placeholders ARE still passed into `vars` (1492-1500) but a grep of `template/` finds only `{{DB_PROVIDER}}`, `{{EXTERNAL_ORIGINS}}`, `{{PROJECT_NAME/TITLE}}`, `{{LUCKYSTACK_VERSION}}` actually consumed — so `{{AUTH_MODE}}` etc. remain dead placeholders. HOWEVER the wizard choices are NOW honored through code: `pruneOptionalPackages` + `editScaffoldFile` blocks (1318-1394) drop the settings/logout links, make pages public, set `credentials: false`, and narrow locales to English when `authMode==='none'` / `i18n===false`. So "answers silently discarded" is no longer true.
- **Verdict & why:** PARTIALLY-FIXED. review/ predates commit 302cbf1's flag/prune work. The behavioural defect (choices ignored) is fixed; the residual is cosmetic dead template-variable placeholders + a package CLAUDE.md "Template variables" list that overstates what substitution does.
- **Recommendation:** Either consume the placeholders or drop them from the var map and the package CLAUDE.md list to avoid implying substitution that doesn't happen.

### CFG-01 — Non-interactive flags for db/auth/oauth/email/monitoring/i18n · severity: high (claimed) · status: ALREADY-FIXED
- **Sources:** review(CFG-01)
- **Current location:** `packages/create-luckystack-app/src/index.ts:40-69 (CliArgs + VALID_FLAGS), :111-163 (parse), :589-619 (preset/no-prompt application)`
- **Original claim:** Only `--no-presence` and `--ai-browser` reachable by flag; everything else interactive-only, so `--no-prompt` hard-locks CI/AI to Mongo+credentials+console.
- **Verification (current code):** Refuted by current code. `VALID_FLAGS` now lists `--db`, `--auth`, `--oauth`, `--email`, `--monitoring`, `--i18n/--no-i18n`, `--ai-docs/--no-ai-docs` (+ existing `--no-presence`, `--ai-browser`). `CliArgs` carries `dbProvider/authMode/oauthProviders/emailProvider/monitoringProvider/i18n/aiInstructions`. `buildPresetAnswers` (589) seeds the wizard and `buildNoPromptChoices` (614) layers flags over defaults. A `--db=postgresql --auth=credentials+oauth --email=resend` scaffold is now expressible.
- **Verdict & why:** ALREADY-FIXED. This is the clearest example of the older review/ scan pre-dating the current code (commit 302cbf1).
- **Recommendation:** None — resolved. (Optionally add the inline comment at `src/index.ts:42` already cites "CFG-01".)

### QUA-061 — `--ai-browser` flag silently ignored when the interactive wizard runs · severity: low (claimed) · status: ALREADY-FIXED
- **Sources:** review(QUA-061)
- **Current location:** `packages/create-luckystack-app/src/index.ts:589-596, 301-335`
- **Original claim:** `args.aiBrowserTooling`/`args.noPresence` only consulted in the `--no-prompt` branch; running the flag with the wizard discards it.
- **Verification (current code):** Refuted. `buildPresetAnswers` (589) maps every passed flag into `presets`, and `runPrompts` uses a `need()` predicate (e.g. line 301 `if (need('authMode'))`, 331 `if (aiInstructions && need('aiBrowserTooling'))`) so a preset value SKIPS the corresponding wizard step. Flags now win + skip rather than being dropped.
- **Verdict & why:** ALREADY-FIXED, same code wave as CFG-01.
- **Recommendation:** None.

### QUA-025 — Template ships a non-capturing `tryCatch` — scaffolded handlers never auto-report errors · severity: medium · status: CONFIRMED
- **Sources:** review(QUA-025)
- **Current location:** `packages/create-luckystack-app/template/shared/tryCatch.ts:1-18`
- **Original claim:** The canonical `tryCatch` calls `captureException` in the catch; the template ships an inline variant that omits it, so every `functions.tryCatch.tryCatch` drops error reporting even when a tracker is configured — while the shipped CLAUDE.md says the server-side path captures to Sentry.
- **Verification (current code):** Confirmed — the file is a self-contained `tryCatch` returning `[error, null]` in the catch with NO `captureException`; the header comment explicitly says "No Sentry coupling here". (Contrast `template/shared/sleep.ts` which re-exports from the package.)
- **Verdict & why:** CONFIRMED. Observability blind spot vs. the shipped contract. The "no coupling" comment looks deliberate, so flag both sides.
- **Recommendation:** Re-export the canonical impl (`export { tryCatch } from '@luckystack/core/client'`), or update the CLAUDE.md Error Handling section + the comment to state auto-capture requires wiring.

### QUA-014 — Template `scripts/` drifted from framework `scripts/` (scaffoldRouteTest rejects root routes; testAll.ts missing config import + TEST_OUTPUT_FILE) · severity: high · status: CONFIRMED
- **Sources:** review(QUA-014)
- **Current location:** `packages/create-luckystack-app/template/scripts/scaffoldRouteTest.mjs:38`, `template/scripts/testAll.ts`
- **Original claim:** Template is stale: scaffoldRouteTest still `if (parts.length < 3)` (rejects root-level routes the template itself ships, e.g. `logout_v1.ts`, `session_v1.ts`), and testAll.ts omits the load-bearing `import '../config'` (wrong Redis namespace → auth tests fail) and the TEST_OUTPUT_FILE JSON summary.
- **Verification (current code):** Confirmed — scaffoldRouteTest.mjs line 38 is `if (parts.length < 3)`; grep of `template/scripts/testAll.ts` for `import '../config'` and `TEST_OUTPUT_FILE` returns nothing. Template ships root-level `src/_api/session_v1.ts` (and the cli asset bundle a logout), so `npm run scaffold:test session/v1` would be rejected as the shipped CLAUDE.md testing rule instructs the consumer to run.
- **Verdict & why:** CONFIRMED. Subtle, hard-to-debug drift in the scaffold's developer tooling.
- **Recommendation:** Single-source the mirrored scripts (copy `scripts/*` into the template at build time, like the framework-docs bundle) or add a CI `diff -q` over the mirrored files; backport the root-route fix + `import '../config'` + TEST_OUTPUT_FILE to the template (and `ls-np`).

### SEC-47 / L2 — `scaffold:page` accepts `..` segments — writes outside `src/` · severity: low · status: CONFIRMED
- **Sources:** reports(#L2) / review(SEC-47) — both
- **Current location:** `packages/create-luckystack-app/template/scripts/scaffoldPage.mjs:54-63`
- **Original claim:** `normalizedArg.split('/').filter(s => s.length > 0)` strips only empty segments; `..` survives `validatePagePath` (it only checks reserved `_` folders) and feeds `path.join(SRC_DIR, ...folderSegments, 'page.tsx')`, so `npm run scaffold:page ../../x` writes outside `src/`. AI-autonomous (Rule 8) → prompt-injection write-anywhere.
- **Verification (current code):** Confirmed — line 55 filters only `s.length > 0`; `validatePagePath` (90-102) checks `SCAFFOLD_IGNORED_FOLDERS` and underscore prefixes but never `.`/`..`; line 63 joins unguarded. No containment assert on `absoluteTargetPath`. (Note: the scaffolder's own project-name path IS now containment-checked at `src/index.ts:1425` — but that fix does not cover scaffoldPage.mjs.)
- **Verdict & why:** CONFIRMED. Both scans agree; low severity (local dev tool, self-supplied input) but a real traversal class, sharper given AI-autonomous execution.
- **Recommendation:** Reject any segment equal to `.`/`..` up front and assert `path.resolve(absoluteTargetPath).startsWith(SRC_DIR + path.sep)`. Mirror to `scaffoldRouteTest.mjs`.

### CFG-43 — `scaffold:page` template choice is a path-name heuristic with no override flag · severity: low · status: CONFIRMED
- **Sources:** review(CFG-43)
- **Current location:** `packages/create-luckystack-app/template/scripts/scaffoldPage.mjs:125`
- **Original claim:** Template is solely the regex `/(admin|dashboard|settings|billing|account|profile)/`; no flag; projects with custom TemplateProvider templates can't scaffold them.
- **Verification (current code):** Confirmed — line 125 `looksLikeDashboard = /(^|\/)(admin|...)(\/|$)/.test(lowerPath)`, script reads only `process.argv[2]`, no override. (Compounded by Hard-2: the dashboard branch it picks emits a crashing template.)
- **Verdict & why:** CONFIRMED, low. Ergonomic gap; the real bug here is Hard-2.
- **Recommendation:** Add an optional `--template <name>` arg validated against the registered template union.

### Docs-gap-3 — `.env` commit guidance contradicts the shipped `.gitignore` · severity: low · status: CONFIRMED
- **Sources:** reports(docs-gap 3)
- **Current location:** `template/_dot_env_template:1` vs `template/_dot_gitignore:6` (+ next-steps banner `src/index.ts:1608`)
- **Original claim:** env_template line 1 says "Commit this file as `.env`" but `.gitignore` ignores `.env`, so the "public commit-me" env layer never reaches the repo.
- **Verification (current code):** Confirmed — env_template:1 still reads "Commit this file as `.env`."; `_dot_gitignore:6` ignores `.env`. The scaffold's own next-steps banner (1608) uses `cp .env_template .env` (copy, not commit), making the file's first-line instruction internally contradictory.
- **Verdict & why:** CONFIRMED, low. The committed-template-vs-gitignore contradiction persists in the file text.
- **Recommendation:** Reword line 1 to "Copy this file to `.env`" (matching the banner) or stop gitignoring `.env` if the one-key-one-file commit model is intended — pick one.

### Docs-gap-5 / QUA-017 — Shipped CI "Test sweep" runs with no server/Redis/DB booted — red on day one · severity: medium · status: CONFIRMED (with one sub-claim FIXED)
- **Sources:** reports(docs-gap 5) / review(QUA-017) — both
- **Current location:** `packages/create-luckystack-app/template/.github/workflows/ci.yml:50-51`
- **Original claim:** `npm run test` runs `testAll.ts` which requires a running server (default `localhost:80`) + Redis/Mongo; the workflow defines no `services:` and boots no server, so the step exits 1. reports/ also flagged `test:e2e` not being a package.json script (masked by continue-on-error).
- **Verification (current code):** CONFIRMED for the core claim — ci.yml has no `services:` block, never boots the server, and "Test sweep" runs bare `npm run test` (which now also runs `generateArtifacts` first, but the HTTP sweep still has no backend). The `test:e2e` sub-claim is PARTIALLY mitigated: the E2E step now guards on `if [ -f node_modules/@vercel-labs/agent-browser/package.json ]` AND uses `continue-on-error: true`, so it no longer hard-fails on a missing script — though `test:e2e` is still absent from `template/package.json`, so it would error if that file ever exists.
- **Verdict & why:** CONFIRMED. The sweep step cannot pass as shipped; every fresh scaffold gets a red CI. Both scans agree.
- **Recommendation:** Add `services:` (redis + mongo/sqlite), boot the built server in the background with a `/readyz` wait, then run the sweep — or gate behind a `TEST_BASE_URL` secret and skip-with-notice when unset.

### SEC-48 — Template CI runs with default GITHUB_TOKEN permissions + tag-pinned actions · severity: low · status: CONFIRMED
- **Sources:** review(SEC-48)
- **Current location:** `packages/create-luckystack-app/template/.github/workflows/ci.yml:1, 21, 24`
- **Original claim:** No `permissions:` block (so `GITHUB_TOKEN` gets repo-default scope) and actions pinned by mutable tag (`@v4`) rather than SHA; propagates to every scaffold.
- **Verification (current code):** Confirmed — no top-level `permissions:`; `actions/checkout@v4` (21) and `actions/setup-node@v4` (24) are tag-pinned.
- **Verdict & why:** CONFIRMED, low. Standard supply-chain hardening missing.
- **Recommendation:** Add `permissions: contents: read` and pin actions to full commit SHAs.

### L1 — Dev server (`vite --host` + `host: true`) exposed to the whole LAN by default · severity: low · status: CONFIRMED
- **Sources:** reports(#L1)
- **Current location:** `template/package.json:10` (`"client": "vite --host"`) + `template/vite.config.ts:36-37` (`port: 5173, host: true`)
- **Original claim:** Every dev session binds 0.0.0.0 — LAN gets the UI, raw `/src` modules, and the proxy into the backend (`/api`, `/auth`, `/socket.io`).
- **Verification (current code):** Confirmed — both `--host` and `host: true` present; vite proxy (38-50) forwards `/api`, `/sync`, `/auth`, `/uploads`, health, `/_docs`, `/socket.io` to the backend.
- **Verdict & why:** CONFIRMED, low (dev-only convenience vs exposure tradeoff).
- **Recommendation:** Default to localhost; make `--host` an opt-in documented flag.

### L3 — OAuth-provider accounts can be deleted without re-authentication · severity: low · status: CONFIRMED
- **Sources:** reports(#L3)
- **Current location:** `packages/create-luckystack-app/template/src/settings/_api/deleteAccount_v1.ts:23-34`
- **Original claim:** Password reconfirm only runs `if (dbUser?.password)`; for OAuth (password-less) users the sole gate is typing `DELETE`, so a hijacked session destroys the account with one call.
- **Verification (current code):** Confirmed — line 29 `if (dbUser?.password)` gates the password check; OAuth users skip it. Rate-limited to 3/min (line 6), no second factor.
- **Verdict & why:** CONFIRMED, low (requires an active/hijacked session).
- **Recommendation:** For password-less accounts require a fresh OAuth round-trip or an email-confirmation token before delete.

### L4 — Avatar upload: no content-type/size validator registered in the template · severity: low · status: CONFIRMED
- **Sources:** reports(#L4) / review(SEC-17 — same file, broader input-trust angle)
- **Current location:** `packages/create-luckystack-app/template/src/settings/_api/updateUser_v1.ts:32-57`
- **Original claim:** `contentType` comes from the attacker-controlled data-URI; `processUpload` only dispatches hooks and the template registers no `onUploadStart` validator. Mitigations: sharp re-encodes to webp + 5MB socket cap. review/'s SEC-17 additionally flags `name`/`theme`/`language` written without runtime validation (bypasses `auth.nameMaxLength`).
- **Verification (current code):** Confirmed — `contentType = matches[1]` (line 37) flows into `processUpload` with no allow-list; the encode callback runs sharp. No `onUploadStart` registered in the template. SEC-17's sibling claim also holds: `name/theme/language` are copied into `newData` (69-72) with no length/union validation (only truthiness), so an authenticated user can exceed `auth.nameMaxLength`.
- **Verdict & why:** CONFIRMED, low/medium. The reference implementation models an input-trust anti-pattern; sharp/byte-cap blunt the avatar vector but the name/theme/language writes are unbounded by policy.
- **Recommendation:** Register an example `onUploadStart` enforcing image/* + byte cap; validate `name` against `getProjectConfig().auth.nameMaxLength`, `theme` against the union, `language` against the locale list (mirror `updatePreferences_v1`).

### L6 / CFG-27-adjacent — Template trains consumers to allow-list OAuth provider origins into CORS · severity: low · status: CONFIRMED
- **Sources:** reports(#L6)
- **Current location:** `template/config.ts:84-87` + `template/_dot_env_template:28-33` (+ scaffolder `OAUTH_PROVIDER_ORIGINS` at `src/index.ts:1472`)
- **Original claim:** Guidance extends the credentialed-origin trust list with provider origins the consumer doesn't control, relying on `Referer` for OAuth callbacks — fragile (privacy extensions strip Referer) and broader than needed.
- **Verification (current code):** Confirmed — config.ts:84-87 documents adding "OAuth provider origins" to `EXTERNAL_ORIGINS`; env_template:28-33 says "every enabled provider's origin must be listed here"; the scaffolder pre-fills provider origins (1472-1482) into `EXTERNAL_ORIGINS`.
- **Verdict & why:** CONFIRMED, low. A design-smell more than a vuln — exempting `/auth/callback/*` from the browser-origin gate (already protected by the OAuth `state` param) is cleaner.
- **Recommendation:** Exempt the callback route from the origin gate instead of telling users to globally allow-list provider origins.

### L7 — ErrorPage renders raw `error.stack` unconditionally (+ hardcoded English status strings) · severity: low · status: CONFIRMED
- **Sources:** reports(#L7, code-quality 1)
- **Current location:** `packages/create-luckystack-app/template/src/_components/ErrorPage.tsx:34, 67-75, 7-15`
- **Original claim:** `errorDetails = error.stack ?? null` is rendered in a "developer details" disclosure not gated on `dev`; minor info disclosure in prod. Also: hardcoded English `STATUS_MESSAGE` strings violate the i18n rule.
- **Verification (current code):** Confirmed — line 34 sets `errorDetails = error.stack`; lines 67-75 render it ungated by `dev`. `STATUS_MESSAGE` (7-15) hardcodes seven English messages, and `errorTitle`/`errorMessage` default strings (22-23) are English literals alongside the translated labels.
- **Verdict & why:** CONFIRMED, low.
- **Recommendation:** Gate `errorDetails` behind `dev` from config; move the status messages into the locale files.

### L5 — sessionStorage-mode OAuth handoff puts the session token in the URL · severity: low · status: UNCERTAIN
- **Sources:** reports(#L5)
- **Current location:** `template/src/main.tsx` (OAuth `?token=` capture + `replaceState` strip)
- **Original claim:** In `sessionBasedToken: true` mode the token transits as a query param (lands in access logs / Location header) before history is scrubbed.
- **Verification (current code):** Not re-opened in this pass (main.tsx not read). The behavior is off by default (cookie mode) and the original reports/ note already classified it as a hardening note acknowledged by the code comment.
- **Verdict & why:** UNCERTAIN here (not re-verified line-by-line), but low impact and off-by-default. Would need to read `template/src/main.tsx` to confirm the `?token=` path still exists.
- **Recommendation:** If kept, document the tradeoff; prefer a POST/fragment handoff over a query param for the token.

### Hooks-1 — Transactional email branding hardcoded `'LuckyStack'` (not a seam) · severity: medium · status: UNCERTAIN
- **Sources:** reports(hooks 1, missing-config 1)
- **Current location:** `template/server/hooks/notifications.ts:51, 90` (not re-read this pass)
- **Original claim:** `brand: 'LuckyStack'` is hardcoded in the sign-in/password-changed emails; should derive from `pageTitle`.
- **Verification (current code):** Not re-read in this pass; the file was not opened. reports/ read it directly and it is a plausible, low-risk claim.
- **Verdict & why:** UNCERTAIN pending a read of `template/server/hooks/notifications.ts`. Carrying reports/'s finding forward unverified.
- **Recommendation:** If confirmed, read `pageTitle` from config for the `brand` field.

### HOK-05 / MIS-020 / code-quality-5 — Account deletion: no pre/post hooks AND leaves the avatar file (GDPR residue) · severity: medium · status: CONFIRMED
- **Sources:** reports(code-quality 5) / review(HOK-05, MIS-020) — both
- **Current location:** `packages/create-luckystack-app/template/src/settings/_api/deleteAccount_v1.ts:36-41`
- **Original claim:** `deleteAccount` revokes sessions + clears the activeUsers Redis key + deletes the Prisma row, but (a) fires NO `dispatchHook` (every sibling mutation has pre/post hooks) and (b) never unlinks `uploads/<id>.webp` written by updateUser → PII residue after deletion.
- **Verification (current code):** Confirmed — lines 36-40 do `revokeUserSessions` → `redis.del(activeUsers)` → `prisma.user.delete`, then `return {...}`. No `dispatchHook('preAccountDelete'/'postAccountDelete')`; no avatar unlink. `updateUser_v1.ts:39-40` writes `${user.id}.webp` under `getUploadsDir()`, never removed here.
- **Verdict & why:** CONFIRMED. Both the hook gap (consumers/packages can't veto/audit/cascade deletion) and the avatar GDPR residue are live, in all shipped copies.
- **Recommendation:** Add `preAccountDelete` (vetoable) + `postAccountDelete` payloads in `packages/login/src/hookPayloads.ts` and dispatch them; after the prisma delete, `unlink(path.join(getUploadsDir(), `${user.id}.webp`)).catch(()=>{})`. Apply to template + cli asset + `ls-np` + consumer demo together.

### CFG-27 — Settings session endpoints hardcode the Redis key shape (bypass formatKey/multi-tenancy formatter) · severity: medium · status: CONFIRMED
- **Sources:** review(CFG-27)
- **Current location:** `template/src/settings/_api/{deleteAccount_v1.ts:20,38, listSessions_v1.ts:19,22,29,31, revokeSession_v1.ts}`
- **Original claim:** All three endpoints rebuild keys by string-concatenating `process.env.PROJECT_NAME ?? 'luckystack'` instead of `formatKey`/`activeUsersKeyFor`/`sessionKeyFor`, so a registered custom key formatter (multi-tenancy/migration) reads/writes the WRONG keys.
- **Verification (current code):** Confirmed for the two read this pass — deleteAccount.ts:20 `const PROJECT_NAME = process.env.PROJECT_NAME ?? 'luckystack'` then `:38` `redis.del(`${PROJECT_NAME}-activeUsers:${user.id}`)`; listSessions.ts:19/22/29/31 same pattern (`-activeUsers:`, `-session:`). revokeSession not re-read but the scan reports the identical construction.
- **Verdict & why:** CONFIRMED. Breaks `registerRedisKeyFormatter` consumers; ships identically in framework repo, template, and cli copies.
- **Recommendation:** Import `activeUsersKeyFor`/`sessionKeyFor` from `@luckystack/login` (or `formatKey` from core) and drop the local `PROJECT_NAME` reads in all three endpoints across all copies.

### QUA-062 — No cleanup of a half-written project directory when the scaffold fails midway · severity: low · status: CONFIRMED
- **Sources:** review(QUA-062)
- **Current location:** `packages/create-luckystack-app/src/index.ts:1634-1639`
- **Original claim:** `main().catch` only logs + exits 1; a throw after `mkdirSync`/partial copy leaves a broken half-scaffold, and the retry dies on "Target directory already exists" with no hint.
- **Verification (current code):** Confirmed — `main().catch` (1635) just `console.error` + `process.exit(1)`; no `rmSync` of the created `targetDir`. The `existsSync(targetDir)` guard at 1430 then blocks any retry.
- **Verdict & why:** CONFIRMED, low. Confusing first-run failure mode.
- **Recommendation:** Track that the CLI created `targetDir`; on error remove it (only if created this run) or print "partial scaffold left at <dir> — delete it before retrying".

### QUA-063 — pickFromList/pickMulti silently substitute the default for unrecognized input · severity: low · status: CONFIRMED
- **Sources:** review(QUA-063)
- **Current location:** `packages/create-luckystack-app/src/index.ts:249` (pickFromList), `:252-…` (pickMulti)
- **Original claim:** `return match ?? defaultValue;` — a typo like 'postgres' (valid: 'postgresql') silently becomes the default in the non-TTY/piped fallback; pickMulti drops unknown tokens similarly.
- **Verification (current code):** Confirmed — line 249 `return match ?? defaultValue;` after a case-insensitive `find`; no "unrecognized" warning. pickMulti parses comma-separated tokens and silently drops unknowns.
- **Verdict & why:** CONFIRMED, low. The non-interactive path fails soft. (Mitigated for scripted callers by the new value flags, which exit 2 on bad values — so this only bites the readline/piped fallback.)
- **Recommendation:** Print "Unrecognized answer X — using default Y" (or re-prompt) in both helpers.

### MIS-022 — No `--version` flag on `create-luckystack-app` · severity: low · status: CONFIRMED
- **Sources:** review(MIS-022)
- **Current location:** `packages/create-luckystack-app/src/index.ts:61-69 (VALID_FLAGS), :40-55 (CliArgs)`
- **Original claim:** `npx create-luckystack-app --version` exits 2 ("Unknown flag"); `readSelfVersion()` already exists.
- **Verification (current code):** Confirmed — `VALID_FLAGS` (61-69) has no `--version`/`-v`; `CliArgs` has no version field. `readSelfVersion()` exists (used for `{{LUCKYSTACK_VERSION}}`).
- **Verdict & why:** CONFIRMED, low. Standard CLI affordance missing — and given the asset-drift findings, version identification matters.
- **Recommendation:** Handle `--version`/`-v` before flag dispatch, print `readSelfVersion()`, exit 0; update `printHelp()` + `docs/cli-flags.md`.

### HOK-22 — No pre/post-scaffold extension seam · severity: low · status: CONFIRMED
- **Sources:** review(HOK-22)
- **Current location:** `packages/create-luckystack-app/src/index.ts:1398-1618 (main pipeline)`
- **Original claim:** `main()` is a fixed pipeline with no post-scaffold hook/command, so org bootstrap (git init, secret bootstrap, portal registration) needs a wrapper script.
- **Verification (current code):** Confirmed — main() is a linear copyTree → injectOptionalDeps → pruneOptionalPackages → AI docs → wireAiBrowserTooling → install → prisma → banner, with no callback/`--post-scaffold` seam.
- **Verdict & why:** CONFIRMED, low. Workable via wrapper; more valuable if the custom-template flag lands.
- **Recommendation:** Add `--post-scaffold "<cmd>"` (spawn with `shell:true`, `cwd=targetDir`, choices as `LS_*` env), or a `template.config.mjs` `postScaffold()` hook with custom templates.

### CFG-10 — TEMPLATE_DIR hardcoded — no custom/org scaffold template · severity: medium · status: CONFIRMED
- **Sources:** review(CFG-10)
- **Current location:** `packages/create-luckystack-app/src/index.ts:31` (TEMPLATE_DIR)
- **Original claim:** `TEMPLATE_DIR = path.resolve(__dirname, '..', 'template')` is the only source; no `--template` flag/env/overlay, so an org standardizing on LuckyStack must fork.
- **Verification (current code):** Confirmed — `TEMPLATE_DIR` is the single hardcoded source (referenced by the `existsSync` guard at 1435 and `copyTree` at 1504); no alternate-template mechanism in src/ or docs/.
- **Verdict & why:** CONFIRMED, medium. Fork pressure the packaging north star aims to remove.
- **Recommendation:** Add `--template <path>` (+ optional additive `--with <dir>` overlay) reusing `copyTree` and the placeholder substitution.

### QUA-026 — Scaffold docs reference `luckystack/login/oauthProviders.ts`, a file the scaffold doesn't contain · severity: medium · status: UNCERTAIN
- **Sources:** review(QUA-026)
- **Current location:** `template/README.md:94`, `template/_dot_env_dot_local_template:26`, scaffolder OAuth intro `src/index.ts:619-620`-region (not re-read this pass)
- **Original claim:** README table + .env.local comment + generated OAuth intro say `luckystack/login/oauthProviders.ts` "already wires" providers, but `template/luckystack/` has only core/, i18n/, server/ — wiring moved into `@luckystack/login`'s register entry.
- **Verification (current code):** Partially corroborated — the scaffolder's `OAUTH_PROVIDER_ORIGINS` comment (`src/index.ts:1468-1471`) and config.ts:97-100 describe env-driven auto-wiring (consistent with the move), but I did not re-read README.md/.env.local_template/verifyBootstrap to confirm the stale references still exist.
- **Verdict & why:** UNCERTAIN pending a read of `template/README.md:94` + `_dot_env_dot_local_template` + `packages/server/src/verifyBootstrap.ts:72`. Plausible given the 0.2.0 auto-wire move; carrying forward.
- **Recommendation:** Sweep the stale strings to "@luckystack/login auto-wires from env; create the overlay only to override".

### QUA-027 — `docs/cli-flags.md` stale (missing flags, embeds outdated parseArgs) · severity: medium · status: UNCERTAIN→likely-CONFIRMED
- **Sources:** review(QUA-027)
- **Current location:** `packages/create-luckystack-app/docs/cli-flags.md` (not re-read this pass)
- **Original claim:** cli-flags.md documents only `--no-install/--no-prompt/--help`, says "no --flag=value support", pastes an old 4-entry VALID_FLAGS — but actual flags now include `--ai-browser=…` and `--no-presence` (and, post-302cbf1, the full `--db/--auth/…` set).
- **Verification (current code):** Not re-read. The mismatch is now LARGER than review/ claimed, because the actual `VALID_FLAGS` (src/index.ts:61-69) has ~13 flags incl. value flags — so if cli-flags.md still lists 4, it's badly stale.
- **Verdict & why:** UNCERTAIN (doc not opened) but very likely CONFIRMED and worse than reported. Would confirm by reading cli-flags.md.
- **Recommendation:** Regenerate cli-flags.md from `VALID_FLAGS`/parseArgs (or describe behavior instead of pasting source); add a vitest asserting every `VALID_FLAGS` entry appears in the doc.

### Code-quality — Template violates its own i18n + color rules; malformed `common/.404` key · severity: low · status: CONFIRMED
- **Sources:** reports(code-quality 1, 2) / review(QUA-020) — both (for the key)
- **Current location:** `template/src/_components/LoginForm.tsx:14-18, 128, 246, 250`
- **Original claim:** LoginForm hardcodes "Sign in to your account"/"Create a new account"/"Log in"/"Sign up"/"Loading..." (i18n rule), uses `text-white` (color-token rule), and calls `notify.error({ key: 'common/.404' })` (stray `/` → never resolves; should be `common.404`).
- **Verification (current code):** Confirmed — lines 14-18 hardcode English `title`/`subtitleText`/`subtitleLink`/`buttonText`; line 250 `{loading ? "Loading..." : buttonText}`; line 246 `bg-primary text-white`; line 128 `notify.error({ key: 'common/.404' })`. (The placeholders like `placeholder="John Pork"` are also English but those are example values.)
- **Verdict & why:** CONFIRMED, low. The reference component the consumer copies from most violates the framework's own shipped invariants. The `common/.404` key is a real broken toast on the most visible failure path (login while server unreachable).
- **Recommendation:** Fix `common/.404` → `common.404`; route the hardcoded strings through `useTranslator`; replace `text-white` with a theme token. The CLI's `check-i18n` is structurally blind to the `/`-containing key (QUA-020), so also harden that to report suspicious keys.

### Code-quality — `settings/page.tsx` god component + blanket eslint-disable + duplicated page templates + stray `ls-np/` · severity: low · status: CONFIRMED
- **Sources:** reports(code-quality 3, 4, 6, 7)
- **Current location:** `template/src/settings/page.tsx`; `template/server/server.ts:2` + scaffold blueprints; `template/scripts/scaffoldPage.mjs:133-201`; `packages/create-luckystack-app/ls-np/`
- **Original claim:** settings/page.tsx is a 533-line god component (the pattern Rule 7b warns against, in the most-copied file); blanket `/* eslint-disable */` in server.ts + blueprints; scaffoldPage inlines its own (already-diverged) page templates; a full generated app `ls-np/` sits checked in next to `template/`.
- **Verification (current code):** Confirmed for the verifiable parts — `ls-np/` still exists (ls confirmed); scaffoldPage.mjs inlines `PAGE_PLAIN_TEMPLATE`/`PAGE_DASHBOARD_TEMPLATE` (133-201) with both starting `/* eslint-disable */` (134, 168) and the dashboard copy already diverged (Hard-2). settings/page.tsx not line-counted this pass but is the file the scaffolder edits heavily (1388-1394), consistent with its size.
- **Verdict & why:** CONFIRMED, low. Repo-hygiene + maintainability; the duplicated-template divergence already shipped the Hard-2 crash.
- **Recommendation:** Single-source the page templates (one blueprint consumed by both scaffoldPage and the injector); remove `ls-np/` (developer action — `rm` needs approval); narrow the blanket eslint-disables.

### Hooks-2 — No production static-file seam shipped (noopServeFile always 404) · severity: low · status: UNCERTAIN
- **Sources:** reports(hooks 2)
- **Current location:** `template/server/server.ts:62-69` (not re-read this pass)
- **Original claim:** `noopServeFile` always 404s + a 204 favicon with only a "most apps swap these out" comment — no example impl, no doc pointer, and (Hard-1) no prod build that would use one.
- **Verification (current code):** Not re-read. Tightly coupled to Hard-1 (no prod server build exists), which IS confirmed.
- **Verdict & why:** UNCERTAIN pending a read of `template/server/server.ts`; the related Hard-1 is confirmed.
- **Recommendation:** Ship an example `serveFile` (or document the prod static-serving story) alongside fixing the prod build.

### Missing-config — Password policy / cookie name / maxHttpBufferSize / socket reconnect / avatar quality / SERVER_PORT default not surfaced in config.ts · severity: low · status: CONFIRMED
- **Sources:** reports(missing-config 2, 3, 4, 5)
- **Current location:** `template/config.ts:44-111`; `template/_dot_env_template:14`; `template/src/settings/_api/updateUser_v1.ts:53`
- **Original claim:** Routes read `getProjectConfig().auth.passwordPolicy` etc. but config.ts exposes none of those projectConfig slots; socket reconnect/heartbeat + avatar webp quality (80) are hardcoded; `SERVER_PORT=80` is a privileged dev default.
- **Verification (current code):** Confirmed for what was read — config.ts (44-111) exposes pageTitle/login URLs/session/cors/auth.{forgotPassword,credentials} but NO passwordPolicy / sessionCookieName / maxHttpBufferSize / nameMaxLength slots (commented examples exist only for secretManager). `updateUser_v1.ts:53` hardcodes `.webp({ quality: 80 })`. `_dot_env_template:14` is `SERVER_PORT=80`.
- **Verdict & why:** CONFIRMED, low. The config file's job is to surface tunable knobs; these stay hidden. SERVER_PORT=80 needs elevated privileges on Linux/macOS.
- **Recommendation:** Add commented-out `auth.passwordPolicy`/`auth.nameMaxLength`/`session.cookieName`/`http.maxHttpBufferSize` slots to config.ts; consider an unprivileged default port (3000/8080).

### Next-steps banner references `prisma:migrate:dev`, a script not in package.json · severity: low · status: CONFIRMED (new, in-scope observation)
- **Sources:** (found during verification — not in either scan)
- **Current location:** `packages/create-luckystack-app/src/index.ts:1612` vs `template/package.json:28-29`
- **Original claim:** n/a
- **Verification (current code):** The non-MongoDB next-steps line prints `npm run prisma:migrate:dev`, but `template/package.json` defines only `prisma:generate` and `prisma:db:push` — no `prisma:migrate:dev`. A SQL-provider consumer following the banner hits "missing script".
- **Verdict & why:** CONFIRMED. Minor onboarding-banner/script mismatch; reported per the "report without auto-fixing" rule.
- **Recommendation:** Add a `prisma:migrate:dev` script to template/package.json or change the banner to the existing `prisma:db:push`/`prisma migrate dev` invocation.
