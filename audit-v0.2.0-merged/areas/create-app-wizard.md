# create-app-wizard — Verified & Merged Audit Findings
Sources: reports/create-app-wizard.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
The current `packages/create-luckystack-app/src/index.ts` is the 1639-line post-fix version (commit 302cbf1 "wizard/cli flow should now actually use the user selected options"). The newer **reports/** scan read this version; the **review/** scan read an older ~1300-line version and is wrong on its two headline findings: **CFG-01** ("no non-interactive flags") and **QUA-005** ("wizard choices silently discarded") are both now **ALREADY-FIXED** — every wizard choice has a matching CLI flag that pre-fills/skips its wizard step (`buildPresetAnswers` → `runPrompts`), and `authMode='none'` / `!i18n` now drive real `pruneOptionalPackages` edits. Of ~18 distinct findings: **2 already-fixed** (the big review/ ones), **~12 confirmed**, **1 partially-fixed**, **2 uncertain (POSIX-only)**, **1 refuted-as-non-issue**. Biggest LIVE issues, all from the more-accurate reports/ scan and re-confirmed here: **HB-2/QUA-004** (npm install + prisma generate provably fail on Windows with Node ≥20.12 because of `spawnSync('.cmd', {shell:false})` → EINVAL) and **HB-3** (next-steps banner sends all SQL users to a nonexistent `npm run prisma:migrate:dev` script). **HB-1** (POSIX symlink defeats `isCliEntry`) remains code-present but is UNCERTAIN without a Linux run.

## Findings

### F-01 — npm install / npx prisma generate fail on Windows (spawnSync `.cmd` + `shell:false` → EINVAL)  ·  severity: high  ·  status: CONFIRMED
- **Sources:** reports(HB-2) + review(QUA-004) — both, same root cause
- **Current location:** `src/index.ts:904-905` (runNpmInstall), `:917-918` (runPrismaGenerate)
- **Original claim:** Since Node's CVE-2024-27980 fix (≥20.12.2; `engines` only requires ≥20), spawning `npm.cmd`/`npx.cmd` with `shell:false` throws EINVAL; the flagship `npx create-luckystack-app my-app` writes files but never installs deps. reports/ confirmed empirically on Node v22.14.0.
- **Verification (current code):** `const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'; const result = spawnSync(npmCmd, ['install'], { cwd, stdio: 'inherit', shell: false });` — unchanged. Same shape for `npx.cmd prisma generate`. Only `result.status !== 0` is checked; `result.error` (the EINVAL) is never inspected or printed, so the user sees only "npm install failed. You can run it manually." runPrismaGenerate still runs after install already failed.
- **Verdict & why:** CONFIRMED. Both scans agree; reports/ has the empirical proof. The two scans agree on severity (High). Args are static literals, so the fix is safe.
- **Recommendation:** Use `shell: true` for both spawns (or spawn `process.execPath` with npm's `npm-cli.js`), log `result.error?.message`, skip prisma generate when install failed, and add a Windows CI smoke test.

### F-02 — Next-steps banner tells SQL users to run a nonexistent `prisma:migrate:dev` script  ·  severity: high  ·  status: CONFIRMED
- **Sources:** reports(HB-3) — reports-unique
- **Current location:** `src/index.ts:1610-1612`; template `package.json:28-29`
- **Original claim:** For postgresql/mysql/sqlite the banner prints `npm run prisma:migrate:dev`, but the template `package.json` defines only `prisma:generate` + `prisma:db:push` — no migrate script anywhere.
- **Verification (current code):** Banner at :1612 prints `'npm run prisma:migrate:dev       # creates the User table + initial migration'` for all non-mongodb providers. `grep` of `template/package.json` returns only `"prisma:generate"` (:28) and `"prisma:db:push"` (:29). No `prisma:migrate:dev` exists anywhere in the template. All three SQL choices end on a dead first command, and there is no migrate path at all for SQL in the scaffold.
- **Verdict & why:** CONFIRMED. The very first command a SQL-provider user is told to run does not exist.
- **Recommendation:** Add `"prisma:migrate:dev": "dotenv -e .env.local -- prisma migrate dev"` to template `package.json`, or print `npx prisma migrate dev` directly.

### F-03 — Next-steps banner `cd ${args.projectName}` instead of the slug directory  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** reports(Missing #1) — reports-unique
- **Current location:** `src/index.ts:1607`
- **Original claim:** The directory is created from `slug` (:1423) but the banner prints `cd ${args.projectName}`; `create-luckystack-app "My App"` scaffolds `my-app/` but prints `cd My App`.
- **Verification (current code):** :1423 `const targetDir = path.resolve(cwd, slug);`, :1607 `cd ${args.projectName}`. Confirmed mismatch — the printed cd target is the raw name, not the created directory.
- **Verdict & why:** CONFIRMED. Cosmetic but it breaks the literal copy-paste path for any name needing slugification.
- **Recommendation:** Print `slug`.

### F-04 — AUTH_MODE / OAUTH_PROVIDERS / EMAIL_PROVIDER / MONITORING_PROVIDER / I18N_ENABLED template vars are computed but consumed by zero template files  ·  severity: medium  ·  status: CONFIRMED (dead vars) / ALREADY-FIXED (behavioral claim)
- **Sources:** reports(Docs #1) + review(QUA-005) — both; verdicts now diverge
- **Current location:** `src/index.ts:1492-1500` (vars built); template tree (no consumers)
- **Original claim (review/QUA-005):** "Choosing authMode='none' changes NOTHING — config.ts hardcodes credentials:true, @luckystack/login is unconditional, all auth pages ship; choosing i18n='No' changes nothing." Treated this as the headline High "wizard answers silently discarded."
- **Original claim (reports/Docs #1):** The five vars are still built but no template file substitutes them; the dead vars + their doc rows should be wired or deleted.
- **Verification (current code):** `grep '{{(AUTH_MODE|OAUTH_PROVIDERS|EMAIL_PROVIDER|MONITORING_PROVIDER|I18N_ENABLED)}}'` over `template/` → **zero matches**, so the five vars genuinely substitute into nothing (reports/ is right). BUT the review/ behavioral claim is now FALSE: `pruneOptionalPackages` (`:1213-1356` for `authMode==='none'`, `:1358-1395` for `!i18n`) performs real edits — drops `@luckystack/login`, removes `src/login|register|reset-password|settings`, `LoginForm.tsx`, `functions/session.ts`, rewrites `config.ts` to `credentials:false` + `forgotPassword:'disabled'`, and for i18n removes nl/de/fr locales and collapses the registry. The choices are NOT discarded; they're honored via prune edits rather than via these template placeholders.
- **Verdict & why:** Split. The dead-variable + stale-CLAUDE.md-"Template variables"-list part is CONFIRMED. The review/ "choices silently discarded / consumer gets a full auth stack anyway" part is ALREADY-FIXED by commit 302cbf1 — this is the clearest example of review/ pre-dating the fix. reports/ (Medium docs-gap) is the correct read of what remains.
- **Recommendation:** Delete the five unused vars from `vars` (:1492-1500) and the package `CLAUDE.md` "Template variables" list + `docs/template-variables.md` rows; the behavior is already delivered by the pruner. (Or, if a template file is ever meant to read them, wire it.)

### F-05 — Whole third-party OAuth provider origins pre-filled into the project-wide EXTERNAL_ORIGINS / CORS allow-list  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** reports(Security M-1) — reports-unique
- **Current location:** `src/index.ts:1472-1482` (OAUTH_PROVIDER_ORIGINS + join into EXTERNAL_ORIGINS), template `_dot_env_template` (`EXTERNAL_ORIGINS={{EXTERNAL_ORIGINS}}`)
- **Original claim:** Selecting GitHub/Discord OAuth puts `https://github.com` / `https://discord.com` — origins hosting arbitrary user content — into the project-wide allowed-origins list, so any page on those origins passes the framework origin/Referer gate for ALL routes, weakening CSRF posture.
- **Verification (current code):** `OAUTH_PROVIDER_ORIGINS` maps each provider to its full origin (:1473-1477); `externalOrigins = choices.oauthProviders.map(p => OAUTH_PROVIDER_ORIGINS[p]).filter(Boolean).join(',')` (:1479-1482) → substituted into `EXTERNAL_ORIGINS` (:1495). The comment at :1468-1471 explicitly states the origin must be in the global allow-list. Confirmed: the exemption is global, not scoped to the OAuth callback route.
- **Verdict & why:** CONFIRMED, framework-level insecure default minted into every OAuth scaffold. Severity Medium is right (requires the provider origin to host a hostile page targeting the consumer's gate; still a real CSRF-posture weakening).
- **Recommendation:** Scope the exemption to the OAuth callback route via the `ARCHITECTURE_HTTP.md` origin-exempt-path seam instead of allow-listing the entire provider origin for all routes.

### F-06 — `{{PROJECT_TITLE}}` is unsanitized — code/markup injection into generated config.ts + index.html  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(Security L-1) — reports-unique
- **Current location:** `src/index.ts:664-669` (`titleCase`), `:1487` (`PROJECT_TITLE: titleCase(args.projectName)`); template `config.ts:45` (`pageTitle: '{{PROJECT_TITLE}}'`), `index.html`
- **Original claim:** `titleCase` only splits on `/[\s\-_]+/` and upcases; quotes/backticks/`<`/`>` pass through. A name like `"x', evil: '"` breaks/extends the `config.ts` string literal.
- **Verification (current code):** `titleCase` (:664-669) does `.split(/[\s\-_]+/).filter(Boolean).map(upcase).join(' ')` with no character filtering. The directory uses the safe `slugify` (`[^a-z0-9]+ → -`), but the title does not. `template/config.ts:45` embeds it inside a single-quoted literal `pageTitle: '{{PROJECT_TITLE}}'`. Confirmed injectable.
- **Verdict & why:** CONFIRMED. Local, one-shot, requires the user to paste an untrusted project name — hence Low. Still a real source-injection vector into the scaffold.
- **Recommendation:** Restrict `PROJECT_TITLE` to `[A-Za-z0-9 \-_]` (or escape per destination context).

### F-07 — `.mcp.json` wires auto-executing, unpinned `@latest` packages  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(Security L-2) — reports-unique
- **Current location:** `src/index.ts:1572` (`@luckystack/mcp@latest`); `wireAiBrowserTooling` (~:1124-1125) for `@playwright/mcp@latest` + `chrome-devtools-mcp@latest`
- **Original claim:** Every Claude Code session in the scaffold fetches/runs whatever is published at `latest` — a supply-chain drift channel, no pin/integrity.
- **Verification (current code):** :1572 `servers.luckystack ??= { type: 'stdio', command: 'npx', args: ['@luckystack/mcp@latest'] };` — unchanged. Note `@luckystack/mcp` is pinned to `@latest` even though every other `@luckystack/*` dep is pinned to the scaffolder's own `readSelfVersion()`. Mitigated by Claude Code's one-time MCP trust prompt.
- **Verdict & why:** CONFIRMED. Low.
- **Recommendation:** At minimum pin `@luckystack/mcp` to `^${luckystackVersion}` like every other framework dep; consider pinning the third-party MCP majors.

### F-08 — POSIX `.bin` symlink defeats `isCliEntry()` — published CLI may no-op on Linux/macOS `npx`  ·  severity: high  ·  status: UNCERTAIN
- **Sources:** reports(HB-1) — reports-unique
- **Current location:** `src/index.ts:1624-1632` (`isCliEntry`), `:1634` (guard)
- **Original claim:** `return path.resolve(entry) === path.resolve(__filename);` — on POSIX, npm links `.bin/create-luckystack-app` as a symlink to `dist/index.js`; `process.argv[1]` is the symlink path, `__filename` (from `import.meta.url`) is the realpath, `path.resolve` doesn't resolve symlinks → comparison fails → `main()` never runs.
- **Verification (current code):** Code is exactly as described — `path.resolve(entry) === path.resolve(__filename)` with no `fs.realpathSync`. The reasoning from Node bin-linking semantics is sound, but reports/ explicitly flagged it was reasoned, not executed on POSIX (the audit ran on Windows where the `.cmd` shim passes the real script path). I cannot execute a POSIX `npx` link here either.
- **Verdict & why:** UNCERTAIN — the code smell is real and the standard fix (`fs.realpathSync`) is missing, but confirming the actual no-op requires a Linux/macOS `npx`/`.bin`-symlink run. If true this is critical (CLI dead on the primary platform); if Node happens to realpath `argv[1]` in the install shim it's a non-issue.
- **Recommendation:** Compare against `fs.realpathSync(entry)` (the standard fix) regardless — it's strictly safer. Add a POSIX CI test that runs the linked bin.

### F-09 — `editScaffoldFile` silently skips the whole edit set when the target file is missing (asymmetric with token-drift loudness)  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** reports(Code quality #1) — reports-unique
- **Current location:** `src/index.ts:1148` (`if (!fs.existsSync(filePath)) return;`) vs :1161-1166 (throws on token count ≠ 1)
- **Original claim:** A renamed/moved template file makes the whole edit set silently no-op while `dropDependency` still removed the package → a scaffold that doesn't compile. Missing files should be as loud as missing tokens.
- **Verification (current code):** Confirmed verbatim: :1148 early-returns on a missing file with no error, while :1162-1166 throws when a token matches ≠ 1×. Asymmetric failure mode is real. (One caveat: the comment at :1222 notes the auth prune intentionally runs before the i18n prune so the i18n settings/page edit "safely no-ops on the now-removed file" — so SOME silent no-ops are deliberate, which is why a blanket throw would need an allow-list.)
- **Verdict & why:** CONFIRMED. Real asymmetric robustness gap, mitigated only for token drift.
- **Recommendation:** Make missing required files loud (throw) with an explicit allow-list for the documented cross-prune no-op cases (e.g. the i18n-after-auth settings edit).

### F-10 — Stray scaffolded project `ls-np/` committed at the package root (115 tracked files)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(Code quality #2) — reports-unique
- **Current location:** `packages/create-luckystack-app/ls-np/`
- **Original claim:** Leftover CLI test output — a full app tree referenced by nothing in src/scripts/docs; not published (absent from `package.json` `files`) but pollutes the repo and confuses greps/agents.
- **Verification (current code):** `test -d ls-np` → EXISTS. Still present in the working tree.
- **Verdict & why:** CONFIRMED. Repo hygiene, not a runtime defect. (Report-without-auto-fix: flagging, not deleting.)
- **Recommendation:** Remove `ls-np/` from the repo (and ensure scaffold smoke-test output lands in a gitignored/temp dir).

### F-11 — Template ships a non-capturing `tryCatch`, contradicting the shipped CLAUDE.md "captures to Sentry"  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(QUA-025) — review-unique
- **Current location:** `template/shared/tryCatch.ts` (whole file)
- **Original claim:** The canonical `@luckystack/core` tryCatch calls `captureException`; the template ships an inline variant that explicitly omits capture, so every scaffolded `functions.tryCatch.tryCatch` drops error reporting even when a tracker was picked — while the copied CLAUDE.md says "the server-side path captures to Sentry."
- **Verification (current code):** `template/shared/tryCatch.ts` returns the `[error, result]` tuple with NO `captureException`; its header comment confirms "No Sentry coupling here; if you want errors auto-captured … call captureException inside the catch." Confirmed drift vs the CLAUDE.md Error-Handling section copied into the scaffold.
- **Verdict & why:** CONFIRMED. An observability blind spot from day one; the decoupling comment reads deliberate, so both sides are flagged per Rule 3b.
- **Recommendation:** Either re-export the canonical capturing impl (like `template/shared/sleep.ts` does), or update the consumer-shipped CLAUDE.md Error-Handling section + the template comment to state auto-capture requires wiring.

### F-12 — Consumer-shipped CLAUDE.md is a verbatim framework copy — mandates a nonexistent `ai:index` script + references components the template lacks  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(QUA-006) — review-unique
- **Current location:** `framework-docs/CLAUDE.md` (bundled, becomes scaffold root `CLAUDE.md` via `src/index.ts:1533`); `bundleFrameworkDocs.mjs`
- **Original claim:** The copied CLAUDE.md declares `npm run ai:index` autonomous and claims the hook regenerates it, but the template package.json has no `ai:index` script; the Component Reference table points at `Navbar.tsx`/`Middleware.tsx` and `Dropdown`/`TemplateProvider` paths the template doesn't have at those paths.
- **Verification (current code):** `framework-docs/CLAUDE.md` references `ai:index` 3×; the template package.json defines only `ai:capabilities/decisions/graph/lint/product/project-index/runbooks` (no `ai:index`). The AI_INDEX_HOOK in `src/index.ts:940-953` runs ai:lint/capabilities/project-index/decisions/runbooks/product/graph — NOT ai:index. `template/src/_components/` has no `Navbar.tsx` or `Middleware.tsx` (they live under `templates/`, and Dropdown lives under `dropdown/`). Confirmed framework↔scaffold drift in the primary AI contract file.
- **Verdict & why:** CONFIRMED. For an AI-driven-consumer framework this is high-impact-on-first-session, though contained to docs → Medium.
- **Recommendation:** Transform CLAUDE.md during `bundleFrameworkDocs.mjs` (strip framework-only commands, regenerate the component table from the template tree) and add a build-time assertion that every `./X.tsx` in the table exists under `template/src/_components`.

### F-13 — Scaffold docs reference `luckystack/login/oauthProviders.ts`, a file the scaffold does not contain  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(QUA-026) — review-unique
- **Current location:** `template/README.md:94`, `template/_dot_env_dot_local_template:26`, `src/index.ts` buildOAuthEnvVars intro, `packages/server/src/verifyBootstrap.ts:72`
- **Original claim:** README table + .env.local comment + generated OAuth env intro all say `luckystack/login/oauthProviders.ts` "already wires" providers, but `template/luckystack/` has only core/, i18n/, server/. The wiring moved into `@luckystack/login`'s register entry; the references are pre-0.2.0 leftovers.
- **Verification (current code):** `grep oauthProviders.ts template/` → `README.md:94` ("Enabled OAuth providers") and `_dot_env_dot_local_template:26` ("luckystack/login/oauthProviders.ts already wires"). `ls template/luckystack/` would show no such file (only core/i18n/server). Confirmed stale references.
- **Verdict & why:** CONFIRMED. Low — an AI agent told to edit that file finds nothing and may create an overlay that replaces the auto-wired providers.
- **Recommendation:** Sweep the strings to "@luckystack/login auto-wires providers from env at boot; create luckystack/login/oauthProviders.ts only to override/add custom providers."

### F-14 — `docs/cli-flags.md` + package CLAUDE.md function index are stale vs the real parser  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(Docs #2, #4) + review(QUA-027) — both
- **Current location:** `docs/cli-flags.md`, package `CLAUDE.md` (parseArgs row, CliArgs row, runPrompts row); truth: `src/index.ts:61-71` (`VALID_FLAGS`), `:33-55` (`CliArgs`), `:378-534` (`runWizard`)
- **Original claim:** cli-flags.md documents only `--no-install/--no-prompt/--help/-h`, states "no `--flag=value` support", and embeds a 4-entry VALID_FLAGS; CLAUDE.md lists 4 CliArgs fields and describes runPrompts as a readline numbered-prompt flow.
- **Verification (current code):** `VALID_FLAGS` (:61-71) now has 13 entries incl. six `--key=value` flags. `CliArgs` (:33-55) has 13 fields. The TTY path is the arrow-key `runWizard`; readline is the non-TTY fallback. The package `CLAUDE.md` (read in context) still lists the old ~5-flag parseArgs, a 4-field CliArgs, and "Opens a readline interface" runPrompts, and omits `convertAnswersToChoices/buildNoPromptChoices/buildPresetAnswers/editScaffoldFile/pruneOptionalPackages/injectOptionalDeps/wireAiBrowserTooling/installAiIndexHook`.
- **Verdict & why:** CONFIRMED. Both scans agree; the docs lag the code by a full feature generation. Low (docs only) but high-leverage for AI consumers.
- **Recommendation:** Regenerate cli-flags.md + the CLAUDE.md function index from the current parser/exports; add a vitest assertion that every `VALID_FLAGS` entry appears in cli-flags.md.

### F-15 — `docs/scaffold-flow.md` is stale (targetDir uses slug, prompt path changed, pruner/injector steps omitted)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(Docs #3) — reports-unique
- **Current location:** `docs/scaffold-flow.md`; truth: `src/index.ts:1423`, `:1445-1447`, `:1508-1512`
- **Original claim:** Doc states `targetDir = path.resolve(cwd, args.projectName)` (code uses `slug` — the traversal defense), shows `choices = args.prompt ? runPrompts() : DEFAULT_CHOICES` (now flag-preset wizard + `buildNoPromptChoices`), and omits `injectOptionalDeps`, `pruneOptionalPackages`, `installAiIndexHook`, `wireAiBrowserTooling`.
- **Verification (current code):** :1423 resolves `slug`; :1445-1447 uses `runPrompts(buildPresetAnswers(args))` / `buildNoPromptChoices(args)`; :1508-1512 calls injectOptionalDeps + pruneOptionalPackages. The doc, if unchanged, describes the old flow.
- **Verdict & why:** CONFIRMED (doc-staleness, consistent with F-14). Low.
- **Recommendation:** Rewrite scaffold-flow.md against the current `main()` pipeline.

### F-16 — `--ai-browser` (and choice flags) silently ignored when the interactive wizard runs  ·  severity: low  ·  status: ALREADY-FIXED
- **Sources:** review(QUA-061) + reports(Missing #4 partial) — both
- **Current location:** `src/index.ts:586-598` (`buildPresetAnswers`), `:1445-1447`, `:296` (`need()` skip)
- **Original claim (review):** `args.aiBrowserTooling`/`args.noPresence` only consulted in `--no-prompt`; running with a flag but without `--no-prompt` validates then discards it (wizard re-asks).
- **Verification (current code):** `main()` now passes `buildPresetAnswers(args)` into `runPrompts` (:1446). `buildPresetAnswers` (:586-598) seeds the answer-bag from every passed flag incl. `aiBrowserTooling` and `noPresence`; `runWizard`/`runPromptsFallback` skip any key already in presets (`need()` at :296, and the wizard `skip`/preset handling). So a flag now pre-fills and skips its wizard step instead of being discarded.
- **Verdict & why:** ALREADY-FIXED. review/ pre-dated the CFG-01 flag-preset rework. (reports/ Missing #4 noted the narrower `--ai-browser=all --no-ai-docs` → forced none case still happens silently — that forcing is intentional via `normalizeChoices`/`convertAnswersToChoices`; only the lack of a stderr note remains, which is cosmetic.)
- **Recommendation:** None required for the core issue. Optionally print a one-line note when `--ai-browser` is forced to `none` because AI docs are off.

### F-17 — No non-interactive flags for db/auth/oauth/email/monitoring/i18n  ·  severity: high (as claimed)  ·  status: ALREADY-FIXED
- **Sources:** review(CFG-01) — review-unique
- **Current location:** `src/index.ts:61-71` (VALID_FLAGS), `:132-146` (value-flag parsing), `:586-622`
- **Original claim:** Only `--no-presence` and `--ai-browser` are flag-reachable; `--no-prompt` hard-locks CI/AI to mongodb+credentials+console.
- **Verification (current code):** `VALID_FLAGS` includes `--db=`, `--auth=`, `--oauth=`, `--email=`, `--monitoring=`, `--i18n`/`--no-i18n`, `--ai-docs`/`--no-ai-docs` (:63-68); the default arm of `parseArgs` parses each via `parseValueFlag` (exit 2 on bad value, :76-81, :132-146); `buildNoPromptChoices` (:611-622) and `buildPresetAnswers` (:586-598) apply them. Exactly the recommendation review/ made is now implemented (the `//? CFG-01` comments at :42-44 even cite the finding).
- **Verdict & why:** ALREADY-FIXED. This is the second clear case of review/ reading pre-commit-302cbf1 code. review/ was right about the old state; the current code resolves it.
- **Recommendation:** None.

### F-18 — `pickFromList` / `pickMulti` silently substitute the default for unrecognized input (non-TTY fallback)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(Hooks #4) + review(QUA-063) — both
- **Current location:** `src/index.ts:249` (`return match ?? defaultValue;`), `pickMulti` ~:252-280
- **Original claim:** In the piped/CI fallback an AI agent or heredoc hits, a typo like `postgres` (valid: `postgresql`) silently becomes the default (`mongodb`); pickMulti silently drops unknown tokens.
- **Verification (current code):** :249 `return match ?? defaultValue;` with no warning — confirmed. This fallback is the non-TTY path. (Note: the flag path now exits 2 on bad values via `parseValueFlag`, so the soft-fail is confined to the readline fallback when someone pipes answers instead of using flags.)
- **Verdict & why:** CONFIRMED. Low, and narrower than before now that flags are the recommended non-interactive path — but still a silent wrong-database trap for piped-stdin callers.
- **Recommendation:** Print "Unrecognized answer X — using default Y" (or re-prompt) in both helpers.

### F-19 — TEMPLATE_DIR hardcoded — no custom/organization template, no `--template` flag  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(CFG-10) + reports(Hooks #2) — both
- **Current location:** `src/index.ts:31` (`const TEMPLATE_DIR = path.resolve(__dirname, '..', 'template');`)
- **Original claim:** Only one template source; no `--template`/env/overlay, so an org standardizing on LuckyStack must fork the package.
- **Verification (current code):** :31 is the sole template root; no `--template` token in `VALID_FLAGS`, no alternate-root reference in src/docs. Confirmed.
- **Verdict & why:** CONFIRMED. Medium — fork pressure against the "external installer first" north star. (Enhancement, not a defect; report-only.)
- **Recommendation:** Add `--template <path>` (validate exists, reuse `copyTree` unchanged) and optionally `--with <dir>` for an additive overlay; document placeholder support.

### F-20 — No pre/post-scaffold extension seam (`--post-scaffold` / template manifest)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(HOK-22) — review-unique
- **Current location:** `src/index.ts:1398-1618` (`main()` fixed pipeline)
- **Original claim:** `main()` is a fixed pipeline with no post-scaffold callback; `git init`/secret-bootstrap/portal-registration requires wrapping the CLI.
- **Verification (current code):** `grep post-scaffold|postScaffold src/index.ts` → 0. The pipeline is fixed. Confirmed.
- **Verdict & why:** CONFIRMED. Low (wrapping is workable). Enhancement, report-only.
- **Recommendation:** Add `--post-scaffold "<cmd>"` (spawnSync, shell:true, cwd=targetDir, after install, choices exposed as `LS_*` env vars) or a `template.config.mjs` `postScaffold` hook if custom templates land.

### F-21 — No `--version` flag on the CLI  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(MIS-022) — review-unique
- **Current location:** `src/index.ts:61-71` (VALID_FLAGS, no `--version`/`-v`), `:671` (`readSelfVersion` already exists)
- **Original claim:** `npx create-luckystack-app --version` exits 2 "Unknown flag"; `readSelfVersion()` already loads the version for `{{LUCKYSTACK_VERSION}}`.
- **Verification (current code):** `VALID_FLAGS` (:61-71) has no `--version`/`-v`; the parser's unknown-flag arm (:147-155) exits 2 on any `--`-prefixed token it doesn't recognize, so `--version` errors. `readSelfVersion` (:671-685) is present and reusable.
- **Verdict & why:** CONFIRMED. Low (standard-flag gap), trivially fixable.
- **Recommendation:** Handle `--version`/`-v` before flag dispatch, print `readSelfVersion()`, exit 0; update cli-flags.md + printHelp.

### F-22 — No cleanup of a half-written project directory on mid-scaffold failure  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(QUA-062) — review-unique
- **Current location:** `src/index.ts:1634-1639` (`main().catch` only logs + exit 1); throw sources e.g. `editScaffoldFile` :1163, overwrite guard :1430
- **Original claim:** If copyTree/injectOptionalDeps/pruneOptionalPackages throws after mkdir/partial copy, the broken half-scaffold stays on disk and the obvious retry dies on "Target directory already exists".
- **Verification (current code):** `main().catch` (:1635-1638) logs "unexpected error" and exits 1 — no targetDir cleanup. With F-09's loud token-drift throw, a prune failure mid-copy is a realistic trigger that leaves a partial dir; the overwrite guard (:1430-1433) then blocks the retry with a non-obvious message.
- **Verdict & why:** CONFIRMED. Low UX gap, more likely now that the pruner throws on drift.
- **Recommendation:** Track whether the CLI created targetDir this run; on error either remove it (only when created this run) or print "partial scaffold left at <dir> — delete it before retrying".

### F-23 — `--oauth` discarded when authMode isn't `credentials+oauth`  ·  severity: low  ·  status: PARTIALLY-FIXED
- **Sources:** reports(Missing #3) — reports-unique
- **Current location:** `src/index.ts:606` (`normalizeChoices`), `:549-551` (`convertAnswersToChoices`)
- **Original claim:** `--no-prompt --oauth=google` with default auth=credentials scaffolds zero OAuth wiring with no warning — the explicit flag evaporates.
- **Verification (current code):** Both `normalizeChoices` (:606 `oauthProviders: choices.authMode === 'credentials+oauth' ? choices.oauthProviders : []`) and `convertAnswersToChoices` (:549-551) still zero out oauth when authMode isn't `credentials+oauth`, with no warning. The flag IS now parsed/validated (improvement over the old state), but a passed `--oauth` with a non-oauth auth mode is still silently dropped.
- **Verdict & why:** PARTIALLY-FIXED. The flag now exists and validates; the silent-drop-on-mismatch remains. Low.
- **Recommendation:** When `--oauth` is non-empty but authMode ≠ `credentials+oauth`, either warn on stderr or let `--oauth` imply `--auth=credentials+oauth`.

### F-24 — Package-manager hardcoded to npm (no `--pm` for pnpm/yarn/bun)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(Hooks #1) — reports-unique
- **Current location:** `src/index.ts:904` (`npm.cmd`/`npm`), :917 (`npx`), :971 (`prepare`), AI_INDEX_HOOK (:935-953, `npm run …`)
- **Original claim:** npm is hardcoded; pnpm/yarn/bun users can't opt out without `--no-install` + manual work; the generated prepare script and pre-commit hook also assume npm. No `--pm` flag.
- **Verification (current code):** `runNpmInstall`/`runPrismaGenerate` hardcode npm/npx (:904, :917); AI_INDEX_HOOK runs `npm run ai:*` (:940-952); no `--pm` in VALID_FLAGS. Confirmed.
- **Verdict & why:** CONFIRMED. Low (enhancement / consumer-flexibility gap). Report-only.
- **Recommendation:** Optional `--pm=<npm|pnpm|yarn|bun>` threading through both spawns and the hook, if multi-PM support is in scope for 0.2.0.

### F-25 — Target directory always `cwd/<slug>` (no `--dir`, no `create . in place`)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(Hooks #3) — reports-unique
- **Current location:** `src/index.ts:1423` (`targetDir = path.resolve(cwd, slug)`), :1413-1416 (slug-empty rejection)
- **Original claim:** Scaffolding into the current dir (`create-luckystack-app .`) is impossible (`slugify('.')` → '' → "Invalid project name"); no explicit `--dir`. The containment check is correct security-wise; the missing piece is an intentional opt-in.
- **Verification (current code):** :1412-1416 rejects an empty slug; :1423 builds targetDir from slug only; no `--dir` flag. Confirmed. The path-traversal guard (:1424-1428) is correct and should stay.
- **Verdict & why:** CONFIRMED. Low (enhancement). Report-only — the security posture is fine; this is a missing convenience opt-in.
- **Recommendation:** If desired, add `--dir <path>` (still run through the `path.relative` containment check) for in-place / custom-location scaffolds.

### F-26 — Third-party dependency versions hardcoded in the CLI (drift risk)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(Missing #2) — reports-unique
- **Current location:** `src/index.ts:988-991` (`resend ^6.0.0`, `nodemailer ^6.9.0`, `@types/nodemailer ^6.4.0`), MONITORING_PROVIDERS deps (`@sentry/node`, `posthog-node`, `dd-trace`, `hot-shots`), `@playwright/test`/`@playwright/mcp` in wireAiBrowserTooling
- **Original claim:** Pinned third-party versions age inside the published CLI with no override.
- **Verification (current code):** :988-991 confirm the email deps; the monitoring deps live in the `MONITORING_PROVIDERS` registry; the browser deps in `wireAiBrowserTooling`. All literal version ranges. Confirmed.
- **Verdict & why:** CONFIRMED. Low — maintenance drift, not a defect. Report-only (the reports/ scan itself marked it report-only).
- **Recommendation:** Optionally consolidate into one versions table; no action strictly required for 0.2.0.

### F-27 — Template `session_v1` logs the full session + returns it to the client  ·  severity: medium  ·  status: CONFIRMED (cross-area, template payload)
- **Sources:** review(SEC-14, SEC-15) — review-unique
- **Current location:** `template/src/_api/session_v1.ts:15` (`console.log(user)`), `:16-18` (`result: user`)
- **Original claim:** The template session route logs the full session (incl. token) to stdout on every request (SEC-15) and returns the raw session incl. token/csrfToken to client JS (SEC-14).
- **Verification (current code):** `main` is `({ user }) => { console.log(user); return { status:'success', result: user }; }`. The `console.log(user)` per-request logging is CONFIRMED. Whether token/csrfToken leak depends on the `SessionLayout` shape (not opened here) — the log line is the concrete confirmable defect; the raw-return concern is plausible but shape-dependent.
- **Verdict & why:** CONFIRMED for the per-request session logging (a real info-disclosure smell shipped into every scaffold). This is a template-payload finding — outside the wizard-CLI core (the reports/ scan deliberately excluded template payload), so noted as cross-area for the consumer-app reviewer to own the SEC-14 token-shape verification.
- **Recommendation:** Remove the `console.log(user)` from the template route; confirm `SessionLayout` excludes the raw token/csrfToken before returning `user` to the client (or return a sanitized projection).

## Verified non-findings (carried from reports/, re-confirmed)
- **Path traversal on project name** — blocked: directory built from the `[a-z0-9-]` slug and re-checked with `path.relative` (`src/index.ts:1412-1428`). REFUTED as a defect.
- **Command injection in spawns** — both `spawnSync` calls use `shell:false` with fully static argument arrays (`:905`, `:918`); no user data flows into argv. (Note: this is exactly why F-01's `shell:true` fix is safe.) REFUTED.
- **Prototype pollution in `replacePlaceholders`** — uses `Object.prototype.hasOwnProperty.call`. REFUTED.
- **Overwrite protection** — `:1430-1433` exits when the target dir exists. Present.
- **ReDoS** — all regexes (slugify, titleCase, parsers) are linear. REFUTED.
