# Configurability Review — LuckyStack v0.2.0

**Date:** 2026-06-11 · **ID prefix:** CFG- · **Findings:** 43 (after merging cross-area duplicates)

Scope/methodology: one combined audit agent per package/area (core, server, devkit, cli, create-luckystack-app, login, email, error-tracking, sync, api, router, secret-manager, test-runner, docs-ui, presence, consumer-app, overlays, tooling), each self-verified against the existing config surfaces (ProjectConfig, per-package `register*Config` registries, env knobs, CLI flags, hooks) and against `docs/` + `docs/audits/` to avoid re-reporting known issues. Near-duplicate reports from different area agents were merged into single entries (noted inline); IDs are stable and assigned in severity order critical → high → medium → low. The dominant theme: the v0.2.0 north star ("a stranger installs and configures without forking") is undermined by (a) documented knobs that are never read, (b) auto-register paths that run before the consumer overlay and therefore cannot be overridden, and (c) hardcoded constants/paths where sibling code already has the config-driven equivalent.

## Severity index

| ID | Severity | Title | File | Area |
|---|---|---|---|---|
| CFG-01 | high | No non-interactive flags for db/auth/oauth/email/monitoring/i18n in the scaffolder | `packages/create-luckystack-app/src/index.ts` | create-app |
| CFG-02 | high | registerRoutingRules / custom srcDir only partially honored across devkit | `packages/devkit/src/templateInjector.ts` | devkit |
| CFG-03 | high | Auto-registered mountDocsUi() shadows consumer customization at `/_docs` | `packages/docs-ui/src/register.ts` | docs-ui |
| CFG-04 | high | `auth.providerAccountStrategy: 'unified'` is a dead, documented knob | `packages/core/src/projectConfig.ts` | login |
| CFG-05 | high | Reset/email-change email copy hardcoded English, bypasses template registry | `packages/login/src/forgotPassword.ts` | login |
| CFG-06 | high | No per-route rate limit for sync routes | `packages/sync/src/handleSyncRequest.ts` | sync |
| CFG-07 | medium | check-env ignore list hardcoded in the package despite "edit per project" comment | `packages/cli/src/commands/checkEnv.ts` | cli |
| CFG-08 | medium | CLI FEATURES registry is closed to new/third-party packages | `packages/cli/src/index.ts` | cli |
| CFG-09 | medium | apiRequest and syncRequest have no response timeout — lost responses hang forever | `packages/core/src/apiRequest.ts`, `packages/sync/src/syncRequest.ts` | core + sync |
| CFG-10 | medium | TEMPLATE_DIR hardcoded — no custom/organization scaffold template | `packages/create-luckystack-app/src/index.ts` | create-app |
| CFG-11 | medium | normalizeImportPath hardcodes `src/_sockets` despite configurable generated-types path | `packages/devkit/src/typeMap/tsProgram.ts` | devkit |
| CFG-12 | medium | Supervisor watch globs stale vs scaffolded layout, not extendable | `packages/devkit/src/supervisor.ts` | devkit |
| CFG-13 | medium | SmtpSenderOptions cannot carry nodemailer transport options (TLS/pool/DKIM) | `packages/email/src/adapters/smtp.ts` | email |
| CFG-14 | medium | Sentry.init options not extensible (no release/integrations/SDK beforeSend) | `packages/error-tracking/src/sentry.ts` | error-tracking |
| CFG-15 | medium | Overlay-based registerSentryConfig silently no-ops in the auto-register flow | `packages/error-tracking/src/register.ts` | error-tracking |
| CFG-16 | medium | Zero-config PostHog path exposes no adapter options and no client handle | `packages/error-tracking/src/register.ts` | error-tracking |
| CFG-17 | medium | Reset / email-change confirmation URL paths hardcoded | `packages/login/src/forgotPassword.ts` | login |
| CFG-18 | medium | redisHealthStore ignores REDIS_USER — cannot auth to ACL Redis | `packages/router/src/redisHealthStore.ts` | router |
| CFG-19 | medium | WebSocket target service pinned to 'system' with no override | `packages/router/src/wsProxy.ts` | router |
| CFG-20 | medium | No timeout/retry on boot-time secret-manager /resolve fetch | `packages/secret-manager/src/index.ts` | secret-manager |
| CFG-21 | medium | OAuth authorize URL hardcodes `prompt=select_account`, no extra-params knob | `packages/server/src/httpRoutes/authApiRoute.ts` | server |
| CFG-22 | medium | Socket.io server options passthrough limited to three keys | `packages/server/src/loadSocket.ts` | server |
| CFG-23 | medium | OVERLAY_ORDER is a fixed whitelist — unknown overlay subfolders and nested files silently skipped | `packages/server/src/bootstrap.ts` | server + overlays |
| CFG-24 | medium | Per-check request timeout not threadable through test-runner sweeps | `packages/test-runner/src/runContractTests.ts` | test-runner |
| CFG-25 | medium | resetServerState hardcodes `/_test/reset` while the server path is configurable | `packages/test-runner/src/resetServerState.ts` | test-runner |
| CFG-26 | medium | runAllTests does not expose the rate-limit layer's documented knobs | `packages/test-runner/src/runAllTests.ts` | test-runner |
| CFG-27 | medium | Settings session endpoints hand-roll Redis keys, bypassing formatKey/key formatter | `src/settings/_api/deleteAccount_v1.ts` | consumer-app |
| CFG-28 | medium | luckystack.invariants.json cannot define project-specific invariant rules | `scripts/lintInvariants.mjs` | tooling |
| CFG-29 | low | API backpressure poll interval hardcoded at 10ms | `packages/api/src/_shared/backpressure.ts` | api |
| CFG-30 | low | Redis reconnect cap hardcoded at 50 attempts despite "raise it" comment | `packages/core/src/redis.ts` | core |
| CFG-31 | low | BOOT_KEY_PREFIX bypasses formatKey/project namespace — collides on shared Redis | `packages/core/src/bootUuid.ts` | core |
| CFG-32 | low | `cors.allowLocalhost` matches only literal `localhost`, not 127.0.0.1/[::1] | `packages/core/src/checkOrigin.ts` | core |
| CFG-33 | low | Supervisor timing constants hardcoded; crash-restart loop has no backoff/cap | `packages/devkit/src/supervisor.ts` | devkit |
| CFG-34 | low | docs-ui UI strings hardcoded English with no `strings` option | `packages/docs-ui/src/docsHtml.ts` | docs-ui |
| CFG-35 | low | renderEmailLayout hardcodes `lang="en"` and the full palette/width | `packages/email/src/renderEmailLayout.ts` | email |
| CFG-36 | low | No send timeout on the Resend adapter | `packages/email/src/adapters/resend.ts` | email |
| CFG-37 | low | Sentry cannot be force-disabled in production (`SENTRY_ENABLED=false` ignored) | `packages/error-tracking/src/sentry.ts` | error-tracking |
| CFG-38 | low | SocketStatusIndicator placement/styling hardcoded, no className/position prop | `packages/presence/src/client/SocketStatusIndicator.tsx` | presence |
| CFG-39 | low | capturePointers scans the entire inherited environment with no name allowlist | `packages/secret-manager/src/index.ts` | secret-manager |
| CFG-40 | low | Hardcoded static-file extension whitelist 404s robots.txt/sitemap.xml/fonts | `packages/server/src/httpRoutes/staticRoutes.ts` | server |
| CFG-41 | low | Sync stream backpressure sampling constants hardcoded (32 sockets / 10ms / 1KB) | `packages/sync/src/_shared/streamEmitters.ts` | sync |
| CFG-42 | low | streamWatcher connect/join-ack timeouts (3000ms) hardcoded, not covered by defaultTimeoutMs | `packages/test-runner/src/streamWatcher.ts` | test-runner |
| CFG-43 | low | scaffold:page template choice is a path-name heuristic with no override flag | `scripts/scaffoldPage.mjs` | tooling |

---

### CFG-01 (high) — No non-interactive flags for db/auth/oauth/email/monitoring/i18n — `--no-prompt` hard-locks CI and AI agents to Mongo+credentials+console

**File:** `packages/create-luckystack-app/src/index.ts:1114`
**Area:** create-luckystack-app

**Evidence/description:** The only scaffold choices reachable by flag are presence (`--no-presence`) and ai-browser (`--ai-browser=...`). Every other choice (dbProvider, authMode, oauthProviders, emailProvider, monitoringProvider, i18n, aiInstructions) is interactive-only; `--no-prompt` applies `DEFAULT_CHOICES` (mongodb, credentials, console email, no monitoring). The only non-TTY alternative is driving the fragile numbered readline fallback via piped stdin, which is undocumented.

**Why it matters for a consumer:** A CI pipeline or an AI agent (non-TTY) that wants a postgres + oauth + resend project cannot express it declaratively. This is the front door of the "stranger builds a product 100% AI-driven" north star, and the existing precedent (`--no-presence`, `--ai-browser=`) shows flag parity is the intended pattern.

**Recommendation:** Add value flags mirroring PROVIDER_OPTIONS: `--db=<mongodb|postgresql|mysql|sqlite>`, `--auth=<none|credentials|credentials+oauth>`, `--oauth=google,github`, `--email=<none|console|resend|smtp>`, `--monitoring=<none|sentry|datadog|posthog>`, `--no-i18n`, `--no-ai-docs`, validated against PROVIDER_OPTIONS exactly like `--ai-browser` (exit 2 on bad value). Flags should also pre-answer/skip the corresponding wizard steps.

### CFG-02 (high) — registerRoutingRules / custom srcDir only partially honored — templateInjector, routeMeta, importDependencyGraph hardcode `src`, `_api`, `_sync`

**File:** `packages/devkit/src/templateInjector.ts:130` (also `templateInjector.ts:327,454`; `packages/devkit/src/typeMap/routeMeta.ts:20,32,46,58`; `packages/devkit/src/importDependencyGraph.ts:160-162`; `packages/devkit/src/hotReload.ts`)
**Area:** devkit

**Evidence/description:** devkit ships a public registry (`registerRoutingRules`, routingRules.ts) and its docs promise custom markers "flow through to the watcher segment computation ... and the loader scans, so non-default layouts work without forking" (`packages/devkit/docs/loader-pipeline.md:229`). In reality several modules hardcode the defaults:
- `templateInjector.ts:130/135` — `normalized.includes('/_api/')` / `'/_sync/'`;
- `templateInjector.ts:327` — `/src\/(.+?)\/_sync\//`;
- `templateInjector.ts:454` — `normalized.indexOf('src/')` for `{{REL_PATH}}`, giving the wrong import depth when srcDir isn't literally `src`;
- `typeMap/routeMeta.ts:20/32/46/58` — `src\/(?:(.+?)\/)_api\//` etc., so type-map page paths break under custom markers or srcDir;
- `importDependencyGraph.ts:160-162` — `isRouteFile` = `includes('/src/') && ('/_api/' || '/_sync/')`, so dependency-cascade hot reload silently never fires for custom layouts.

Additionally `RoutingRules.ignore` is honored by discovery/validation walks but never consulted by the chokidar pipeline in hotReload.ts, so ignored trees still trigger reload/regeneration work.

**Why it matters for a consumer:** A consumer who uses the documented knobs gets a half-broken dev experience — broken injection, wrong type-map paths, dead hot-reload cascades — with no error pointing at the cause. The docs make a promise the code does not keep.

**Recommendation:** Route every path classification through routingRules helpers (`apiMarkerSegment()`, `syncMarkerSegment()`) and core's `getSrcDir()` instead of literal `'src'`/`'_api'`/`'_sync'`; have setupWatchers apply `rules.ignore` (chokidar `ignored` option or an early return in handleAdd/handleChange/handleDelete). Add a regression test that registers a custom marker + srcDir and asserts injection, type-map page paths, and dependency fan-out all still work.

### CFG-03 (high) — Auto-registered default mountDocsUi() shadows any consumer customization at `/_docs` — overlay override is impossible

**File:** `packages/docs-ui/src/register.ts:19` (also `packages/server/src/bootstrap.ts:103-129`, `packages/server/src/customRoutesRegistry.ts:30-36`, `packages/server/src/customRoutes.ts:68-75`)
**Area:** docs-ui

**Evidence/description:** `register.ts` unconditionally calls `registerCustomRoute(mountDocsUi())`, and bootstrapLuckyStack imports it in the auto-detect phase BEFORE the consumer overlay. The custom-routes registry is append-only with first-match-wins dispatch (registry handlers also run before `options.customRoutes`). So a consumer who follows the README quickstart (mount with `pageTitle`/`branding`/`enableTryItOut`/`enabledInProd` at the default `/_docs`) gets their handler permanently shadowed by the plain auto-registered instance: custom title/branding silently ignored in dev, and `enabledInProd: true` dead in production (the auto instance 404s `/_docs` first). register.ts's own comment (lines 8-9: "Consumers who want custom branding / routePath can still mount their own via a luckystack/docs-ui/index.ts overlay") and bootstrap.ts:101-102 ("consumer overlay file (last writer) can override the auto-wired defaults") are both false for this registry — there are no last-writer semantics and no per-handler unregister (only `clearCustomRoutes()`, which nukes every package's routes).

**Why it matters for a consumer:** The documented customization path silently does nothing. The only working escape is choosing a different routePath, which leaves the default page also live at `/_docs` and is documented nowhere.

**Recommendation:** Give registerCustomRoute keyed replace semantics (`registerCustomRoute(handler, { key: 'docs-ui' })` — last write per key wins) and use it in register.ts; the consumer overlay re-registers under the same key and genuinely overrides. Alternatively docs-ui can route through a package-level singleton (register stores options, overlay's `mountDocsUi()` updates them). Until fixed, document the shadowing + routePath workaround in README/mounting.md.

### CFG-04 (high) — `auth.providerAccountStrategy: 'unified'` is a dead config knob — declared and documented but never read

**File:** `packages/core/src/projectConfig.ts:259` (default at line 501; doc at `docs/ARCHITECTURE_EMAIL.md:133-138`)
**Area:** login

**Evidence/description:** ProjectConfig declares `providerAccountStrategy: 'per-provider' | 'unified'` (default `'per-provider'`) and ARCHITECTURE_EMAIL.md documents `'unified'` as "Same email maps to a single User. Requires schema migration documented in packages/login/README.md". But no file in `packages/login` (or anywhere outside the type declaration) reads this key — login.ts always calls `userAdapter.findByEmail({ email, provider })` provider-scoped — and `packages/login/README.md` contains no 'unified' migration doc at all.

**Why it matters for a consumer:** Setting `'unified'` is silently ignored: duplicate accounts per provider, contradicting the documented contract. A silently-dead documented knob is worse than no knob — it costs a consumer real debugging time and erodes trust in every other knob.

**Recommendation:** Either implement it (in `findOrCreateOAuthUser` and `loginWithCredentialsCore`, branch on `getProjectConfig().auth.providerAccountStrategy` to look up by email irrespective of provider and link providers) or remove the knob + its ARCHITECTURE_EMAIL.md section for 0.2.0 and re-add when implemented.

### CFG-05 (high) — Framework reset/email-change email copy is hardcoded English and bypasses the registerEmailTemplate override registry

**File:** `packages/login/src/forgotPassword.ts:90` (also `packages/login/src/emailChangeNotification.ts:50-58`, `packages/email/src/sendEmail.ts:105`, `packages/email/src/templates.ts:8-13`)
**Area:** login

**Evidence/description:** `sendPasswordResetEmail` builds the email inline ('Reset your password', 'Hi ..., we received a request...', subject `` `Reset your ${brand} password` ``) via renderEmailLayout and passes raw html/text to sendEmail; `sendEmailChangeConfirmation` does the same. sendEmail only consults the template registry when given a `template` name, so the documented escape hatch — templates.ts:8-13 explicitly says use registerEmailTemplate "to override built-in templates (e.g. swap the password-reset wording)" and claims a built-in `password-reset` fallback exists — is unreachable: no built-in template is ever registered (grep confirms zero registerEmailTemplate call sites outside the export), and the login package never dispatches by template name.

**Why it matters for a consumer:** A non-English product (the framework's own Rule 13 makes i18n mandatory) must fork or switch to forgotPassword `'custom'` and rebuild the whole flow just to translate two emails. The documented override contract is fiction.

**Recommendation:** Dispatch via `sendEmail({ template: 'password-reset', data: { resetUrl, userName, brand, ttlMinutes, language } })`, register the current copy as the built-in `password-reset` / `email-change` templates at @luckystack/email load (fulfilling the templates.ts comment), and document the override in `packages/login/docs/password-reset.md`.

### CFG-06 (high) — No per-route rate limit for sync routes — all sync shares the global defaultApiLimit

**File:** `packages/sync/src/handleSyncRequest.ts:80` (also `packages/sync/src/handleHttpSyncRequest.ts:86`)
**Area:** sync

**Evidence/description:** `applySyncRateLimits` applies the same global bucket (`config.rateLimiting.defaultApiLimit`) to every sync route; the HTTP path is identical. API routes support `export const rateLimit: number | false` per route (read by devkit `loader.ts:209` and the prod generator), but sync routes do not: the loaders never read a `rateLimit` export from `_server` files and the handlers never consult one. `docs/ARCHITECTURE_SYNC.md:496` confirms only global settings apply.

**Why it matters for a consumer:** A collab-editor cursor-move or game-tick sync needs hundreds of events/minute while a "send invite" sync should stay at ~10 — today the only lever is raising `rateLimiting.defaultApiLimit`, which simultaneously weakens every API route too. The workaround (hand-rolled checkRateLimit inside `_server` or a preSyncAuthorize hook) contradicts the per-package-config north star and the API/sync symmetry the docs promise.

**Recommendation:** Support `export const rateLimit: number | false` in sync `_server` files end-to-end: read it in devkit loader + generateServerRequests, add it to RuntimeSyncServerEntry, and use `serverSyncEntry.rateLimit ?? config.rateLimiting.defaultApiLimit` in both transports (mirroring the API handler).

### CFG-07 (medium) — check-env FRAMEWORK_ENV_KEYS ignore list is hardcoded in the package — the code comment says "edit per project" but it ships in node_modules

**File:** `packages/cli/src/commands/checkEnv.ts:16`
**Area:** cli

**Evidence/description:** The unused/missing-env scans exclude a hardcoded `FRAMEWORK_ENV_KEYS` set plus `IGNORED_PREFIXES = ['VITE_', 'TEST_']`. The comment on lines 14-15 says "Edit/extend per project as needed" — impossible without forking, since the file is compiled into `dist/index.js` inside node_modules. The list is also already staling: it still contains `DNS` while recent commits removed the DNS origin model (`refactor(oauth): remove DNS`). Only `LUCKYSTACK_ENV_FILES` (file list) has an override; the key ignore list has none.

**Why it matters for a consumer:** Any consumer with env keys consumed outside scanned code (docker-compose interpolation, CI scripts, a non-JS sidecar, keys read by another @luckystack package added later) gets permanent false "unused" findings — in a log whose header tells an LLM to DELETE those keys from `.env`.

**Recommendation:** Add a consumer knob: read extra ignore entries from a config source the consumer owns — e.g. a `checks: { env: { ignoreKeys: string[], ignorePrefixes: string[] } }` block in `luckystack.invariants.json` (already shipped by the scaffold) or a `--ignore KEY1,KEY2,PREFIX_*` CLI flag — and merge it over the built-in set. The same mechanism should let check-i18n accept extra used-key regex patterns for custom translate wrappers. Drop the stale `DNS` entry.

### CFG-08 (medium) — FEATURES registry in the CLI is closed — third-party or new optional packages cannot plug into `luckystack add` without forking

**File:** `packages/cli/src/index.ts:30`
**Area:** cli

**Evidence/description:** `const FEATURES: Record<string, FeatureSpec>` (lines 30-37) hardcodes login/presence/email/sync/error-tracking/docs-ui, and `packages/cli/CLAUDE.md` instructs maintainers to manually mirror it against OPTIONAL_PACKAGES in @luckystack/server. There is no way for a package outside that list — `@luckystack/secret-manager` (absent from the list AND from the ADD_GUIDE matrix), the separate-repo `@luckystack/monitoring`, or any future ecosystem package — to register an `add` recipe (dep + asset copies + file edits).

**Why it matters for a consumer:** Per the project's north star (per-package config beats a central bag; strangers extend without forking), the asset-injection mechanism (copyDirIfAbsent + editFile) is generic but the registry that drives it is sealed. Backend-only packages still work via plain `npm i` self-wiring, so only asset-injecting features are truly blocked — hence medium.

**Recommendation:** Support a manifest-driven fallback: when `add <feature>` misses the built-in registry, look for `node_modules/@luckystack/<feature>/luckystack.add.json` (and optionally a consumer-side `luckystack/add/<feature>.json`) describing `{ pkg, assets: [{from,to}], edits: [{file,find,replace}], note }`, executed through the existing copyDirIfAbsent/editFile helpers. The built-in FEATURES become bundled instances of the same format.

### CFG-09 (medium) — apiRequest and syncRequest have no response timeout — a lost response hangs the caller forever

**File:** `packages/core/src/apiRequest.ts:216` (emit at 373, listener at 431; `packages/core/src/socketState.ts:19-20`), `packages/sync/src/syncRequest.ts:521` (abort path 502-519)
**Area:** core + sync (merged — two area agents reported the same gap on the two request surfaces)

**Evidence/description:** Both request promises settle only via a `socketInstance.once(...ResponseEventName(tempIndex), ...)` listener (or, for syncRequest, an optional caller-supplied AbortSignal). If the server restarts/crashes between the emit and the response, the per-request server state is gone, the response event never fires, and the caller's `await` hangs indefinitely — for syncRequest the progress/abort listeners also leak. No timeout exists anywhere in either file (grep-confirmed), and there is no `api.requestTimeoutMs` / `sync.requestTimeoutMs` in projectConfig. Related hardcode: `waitForSocket` polls 10ms × 500 = fixed 5s.

**Why it matters for a consumer:** Any production deploy/restart while users have in-flight requests leaves UI spinners stuck until reload. The AbortSignal workaround requires every call site to build its own AbortController + setTimeout, which an AI-built consumer will not do consistently.

**Recommendation:** Add `timeoutMs?: number` per call plus project defaults `projectConfig.api.requestTimeoutMs` and `projectConfig.sync.requestTimeoutMs` (e.g. 30000, `false` to disable). On expiry: remove listeners, clean abort controller/progress handlers, resolve with a normalized error envelope (`{ status: 'error', errorCode: 'api.timeout' | 'sync.requestTimeout', httpStatus: 504 }`).

### CFG-10 (medium) — TEMPLATE_DIR is hardcoded — no custom/organization template support without forking the package

**File:** `packages/create-luckystack-app/src/index.ts:31`
**Area:** create-app

**Evidence/description:** `const TEMPLATE_DIR = path.resolve(__dirname, '..', 'template');` is the only template source; there is no `--template` flag, env var, or extra-files overlay mechanism (verified: no other reference to an alternate template root in src/ or docs/).

**Why it matters for a consumer:** A company standardizing on LuckyStack with its own branding, extra pages, or stricter eslint config must fork create-luckystack-app (or scaffold-then-patch every time) — exactly the fork pressure the packaging north star ("external installer first") is meant to eliminate.

**Recommendation:** Add `--template <path>` (and optionally `--with <dir>` for an additive overlay copied after the base template with the same placeholder substitution). Validate the dir exists, then reuse copyTree unchanged. Document that placeholder vars (`{{PROJECT_NAME}}` etc.) work in custom templates.

### CFG-11 (medium) — normalizeImportPath hardcodes ROOT_DIR/src/_sockets despite configurable generatedSocketTypes path

**File:** `packages/devkit/src/typeMap/tsProgram.ts:146` (lines 145-155; also `packages/devkit/src/typeMap/extractors.ts:18-26`)
**Area:** devkit

**Evidence/description:** Both files compute emitted import specifiers relative to `path.join(ROOT_DIR, 'src', '_sockets')` — the DEFAULT location of `apiTypes.generated.ts`. But the actual location is a project-config knob: `paths.generatedSocketTypes` (`packages/core/src/projectConfig.ts:538`, resolved by `getGeneratedSocketTypesPath()`), and devkit's own `functionsMeta.ts:60` already derives the directory correctly via `path.dirname(getGeneratedSocketTypesPath())`.

**Why it matters for a consumer:** A consumer who relocates the generated artifacts (the documented core-level override, devkit CLAUDE.md line 95) gets unresolvable relative imports for any unresolved-symbol fallback in the emitted type map.

**Recommendation:** Replace the hardcoded `fromDir` in both files with `path.dirname(getGeneratedSocketTypesPath())` (matching functionsMeta.ts), and update `docs/ts-program-cache.md:143` accordingly.

### CFG-12 (medium) — Supervisor watch globs are stale vs the scaffolded layout and not extendable

**File:** `packages/devkit/src/supervisor.ts:50` (CORE_WATCH_GLOBS, lines 50-59)
**Area:** devkit

**Evidence/description:** CORE_WATCH_GLOBS watches `server/bootstrap/**/*.ts`, `server/auth/**/*.ts`, and `server/functions/{db,redis,sentry}.ts`. In both this repo and the create-luckystack-app template, those paths do not exist: the shims live at root `functions/` (functions/db.ts, redis.ts, sentry.ts, session.ts) and the template's `server/` contains only `config/`, `hooks/`, `server.ts`. The only knob is LUCKYSTACK_ENV_FILES (env-file list); there is no way to add watch globs without forking. (The related tsx-path/child-command hardcoding is already recorded in `docs/audits/CODE_QUALITY_AUDIT.md` — this finding is specifically the stale/inextensible watch list.)

**Why it matters for a consumer:** Editing `functions/db.ts` (Prisma wiring), `server/hooks/**`, `server/config/**`, `services.config.ts` or `deploy.config.ts` does NOT restart the dev server — stale-server confusion with zero feedback. The watch list has DRIFTED from the layout the scaffolder actually ships.

**Recommendation:** Update the default globs to the actual scaffold layout (`functions/*.ts`, `server/**/*.ts`, `services.config.ts`, `deploy.config.ts`) and add an env override consistent with LUCKYSTACK_ENV_FILES, e.g. `LUCKYSTACK_SUPERVISOR_WATCH="glob1,glob2"` (append) — the supervisor deliberately cannot read projectConfig, so an env knob fits its no-core-import invariant.

### CFG-13 (medium) — SmtpSenderOptions cannot carry nodemailer transport options (TLS, pooling, timeouts, DKIM) — on-prem relay use case requires forking the adapter

**File:** `packages/email/src/adapters/smtp.ts:5` (lines 5-15)
**Area:** email

**Evidence/description:** SmtpSenderOptions is a closed shape: `{ host, port, secure?, auth?, from? }`, and only those fields reach `factory(smtpConfig)`. `adapters.md:118` names "self-hosters, AWS SES via SMTP, on-prem relay servers" as the headline use case — exactly the audience that needs `tls: { rejectUnauthorized: false }` (self-signed internal relay), `pool: true`, `connectionTimeout`, `dkim`, or `requireTLS`. None are passable, and the env-driven autoSelect/register.ts auto-wire path is similarly locked.

**Why it matters for a consumer:** The documented escape hatch (adapters.md:259 "Writing a custom adapter") works but means reimplementing the whole SMTP adapter and abandoning the zero-code env auto-wiring — against the "install without forking" north star.

**Recommendation:** Add `transportOptions?: Record<string, unknown>` to SmtpSenderOptions, shallow-merged into the createTransport config (explicit fields win), plus an emailConfig knob (e.g. `emailConfig.smtp.transportOptions`) so the autoSelect/register.ts path can carry it too. Document in adapters.md.

### CFG-14 (medium) — Sentry.init options are not extensible — no release, sendDefaultPii, integrations, profilesSampleRate, or SDK-level beforeSend knob

**File:** `packages/error-tracking/src/sentry.ts:79` (registry shape at `packages/error-tracking/src/sentryConfig.ts:23-31`)
**Area:** error-tracking

**Evidence/description:** `initializeSentry()` hardcodes the entire Sentry.init option bag; `registerSentryConfig` only exposes `server.tracesSampleRate` and `server.ignoreErrors`. A real production consumer needs at minimum `release` (release health / regressions — a core Sentry feature), and plausibly `dist`, `integrations` (profiling), `profilesSampleRate`, `maxBreadcrumbs`, `sendDefaultPii`, or their own SDK-level `beforeSend`. The documented escape hatch — skip initializeSentry and call Sentry.init directly (sentry-integration.md step 3) — explicitly costs the built-in cookie redaction and config-driven sample rates, and since 0.2.0 the auto-register path calls `initializeSentry()` anyway whenever SENTRY_DSN is set, so the consumer's own init and the framework's fight over the client (last one wins).

**Why it matters for a consumer:** Standard production Sentry hygiene (release tracking) is impossible without losing the framework's redaction, or racing two inits.

**Recommendation:** Add a passthrough slot to the per-package config: `registerSentryConfig({ server: { init?: Partial<Sentry.NodeOptions> } })`, spread last over the built-in options (with the built-in beforeSend composed, not replaced). At minimum add `release` and a composable `beforeSend`.

### CFG-15 (medium) — In the auto-register flow, overlay-based registerSentryConfig silently no-ops (init runs before the overlay)

**File:** `packages/error-tracking/src/register.ts:27` (ordering at `packages/server/src/capabilities.ts:52-53`)
**Area:** error-tracking

**Evidence/description:** bootstrapLuckyStack imports `@luckystack/error-tracking/register` (which calls `initializeSentry()` at register.ts:27) BEFORE the consumer overlay folder, on the stated theory that "a hand-written overlay (last writer) still wins". But Sentry config is snapshotted at init time: `sentry-integration.md:349` itself says "Calling registerSentryConfig AFTER initializeSentry() has no effect on the SDK". So a `luckystack/sentry/*.ts` overlay that calls `registerSentryConfig({ server: { tracesSampleRate: ... } })` runs after Sentry.init and is silently ignored — no warning, no error.

**Why it matters for a consumer:** The 0.2.0 "npm i + env + restart, no code edit" promise breaks for Sentry tuning. The only working path is editing server.ts before the bootstrap call, which the install-anytime model says you shouldn't need.

**Recommendation:** Either defer `initializeSentry()` until after the overlay phase (a register-exported init callback the bootstrap invokes post-overlay), or detect the late registerSentryConfig call (flag set by initializeSentry) and log a loud warning with the fix, or re-apply mutable options to the live client via `Sentry.getClient().getOptions()` on late registration.

### CFG-16 (medium) — Zero-config PostHog path exposes no adapter options and no client handle

**File:** `packages/error-tracking/src/register.ts:52`
**Area:** error-tracking

**Evidence/description:** The env-gated auto-registration constructs `new mod.PostHog(posthogKey, { host: process.env.POSTHOG_HOST })` and `createPostHogAdapter({ client })` with no way for the consumer to set `anonymousDistinctId`, a `beforeSend` redaction hook, or posthog-node client options (flushAt, flushInterval, personalApiKey) — and the internally-created client is never exposed, so the consumer cannot call `client.shutdown()` on graceful stop even though `docs/adapter-pattern.md:343-344` says "The consumer owns the client lifecycle (creation + shutdown())". That ownership claim is simply false on the register path.

**Why it matters for a consumer:** A consumer needing any of these must abandon the zero-config path entirely and hand-wire in the overlay — but then the POSTHOG_KEY env still triggers the register path too (double adapter, plus the init replace-race noted in CFG-15's sibling pattern).

**Recommendation:** Add a `registerPostHogConfig({ anonymousDistinctId?, beforeSend?, clientOptions? })` per-package registry read by register.ts (consistent with registerSentryConfig), expose the created client (e.g. `getAutoRegisteredPostHogClient()`), and skip auto-registration when the consumer registered their own PostHog adapter.

### CFG-17 (medium) — Reset and email-change confirmation URL paths hardcoded (`/reset-password`, `/settings/confirm-email`)

**File:** `packages/login/src/forgotPassword.ts:87` (also `packages/login/src/emailChangeNotification.ts:47`)
**Area:** login

**Evidence/description:** forgotPassword.ts:87 builds `` `${baseUrl}/reset-password?token=...` `` and emailChangeNotification.ts:47 builds `` `${baseUrl}/settings/confirm-email?token=...` `` with hardcoded path segments. Only the host (`app.publicUrl`) is configurable.

**Why it matters for a consumer:** A consumer who renames/moves the scaffolded pages (e.g. localized routes `/wachtwoord-herstellen`, or a settings area at `/account`) gets emails linking to 404s, with no knob short of switching to forgotPassword `'custom'` and reimplementing the orchestrator.

**Recommendation:** Add `auth.passwordResetPath` (default `'/reset-password'`) and `auth.emailChangeConfirmPath` (default `'/settings/confirm-email'`) to ProjectConfig and read them in both orchestrators; alternatively accept an optional `urlBuilder: (token) => string` argument.

### CFG-18 (medium) — redisHealthStore ignores REDIS_USER — cannot auth to ACL/username Redis

**File:** `packages/router/src/redisHealthStore.ts:40` (lines 40-45; correct pattern at `packages/router/src/bootHandshake.ts:98`, `packages/core/src/redis.ts:68-73`)
**Area:** router

**Evidence/description:** createRedisHealthStore builds its own ioredis clients from raw env: `host: process.env.REDIS_HOST`, `port: process.env.REDIS_PORT`, `password: process.env.REDIS_PASSWORD`. It does NOT read REDIS_USER and does NOT reuse core's `getRedisConnectionOptions()` (which DOES include `username` from REDIS_USER). bootHandshake.ts:98 correctly uses getRedisConnectionOptions, so the two router Redis code paths have DRIFTED. startRouter calls createRedisHealthStore with only `{ envKey, onExternalChange }` (startRouter.ts:92-100), so the input overrides can't compensate.

**Why it matters for a consumer:** A deployment on Redis 6+ ACL requiring a username gets a working boot handshake but a health store that fails to authenticate (NOAUTH/WRONGPASS) — which in split/fallback mode hard-fails startup (startRouter.ts:101-106).

**Recommendation:** Replace the raw-env client construction in redisHealthStore with `getRedisConnectionOptions()` from @luckystack/core (spread its `{ host, port, username?, password? }`), matching bootHandshake. This also removes the duplicated connection logic.

### CFG-19 (medium) — WebSocket target service hardcoded to 'system' with no config/CLI override

**File:** `packages/router/src/wsProxy.ts:14` (also line 22; call site `packages/router/src/startRouter.ts:138`)
**Area:** router

**Evidence/description:** All WS upgrades are pinned to `DEFAULT_WS_SERVICE = 'system'`. createWsProxy accepts a `wsTargetService` param, but startRouter calls `createWsProxy({ resolver })` without it, StartRouterInput exposes no such field, there is no `deploy.routing` key for it, and the CLI has no flag.

**Why it matters for a consumer:** A consumer whose socket-holding bundle/service is not literally named `system` (a stranger building their own preset layout per the north star) gets a 502 on every WebSocket upgrade with no way to fix it short of forking. The single-binding-per-service WS model is documented, but the service NAME being fixed is not.

**Recommendation:** Thread `wsTargetService` through StartRouterInput and add `deploy.routing.websocketService?: string` (default `'system'`) consumed in startRouter when constructing the WS proxy; document it alongside the other `routing.*` knobs in CLAUDE.md.

### CFG-20 (medium) — No timeout or retry on the boot-time /resolve fetch — remote-mode boot can hang for minutes or crashloop on a transient blip

**File:** `packages/secret-manager/src/index.ts:175` (SecretManagerConfig at lines 37-74)
**Area:** secret-manager

**Evidence/description:** fetchResolve calls `await fetchFn(endpoint, { method: 'POST', headers, body })` with no AbortSignal, no timeout and no retry. In `'remote'` mode (the default, and what the shipped boot seam `server/bootstrap/initSecrets.ts` hardcodes) a hung secret server blocks the entire server boot until undici's ~300s headersTimeout, and a single transient network blip (e.g. secret server restarting during a rolling deploy) is an immediate hard boot crash. SecretManagerConfig has no timeoutMs/retries fields.

**Why it matters for a consumer:** In k8s a transient blip means a crashloop until the secret server is back. The only escape hatch is wrapping `fetchImpl`, which forces every consumer to hand-roll AbortSignal/retry logic for the most common production need.

**Recommendation:** Add per-package knobs to SecretManagerConfig: `timeoutMs?: number` (default e.g. 10_000, via `AbortSignal.timeout(timeoutMs)` passed to fetch) and `retries?: { count: number; delayMs: number }` (default 0 to preserve current behavior). Document that retries apply per resolve attempt and that `'remote'` mode still throws after exhaustion.

### CFG-21 (medium) — OAuth authorize URL hardcodes `prompt=select_account` with no extra-params knob

**File:** `packages/server/src/httpRoutes/authApiRoute.ts:63` (lines 62-64; interface at `packages/login/src/oauthProviders.ts:33`)
**Area:** server

**Evidence/description:** authApiRoute builds the authorize redirect with a hardcoded `&prompt=select_account` and exactly six fixed params. The OAuthProvider interface (verified) has no field for extra authorization params.

**Why it matters for a consumer:** Realistic needs are blocked: Google offline access (`access_type=offline&prompt=consent` for a refresh token), silent SSO (`prompt=none`), OIDC `nonce`, Auth0 `audience`, Microsoft `domain_hint` — and some IdPs reject or mis-handle an unexpected `prompt`. A consumer registering a custom provider (which the registry supports) still cannot influence the URL the server package builds.

**Recommendation:** Add `extraAuthorizationParams?: Record<string,string>` (and make `prompt` part of it, defaulting to `{ prompt: 'select_account' }`) to OAuthProvider; authApiRoute spreads them into the URLSearchParams. Per-package config, no central bag.

### CFG-22 (medium) — Socket.io server options passthrough limited to three keys — no path/transports/connectionStateRecovery/perMessageDeflate

**File:** `packages/server/src/loadSocket.ts:87` (lines 87-102)
**Area:** server

**Evidence/description:** loadSocket constructs `new SocketIOServer(httpServer, { cors, maxHttpBufferSize, pingTimeout, pingInterval })`. Only those three numerics are configurable (`projectConfig.socket.*`). A consumer cannot change the engine path (default `/socket.io` — collides with a reverse-proxy prefix or another app on the same domain), restrict `transports: ['websocket']` (common behind LBs that mishandle polling), enable `connectionStateRecovery`, tune `perMessageDeflate`, or set `allowEIO3`. registerSocketMiddleware exists but middlewares cannot alter server construction options.

**Why it matters for a consumer:** Forking loadSocket is the only escape hatch today for standard deployment realities (LBs, shared domains).

**Recommendation:** Add `socket.serverOptions?: Partial<ServerOptions>` to ProjectConfig (or `ioOptions` on CreateLuckyStackServerOptions) spread last into the constructor: `{ cors, ...defaults, ...config.socket.serverOptions }`, documenting that cors/origin stays framework-owned unless explicitly overridden.

### CFG-23 (medium) — OVERLAY_ORDER is a fixed whitelist — overlay subfolders with custom names (and nested files) are silently skipped, with no extension knob

**File:** `packages/server/src/bootstrap.ts:38` (lines 38-56, loader at 74-76, readdir at 86-91; options at 24-36; doc at `packages/server/docs/create-server.md:131`)
**Area:** server + overlays (merged — reported identically by the pkg-server and overlays area agents)

**Evidence/description:** loadOverlayFolder iterates only the hardcoded `OVERLAY_ORDER = ['core','deploy','login','email','sentry','presence','docs-ui','server']` and reads only top-level `*.ts`/`*.js` per folder (readdirSync, non-recursive). Any other subfolder — `luckystack/stripe/`, `luckystack/monitoring/` (the separate-repo @luckystack/monitoring adapter is an explicitly planned consumer), `luckystack/secrets/`, or a typo like `luckystack/logins/` — is skipped with zero warning, as is any nested file like `luckystack/server/hooks/audit.ts`. BootstrapLuckyStackOptions exposes only `overlayRoot` and `skipOverlayLoad`; there is no `overlayOrder` / `extraOverlayPackages` option, and create-server.md documents the canonical order without stating that everything else is dropped. The `server` catch-all folder is undiscoverable as the intended escape hatch.

**Why it matters for a consumer:** The documented pattern is "each subfolder mirrors a framework package", but nothing stops or warns about other names — registrations a consumer reasonably places in a new subfolder silently never run: no error, no warning, feature just absent at runtime. Both a configurability gap and a silent-failure trap.

**Recommendation:** After walking OVERLAY_ORDER, load any remaining (unknown) subfolders alphabetically — last-writer-wins already makes this safe — or add `overlayOrder?: string[]` / `extraOverlayPackages?: string[]` to BootstrapLuckyStackOptions. Independently, emit a boot warning for any `luckystack/` subfolder or nested `.ts` file that was not loaded, and document the whitelist + non-recursive behavior in create-server.md.

### CFG-24 (medium) — Per-request timeout (5s/10s) is overridable on single checks but not threadable through the sweeps or runAllTests

**File:** `packages/test-runner/src/runContractTests.ts:40` (lines 40-45; default at `packages/test-runner/src/contractCheck.ts:4`)
**Area:** test-runner

**Evidence/description:** contractCheck.ts hardcodes DEFAULT_REQUEST_TIMEOUT_MS=5000 (authEnforcementCheck 5000, rateLimitCheck 10000, fuzzCheck 5000) and each `*Check` input accepts `requestTimeoutMs` — but the sweep runners never forward it: RunContractTestsInput, RunAuthEnforcementTestsInput, RunRateLimitTestsInput, RunFuzzTestsInput and RunAllTestsInput have no requestTimeoutMs field, and runContractTests calls runContractCheck without one. contractCheck.ts's own docstring names the realistic scenario: "Bump for slow endpoints (AI calls, large reports) where the framework default would false-fail the contract check".

**Why it matters for a consumer:** A consumer running `npm run test` (runAllTests) cannot bump the timeout for any endpoint without reimplementing the sweep loop — slow endpoints false-fail permanently.

**Recommendation:** Add `requestTimeoutMs?: number` (or `timeoutFor?: (endpoint) => number` for per-endpoint control) to all four Run*TestsInput types and RunAllTestsInput, thread through to the checks, and expose as TEST_REQUEST_TIMEOUT_MS in scripts/testAll.ts.

### CFG-25 (medium) — resetServerState hardcodes `/_test/reset` while the server path is consumer-configurable

**File:** `packages/test-runner/src/resetServerState.ts:18` (server side at `packages/server/src/httpRoutes/testResetRoute.ts:12`)
**Area:** test-runner

**Evidence/description:** resetServerState builds `` `${baseUrl}/_test/reset` `` as a string literal. The server resolves the route from config: `if (routePath !== getProjectConfig().http.testResetEndpoint) return false;` and server CLAUDE.md documents `projectConfig.http.testResetEndpoint` as a knob (default `'/_test/reset'`). The two sides have DRIFTED: one configurable, one literal.

**Why it matters for a consumer:** Customizing the endpoint path yields a test-runner that silently POSTs to a 404 — and because the boolean return is ignored at `runRateLimitTests.ts:89`, resetBetweenEndpoints degrades into a no-op with no error.

**Recommendation:** Read the path from `getProjectConfig().http.testResetEndpoint` (core is already a dependency and customTests.ts already uses getProjectConfig) with an optional `path?: string` override on ResetServerStateInput for cross-process targets.

### CFG-26 (medium) — runAllTests does not expose the rate-limit layer's documented knobs (maxRateLimitToTest, resetBetweenEndpoints, resetToken)

**File:** `packages/test-runner/src/runAllTests.ts:98` (input type at lines 21-39, call at 99-106; knobs at `packages/test-runner/src/runRateLimitTests.ts:18-30`)
**Area:** test-runner

**Evidence/description:** RunRateLimitTestsInput documents maxRateLimitToTest (default 50), resetBetweenEndpoints and resetToken (also advertised in CLAUDE.md:80-81). But RunAllTestsInput has none of them, and the call passes only map/baseUrl/skip/headers/inputFor. scripts/testAll.ts adds no env vars for them either.

**Why it matters for a consumer:** The documented orchestrator (`npm run test`) silently pins maxRateLimitToTest=50 and never resets between endpoints — a consumer with `rateLimit: 100` endpoints sees them skipped with no way to opt in short of writing their own orchestration script. Realistic: staging CI wanting resetBetweenEndpoints+resetToken.

**Recommendation:** Add `maxRateLimitToTest?`, `resetBetweenEndpoints?`, `resetToken?` to RunAllTestsInput, forward them to runRateLimitTests, and surface TEST_MAX_RATE_LIMIT / TEST_RESET_BETWEEN / TEST_RESET_TOKEN env vars in scripts/testAll.ts + both template copies.

### CFG-27 (medium) — Settings session endpoints hardcode the Redis key shape instead of formatKey()/activeUsersKeyFor(), breaking custom key formatters / multi-tenancy

**File:** `src/settings/_api/deleteAccount_v1.ts:38` (also `src/settings/_api/listSessions_v1.ts:22,30,32`, `src/settings/_api/revokeSession_v1.ts:30`; all three copies ship in the create-luckystack-app template + cli assets)
**Area:** consumer-app

**Evidence/description:** deleteAccount (`` `${PROJECT_NAME}-activeUsers:${user.id}` ``), listSessions (`` `${PROJECT_NAME}-activeUsers:` `` + `` `${PROJECT_NAME}-session:` ``), and revokeSession (`` `${PROJECT_NAME}-session:${targetToken}` ``) all rebuild Redis keys by string-concatenating `process.env.PROJECT_NAME ?? 'luckystack'`. Core ships `formatKey('-activeUsers', id)` / `formatKey('-session', token)` and login exports `activeUsersKeyFor`/`sessionKeyFor` precisely so `registerRedisKeyFormatter()` (the documented multi-tenant per-tenant prefixing hook) can rewrite every key. These hand-rolled keys bypass the formatter entirely.

**Why it matters for a consumer:** A consumer who registers a custom formatter (multi-tenancy, key migration) has these endpoints read/write the WRONG keys — listSessions returns empty, revokeSession silently fails to find sessions, deleteAccount leaves the activeUsers set orphaned. The breakage ships identically in framework repo, template, and cli copies.

**Recommendation:** Replace the literal templates with the framework key builders: import `activeUsersKeyFor`/`sessionKeyFor` from @luckystack/login (or `formatKey` from @luckystack/core) and drop the local `PROJECT_NAME` constant + `process.env` read. This routes through the active key formatter and `getProjectName()`. Apply to all three endpoints in all three copies.

### CFG-28 (medium) — luckystack.invariants.json cannot define project-specific invariant rules — only reclassify the 3 built-ins

**File:** `scripts/lintInvariants.mjs:131` (RULES at lines 48-98, loadConfig at 131-137, mirror header at 26-27)
**Area:** tooling

**Evidence/description:** The RULES array (no-as-any, no-arbitrary-color, i18n-jsx) is hardcoded, and loadConfig reads only `{ block: [], warn: [] }` from luckystack.invariants.json — a consumer can promote/demote the three shipped rules but cannot ADD one. Editing the script itself is forbidden by its own header, which declares it a byte-for-byte mirror of the template copy.

**Why it matters for a consumer:** A real consumer wanting their own diff-time invariant (e.g. "no moment.js imports", "no direct @prisma/client import in components" — the latter is literally a CLAUDE.md convention with no machine check) has no path. The whole point of this tool is encoding per-project AI contracts, so per-project rules are the obvious first extension request.

**Recommendation:** Support a `custom` array in luckystack.invariants.json: `{ "custom": [{ "id": "no-momentjs", "pattern": "from 'moment'", "message": "use date-fns", "files": "\\.(ts|tsx)$", "severity": "warn" }] }`, compiled into the RULES list at load time. Keeps the script itself mirror-safe while making the invariant set per-project.

### CFG-29 (low) — API backpressure poll interval hardcoded at 10ms (only the threshold is overridable)

**File:** `packages/api/src/_shared/backpressure.ts:34` (default threshold at line 18)
**Area:** api

**Evidence/description:** `createApiFlushPressure` polls the socket write-buffer every `setTimeout(resolve, 10)`, with a default threshold of `1_048_576` bytes. The threshold is per-call configurable via `thresholdBytes`; the 10ms cadence is a fixed literal with no knob. (Sibling constants on the sync streaming side are CFG-41.)

**Why it matters for a consumer:** Streaming many small chunks to thousands of concurrent sockets may want a coarser interval (less CPU churn) or a finer one (lower latency); neither is reachable without forking. Not security-sensitive.

**Recommendation:** Expose the poll interval as an optional field (e.g. `flushPressure({ thresholdBytes, pollIntervalMs })`) defaulting to 10, or read a `socket`/`sync` config key from getProjectConfig() so it can be set per-project.

### CFG-30 (low) — Redis reconnect cap hardcoded at 50 attempts despite comment saying "raise it"

**File:** `packages/core/src/redis.ts:18`
**Area:** core

**Evidence/description:** `MAX_REDIS_RECONNECT_ATTEMPTS = 50` (~1 minute with the capped backoff) is a module const; the inline comment ends with "Raise it for longer outage tolerance" but there is no knob, env var, or registry to raise it.

**Why it matters for a consumer:** Managed-Redis maintenance windows routinely exceed 1 minute; after the cap the default client gives up permanently while the Node process stays alive serving errors. The only escapes are forking or registering a fully custom Redis client.

**Recommendation:** Read from projectConfig (e.g. `redis: { maxReconnectAttempts, maxBackoffMs }`) or env `LUCKYSTACK_REDIS_MAX_RECONNECTS` at client-build time; keep 50 as default.

### CFG-31 (low) — BOOT_KEY_PREFIX bypasses formatKey/project namespace — collides on shared Redis

**File:** `packages/core/src/bootUuid.ts:12`
**Area:** core

**Evidence/description:** Boot UUIDs are written to literal `luckystack:boot:<envKey>` — the only framework key family NOT routed through `formatKey()`/`getProjectName()` (sessions, rate-limit, lease, oauth-state are all project-prefixed).

**Why it matters for a consumer:** Two LuckyStack projects sharing one Redis instance (an explicitly supported, footgun-documented topology in ARCHITECTURE_MULTI_INSTANCE.md) with the same envKey (`production`) overwrite each other's boot UUID, causing the router boot-handshake /_health cross-check to mis-detect drift or false-match. A multi-tenant redisKeyFormatter cannot fix it because the call site doesn't use formatKey.

**Recommendation:** Include the project name in the key (`luckystack:boot:<projectName>:<envKey>`) or route through `formatKey('boot', envKey)`; bump in lockstep with @luckystack/router's reader since BOOT_KEY_PREFIX is the declared single source of truth for both.

### CFG-32 (low) — `cors.allowLocalhost` matches only the literal `localhost`, not 127.0.0.1/[::1]

**File:** `packages/core/src/checkOrigin.ts:28`
**Area:** core

**Evidence/description:** isLocalhostOrigin is `/^https?:\/\/localhost(:\d+)?$/i`. A dev frontend served from `http://127.0.0.1:5173` (Vite prints both URLs; some tooling defaults to the IP) is rejected even with `allowLocalhost: true`; the bind-address same-origin allowance only covers the exact bind ip:port, not the Vite port.

**Why it matters for a consumer:** Surfaces as a confusing CORS rejection in dev. Workaround exists (add the IP form to allowedOrigins), but the knob's name promises more than it delivers.

**Recommendation:** Extend the regex to loopback forms: `^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$`, keeping the allowLocalhost gate; document the broadened meaning in CorsConfig's jsdoc.

### CFG-33 (low) — Supervisor timing constants hardcoded; crash-restart loop has no backoff or cap

**File:** `packages/devkit/src/supervisor.ts:20` (lines 20-21, 172, 185-188)
**Area:** devkit

**Evidence/description:** `RESTART_DEBOUNCE_MS = 150`, `CRASH_RESTART_DELAY_MS = 300`, the 1500ms force-exit grace, and the watcher's awaitWriteFinish `stabilityThreshold: 120 / pollInterval: 20` are all hardcoded — while the equivalent src-watcher values ARE config knobs (`dev.watcherStabilityThresholdMs` / `dev.watcherPollIntervalMs` / `dev.hotReloadDebounceMs`).

**Why it matters for a consumer:** A crashing-on-boot server (bad config.ts, port in use) respawns every 300ms forever with no exponential backoff or max-attempts, flooding the terminal. Slower disks/Docker volumes need a larger stabilityThreshold; CI wrappers want a restart cap.

**Recommendation:** Read env overrides (matching the supervisor's no-core-import design): `LUCKYSTACK_SUPERVISOR_RESTART_DEBOUNCE_MS`, `LUCKYSTACK_SUPERVISOR_CRASH_DELAY_MS`, plus exponential backoff capped at e.g. 10 consecutive crashes before requiring a file change to retry.

### CFG-34 (low) — docs-ui UI strings hardcoded English with no `strings` option — only escape hatch is full template replacement

**File:** `packages/docs-ui/src/docsHtml.ts:331` (also lines 239, 251-259, 360-363, 415)
**Area:** docs-ui

**Evidence/description:** User-visible strings are fixed: "No API docs available. Run npm run generateArtifacts..." (331), "Filter by route name…" (415), "No matches." (363), 'endpoints'/'pages' pills (360-361), "Try it out (live request)" (239), 'login required'/'public' auth tags (251-259).

**Why it matters for a consumer:** The framework mandates i18n for user-facing text (CLAUDE.md Rule 13), and a non-English team's internal portal (the advertised enabledInProd use case) cannot translate without replacing the entire template via DocsTemplateBuilder — forfeiting the whole default renderer for a few labels. Low because it is a dev tool and the template escape hatch exists.

**Recommendation:** Add `strings?: Partial<DocsUiStrings>` to MountDocsUiOptions/RenderDocsHtmlOptions (keys: filterPlaceholder, emptyState, noMatches, tryItOutLabel, sendLabel, authPublic, authLoginRequired, endpointsPill, pagesPill) merged over English defaults and passed into renderDocsCss/renderDocsScript.

### CFG-35 (low) — renderEmailLayout hardcodes `lang="en"` and the full visual palette/width — only the accent color is a knob

**File:** `packages/email/src/renderEmailLayout.ts:60`
**Area:** email

**Evidence/description:** `<html lang="en">`, body background `#f5f5f5`, card width `560`, text colors `#1E1F21`/`#454648`/`#6b7280`/`#9ca3af`, border `#e5e5e5`, CTA text `#ffffff` are all literals; only `accent` and `brand` are parameters.

**Why it matters for a consumer:** A Dutch-language product (this maintainer's own market) sends framework password-reset/email-change emails declaring `lang="en"`, affecting screen readers and some client rendering heuristics; a dark-branded product cannot adjust the palette. Mitigating (hence low): consumers can author fully custom HTML in their own templates — but the framework-internal login emails use this helper, so changing their lang/colors today means overriding the entire email flow rather than one knob (compounds with CFG-05).

**Recommendation:** Add optional `lang?: string` (default `'en'`) and a `theme?: { background?, cardBackground?, text?, mutedText?, border?, width? }` field to RenderEmailLayoutInput, and have login's forgotPassword/emailChangeNotification forward a configurable value (e.g. from projectConfig.defaultLanguage).

### CFG-36 (low) — No send timeout on the Resend adapter — a hung provider stalls the calling API request indefinitely

**File:** `packages/email/src/adapters/resend.ts:62`
**Area:** email

**Evidence/description:** `await client.emails.send({...})` has no timeout and the Resend SDK's fetch has no AbortSignal wired; sendEmail has no pipeline-level timeout either. login's forgotPassword awaits sendEmail inside the API request, so a hung Resend endpoint holds the password-reset request open until socket/OS timeouts. nodemailer has internal default timeouts so SMTP is less exposed.

**Why it matters for a consumer:** Provider hangs are rare and rate limiting bounds concurrent resets (hence low), but there is currently no knob at all.

**Recommendation:** Add `emailConfig.sendTimeoutMs` (default e.g. 15000) enforced in sendEmail around `sender.send(message)` via Promise.race/AbortSignal, returning `{ ok: false, reason: 'send-timeout' }` — one knob covers all adapters including consumer-written ones.

### CFG-37 (low) — Sentry cannot be force-DISABLED in production — `SENTRY_ENABLED=false` is ignored

**File:** `packages/error-tracking/src/sentry.ts:91`
**Area:** error-tracking

**Evidence/description:** `enabled: isProduction || enabledOverride === 'true'` — the override can only force-enable outside production; `SENTRY_ENABLED=false` with NODE_ENV=production still sends events.

**Why it matters for a consumer:** A staging/load-test box running NODE_ENV=production with an env file copied from prod (SENTRY_DSN included) cannot turn Sentry off without editing the shared DSN; no temporary quota-saving kill switch during an incident. Current only workaround is unsetting SENTRY_DSN.

**Recommendation:** Honor the explicit negative: `enabled: enabledOverride !== undefined ? enabledOverride === 'true' : isProduction`. Document in README env table.

### CFG-38 (low) — SocketStatusIndicator position and styling hardcoded (`top-2 right-2 z-50`) with no className/position prop

**File:** `packages/presence/src/client/SocketStatusIndicator.tsx:49`
**Area:** presence

**Evidence/description:** The badge renders `` className={`absolute top-2 right-2 z-50 ${tint} ${onTint} px-2 py-1 rounded-md text-xs font-bold pointer-events-none`} ``. The text is overridable (`label`, `formatStatus` props handle i18n) and the colors follow theme tokens, but placement (top-right), z-index, size, and shape are fixed. No `className`, `position`, or render-override prop exists, and `docs/client-component.md` documents no escape hatch beyond the format props.

**Why it matters for a consumer:** An app with a top-right user menu, or wanting the badge bottom-left / larger / clickable, must fork the component.

**Recommendation:** Add an optional `className?: string` (merged after the defaults so consumers can override placement) or a `position?: 'top-left'|'top-right'|'bottom-left'|'bottom-right'` prop, keeping current values as defaults.

### CFG-39 (low) — capturePointers scans the ENTIRE inherited process environment with no name allowlist/denylist

**File:** `packages/secret-manager/src/index.ts:126`
**Area:** secret-manager

**Evidence/description:** capturePointers iterates every `process.env` entry — not just keys loaded from `.env` files — and any inherited variable whose VALUE happens to match the default `/^(.+)_V(\d+)$/` (e.g. a CI-injected `RELEASE_TAG=build_2024_V2`) is (a) sent to the secret server (leaking an unrelated env value off-host) and (b) a hard boot crash in `'remote'` mode when the server can't resolve it. `pointerPattern` is a documented escape hatch but it is global shape-tuning, not scoping: you cannot say "only resolve these N env names".

**Why it matters for a consumer:** Value-suffix collisions are rare (hence low), but when they hit, the failure modes are an off-host leak and an unexplainable boot crash.

**Recommendation:** Add `envNames?: string[] | ((name: string) => boolean)` to SecretManagerConfig to restrict which env entries are pointer-eligible (default: all, preserving current behavior). Mention the inherited-environment scan explicitly in docs/architecture.md's pointer-model section.

### CFG-40 (low) — Hardcoded static-file extension whitelist 404s robots.txt, sitemap.xml, manifest.json, fonts at root

**File:** `packages/server/src/httpRoutes/staticRoutes.ts:6` (extname branch at line 58)
**Area:** server

**Evidence/description:** KNOWN_STATIC_FILE_REGEX allows only `.png|jpg|jpeg|gif|svg|html|css|js` outside `/assets/`; any other extension hits the `path.extname` branch and gets a hard 404 before the consumer's serveFile is ever consulted. So `/robots.txt`, `/sitemap.xml`, `/manifest.json`, `/.well-known/...`, `.webp`, `.woff2`, `.map` all 404 by default.

**Why it matters for a consumer:** These are things every production site needs; each consumer rediscovers the 404 individually. Workaround exists (registerCustomRoute runs before handleStaticAndSpaFallback), hence low.

**Recommendation:** Make the list a config knob, e.g. `http.staticFileExtensions: string[]` (defaults extended with txt,xml,json,ico,webp,woff,woff2,map) and consider passing unmatched extension paths to serveFile (which 404s on miss anyway) instead of pre-empting with a framework 404.

### CFG-41 (low) — Sync stream backpressure sampling constants hardcoded (32-socket sample, 10ms poll, 1KB avg packet)

**File:** `packages/sync/src/_shared/streamEmitters.ts:59` (lines 59-64)
**Area:** sync

**Evidence/description:** streamEmitters hardcodes `AVG_PACKET_BYTES = 1024`, `POLL_INTERVAL_MS = 10`, and `MAX_SOCKETS_FOR_PRESSURE_SAMPLE = 32`. The per-call `thresholdBytes` override exists (documented knob — not a finding), but none of the three constants are reachable via projectConfig (`sync.streamThrottle.*` and `sync.fanoutYield*` are the only sync knobs in `packages/core/src/projectConfig.ts:512-518`). (Sibling API-side poll constant is CFG-29.)

**Why it matters for a consumer:** A consumer streaming 16KB collab-diff chunks gets a 16x-wrong packet-count approximation from AVG_PACKET_BYTES; a 500-socket webinar room measures pressure on an arbitrary first-32 sample; latency-sensitive streams can't lower the 10ms poll.

**Recommendation:** Move the three constants into `projectConfig.sync.flushPressure: { avgPacketBytes, pollIntervalMs, maxSampledSockets }` with the current values as defaults.

### CFG-42 (low) — streamWatcher connect/join-ack timeouts (3000ms) are hardcoded and not covered by defaultTimeoutMs

**File:** `packages/test-runner/src/streamWatcher.ts:65` (lines 65-66; defaultTimeoutMs at line 61)
**Area:** test-runner

**Evidence/description:** `const JOIN_RESPONSE_TIMEOUT_MS = 3000;` and `const CONNECT_TIMEOUT_MS = 3000;` are module constants. OpenStreamWatcherInput.defaultTimeoutMs only governs stopAt/waitForCount, not the connect or joinRoom-ack phases.

**Why it matters for a consumer:** On slow CI runners or remote staging targets (TEST_BASE_URL over WAN), socket connect can legitimately exceed 3s, making every watchStream-based custom test flake with "socket failed to connect within 3000ms" and no override available.

**Recommendation:** Add `connectTimeoutMs?` and `joinAckTimeoutMs?` to OpenStreamWatcherInput (defaulting to the current 3000), and let TestContext.watchStream inherit them from a RunCustomTestsInput-level setting.

### CFG-43 (low) — scaffold:page template choice is a hardcoded path-name heuristic with no override flag

**File:** `scripts/scaffoldPage.mjs:125` (and the template copy of the script)
**Area:** tooling

**Evidence/description:** Template selection is solely the regex `/(^|\/)(admin|dashboard|settings|billing|account|profile)(\/|$)/`: matching paths get the dashboard template, all else plain. No flag exists; verified the script reads only `process.argv[2]`.

**Why it matters for a consumer:** Scaffolding e.g. `reports/weekly` (wants dashboard) or an `admin-landing` marketing page (wants plain) cannot express intent — and projects that registered additional templates in TemplateProvider (which CLAUDE.md explicitly supports: "Add new templates here and to the Template union") can never scaffold them.

**Recommendation:** Accept `npm run scaffold:page <path> -- --template=<plain|dashboard|...>` overriding the heuristic; for custom templates, fall back to the plain skeleton with the requested `export const template = '<name>'` constant. Mirror the change into the template copy of the script.

---

## Cross-cutting patterns (for the maintainer)

1. **Documented knobs that are never read** (CFG-04 providerAccountStrategy, CFG-05 template registry, CFG-25 testResetEndpoint client side) — worse than missing knobs; consider a doc-vs-code knob audit before publishing 0.2.0.
2. **Auto-register runs before the consumer overlay and cannot be overridden** (CFG-03 docs-ui custom route, CFG-15 Sentry init, CFG-16 PostHog) — the "last writer wins" overlay promise needs either deferred init or keyed-replace registries to be true.
3. **Hardcoded literals where a sibling already uses the config-driven path** (CFG-11 vs functionsMeta.ts, CFG-18 vs bootHandshake.ts, CFG-27 vs formatKey, CFG-31 vs every other key family) — drift, not design; mechanical fixes.
4. **No timeouts anywhere on network awaits** (CFG-09, CFG-20, CFG-36, CFG-42) — a single `timeoutMs` convention across packages would close four findings.
5. **Closed registries blocking the "extend without forking" north star** (CFG-01 flags, CFG-08 FEATURES, CFG-10 TEMPLATE_DIR, CFG-23 OVERLAY_ORDER, CFG-28 invariants) — each needs a manifest/config-driven extension point.
