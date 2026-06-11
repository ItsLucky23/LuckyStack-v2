# Code Quality Review — LuckyStack v0.2.0

**Date:** 2026-06-11 · **Branch:** `chore/package-split-prep` · **ID prefix:** QUA-

**Scope & methodology.** One combined audit agent per package/area (`pkg-api`, `pkg-cli`, `pkg-core`, `pkg-create-app`, `pkg-devkit`, `pkg-docs-ui`, `pkg-email`, `pkg-env-resolver`, `pkg-error-tracking`, `pkg-login`, `pkg-presence`, `pkg-router`, `pkg-secret-manager`, `pkg-server`, `pkg-sync`, `pkg-test-runner`, plus `consumer-app`, `consumer-server`, `overlays`, `tooling`) swept its area for the quality dimension: dead/stale code, doc↔code drift, lint suppression, casting-policy violations, missing tests on critical paths, import-time side effects, and framework↔template mirror drift. Each finding was self-verified against the actual working-tree code, existing config options/hooks, and the prior audit trail in `docs/audits/` (CODE_QUALITY_AUDIT.md, SECURITY_AUDIT.md, REAUDIT_2026-06-09.md, PROJECT_DOCS_AUDIT.md) to avoid re-reporting already-fixed items. Near-duplicate reports from multiple area agents were merged (3 merges, noted inline); 92 distinct findings remain.

---

## Severity Index

| ID | Severity | Title | File | Area |
|---|---|---|---|---|
| QUA-001 | Critical | Renderer JSON-shape mismatch: docs-ui expects nested object, devkit emits arrays | `packages/docs-ui/src/docsHtml.ts:339` | pkg-docs-ui |
| QUA-002 | High | Blanket `/* eslint-disable */` across 11 framework source files (api, core, sync, devkit) | `packages/api/src/handleApiRequest.ts:1` (+10 more) | pkg-api / pkg-core / pkg-sync / pkg-devkit |
| QUA-003 | High | Stale LoginForm asset imports removed `providers` config export — compile-breaking mirror drift | `packages/cli/assets/login/src/_components/LoginForm.tsx:6` | pkg-cli |
| QUA-004 | High | npm install / prisma generate silently fail on Windows (spawnSync `.cmd` with `shell:false` → EINVAL) | `packages/create-luckystack-app/src/index.ts:773` | pkg-create-app |
| QUA-005 | High | AUTH_MODE / I18N_ENABLED / EMAIL_PROVIDER / MONITORING_PROVIDER / OAUTH_PROVIDERS template vars are dead — wizard answers silently discarded | `packages/create-luckystack-app/src/index.ts:1159` | pkg-create-app |
| QUA-006 | High | Consumer-shipped CLAUDE.md is a verbatim framework copy — references scripts and components the scaffold doesn't have | `packages/create-luckystack-app/scripts/bundleFrameworkDocs.mjs:30` | pkg-create-app |
| QUA-007 | High | Try-it-out runner posts to wrong URL — missing `/api/` prefix, feature cannot work | `packages/docs-ui/src/docsHtml.ts:217` | pkg-docs-ui |
| QUA-008 | High | Try-it-out sends no CSRF token — default cookie-mode config rejects every POST | `packages/docs-ui/src/docsHtml.ts:217` | pkg-docs-ui |
| QUA-009 | High | Bootstrap's empty catch silently swallows optional-package `/register` failures — neutralizes the fail-loud peer-dep guard | `packages/server/src/bootstrap.ts:111` + `packages/email/src/register.ts:19` | pkg-email / pkg-server / overlays |
| QUA-010 | High | Ghost `packages/env-resolver/dist` survives deletion and feeds a phantom package into the shipped AI_QUICK_INDEX | `packages/env-resolver/dist/index.js:1` | pkg-env-resolver |
| QUA-011 | High | PostHog registration is async fire-and-forget and can REPLACE consumer overlay trackers (race) | `packages/error-tracking/src/register.ts:42` | pkg-error-tracking |
| QUA-012 | High | Adapter-only auto-instrumentation produces useless zero-duration spans | `packages/error-tracking/src/autoInstrumentation.ts:92` | pkg-error-tracking |
| QUA-013 | High | Dev loader drops `errorFormatter`/`validation` for sync routes that the prod generator emits — silent dev/prod divergence | `packages/devkit/src/loader.ts:353` | pkg-sync |
| QUA-014 | High | Framework `scripts/` and template scripts drifted in BOTH directions (5 of 11 mirrored files, incl. load-bearing testAll.ts config import) | `packages/create-luckystack-app/template/scripts/*` | tooling / pkg-test-runner |
| QUA-015 | High | Repo `luckystack/login/oauthProviders.ts` is a stale pre-0.2.0 fork masking the canonical `@luckystack/login/register` auto-wiring | `luckystack/login/oauthProviders.ts:38` | overlays |
| QUA-016 | High | Overlay loader dynamic-imports consumer `.ts` files at runtime — broken or silently skipped under the documented prod path | `packages/server/src/bootstrap.ts:58` | overlays |
| QUA-017 | High | CI "Test sweep" step runs with no server booted and no Redis/Mongo services — step cannot pass (also shipped to every scaffold) | `.github/workflows/ci.yml:48` | tooling |
| QUA-018 | Medium | `as unknown as` double-casts in both API transport handlers | `packages/api/src/handleApiRequest.ts:397` | pkg-api |
| QUA-019 | Medium | addPresence two-file edit is not transactional; idempotency guard then masks the half-applied state | `packages/cli/src/commands/addPresence.ts:92` | pkg-cli |
| QUA-020 | Medium | Malformed i18n key `common/.404` in LoginForm fetch-failure path (3 mirrored copies) | `packages/cli/assets/login/src/_components/LoginForm.tsx:123` | pkg-cli |
| QUA-021 | Medium | Zero tests in @luckystack/cli — no asset↔template parity check, no prune↔add round-trip | `packages/cli/package.json:46` | pkg-cli |
| QUA-022 | Medium | check-i18n blind to template-literal keys; tells an LLM to delete live locale keys | `packages/cli/src/commands/checkI18n.ts:52` | pkg-cli |
| QUA-023 | Medium | Redis proxy stray-prefix net is asymmetric: set/get prefixed, del/exists/mget not | `packages/core/src/redis.ts:82` | pkg-core |
| QUA-024 | Medium | Zero tests on core's security-critical primitives (serveAvatar, getParams, resolveClientIp, extractToken*) | `packages/core/src/serveAvatars.ts:14` | pkg-core |
| QUA-025 | Medium | Template ships a non-capturing tryCatch copy — scaffolded handlers never auto-report errors | `packages/create-luckystack-app/template/shared/tryCatch.ts:1` | pkg-create-app |
| QUA-026 | Medium | Scaffold docs reference `luckystack/login/oauthProviders.ts`, a file the scaffold does not contain | `packages/create-luckystack-app/template/README.md:94` | pkg-create-app |
| QUA-027 | Medium | docs/cli-flags.md stale: missing `--no-presence` and `--ai-browser`, embeds outdated parseArgs source | `packages/create-luckystack-app/docs/cli-flags.md:11` | pkg-create-app |
| QUA-028 | Medium | Boot-time route scan classifies API/sync folders by `endsWith('api'/'sync')` instead of the registered marker | `packages/devkit/src/loader.ts:249` | pkg-devkit |
| QUA-029 | Medium | isGeneratedPath omits `apiInputSchemas.generated.ts` — every regen self-triggers a second full regeneration | `packages/devkit/src/hotReload.ts:176` | pkg-devkit |
| QUA-030 | Medium | No test exercises the docs-ui client render pipeline against a real artifact shape | `packages/docs-ui/src/docsHtml.test.ts:1` | pkg-docs-ui |
| QUA-031 | Medium | sendEmail.ts — the package's central orchestrator — has zero test coverage | `packages/email/src/sendEmail.ts:85` | pkg-email |
| QUA-032 | Medium | Consumer `template.render()/subject()` throws escape sendEmail, breaking its no-throw contract | `packages/email/src/sendEmail.ts:113` | pkg-email |
| QUA-033 | Medium | README claims initializeSentry registers apiError/syncError/postLogin handlers — none exist | `packages/error-tracking/README.md:44` | pkg-error-tracking |
| QUA-034 | Medium | register.ts points Datadog users at a non-existent `datadog-preload` subpath | `packages/error-tracking/src/register.ts:15` | pkg-error-tracking |
| QUA-035 | Medium | PostHog adapter identity is a single mutable variable — concurrent requests cross-attribute events | `packages/error-tracking/src/adapters/posthog.ts:52` | pkg-error-tracking |
| QUA-036 | Medium | login register.ts captures getProjectConfig() at module load, violating its call-time-resolution contract | `packages/login/src/register.ts:54` | pkg-login |
| QUA-037 | Medium | sendEmailChangeConfirmation doesn't catch a failed @luckystack/email lazy import (inconsistent with forgotPassword) | `packages/login/src/emailChangeNotification.ts:40` | pkg-login |
| QUA-038 | Medium | No package-level tests for login.ts — credentials flow, OAuth callback, state consumption untested | `packages/login/src/login.ts:1` | pkg-login |
| QUA-039 | Medium | socketConnected broadcasts userBack ungated by socketActivityBroadcaster and on cold connects | `packages/presence/src/activity/lifecycle.ts:58` | pkg-presence |
| QUA-040 | Medium | Refractory-throttle map (lastFired) grows unboundedly — never pruned on disconnect | `packages/presence/src/activityEvents.ts:43` | pkg-presence |
| QUA-041 | Medium | Presence docs drift: lifecycle.md documents the token-leaking AFK broadcast and -1 recipientCount sentinel that no longer exist | `packages/presence/docs/lifecycle.md:113` | pkg-presence |
| QUA-042 | Medium | Post-audit security validators have zero test coverage (validateUrl, validateToken, isSafeEnvFile, env-key regex) | `packages/secret-manager/src/index.test.ts:1` | pkg-secret-manager |
| QUA-043 | Medium | withSessionLock only serializes per-process — cross-instance roomCodes read-modify-write race | `packages/server/src/loadSocket.ts:36` | pkg-server |
| QUA-044 | Medium | RuntimeSyncServerEntry.validation is declared, generated, documented — but never read by either sync handler | `packages/sync/src/_shared/syncTypes.ts:75` | pkg-sync |
| QUA-045 | Medium | chunkCounters Map grows unboundedly — the "cleared on teardown" comment is false | `packages/sync/src/_shared/streamEmitters.ts:12` | pkg-sync |
| QUA-046 | Medium | syncRequest promise never settles when its queued offline request is evicted | `packages/sync/src/syncRequest.ts:453` | pkg-sync |
| QUA-047 | Medium | room-fanout.md describes the pre-fetchSockets implementation — contradicts current code in three sections | `packages/sync/docs/room-fanout.md:14` | pkg-sync |
| QUA-048 | Medium | Prototype-pollution fuzz payload is a no-op: `{ __proto__: {...} }` serializes to `{}` | `packages/test-runner/src/fuzzCheck.ts:18` | pkg-test-runner |
| QUA-049 | Medium | runAllTests applies `filter` post-hoc: filtered-out endpoints are still hit (incl. rate-limit drains) | `packages/test-runner/src/runAllTests.ts:79` | pkg-test-runner |
| QUA-050 | Medium | resetBetweenEndpoints wipes sessions, breaking the authenticated rate-limit sweep it supports | `packages/test-runner/src/runRateLimitTests.ts:88` | pkg-test-runner |
| QUA-051 | Medium | test-runner README peer-dep and feature claims stale (zod ^3.25 vs ^4, missing socket.io-client, phantom getApiMethodMapPath) | `packages/test-runner/README.md:79` | pkg-test-runner |
| QUA-052 | Medium | CLAUDE.md misdocuments /_test/reset gating as weaker than the server actually enforces | `packages/test-runner/CLAUDE.md:78` | pkg-test-runner |
| QUA-053 | Medium | Client code references six i18n keys that exist in no locale file (toasts render raw key strings) | `src/_locales/en.json:1` | consumer-app |
| QUA-054 | Medium | Leftover debug console.log of filesystem paths on every static request | `server/prod/serveFile.ts:57` | consumer-server |
| QUA-055 | Medium | CI never runs the vitest unit suite (test:unit) or lint:packages — framework code unverified in CI | `.github/workflows/ci.yml:41` | tooling |
| QUA-056 | Medium | scripts/bundleServer.mjs imports esbuild as a phantom (undeclared) dependency | `scripts/bundleServer.mjs:1` | tooling |
| QUA-057 | Medium | @luckystack/core barrel connects to Redis at import time, forcing process.exit workarounds in generator scripts | `scripts/generateTypeMaps.ts:13` | tooling |
| QUA-058 | Low | Shipped LoginForm hardcodes English UI strings despite mandatory-i18n rule | `packages/cli/assets/login/src/_components/LoginForm.tsx:14` | pkg-cli |
| QUA-059 | Low | Import-time side effects in core: .env load + throw, dev PrismaClient construction, cleanup timer | `packages/core/src/env.ts:108` | pkg-core |
| QUA-060 | Low | Dead export isMethodAllowed silently permits OPTIONS for any method-locked route | `packages/core/src/httpApiUtils.ts:74` | pkg-core |
| QUA-061 | Low | `--ai-browser` flag silently ignored when the interactive wizard runs | `packages/create-luckystack-app/src/index.ts:1112` | pkg-create-app |
| QUA-062 | Low | No cleanup of a half-written project directory when the scaffold fails midway | `packages/create-luckystack-app/src/index.ts:1288` | pkg-create-app |
| QUA-063 | Low | pickFromList silently substitutes the default for unrecognized input in the non-TTY fallback | `packages/create-luckystack-app/src/index.ts:188` | pkg-create-app |
| QUA-064 | Low | devkit CLAUDE.md documents exports that do not exist + wrong chokidar version | `packages/devkit/CLAUDE.md:57` | pkg-devkit |
| QUA-065 | Low | Two `as unknown as` casts in docs-ui index.test.ts (zero-cast policy) | `packages/docs-ui/src/index.test.ts:64` | pkg-docs-ui |
| QUA-066 | Low | Inline script dead/incomplete code: unstyled `.badge` class for tags | `packages/docs-ui/src/docsHtml.ts:305` | pkg-docs-ui |
| QUA-067 | Low | templates.ts header documents a built-in `password-reset` fallback that does not exist | `packages/email/src/templates.ts:11` | pkg-email |
| QUA-068 | Low | registerEmailConfig merges onto DEFAULT_EMAIL_CONFIG, not the active config — second call wipes earlier overrides | `packages/email/src/emailConfig.ts:89` | pkg-email |
| QUA-069 | Low | autoSelectEmailSender passes NaN as SMTP port when the port env var is non-numeric | `packages/email/src/autoSelect.ts:56` | pkg-email |
| QUA-070 | Low | PROJECT_DOCS_AUDIT falsely records the env-resolver folder as gone, dropping the dist-cleanup TODO | `docs/audits/PROJECT_DOCS_AUDIT.md:41` | pkg-env-resolver |
| QUA-071 | Low | initializeSentry has no idempotency guard yet is called twice in the standard 0.2.0 boot flow | `packages/error-tracking/src/sentry.ts:57` | pkg-error-tracking |
| QUA-072 | Low | ErrorTrackerEvent.forwarded is a dead contract field — never read, never set to false | `packages/error-tracking/src/adapters/runBeforeSend.ts:9` | pkg-error-tracking |
| QUA-073 | Low | logout() bypasses the SessionAdapter with a raw redis.srem (redundant with deleteSession) | `packages/login/src/logout.ts:34` | pkg-login |
| QUA-074 | Low | Documented structural cast `prisma.user as unknown as PrismaUserDelegate` in default user adapter | `packages/login/src/userAdapter.ts:69` | pkg-login |
| QUA-075 | Low | Root barrel performs import-time side effect (registerDefaultAfkEvent) despite a dedicated /register entry | `packages/presence/src/index.ts:29` | pkg-presence |
| QUA-076 | Low | resolveTarget uses console.error instead of the registered logger | `packages/router/src/resolveTarget.ts:256` | pkg-router |
| QUA-077 | Low | `values as Record<string, string>` cast bypasses the per-value runtime guard the comment promises | `packages/secret-manager/src/index.ts:203` | pkg-secret-manager |
| QUA-078 | Low | reloadSecretManagerFromFiles drops boot-captured pointers and injects plain values before a remote-mode throw | `packages/secret-manager/src/index.ts:413` | pkg-secret-manager |
| QUA-079 | Low | Stale JSDoc: `dev.watch` claims the optional `dotenv` peer is required, but the package ships its own parser | `packages/secret-manager/src/index.ts:66` | pkg-secret-manager |
| QUA-080 | Low | Type-erasing `as` cast on loginWithCredentials result instead of an exported return type | `packages/server/src/httpRoutes/authApiRoute.ts:101` | pkg-server |
| QUA-081 | Low | `prisma as unknown as PrismaPingShape` cast in readiness probe (documented structural exception) | `packages/server/src/httpRoutes/healthRoutes.ts:30` | pkg-server |
| QUA-082 | Low | security-defaults.md CSRF section drifted from csrfMiddleware implementation | `packages/server/docs/security-defaults.md:83` | pkg-server |
| QUA-083 | Low | No tests for either sync transport handler's security pipeline | `packages/sync/src/handleSyncRequest.ts:314` | pkg-sync |
| QUA-084 | Low | attachSyncReceiver throws synchronously inside the socket event listener on malformed payloads | `packages/sync/src/syncRequest.ts:924` | pkg-sync |
| QUA-085 | Low | changePassword_v1 has diverged into three non-identical copies (repo / template / cli mirrors) | `src/settings/_api/changePassword_v1.ts:28` | consumer-app |
| QUA-086 | Low | docs/page.tsx uses `as unknown as DocsResult` + `as never` casts (zero-tolerance policy) | `src/docs/page.tsx:426` | consumer-app |
| QUA-087 | Low | Blocked sensitive-file response returns HTTP 200 instead of 403 | `server/prod/serveFile.ts:86` | consumer-server |
| QUA-088 | Low | Stray dev script with hardcoded internal IP shipped in server/dev | `server/dev/request.py:3` | consumer-server |
| QUA-089 | Low | create-server.md documents an overlay order missing the `email` folder bootstrap actually loads | `packages/server/docs/create-server.md:16` | overlays |
| QUA-090 | Low | eslint.official.config.js: 20-line `import-x/order` config dead — overridden by a duplicate key set to 'off' | `eslint.official.config.js:114` | tooling |
| QUA-091 | Low | 75KB scratch file `.publish-dry.out` committed at repo root | `.publish-dry.out:1` | tooling |
| QUA-092 | Low | buildPackages.mjs header topology comment no longer matches the actual WAVES array | `scripts/buildPackages.mjs:5` | tooling |

---

## Critical

### QUA-001 — Renderer JSON-shape mismatch: docs-ui expects nested `{page:{name:{version:meta}}}` but devkit emits `{page: ApiDocsEntry[]}`

**File:** `packages/docs-ui/src/docsHtml.ts:339` (also `packages/docs-ui/docs/mounting.md:152`, `packages/devkit/src/typeMap/emitterArtifacts.ts:62`)
**Area:** pkg-docs-ui
**Evidence/description:** The embedded `render()` iterates `for (const [page, names] of Object.entries(apis))` → `Object.entries(names)` → `Object.entries(versions)` (docsHtml.ts:339-346), assuming a nested object shape; `docs/mounting.md:152` documents `{ "apis": { "<page>": { "<name>": { "<version>": {...} } } } }`. But the actual emitter declares `apis: Record<string, ApiDocsEntry[]>` — an ARRAY of entry objects per page — and the real working-tree artifact `src/docs/apiDocs.generated.json` confirms it (`"playground": [ { "page": ..., "name": "echo", "version": "v1", ... } ]`). With arrays, `name` becomes `"0"`, `"1"`, …, and `Object.entries(versions)` iterates the FIELDS of each entry, so the page renders one garbage endpoint row per field (e.g. `/api/playground/0/page` with meta = the string `"playground"`). The package's string-only tests (docsHtml.test.ts) never feed a real artifact through the pipeline, so the drift went undetected.
**Why it matters for a consumer:** The package's sole feature — rendering the API docs page — produces nonsense against the artifact the framework actually generates. Anyone installing `@luckystack/docs-ui` on 0.2.0 gets a broken docs page out of the box.
**Recommendation:** Pick one canonical shape and align both sides for 0.2.0. Simplest: update `render()`/`renderEndpoint` to iterate `for (const entry of pageEntries)` using `entry.name`/`entry.version`/`entry.method` (keep a legacy nested-object branch if back-compat is desired). Fix `mounting.md:152` to document the array shape, and add the fixture test described in QUA-030.

---

## High

### QUA-002 — Blanket `/* eslint-disable */` across 11 framework source files (api, core, sync, devkit) — MERGED from 4 area agents

**File:**
- `packages/api/src/handleApiRequest.ts:1` (516-line core socket API handler)
- `packages/core/src/getParams.ts:1-2` (HTTP body parser — a security boundary: requestBodyMaxBytes/413, content-type allow-list/415)
- `packages/sync/src/handleSyncRequest.ts:1` and `packages/sync/src/handleHttpSyncRequest.ts:1` (~600/540-line security-critical sync transport handlers)
- `packages/devkit/src/loader.ts:1`, `hotReload.ts:1`, `templateInjector.ts:1`, `typeMap/discovery.ts:1`, `typeMap/extractors.ts:1`, `typeMap/routeMeta.ts:1`, `typeMap/tsProgram.ts:1`

**Area:** pkg-api / pkg-core / pkg-sync / pkg-devkit
**Evidence/description:** Each file opens with `/* eslint-disable unicorn/no-abusive-eslint-disable */` followed by a bare `/* eslint-disable */` — every lint rule (including all type-safety rules) is off for the whole file, and the guard rule that would flag the blanket disable is itself disabled first. This hides, among other things, the `as unknown as` cast at handleApiRequest.ts:397 and the `user!` non-null assertion at line 87 (which the sibling `handleHttpApiRequest.ts` flags with narrow, justified per-line disables — proving the blanket form is unnecessary), `user!`/`as RuntimeSyncServerEntry` casts in the sync handlers, and `any`-typed dynamic-import destructuring in loader.ts:209. The prior audit (docs/audits/CODE_QUALITY_AUDIT.md CC-8) recorded this pattern only for login/presence/core extractToken; REAUDIT_2026-06-09 claims "CC-8 narrowed to justified per-line" — these 11 files were missed or regressed. Violates CLAUDE.md Rule 7a and the strict-typing memory ("no lint rules disabled").
**Why it matters for a consumer:** These are the request handlers every consumer's API/sync traffic flows through; latent type errors in them ship to production unflagged, and `npm run lint:packages` provides false assurance for exactly the most attack-facing framework code.
**Recommendation:** Remove all blanket pragmas; replace with the minimal per-line disables + justifications that handleHttpApiRequest.ts and clientFanout.ts:156 already model. For devkit, type the dynamic-import results (an `ApiRouteModule` interface with optional `main/auth/rateLimit/...`) so most disables become unnecessary. Re-run `npm run lint:packages` to surface what was hidden before publishing 0.2.0.

### QUA-003 — Stale LoginForm asset imports removed `providers` config export — compile-breaking mirror drift

**File:** `packages/cli/assets/login/src/_components/LoginForm.tsx:6` (drifted from `packages/create-luckystack-app/template/src/_components/LoginForm.tsx`)
**Area:** pkg-cli
**Evidence/description:** The shipped asset reads `import { ..., providers, ... } from "config"` and gates the credentials form on `providers.includes("credentials")` (line 177). The current template config.ts exports NO `providers` array — its own comment (template config.ts:325-328) says "No static `providers` array" — and the newer template LoginForm fetches `credentials` from `GET /auth/providers` via `showCredentials` state. CRLF-normalized diff confirms this is the ONLY real content drift in the whole login asset bundle (40 diff lines); every other asset file is byte-identical to the template. **Framework template and CLI asset have DRIFTED.** Latent only because `copyDirIfAbsent` skips existing files — but the CLI's stated use case ("a consumer scaffolded a base project and now wants login") is exactly when this file LANDS.
**Why it matters for a consumer:** `npx luckystack add login` on a partial scaffold produces a project that does not compile (TS2305: config has no exported member 'providers').
**Recommendation:** Re-copy the current template LoginForm.tsx into `packages/cli/assets/login/src/_components/` before publishing 0.2.0, and add the parity test from QUA-021 so asset↔template drift becomes a CI failure instead of a consumer compile error.

### QUA-004 — npm install / prisma generate silently fail on Windows (spawnSync `.cmd` with `shell:false` → EINVAL)

**File:** `packages/create-luckystack-app/src/index.ts:773` (runNpmInstall), `:786` (runPrismaGenerate)
**Area:** pkg-create-app
**Evidence/description:** `spawnSync(npmCmd, ['install'], { cwd, stdio: 'inherit', shell: false })` with `npmCmd='npm.cmd'` on win32 (same for `npx.cmd`). Since Node's CVE-2024-27980 fix (>= 20.12.2; engines only requires >= 20.0.0), spawning a `.cmd`/`.bat` without `shell:true` fails with EINVAL. Verified empirically on this machine: `spawnSync('npm.cmd',['--version'],{shell:false})` returns `status=null, error='spawnSync npm.cmd EINVAL'`. `result.error` is never checked or printed (only `result.status !== 0`), and runPrismaGenerate still runs (and fails identically) after the install already failed.
**Why it matters for a consumer:** The flagship `npx create-luckystack-app my-app` on Windows writes files but NEVER installs deps or generates the Prisma client; the user sees only "npm install failed. You can run it manually" with no cause.
**Recommendation:** Use `shell: true` for the npm/npx spawns (args are static literals — no injection risk) or spawn `cmd.exe /c npm install`. Log `result.error?.message` when set, skip runPrismaGenerate when install failed, and add a Windows CI smoke test that scaffolds with install enabled.

### QUA-005 — AUTH_MODE / I18N_ENABLED / EMAIL_PROVIDER / MONITORING_PROVIDER / OAUTH_PROVIDERS template variables are dead — wizard choices silently discarded

**File:** `packages/create-luckystack-app/src/index.ts:1159-1167` (also `packages/create-luckystack-app/CLAUDE.md` "Template variables" list, `template/config.ts:109`, `template/package.json`)
**Area:** pkg-create-app
**Evidence/description:** main() computes AUTH_MODE, OAUTH_PROVIDERS, EMAIL_PROVIDER, MONITORING_PROVIDER, I18N_ENABLED, and the package CLAUDE.md documents them as substituted template variables — but a grep of the entire `template/` tree shows only DB_PROVIDER, USER_ID_ATTRS, EXTERNAL_ORIGINS, DATABASE_URL, OAUTH_ENV_VARS, EMAIL_ENV_VARS, MONITORING_ENV_VARS are ever used. Choosing `authMode='none'` changes NOTHING — template/config.ts:109 hardcodes `credentials: true`, `@luckystack/login` is an unconditional dependency, and login/register/reset-password pages all ship. Choosing i18n='No' also changes nothing.
**Why it matters for a consumer:** The wizard asks questions whose answers are silently discarded — directly against the v0.2.0 "most packages optional" goal and the no-fork north star. A consumer who answered "no auth" gets a full auth stack anyway and has to rip it out by hand.
**Recommendation:** Either honor the choices (authMode 'none' → drop the login dep + auth pages + `credentials: false` via a pruneOptionalPackages-style edit; i18n off → prune locales + config flag) or remove the no-op wizard questions and dead vars for 0.2.0. Fix the package CLAUDE.md "Template variables" list to match reality either way.

### QUA-006 — Consumer-shipped CLAUDE.md is a verbatim framework-repo copy: mandates `npm run ai:index` (script doesn't exist in scaffold), component table points at files the template doesn't have

**File:** `packages/create-luckystack-app/scripts/bundleFrameworkDocs.mjs:30` (also `framework-docs/CLAUDE.md:53`, `template/package.json`, `src/index.ts:798-818`)
**Area:** pkg-create-app
**Evidence/description:** bundleFrameworkDocs.mjs copies the repo-root CLAUDE.md byte-for-byte into framework-docs/, and main() makes it every scaffold's root CLAUDE.md. That file declares `npm run ai:index` an autonomous command (Rules 8/12/15) and claims the pre-commit hook regenerates "all three snapshots (ai:index, ai:capabilities, ai:project-index)" — but template/package.json has NO `ai:index` script and the scaffolded AI_INDEX_HOOK runs ai:lint/ai:capabilities/ai:project-index/ai:decisions/ai:runbooks. The Component Reference table tells the consumer's AI to use `Navbar` (`./Navbar.tsx`) and `Middleware` (`./Middleware.tsx`) which do NOT exist in `template/src/_components/`, and lists `Dropdown` and `TemplateProvider` at paths the template has under `dropdown/` and `templates/` subfolders. **Framework and template have DRIFTED — the shipped contract file describes the framework repo, not the scaffold.**
**Why it matters for a consumer:** For a framework whose north star is 100% AI-driven consumers, the primary AI contract file is materially wrong on the consumer's first session — the AI will run nonexistent scripts and import nonexistent components.
**Recommendation:** Maintain a consumer-adapted CLAUDE.md (or transform during bundleFrameworkDocs.mjs): strip/remap framework-repo-only commands and regenerate the Component Reference table from the template tree. Add a build-time assertion that every `./X.tsx` referenced in the table exists under `template/src/_components` to catch this class of drift.

### QUA-007 — Try-it-out runner posts to wrong URL — missing `/api/` prefix, feature cannot work

**File:** `packages/docs-ui/src/docsHtml.ts:217` (route built at :314; correct display path at :269)
**Area:** pkg-docs-ui
**Evidence/description:** `runEndpoint` fetches `'/' + route + '?stream=false'` where route is `page + '/' + name + '/' + version`, producing e.g. `/playground/echo/v1`. The framework's HTTP API handler only matches `routePath.startsWith('/api/')` (`packages/server/src/httpRoutes/apiRoute.ts:23`), so every Send click misses the API and falls through to SPA/static serving. The displayed path right above is correctly `'/api/' + page + ...`. The package's own docs contradict each other: `docs/mounting.md:192` says the runner posts to `/api/<page>/<name>/<version>?stream=false`; `docs/html-generation.md:112` says "no leading /api/". The `version` parameter of runEndpoint (line 204) is also dead.
**Why it matters for a consumer:** The interactive try-it-out — half the package's pitch — can never reach an endpoint; every request returns the SPA shell.
**Recommendation:** Change the fetch to `'/api/' + route + '?stream=false'` (optionally an `apiBasePath` option, default `/api`, for path-prefix proxies), remove the dead `version` param, and reconcile mounting.md vs html-generation.md to the corrected behavior.

### QUA-008 — Try-it-out sends no CSRF token — default cookie-mode config rejects every POST with `auth.csrfMismatch`

**File:** `packages/docs-ui/src/docsHtml.ts:217-222` (also `packages/server/src/httpRoutes/csrfMiddleware.ts:21-34`, `packages/core/src/projectConfig.ts:441`, `docs/html-generation.md:152`)
**Area:** pkg-docs-ui
**Evidence/description:** Default config is cookie-session mode (`session.basedToken: false`), where the CSRF middleware enforces a double-submit `x-csrf-token` header on every state-changing request to `/api/*` (403 `auth.csrfMismatch`). The runner's fetch sends only `Content-Type` and `credentials: 'include'` — no CSRF token, and it never calls `GET /auth/csrf` to obtain one. So even after QUA-007 is fixed, every try-it-out POST is rejected under default configuration. `docs/html-generation.md:152` claims "Authentication is implicit via the browser session cookie" with no mention of CSRF.
**Why it matters for a consumer:** The feature fails a second way under the framework's own defaults; a consumer debugging it will suspect their CSRF setup, not the docs page.
**Recommendation:** In the inline runner, fetch `/auth/csrf` once (credentials: 'include'), cache the token, and send it as the configured CSRF header on each POST. Document the CSRF interaction in html-generation.md, including token-mode (`basedToken: true`) behavior where the header is not required.

### QUA-009 — Bootstrap's empty catch silently swallows optional-package `/register` failures — neutralizes the fail-loud peer-dep guard — MERGED from 3 area agents (pkg-email, pkg-server, overlays)

**File:** `packages/server/src/bootstrap.ts:111-119` (importIfExistsSpecifier); concrete victim: `packages/email/src/register.ts:19` (with `packages/email/src/resend.ts:41-45`, `smtp.ts:32-39`)
**Area:** pkg-email / pkg-server / overlays
**Evidence/description:** `importIfExistsSpecifier` is `try { await import(specifier); } catch { /* module is responsible for logging its own failure */ }` — zero logging. A module that throws DURING import (syntax error after a bad publish, missing transitive dep, a top-level peer-dep-guard throw) by definition never reaches its own logging. The email package is the proven casualty: ResendSender/SmtpSender deliberately throw at factory time when the env key is set but the peer is missing ("the server crashes during bootstrap instead of silently failing", implementing the documented policy in packages/email/CLAUDE.md:92 and the user's peer-dep-guard memory). In the 0.2.0 auto-wire path that throw happens inside the module-level `registerEmailSender(autoSelectEmailSender())` of register.ts — and bootstrap swallows it. Result: `RESEND_API_KEY` set + `resend` not installed yields a silent no-sender boot; every email returns `{ ok:false, reason:'no-sender' }` with a generic warn that never mentions the missing peer. The entire boot-time-guard design (CC-3 in docs/audits/REAUDIT_2026-06-09.md) is neutralized on the default path. The same hole applies to every optional package's register module — e.g. `npm i @luckystack/login` + env + restart can boot an apparently healthy server with auth completely unwired (`auth.disabled`) and not one line of output explaining why. The silent behavior also contradicts the docs' claim that overlay "import errors bubble up unchanged" — true only for the consumer-overlay path, opposite for auto-register.
**Why it matters for a consumer:** The advertised 0.2.0 flow is install-package → set env → restart. When anything in that chain breaks, the feature silently vanishes with zero diagnostics — the worst possible failure mode for an AI-driven consumer that trusts boot output.
**Recommendation:** In the catch, log `getLogger().error('[luckystack:bootstrap] <specifier> failed to load — feature disabled', { err })` + captureException. Consider hard-failing when the register module's feature env keys ARE set (consistent with the peer-dep-guard policy) and only soft-skipping when env is unset. Additionally make `packages/email/src/register.ts` self-defending: wrap in tryCatch, log loudly, and rethrow in production.

### QUA-010 — Ghost `packages/env-resolver/dist` survives deletion and feeds a phantom package into the shipped AI_QUICK_INDEX

**File:** `packages/env-resolver/dist/index.js:1` (untracked, gitignored leftover); downstream: `scripts/generateAiIndex.mjs:~206`, `docs/AI_QUICK_INDEX.md:354/656`, `packages/create-luckystack-app/framework-docs/docs/AI_QUICK_INDEX.md:354/656`
**Area:** pkg-env-resolver
**Evidence/description:** `@luckystack/env-resolver` was deleted at HEAD (commit 7c3e1f4, replaced by `@luckystack/secret-manager`); `git ls-files packages/env-resolver` is empty. But an untracked, gitignored leftover `dist/` (built May 29) survives in the working tree. Consequence chain, verified: (1) generateAiIndex.mjs scans `packages/*` directories and emits a section for ANY dir, so the freshly regenerated AI_QUICK_INDEX.md still lists `### env-resolver` plus an `env-resolver | 0 | 0 | 0` count row — the pre-commit regen safety net actively reproduces the phantom; (2) the committed HEAD copy has the same entries; (3) bundleFrameworkDocs.mjs copies docs/ into framework-docs/ (in the package `files` array), so the phantom ships in the 0.2.0 tarball to every scaffold; (4) `npm view @luckystack/env-resolver` returns E404 — never published. The stale dist code is also buggy dead code (`process.env[key] ??= value` never overwrites already-set keys, defeating its own documented hot-reload).
**Why it matters for a consumer:** A consumer's AI is contractually told (CLAUDE.md Quick Links / Rule 12) to consult these indexes before suggesting installs — it can propose `npm i @luckystack/env-resolver`, which 404s.
**Recommendation:** Before publishing 0.2.0: (1) delete `packages/env-resolver/` entirely (developer action — `rm` needs user approval per Rule 8); (2) re-run `npm run ai:index` and bundleFrameworkDocs so both indexes drop the entry; (3) harden generateAiIndex.mjs to skip any `packages/*` dir lacking a `package.json` so gitignored build leftovers on any checkout can never re-pollute the shipped index. See also QUA-070 (the audit record that wrongly closed this).

### QUA-011 — PostHog registration is async fire-and-forget and can REPLACE consumer overlay trackers (race)

**File:** `packages/error-tracking/src/register.ts:42` (also `packages/core/src/errorTrackerRegistry.ts:52-54`, `packages/server/src/capabilities.ts:51-53`, `docs/adapter-pattern.md:114-139`)
**Area:** pkg-error-tracking
**Evidence/description:** When POSTHOG_KEY is set, the register entry runs `void (async () => { ... registerErrorTracker(createPostHogAdapter({ client })); })()` — unawaited, gated on a dynamic `import('posthog-node')`. `registerErrorTracker` REPLACES the whole tracker list. Bootstrap imports `./register` BEFORE the consumer overlay explicitly so "a hand-written overlay (last writer) still wins" — but the IIFE's continuation resolves at an unordered later microtask/turn: if the overlay registers its own adapter (including the documented staged `registerErrorTrackers([...getActiveErrorTrackers(), mine])` pattern), the late-resolving PostHog registration silently wipes the consumer's adapters — or the consumer's snapshot misses PostHog. The ordering contract is violated nondeterministically. The comment at register.ts:19 also misstates that the overlay "can register additional adapters via registerErrorTracker" — singular registerErrorTracker replaces, never adds.
**Why it matters for a consumer:** A consumer with both POSTHOG_KEY and a custom overlay adapter gets one or the other dropped depending on import timing — error reporting silently disappears in production with no deterministic repro.
**Recommendation:** Make registration race-free: register a synchronous lazy-proxy adapter immediately and bind the real client when the import resolves; or have bootstrap await an exported `ready` promise from the register module before importing the overlay. Add an `addErrorTracker(tracker)` append API to the core registry so staged registration is atomic.

### QUA-012 — Adapter-only auto-instrumentation produces useless zero-duration spans (span never wraps the handler)

**File:** `packages/error-tracking/src/autoInstrumentation.ts:92` (also `packages/core/src/sentrySetup.ts:77-89`, `docs/auto-instrumentation.md:228-230`)
**Area:** pkg-error-tracking
**Evidence/description:** The `preApiExecute` hook calls the legacy `startSpan(payload.routeName, op)`. For adapter-only consumers (Datadog/custom, no Sentry SDK), core's legacy shim executes `startSpanAcrossTrackers(name, op, () => {})` with an EMPTY callback and returns `undefined`. The Datadog adapter therefore opens a span and immediately finishes it in `finally` (~0ms, measuring nothing); `isSpanHandle(undefined)` is false so nothing is pinned in the WeakMap and `postApiExecute` is a no-op. docs/auto-instrumentation.md claims adapter-only consumers get the span lifecycle through the registry — they get meaningless instant spans. The callback-style `ErrorTracker.startSpan(name, op, fn)` contract is fundamentally incompatible with the pre/post-hook pair, so a consumer cannot fix this without forking.
**Why it matters for a consumer:** APM data for non-Sentry consumers is silently worthless — every request span shows ~0ms, and the consumer has no supported escape hatch.
**Recommendation:** Add an optional handle-style member to the ErrorTracker contract (`startInactiveSpan?: (name, op) => { end(): void }`), have autoInstrumentation prefer it across trackers, keep callback `startSpan` for closure-wrappable code, and document the limitation in auto-instrumentation.md until fixed.

### QUA-013 — Dev loader drops `errorFormatter` and `validation` for sync routes that the prod bundle generator emits — silent dev/prod divergence

**File:** `packages/devkit/src/loader.ts:353-358` and `:429-434` (contract: `packages/sync/src/_shared/syncTypes.ts:76-82`, `packages/sync/src/handleSyncRequest.ts:318`, `handleHttpSyncRequest.ts:284`, prod generator `scripts/generateServerRequests.ts:176`)
**Area:** pkg-sync (fix lives in devkit)
**Evidence/description:** The sync handlers read `serverSyncEntry?.errorFormatter`, and syncTypes.ts documents "both transports honor the same errorFormatter export". The prod generator emits `validation` + `errorFormatter` for `_server` entries. But devkit's dev loader builds sync entries as only `{ main, auth, inputType, inputTypeFilePath }` in BOTH the hot-reload and initial-scan paths — `errorFormatter` and `validation` are dropped.
**Why it matters for a consumer:** A per-route sync `errorFormatter` works in production but is silently ignored during all of development (and vice-versa surprises at deploy) — exactly the kind of dev/prod divergence that wastes hours.
**Recommendation:** Copy `validation: resolvedSyncModule.validation` and `errorFormatter: resolvedSyncModule.errorFormatter` into both devSyncs assignment sites in loader.ts, and add a parity test asserting dev-loader and prod-generator sync entry shapes match. (Note: even once forwarded, `validation` is ignored by the handlers — see QUA-044.)

### QUA-014 — Framework `scripts/` and create-luckystack-app template scripts drifted in BOTH directions (5 of 11 mirrored files), including the load-bearing testAll.ts config import — MERGED (tooling + pkg-test-runner)

**File:** `packages/create-luckystack-app/template/scripts/scaffoldRouteTest.mjs:38`, `template/scripts/testAll.ts:17` (+ identical `ls-np/scripts/testAll.ts`), `template/scripts/generateAiCapabilities.mjs`, `scripts/generateServerRequests.ts:210`, `scripts/lintInvariants.mjs:26-27`
**Area:** tooling / pkg-test-runner
**Evidence/description:** Diffing `scripts/*` against `packages/create-luckystack-app/template/scripts/*` (ignoring line endings) shows real drift in 5 of the 11 mirrored files. **Template is STALE:** (1) template scaffoldRouteTest.mjs still has `if (parts.length < 3)` so root-level routes are rejected — yet the template itself ships root-level routes (`src/_api/logout_v1.ts`, `src/_api/session_v1.ts`), so a consumer cannot run `npm run scaffold:test logout/v1` as the shipped CLAUDE.md testing rule instructs (framework copy was fixed to `< 2`); (2) template testAll.ts (and the ls-np copy) omits the `import '../config';` line the framework copy declares load-bearing ("Without this, getProjectConfig() falls back to defaults and helpers like clearAllRateLimits()/getSession() target the wrong Redis namespace") — in any scaffold where projectName/sessionCookieName/rate-limit prefix differ from defaults, `ctx.session.login()` mints sessions in the wrong namespace and every authenticated Layer-5 test fails with `auth.required` for no visible reason. It also drops the TEST_OUTPUT_FILE machine-readable JSON summary writer ("so an AI agent or CI can parse pass/fail" — directly relevant to the AI-driven north star); (3) template generateAiCapabilities.mjs lacks the hasTestFile()/Tests-column feature. **Framework is STALE in reverse:** scripts/generateServerRequests.ts:210 writes to `server/prod/` WITHOUT the `fs.mkdirSync(outDir, { recursive: true })` the template copy has — first run in a checkout without `server/prod/` crashes. lintInvariants.mjs documents a "byte-for-byte duplicate" contract but nothing enforces it for any of the 11 files.
**Why it matters for a consumer:** The scaffold's developer tooling diverges from the documented framework behavior in subtle, hard-to-debug ways — broken scaffold:test for shipped routes and silently wrong-namespace test sessions are the two worst.
**Recommendation:** Single-source the mirrored scripts: copy `scripts/*` into the template at package build time (same mechanism as the framework-docs bundle), or add a CI `diff -q` over the 11 files that fails on drift. Immediate pre-publish fixes: backport mkdirSync into scripts/generateServerRequests.ts; forward the root-route fix, the `import '../config'` + TEST_OUTPUT_FILE blocks, and the Tests column to the template (and ls-np) copies.

### QUA-015 — Repo `luckystack/login/oauthProviders.ts` is a stale pre-0.2.0 fork masking the canonical `@luckystack/login/register` auto-wiring

**File:** `luckystack/login/oauthProviders.ts:38` (also `luckystack/login/userAdapter.ts`; canonical: `packages/login/src/register.ts`)
**Area:** overlays
**Evidence/description:** The framework repo's own overlay diverges from packages/login/src/register.ts (and the ls-np sample overlay) in four ways: (1) providers gate on CLIENT_ID only (lines 42/50/58/66/74) while register.ts requires BOTH `CLIENT_ID && CLIENT_SECRET`; (2) env selection uses `useProdCreds = prod && secure` (NODE_ENV !== 'development' + SECURE === 'true') vs register.ts's plain `dev = NODE_ENV !== 'production'`; (3) `credentialsProvider()` is pushed unconditionally (line 39) while register.ts gates it on `projectConfig.auth.credentials` — the repo's own config.ts:325-328 comment claims "credentials is gated by auth.credentials", which this overlay silently contradicts; (4) microsoftProvider lacks the MICROSOFT_TENANT_ID support register.ts:106 has. Because `registerOAuthProviders` REPLACES the provider list and overlays run AFTER the auto-detect phase, the framework repo never dogfoods the env-driven register.ts path — the headline 0.2.0 feature shipped to consumers. `userAdapter.ts` is likewise redundant (register.ts auto-wires defaultPrismaUserAdapter behind an isUserAdapterRegistered() guard; ARCHITECTURE_PACKAGING.md §39.1 says the login overlay "is no longer scaffolded by default").
**Why it matters for a consumer:** Bugs in the auto-wiring every consumer relies on would go unnoticed in the framework repo because the repo's own overlay overrides it with different logic.
**Recommendation:** Delete both overlay files (or reduce to commented placeholders like `luckystack/core/clients.ts`) so the repo exercises the same register.ts path consumers get. If the overlay must stay, sync its logic 1:1 with register.ts (ID+SECRET gating, NODE_ENV polarity, auth.credentials gate, tenant support) and document why it exists.

### QUA-016 — Overlay loader dynamic-imports consumer `.ts` files at runtime — broken or silently skipped under the documented production path (`node dist/server.js`)

**File:** `packages/server/src/bootstrap.ts:58-61, 81-91` (also `scripts/bundleServer.mjs`, root `package.json:55`, `template/package.json:14`, `template/luckystack/server/index.ts:7`)
**Area:** overlays
**Evidence/description:** loadOverlayFolder resolves files like `<ROOT_DIR>/luckystack/core/clients.ts` and runs `await import(pathToFileURL(filePath).href)`. The documented production entry is `node dist/server.js` — a single esbuild bundle of server/server.ts (the template's `build` is only `vite build`; tsx is a devDependency). Esbuild cannot follow the fs-driven dynamic import, so in prod: (a) if `luckystack/` source is deployed next to dist/, plain Node 20 LTS / Node 22 < 22.18 throws ERR_UNKNOWN_FILE_EXTENSION on the .ts import (engines allow >= 20) — and even type-stripping Node versions fail on the template's server overlay, which uses an extensionless relative import (`from '../../server/hooks/notifications'`) that type stripping does not resolve; (b) if only dist/ is deployed, `fs.existsSync` fails and ALL overlays are silently skipped with zero log output — a custom UserAdapter, hand-registered OAuth providers, or audit hooks vanish in production while dev worked fine (register.ts auto-wiring partially papers over this for login, hiding the divergence). Neither `packages/server/docs/create-server.md` nor `docs/HOSTING.md` mentions any prod story for the overlay folder. Confidence: medium (code + build-script reading, not an executed prod boot).
**Why it matters for a consumer:** The overlay folder is the framework's official customization seam; under the documented deploy it either crashes boot or silently strips every customization — including security-relevant ones.
**Recommendation:** Pick an explicit prod story: (1) have bundleServer.mjs (and template build) statically inject overlay files (generate a `luckystack/_generated/overlayIndex.ts` of static imports that server.ts imports), or (2) compile `luckystack/**/*.ts` to `dist/luckystack/*.js` at build time and prefer .js in loadOverlayFolder, or at minimum (3) log every overlay file loaded/skipped at boot and document the Node-version + deploy-contents requirements in HOSTING.md and create-server.md.

### QUA-017 — CI "Test sweep" step runs the HTTP test sweep with no server booted and no Redis/Mongo services — step cannot pass (also shipped to every scaffold)

**File:** `.github/workflows/ci.yml:48` (mirrors: `.gitlab-ci.yml:175`, `packages/create-luckystack-app/template/.github/workflows/ci.yml`, `template/.gitlab-ci.yml`)
**Area:** tooling
**Evidence/description:** The step runs `npm run test`, which executes scripts/testAll.ts. That script's own header (lines 2-4) states "The server must be up already; this script does NOT boot it... Run `npm run server` in another terminal first" and defaults to TEST_BASE_URL `http://localhost:80`. The workflow defines no `services:` (no Redis, no MongoDB) and never boots the server, so every endpoint request fails and the job exits 1. The identical broken job ships in the GitLab pipeline AND in both consumer template CI files. packages/test-runner has no reachability pre-check that would soften this (grep for unreachable/ECONNREFUSED/preflight: no matches).
**Why it matters for a consumer:** Every freshly scaffolded project gets a red CI on first push — directly contradicting the "stranger can build a product without forking" north star, and training users to ignore CI.
**Recommendation:** Add `services:` for redis + mongo (or a sqlite/miniredis profile), boot the built server in the background (`npm run prod &` with a `/readyz` wait loop — the health endpoints already exist), then run `npm run test`; alternatively gate the sweep behind a TEST_BASE_URL secret and skip with a notice when unset. Apply the same fix to the template CI files.

---

## Medium

### QUA-018 — `as unknown as` double-casts in both API transport handlers (zero-tolerance policy)

**File:** `packages/api/src/handleApiRequest.ts:397`, `packages/api/src/handleHttpApiRequest.ts:121`
**Area:** pkg-api
**Evidence/description:** handleApiRequest.ts:397 casts `normalized as unknown as Record<string, unknown> & { status?: string }` to feed `applyErrorFormatter` (hidden entirely by the file's blanket eslint-disable, QUA-002). handleHttpApiRequest.ts:121 does the same (at least annotated as a documented formatter-boundary cast). Root cause: `applyErrorFormatter` accepts a wider shape than the discriminated envelope unions structurally satisfy.
**Why it matters for a consumer:** Per the repo's zero-tolerance casting policy these are reportable; type drift between the envelope union and the formatter input would compile silently and break at runtime in the hot request path.
**Recommendation:** Widen `applyErrorFormatter`'s input type in @luckystack/core to accept the envelope union directly (or export a shared `ApiResponseEnvelope` it consumes). If a runtime boundary truly remains, encode it as a single typed adapter function rather than inline double-casts in two files.

### QUA-019 — addPresence two-file edit is not transactional; the idempotency guard then masks the half-applied state

**File:** `packages/cli/src/commands/addPresence.ts:92` (applyPresenceEdits at :25)
**Area:** pkg-cli
**Evidence/description:** `applyPresenceEdits` writes main.tsx via `editFile` BEFORE validating the TemplateProvider tokens. editFile is atomic per file, but if a TemplateProvider token is missing (consumer customized the file), main.tsx is already rewritten while TemplateProvider.tsx stays pruned. On re-run, the guard `fs.readFileSync(mainPath,'utf8').includes('@luckystack/presence/client')` sees the half-applied main.tsx, prints "already present — skipped JSX injection," and proceeds to dep+install — the SocketStatusIndicator mount is silently never injected and the command reports success. The comment at line 24 ("a throw can't half-edit it") is true per file but misleading for the two-file operation.
**Why it matters for a consumer:** `npx luckystack add presence` on a lightly customized project can leave presence half-wired forever, with the tool insisting it succeeded.
**Recommendation:** Dry-run validation first: read both files, check every `find` token in memory, and only write when all tokens in BOTH files match (extend editFile with validateOnly, or split into planEdits/applyEdits). Make the idempotency guard check both files and warn explicitly on the mixed state.

### QUA-020 — Malformed i18n key `common/.404` in LoginForm fetch-failure path (3 mirrored copies)

**File:** `packages/cli/assets/login/src/_components/LoginForm.tsx:123`, `packages/create-luckystack-app/template/src/_components/LoginForm.tsx:128`, `src/_components/LoginForm.tsx:122`
**Area:** pkg-cli (mirrored into template + consumer src)
**Evidence/description:** On a failed credentials POST the code calls `notify.error({ key: 'common/.404' })` — the stray `/` means it can never resolve; locales define `common.404`. The user sees the raw key/fallback instead of the translated connection-error message. The CLI's own `check-i18n` cannot catch it: `isTranslationKey` (checkI18n.ts:18) rejects strings containing `/`, so the bad key is silently dropped from the used-set instead of reported as missing.
**Why it matters for a consumer:** Every scaffolded project's most visible failure path (login while the server is unreachable) shows a raw translation key, and the shipped lint tool is structurally blind to the typo class.
**Recommendation:** Fix the key to `common.404` in all three copies. Make check-i18n report literal `key: '...'` values that FAIL the dotted-key regex as a suspicious-key section instead of silently discarding them.

### QUA-021 — Zero tests in @luckystack/cli — no asset↔template parity check, no prune↔add round-trip test

**File:** `packages/cli/package.json:46`
**Area:** pkg-cli
**Evidence/description:** The test script is `vitest run --passWithNoTests`; a glob over packages/cli finds no `*.test.ts`. Two invariants the package itself documents are unenforced: (1) CLAUDE.md says "Edits throw on a missing token so template drift surfaces loudly" and "Mirror it [FEATURES] against OPTIONAL_PACKAGES in @luckystack/server" — neither mirror is tested; (2) the assets/login bundle must stay in lockstep with the template — it has already drifted (QUA-003), which a trivial normalized-diff test would have caught. The prune ↔ add edit-token inverse is also untested.
**Why it matters for a consumer:** The next template edit can break `luckystack add <feature>` for every consumer with nothing in CI to notice.
**Recommendation:** Three cheap vitest suites: (a) CRLF-normalized file-equality between `packages/cli/assets/login/src/**` and the template counterparts; (b) FEATURES keys (minus 'sync') ⊆ OPTIONAL_PACKAGES from @luckystack/server; (c) a tmp-dir round-trip: run the pruner edits then addPresence's edits and assert the result equals the original template files.

### QUA-022 — check-i18n is blind to template-literal keys and tells an LLM to delete live locale keys the CLI's own asset uses

**File:** `packages/cli/src/commands/checkI18n.ts:52` (dynamic-site regex at :58; victim: `packages/cli/assets/login/src/settings/page.tsx:183`)
**Area:** pkg-cli
**Evidence/description:** Used-key harvesting matches only quoted literals (`/\bkey:\s*['"]([^'"]+)['"]/`); the dynamic-site detector matches only bare identifiers — neither matches backtick template literals. The CLI's own shipped settings page uses ``translate({ key: `settings.language.${lang}` })``, and `settings.language.{nl,en,de,fr}` exist in every template locale file referenced ONLY through that call. check-i18n therefore lists those four keys per locale as UNUSED, doesn't flag the call site for review, and the report header instructs "Feed this to an LLM: delete each truly-unused key."
**Why it matters for a consumer:** In the project's 100%-AI-driven workflow, the tool's own instructions cause deletion of keys in active use — the language picker breaks after the cleanup the tool recommended.
**Recommendation:** Add a third pattern for template-literal keys (`/\bkey:\s*\`([^\`]*)\`/`), treat a captured `${` prefix as a wildcard marking all matching locale keys used, and list the site in the dynamic-review section. At minimum, list backtick call sites alongside identifier dynamic sites with the same MAY-still-be-used caveat.

### QUA-023 — Redis proxy stray-prefix net is asymmetric: set/get prefixed but del/exists/mget are not

**File:** `packages/core/src/redis.ts:82-91`
**Area:** pkg-core
**Evidence/description:** STRAY_PREFIX_COMMANDS auto-prefixes un-namespaced keys for get/set/setex/incr/sadd/hget/… but excludes `del`, `unlink`, `exists`, `touch`, `mget` as "variadic". Consequence: `redis.set('flag', v)` writes `<project>:flag`, but the natural cleanup `redis.del('flag')` targets the UNPREFIXED `flag` — the delete silently no-ops and the data persists until TTL. The exclusion rationale ("key positions can't be inferred safely") is wrong for these five commands, where EVERY argument is a key.
**Why it matters for a consumer:** For revocation-style keys (bans, kill-switches) this is a correctness/security footgun: the consumer believes the key is gone and it isn't.
**Recommendation:** Add an ALL_ARGS_ARE_KEYS set (del, unlink, exists, touch, mget) mapping every string argument through applyStrayKeyPrefix, keeping eval/scan/multi excluded. Document the symmetry guarantee in docs/redis-adapter.md.

### QUA-024 — Zero tests on core's security-critical primitives (serveAvatar, getParams, resolveClientIp, extractToken*)

**File:** `packages/core/src/serveAvatars.ts:14` (also `getParams.ts`, `resolveClientIp.ts`, `extractTokenFromRequest.ts`/`extractToken.ts`)
**Area:** pkg-core
**Evidence/description:** Core has 15+ test files (checkOrigin, cookies, csrfConfig, rateLimiter, env, clients, redisKeyFormatter, lease, …) but NONE for the four most attack-facing primitives: serveAvatars (path-traversal allowlist FILE_ID_REGEX), getParams (requestBodyMaxBytes / content-type enforcement), resolveClientIp (trustProxy / X-Forwarded-For spoof handling — the fix for audited H-1/H-2), and the token extractors (incl. the array-header fix from the prior audit). Verified by glob + grep across all packages: no `*.test.ts` references any of them.
**Why it matters for a consumer:** Regressions in exactly these files re-open already-audited vulnerabilities silently — the prior audit fixes have no regression net.
**Recommendation:** Add vitest suites: serveAvatar (`../`, `%2e%2e`, null-byte, extension-stripping), getParams (oversize declared + chunked bodies, array/scalar JSON, unknown content-type), resolveClientIp (trustProxy on/off, multi-hop XFF, array headers, IPv6 canon), extractTokenFromRequest (duplicate Authorization array, cookie-vs-bearer precedence per session mode).

### QUA-025 — Template ships a non-capturing tryCatch copy — scaffolded handlers never auto-report errors to the configured tracker, contradicting the shipped CLAUDE.md

**File:** `packages/create-luckystack-app/template/shared/tryCatch.ts:1` (canonical: `packages/core/src/tryCatch.ts:11-13`, repo `shared/tryCatch.ts`)
**Area:** pkg-create-app
**Evidence/description:** The framework's canonical tryCatch calls `captureException(error, context)` in the catch; the repo-root shared/tryCatch.ts re-exports it. The TEMPLATE ships an inline variant that explicitly omits capture ("No Sentry coupling here; if you want errors auto-captured ... call captureException inside the catch"). Every scaffolded project's `functions.tryCatch.tryCatch` — the mandated error-handling primitive injected into all API/sync handlers — silently drops error reporting, even when the user picked sentry/datadog/posthog at scaffold time. Meanwhile the CLAUDE.md copied INTO the scaffold says "the server-side path captures to Sentry via the registered error-tracker." **Framework and template have DRIFTED**; the "no coupling" comment looks deliberate, so flagging both sides per the contract.
**Why it matters for a consumer:** An observability blind spot from day one: the consumer configured a tracker and believes handler errors are reported; none are.
**Recommendation:** Re-export the canonical implementation like template/shared/sleep.ts does (`export { tryCatch } from '@luckystack/core/client';`). If the decoupling is intentional, update the consumer-shipped CLAUDE.md Error Handling section and the template comment to state that auto-capture requires wiring.

### QUA-026 — Scaffold docs reference `luckystack/login/oauthProviders.ts`, a file the scaffold does not contain

**File:** `packages/create-luckystack-app/template/README.md:94` (also `template/_dot_env_dot_local_template:26`, `src/index.ts:619-620` buildOAuthEnvVars intro, `packages/server/src/verifyBootstrap.ts:72`)
**Area:** pkg-create-app
**Evidence/description:** The README file table, the .env.local template comment, and the generated OAuth env intro all say `luckystack/login/oauthProviders.ts` "already wires" providers — but `template/luckystack/` contains only core/, i18n/, server/. The wiring moved into `@luckystack/login`'s register entry (auto-registers built-ins from env), so OAuth still works; the references are pre-0.2.0 leftovers. verifyBootstrap.ts:72 still instructs "call registerOAuthProviders([...]) from luckystack/login/oauthProviders.ts" in scaffolds' boot output.
**Why it matters for a consumer:** An AI agent told to inspect/edit that file finds nothing and may create a fresh overlay that REPLACES the auto-wired providers (cf. QUA-015's replace semantics).
**Recommendation:** Sweep the three template/CLI strings and the verifyBootstrap message to: "@luckystack/login auto-wires providers from env at boot; create luckystack/login/oauthProviders.ts only to override/add custom providers via registerOAuthProviders."

### QUA-027 — docs/cli-flags.md is stale: missing `--no-presence` and `--ai-browser`, claims "no --flag=value support", embeds outdated parseArgs source

**File:** `packages/create-luckystack-app/docs/cli-flags.md:11` (actual flags: `src/index.ts:49`; also package CLAUDE.md CliArgs row)
**Area:** pkg-create-app
**Evidence/description:** The deep-dive doc (linked from the package CLAUDE.md as the authoritative flag reference) documents only --no-install/--no-prompt/--help/-h, states "There is no support for --flag=value syntax", and pastes an old parseArgs with a 4-entry VALID_FLAGS. Actual src/index.ts:49 has six flags including the value flag `--ai-browser=<all|agent-browser|none>` and `--no-presence`. The CLAUDE.md `Type: CliArgs` row is similarly stale (4 fields vs the actual 6).
**Why it matters for a consumer:** These docs ship in the tarball and feed consumer AI agents — which will refuse to use flags that exist or mis-script the scaffolder.
**Recommendation:** Regenerate cli-flags.md from the current parseArgs (or stop embedding implementation source and describe behavior only); fix the CliArgs row. Consider a vitest assertion that every VALID_FLAGS entry appears in cli-flags.md.

### QUA-028 — Boot-time route scan classifies API/sync folders by `endsWith('api')`/`endsWith('sync')` instead of the registered marker

**File:** `packages/devkit/src/loader.ts:249` (scanApiFolder), `:386` (scanSyncFolder); contract: `packages/devkit/docs/loader-pipeline.md:64`
**Area:** pkg-devkit
**Evidence/description:** `scanApiFolder` treats ANY folder whose lowercase name ends in "api" as an API folder (same for "sync"). Consequences: (a) an innocent consumer folder like `src/openapi/` or `src/quicksync/` is swallowed as a route folder — its .ts files are imported as route modules and logged as "invalid filename"; (b) a custom `apiMarker` registered via registerRoutingRules is ignored on the boot scan while the hot-reload paths (`resolveApiRouteMetaFromPath`, loader.ts:35) use the exact marker — boot and hot-reload disagree about which files are routes. loader-pipeline.md:64 claims the walker uses "the resolved apiMarker from getRoutingRules()", which the code does not do.
**Why it matters for a consumer:** Plausible folder names break routing with confusing errors, and custom routing rules half-work (hot reload yes, boot no).
**Recommendation:** Match the exact marker: `if (file !== getRoutingRules().apiMarker) { recurse }` (same for syncMarker), aligning the boot scan with resolveApiRouteMetaFromPath and the validators.

### QUA-029 — isGeneratedPath omits `apiInputSchemas.generated.ts` — every regen self-triggers a second full type-map regeneration

**File:** `packages/devkit/src/hotReload.ts:176-181` (writer: `typeMap/emitterArtifacts.ts:571`; default path: `packages/core/src/projectConfig.ts:539`)
**Area:** pkg-devkit
**Evidence/description:** `isGeneratedPath` filters only `apiTypes.generated.ts` and `apiDocs.generated.json`, but the generator also writes `apiInputSchemas.generated.ts` into the watched srcDir. That write passes the check, qualifies as `isRouteDependencyFile`, and schedules ANOTHER type-map regeneration plus dependency fan-out (hotReload.ts:367-374). The loop terminates only because writeFileIfChanged emits identical content the second time — so every real input-type change costs one extra full ts.Program rebuild + extraction pass (multi-second on real projects) plus log noise.
**Why it matters for a consumer:** Dev-loop latency doubles on every route input change for no benefit.
**Recommendation:** Add `apiInputSchemas.generated.ts` to isGeneratedPath — preferably by filtering on `getGeneratedApiSchemasPath()` so custom paths are covered too.

### QUA-030 — No test exercises the docs-ui client render pipeline against a real artifact shape

**File:** `packages/docs-ui/src/docsHtml.test.ts:1` (also `index.test.ts` `'{"apis":{}}'` stubs)
**Area:** pkg-docs-ui
**Evidence/description:** docsHtml.test.ts only string-asserts produced HTML (title, CSS vars, flags, escaping); index.test.ts covers routing/gating/JSON passthrough with empty stubs. Nothing executes the embedded `render()`/`renderEndpoint()` JS against a representative apiDocs.generated.json — which is exactly why QUA-001 (shape mismatch) and QUA-007 (broken URL) shipped unnoticed.
**Why it matters for a consumer:** The package's entire value is correct rendering of one artifact; the devkit↔renderer contract is untested on both sides, so the next emitter change breaks the page silently again.
**Recommendation:** Add a JSDOM (or extracted-function) test that loads a fixture matching devkit's GeneratedDocsData (arrays of ApiDocsEntry + syncs) and asserts endpoint rows render with correct paths/methods/counts. Longer term: extract the inline script's pure functions (render, renderEndpoint, renderAuth, passesFilter) into a testable module bundled into the HTML string — also the already-deferred "typed JS extraction" item in docs/audits/REAUDIT_2026-06-09.md.

### QUA-031 — sendEmail.ts — the package's central orchestrator — has zero test coverage while every leaf module is tested

**File:** `packages/email/src/sendEmail.ts:85` (redaction at :23-31)
**Area:** pkg-email
**Evidence/description:** Tests exist for console/resend/smtp adapters, autoSelect, emailConfig, renderEmailLayout, and templates — but no sendEmail.test.ts, and no test references sendEmail (grep-verified). Untested security-relevant behavior: PII redaction before Sentry capture (hashRecipient/redactSubject — the fix for the SECURITY_AUDIT "Information disclosure" finding has no regression test), sender resolution precedence (adapter → adapterHint → default → legacy), the required-throw policy, hook dispatch ordering, and the no-sender/no-template early returns.
**Why it matters for a consumer:** A refactor can silently reintroduce PII leakage into error tracking or change sender resolution under consumers' feet.
**Recommendation:** Add sendEmail.test.ts with a stub EmailSender + clearAllHooks/resetEmailTemplatesForTests asserting: (1) redacted to/cc/bcc + subject reach captureException (mock core), (2) resolution precedence, (3) required:true throws vs soft no-sender, (4) pre/post hook payloads, (5) the template path.

### QUA-032 — Consumer `template.render()/subject()` throws escape sendEmail, breaking its "returns a typed result rather than throwing" contract

**File:** `packages/email/src/sendEmail.ts:113-116` (contract comment at :81-84; adapter throws ARE normalized at :142)
**Area:** pkg-email
**Evidence/description:** `template.render(data)` and `template.subject(data)` are called outside any tryCatch, while the function's contract comment promises "Returns a typed result rather than throwing so callers can branch without try/catch". Adapter throws are normalized and hook throws isolated — consumer-registered templates are the only third-party code in the pipeline that can crash the caller.
**Why it matters for a consumer:** A template doing `(data.items as X[]).map(...)` on a malformed payload throws straight out of e.g. a password-reset or receipt API handler.
**Recommendation:** Wrap subject/render in tryCatch and return `{ ok: false, reason: 'template-render-failed', cause: error }` (plus captureException with the template name); document the new reason string in docs/error-handling.md.

### QUA-033 — README claims initializeSentry registers apiError/syncError and postLogin handlers — none exist

**File:** `packages/error-tracking/README.md:44` (also `packages/error-tracking/CLAUDE.md:7`; accurate doc: `docs/auto-instrumentation.md`)
**Area:** pkg-error-tracking
**Evidence/description:** README "What gets auto-instrumented" says initializeSentry() registers handlers on `apiError`, `syncError` and `postLogin / postLogout — call setSentryUser`. src/autoInstrumentation.ts registers ONLY preApiValidate, preApiExecute, postApiExecute, preSyncAuthorize, preSyncFanout, postSyncFanout, and postLogout — no apiError, no syncError, no postLogin subscriber. (Error capture actually flows through core's tryCatch → captureException; the `apiError`/`syncError` hooks dispatched by the server have no subscriber from this package.) Package CLAUDE.md line 7 repeats the same wrong list.
**Why it matters for a consumer:** For an AI-driven consumer the docs are the contract; this sends them looking for (and depending on) behavior that does not exist.
**Recommendation:** Fix README.md:42-46 and CLAUDE.md:7 to list the actual hooks and describe the tryCatch capture path, matching docs/auto-instrumentation.md.

### QUA-034 — register.ts points Datadog users at a non-existent `@luckystack/error-tracking/datadog-preload` subpath

**File:** `packages/error-tracking/src/register.ts:15` (package.json `exports` has only `.` and `./register`; tsup.config.ts builds no such entry)
**Area:** pkg-error-tracking
**Evidence/description:** The register entry's header instructs: "For Datadog, use the separate `--import @luckystack/error-tracking/datadog-preload` mechanism (dd-trace must be the process's first import)". No such file exists anywhere in the repo (only grep hit is this comment), no `./datadog-preload` export exists, nothing builds it. There is also no zero-config Datadog path at all (no DD_* env gate in register.ts).
**Why it matters for a consumer:** Following the instruction yields ERR_PACKAGE_PATH_NOT_EXPORTED at boot; the install-anything-anytime story for Datadog is a dangling pointer.
**Recommendation:** Either implement the preload entry (a small module that requires/inits dd-trace + hot-shots from env and registers createDatadogAdapter, exported as `./datadog-preload` and built by tsup) or delete the comment and document the manual consumer-side dd-trace init path (docs/adapter-pattern.md already covers it).

### QUA-035 — PostHog adapter user identity is a single mutable variable — concurrent requests cross-attribute events to the wrong user

**File:** `packages/error-tracking/src/adapters/posthog.ts:52`
**Area:** pkg-error-tracking
**Evidence/description:** `let currentDistinctId` is closure state on the adapter instance, mutated by `setUser`, which autoInstrumentation fires on EVERY preApiValidate/preSyncAuthorize (process-global hook, no async-context isolation). On a server handling concurrent requests, user A's exception captured between user B's preApiValidate and capture is attributed to B's distinctId — wrong-user attribution of errors and `identify` calls. The Sentry path has the same class of problem on the socket transport (global `Sentry.setUser` without isolation scopes). Confidence: medium.
**Why it matters for a consumer:** Error analytics quietly lie about which user hit the bug — the kind of data corruption nobody notices until they act on it.
**Recommendation:** Carry user identity in the capture call's context (the payload already flows through the hooks) or wrap request handling in AsyncLocalStorage so setUser is per-request. Short term: document the cross-attribution limitation in docs/adapter-pattern.md and prefer `context.userId` from call sites.

### QUA-036 — login register.ts captures getProjectConfig() at module load, violating the package's call-time-resolution contract

**File:** `packages/login/src/register.ts:54-110`
**Area:** pkg-login
**Evidence/description:** `const projectConfig = getProjectConfig();` runs as an import-time side effect, then derives callbackBase, `auth.credentials`, and the entire provider list from it. The package's own CLAUDE.md states "Resolved at call time via getProjectConfig() — no module-load capture", and login.ts/session.ts deliberately use call-time getters for exactly this reason.
**Why it matters for a consumer:** Importing `@luckystack/login/register` before registerProjectConfig runs silently yields default config (empty oauthCallbackBase, default credentials) and a wrong/empty provider registry — no error, just broken OAuth.
**Recommendation:** Wrap the provider wiring in an exported `registerDefaultProvidersFromEnv()` invoked by bootstrapLuckyStack after config registration (keep the side-effect entry as a thin call to it), or at minimum guard with isProjectConfigRegistered() and log a loud warning when unregistered.

### QUA-037 — sendEmailChangeConfirmation does not catch a failed @luckystack/email lazy import (inconsistent with forgotPassword)

**File:** `packages/login/src/emailChangeNotification.ts:40` (correct pattern: `forgotPassword.ts:47-55`)
**Area:** pkg-login
**Evidence/description:** `const { sendEmail, renderEmailLayout } = await (import('@luckystack/email') as Promise<EmailModule>);` has no `.catch` — when the optional peer isn't installed the rejection bubbles out as an unhandled throw (a generic 500 in requestEmailChange_v1, which awaits it without tryCatch). forgotPassword.ts deliberately catches the same import and returns `{ ok: false, reason: 'email-module-load-failed' }` with a diagnostic log. Same seam, divergent failure behavior.
**Why it matters for a consumer:** The optional-peer story is inconsistent: forgot-password degrades gracefully, email-change 500s with no hint that a package is missing.
**Recommendation:** Mirror forgotPassword's pattern: catch the import, log "[emailChange] failed to load @luckystack/email — is it installed?", and return `{ ok: false, reason: 'email-module-load-failed', token: '' }`.

### QUA-038 — No package-level tests for login.ts — credentials flow, OAuth callback, and state consumption untested

**File:** `packages/login/src/login.ts:1` (717 lines; also untested: passwordReset.ts, emailChange.ts, forgotPassword.ts, logout.ts, sessionAdapter.ts)
**Area:** pkg-login
**Evidence/description:** packages/login/src has tests for oauthProviders, passwordPolicy, redirectResolver, session, and userAdapter — but the security-critical core (loginWithCredentials dispatcher, register auto-login, consumeOAuthState single-use semantics, isAllowedRedirectUrl origin validation, loginCallback) has no login.test.ts. The consumer-level auto-sweep covers the HTTP route, not these unit seams (redirect-origin allowlist, the multi/get/del state transaction).
**Why it matters for a consumer:** OAuth state single-use and redirect allowlisting are the package's anti-CSRF/anti-open-redirect defenses; regressions there are silent and exploitable.
**Recommendation:** Add login.test.ts covering at minimum: isAllowedRedirectUrl (relative URL, allowed origin, function-resolver variant, malformed config), consumeOAuthState single-use + missing-state, the register/login body-shape dispatcher; plus passwordReset.test.ts for token mint/consume one-shot semantics.

### QUA-039 — socketConnected broadcasts userBack ungated by socketActivityBroadcaster and on cold connects, contradicting the documented contract

**File:** `packages/presence/src/activity/lifecycle.ts:58` (caller: `packages/server/src/loadSocket.ts:134`; contract: `packages/presence/docs/lifecycle.md:89,99`, `register.ts:4-5`)
**Area:** pkg-presence
**Evidence/description:** Two violations in one path: (1) `informRoomPeers({ ... event: userBack ... })` runs whenever the session has roomCodes + userId — regardless of `isReconnect` — yet lifecycle.md:99 states cold connect = "(no userBack broadcast — cold connect)". (2) The loadSocket caller invokes socketConnected WITHOUT checking `activityBroadcasterEnabled`, while register.ts, the package CLAUDE.md, and lifecycle.md:89 all promise peer notifications are gated by `projectConfig.socketActivityBroadcaster` (default false). Net: merely installing @luckystack/presence makes every connect with persisted roomCodes broadcast userBack to roommates with the gate flag off.
**Why it matters for a consumer:** A privacy/traffic behavior the consumer explicitly left disabled fires anyway — and differently from the docs they'd debug against.
**Recommendation:** Gate the userBack fan-out (read `getProjectConfig().socketActivityBroadcaster` in socketConnected, or fix the loadSocket call-site). Decide whether cold-connect userBack is wanted; align code and lifecycle.md either way; add a test.

### QUA-040 — Refractory-throttle map (lastFired) grows unboundedly — never pruned on socket disconnect

**File:** `packages/presence/src/activityEvents.ts:43-44` (cleanup that exists: `activity/activitySampler.ts:27-29` covers only lastActivityBySocket)
**Area:** pkg-presence
**Evidence/description:** `const lastFired = new Map<string, number>()` keyed `${eventName}|${socketId}` is only ever written in dispatchActivitySample. `clearActivity(socketId)` cleans `lastActivityBySocket` on disconnect but nothing deletes the corresponding lastFired entries. Socket ids are unique per connection, so every socket that ever triggered a throttled event leaks one entry per event forever. REAUDIT_2026-06-09.md:108 verified only the lastActivityBySocket cleanup; lastFired is not covered by any prior audit.
**Why it matters for a consumer:** Slow, permanent memory growth on any long-running deployment with activity events enabled.
**Recommendation:** Export `clearActivityThrottle(socketId)` deleting all `*|${socketId}` keys and call it from clearActivity; or sweep stale keys in the sampler tick via `io.sockets.sockets.has(socketId)`.

### QUA-041 — Presence docs drift: lifecycle.md still documents the token-leaking AFK broadcast and the -1 recipientCount sentinel that no longer exist

**File:** `packages/presence/docs/lifecycle.md:113` (also `docs/peer-notifier.md:147-149`, `docs/disconnect-grace.md:51-56,73-82`, source comments `src/activity/afkEvent.ts:3`, `hookPayloads.ts:22`)
**Area:** pkg-presence
**Evidence/description:** The code was fixed but the shipped docs (npm `files` includes `docs/`) still describe old behavior: (1) lifecycle.md:113 shows the default AFK event emitting `io.to(room).emit(socketEventNames.userAfk, { token })` — actual afkEvent.ts:21-25 routes through informRoomPeers emitting `{ userId, endTime }` only (documenting a token leak as current behavior is especially bad); (2) peer-notifier.md claims the default 'afk' event reports `recipientCount: -1` — it now uses informRoomPeers with real counts; (3) disconnect-grace.md shows PresenceConfig/DEFAULT_PRESENCE_CONFIG without `activitySampleIntervalMs`, which presenceConfig.ts:61-73 includes; (4) source comments reference `projectConfig.presence.afkTimeoutMs` — the key actually lives in registerPresenceConfig.
**Why it matters for a consumer:** AI-driven consumers treat shipped docs as the contract and will code against payload shapes (token field, -1 sentinel) that don't exist — or worse, assume tokens are broadcast.
**Recommendation:** Sweep packages/presence/docs/* + source comments against the 0.2.0 code: fix the T+5m timeline, delete the -1 sentinel paragraph, add activitySampleIntervalMs to config tables, correct the projectConfig.presence references.

### QUA-042 — Security validators added after the audit have zero test coverage (validateUrl, validateToken, isSafeEnvFile, env-key regex)

**File:** `packages/secret-manager/src/index.test.ts:1` (untested code: `src/index.ts:114-124, 136-149, 93-97, 280-282`)
**Area:** pkg-secret-manager
**Evidence/description:** The hardening added for SECURITY_AUDIT.md item 11 — validateUrl (rejects non-http(s)/relative URLs), validateToken (rejects empty token, warns on "Bearer " prefix), isSafeEnvFile (rejects `..` traversal in dev envFiles), the POSIX env-key regex in parseEnvFile — has NO corresponding test. Verified by reading the full test file: no throw-assertions on `file:///x` URLs, empty tokens, `../escape` envFiles, or `INVALID-KEY=` lines.
**Why it matters for a consumer:** A future refactor of doResolve ordering can silently drop these security checks with green tests.
**Recommendation:** Add focused cases: init throws on `url: 'file:///etc'` and `'not-a-url'`; init throws on `token: '  '`; console.warn fires + watcher skipped for `envFiles: ['../outside.env']` (reloadSecretManagerFromFiles is testable without fs.watch); parseEnvFile warns + skips `BAD-KEY=value`. All drivable through the existing public-surface test pattern.

### QUA-043 — withSessionLock only serializes per-process — cross-instance roomCodes read-modify-write race

**File:** `packages/server/src/loadSocket.ts:36-49` (RMW at :200-228; gap in `docs/ARCHITECTURE_MULTI_INSTANCE.md`)
**Area:** pkg-server
**Evidence/description:** withSessionLock is an in-memory Map of promises, so join/leave/updateLocation session mutations are serialized only within one instance. The session lives in shared Redis, and the same user with two tabs can land on two instances (explicitly supported with the Redis adapter). Two concurrent joins on different instances both do readSession → spread → writeSession; the last writer silently drops the other's roomCode (the Socket.io room join succeeds in memory, but persisted `session.roomCodes` loses the entry, so the room is NOT replayed on next reconnect). ARCHITECTURE_MULTI_INSTANCE.md does not mention this pitfall (grep-verified). Confidence: medium.
**Why it matters for a consumer:** Multi-instance deployments — the architecture's headline scaling path — intermittently lose room membership after reconnects, an extremely hard bug to trace.
**Recommendation:** Use the existing core lease primitives (acquireLease/releaseLease keyed `session-lock:<token>`) around the RMW, or store roomCodes as a Redis SET (SADD/SREM) instead of a field inside the session blob. At minimum document the limitation in ARCHITECTURE_MULTI_INSTANCE.md.

### QUA-044 — RuntimeSyncServerEntry.validation is declared, generated, and documented — but never read by either sync handler

**File:** `packages/sync/src/_shared/syncTypes.ts:75` (handlers: `handleSyncRequest.ts:407`, `handleHttpSyncRequest.ts:362`; generator: `scripts/generateServerRequests.ts:176`)
**Area:** pkg-sync
**Evidence/description:** syncTypes.ts declares `validation?: 'strict' | 'relaxed' | { input: 'skip' | 'strict' }` on the sync server entry and the prod generator emits it — but neither transport handler ever checks it; both unconditionally call `validateInputByType`. A consumer setting `validation: { input: 'skip' }` on a sync route (e.g. a dynamic payload the Zod generator can't model) gets the export silently ignored and the request rejected with `sync.invalidInputType`. The API socket handler honors the option (api/_shared/httpValidationStage.ts:17-19); sync has no documented exception.
**Why it matters for a consumer:** A documented, typed, generated escape hatch simply does nothing — the consumer has no way to ship a route the validator can't model.
**Recommendation:** Either honor `serverSyncEntry.validation` before calling validateInputByType (matching the API socket handler's semantics) or delete the field from RuntimeSyncServerEntry + the generator and document that sync input validation is always strict.

### QUA-045 — chunkCounters Map grows unboundedly — the "cleared on teardown" comment is false

**File:** `packages/sync/src/_shared/streamEmitters.ts:10-19` (per-token dispatch at :227-229)
**Area:** pkg-sync
**Evidence/description:** `const chunkCounters = new Map<string, number>()` carries the comment "Cleared on receiver-room teardown." Repo-wide grep shows the only references are the get/set inside bumpChunkIndex — no delete/clear anywhere. Keys are `${routeName}|${recipient}` where recipient includes room codes AND session tokens — both unbounded, churning sets. Slow permanent leak on streaming-heavy deployments, plus semantic drift: the counter never resets per stream, so postSyncStream consumers see a process-lifetime counter, not a per-stream index.
**Why it matters for a consumer:** Memory leak + a hook payload (`chunkIndex`) that doesn't mean what any reasonable consumer assumes.
**Recommendation:** Reset/delete the counter key when a stream completes (cleanupRequest / postSyncFanout for the route+recipient pair), or replace the module-level Map with a per-request counter created inside buildSyncStreamEmitters (the emitters are already per-request). Fix the comment either way.

### QUA-046 — syncRequest promise never settles when its queued offline request is evicted (drop-oldest / maxAgeMs)

**File:** `packages/sync/src/syncRequest.ts:446-468` (eviction sites: `packages/core/src/offlineQueue.ts:45-56, 73-77`)
**Area:** pkg-sync
**Evidence/description:** syncRequest resolves the caller's promise only when enqueueSyncRequest returns false (`offline.queueFull`). But core's offlineQueue silently discards items in two other cases: drop-oldest does `queue.shift()` on the OLD item, and evictExpired splices items older than maxAgeMs. The discarded item's `run` closure is the only thing that can settle its promise, so every evicted send leaves an `await syncRequest(...)` hanging forever — no resolve, no reject, no timeout. With the documented "editor cursor move → drop-oldest" pattern this is the NORMAL overflow path.
**Why it matters for a consumer:** Awaiting callers routinely leak promises (and captured state) while offline; any code structured as `await syncRequest(); updateUI()` freezes.
**Recommendation:** Give queue items an `onDrop` callback (invoked on shift/splice/expiry) and have syncRequest resolve with `{ status: 'error', errorCode: 'offline.dropped' }`; apply the same fix to apiRequest's queue usage.

### QUA-047 — room-fanout.md describes the pre-fetchSockets implementation — contradicts current cross-instance code in three sections

**File:** `packages/sync/docs/room-fanout.md:14` (§1 :13-17, §6, §7 :185-188; current code: `handleSyncRequest.ts:488-495`)
**Area:** pkg-sync
**Evidence/description:** The shipped deep-doc is out of sync with the handler: (1) §1 shows `ioInstance.sockets.sockets` / `adapter.rooms.get(receiver)` while the code uses `await io.in(receiver).fetchSockets()`; (2) §6 case 2 describes `sockets.sockets.get(socketId)` returning undefined mid-fanout — a path that no longer exists; (3) §7 states "per-recipient `_client` execution only runs against local sockets" and recommends sticky sessions — but the RemoteSocket-based fanout runs `_client` for recipients on every instance (exactly what the handler comment and ARCHITECTURE_MULTI_INSTANCE.md now say).
**Why it matters for a consumer:** The doc ships in the npm tarball; AI consumers will make wrong architecture decisions (unnecessary sticky sessions) based on guidance the code obsoleted.
**Recommendation:** Update §1, §6 and §7 to the fetchSockets/RemoteSocket model and remove the sticky-sessions workaround.

### QUA-048 — Prototype-pollution fuzz payload is a no-op: `{ __proto__: {...} }` serializes to `{}`

**File:** `packages/test-runner/src/fuzzCheck.ts:18`
**Area:** pkg-test-runner
**Evidence/description:** JUNK_PAYLOADS includes `{ __proto__: { polluted: true } }`. In an object literal, `__proto__:` is the Annex-B prototype setter, not an own property, so `JSON.stringify(...)` produces `"{}"` (verified with node in this repo). The one security-relevant payload in the catalogue never reaches the wire.
**Why it matters for a consumer:** False confidence: the sweep reports endpoints as fuzzed against __proto__ injection when they were sent an empty object.
**Recommendation:** Build the payload so the key survives serialization — `JSON.parse('{"__proto__":{"polluted":true}}')` or a pre-serialized raw body string (add `{"constructor":{"prototype":{...}}}` while at it). Add a unit test asserting the serialized body contains `"__proto__"`.

### QUA-049 — runAllTests applies `filter` post-hoc: filtered-out endpoints are still hit (including full rate-limit drains)

**File:** `packages/test-runner/src/runAllTests.ts:79` (sweep invocations :80-118, cloneSummary :65-68; correct model: `customTests.ts:387`)
**Area:** pkg-test-runner
**Evidence/description:** RunAllTestsInput.filter is documented as "Substring filter applied to <page>/<name>/<version>" and exposed as TEST_FILTER. But the sweep layers run WITHOUT the filter; filtering happens afterwards in cloneSummary(), which merely drops results from the report. `TEST_FILTER=login/sendReset` still fires contract+auth+fuzz requests at EVERY endpoint and drains every endpoint's rate-limit bucket, then hides the results — slow, state-mutating, and any failure on a non-matching endpoint is silently dropped from totalFailed/exit code. Only runCustomTests applies the filter pre-run.
**Why it matters for a consumer:** The focused-debug knob the docs advertise actually hammers the whole API and can mask real failures.
**Recommendation:** Apply the filter pre-run: pass a predicate into each sweep (or pre-filter walkEndpoints output via a shared `filterEndpoints` in testLayerHelpers.ts); keep cloneSummary only as a safety net.

### QUA-050 — resetBetweenEndpoints wipes sessions, breaking the authenticated rate-limit sweep it is meant to support

**File:** `packages/test-runner/src/runRateLimitTests.ts:88-89` (server side: `packages/server/src/httpRoutes/testResetRoute.ts:41-63`)
**Area:** pkg-test-runner
**Evidence/description:** runRateLimitTests supports an authenticated sweep (`isAuthenticatedSweep = Boolean(input.headers?.Cookie)`) so login-gated routes can be rate-limit-tested. But with `resetBetweenEndpoints: true`, resetServerState() hits /_test/reset, which deletes ALL `-session:*` Redis keys — including the session backing the sweep's own Cookie. From the second endpoint on, every drain request and the N+1 probe return `auth.required` instead of `api.rateLimitExceeded`. The two documented knobs (resetBetweenEndpoints, TEST_AUTH_TOKEN) are mutually destructive with no warning anywhere.
**Why it matters for a consumer:** Confusing false failures on exactly the configuration the docs recommend for authenticated rate-limit testing.
**Recommendation:** Re-mint/re-save the session after each reset (expose a `reauthenticate?: () => Promise<string>` callback), or make /_test/reset support scoped clears (`?include=rateLimits`) and request only that; at minimum document the incompatibility in rate-limit-tests.md and CLAUDE.md.

### QUA-051 — test-runner README peer-dep and feature claims are stale (zod ^3.25 vs ^4, missing socket.io-client peer, "four layers", nonexistent getApiMethodMapPath)

**File:** `packages/test-runner/README.md:79` (also :3, :8, :54; `packages/test-runner/CLAUDE.md:88`; truth: `package.json:60-61`)
**Area:** pkg-test-runner
**Evidence/description:** (1) README says peer `zod@^3.25.0` vs package.json `"zod": "^4.0.0"`; (2) Install instructions omit the REQUIRED peer `socket.io-client@^4.8.0` and the optional `@luckystack/login` peer needed for ctx.session; (3) "four progressive test layers" vs the five that ship (custom Layer 5, runAllTests); (4) "Defaults are read via getApiMethodMapPath() from @luckystack/core" — that function does not exist anywhere in packages/core/src (grep: no matches); CLAUDE.md:88 repeats the phantom function and claims `@luckystack/core@^0.1.0` vs the actual `^0.2.0`.
**Why it matters for a consumer:** This is the published-package README for 0.2.0 — a stranger following it gets unmet peers and chases a phantom API.
**Recommendation:** Sweep README.md + CLAUDE.md before publish: zod ^4.0.0, add socket.io-client (+ optional @luckystack/login) to Install and the peer table, "five layers", delete both getApiMethodMapPath references, core ^0.2.0.

### QUA-052 — CLAUDE.md misdocuments /_test/reset gating as "available whenever not production, token optional" — server is stricter

**File:** `packages/test-runner/CLAUDE.md:78-79` (also `README.md:53`; truth: `packages/server/src/httpRoutes/testResetRoute.ts:19,26`, runner's own `resetServerState.ts:7-10`)
**Area:** pkg-test-runner
**Evidence/description:** CLAUDE.md says /_test/reset is "automatisch beschikbaar wanneer NIET production" with TEST_RESET_TOKEN optional; README says the same. The actual server requires NODE_ENV exactly 'development' or 'test' AND requires TEST_RESET_TOKEN unconditionally ("an unset token must NOT mean no auth required" — 403 when unset). An AI agent following CLAUDE.md calls resetServerState without a token, gets 403/false, and resetBetweenEndpoints silently does nothing (resetServerState's boolean return is ignored at runRateLimitTests.ts:89). Security-relevant doc drift — the stricter server is correct, the docs describe a weaker model.
**Why it matters for a consumer:** The reset feature silently no-ops, corrupting test results, while the docs assert it works tokenless.
**Recommendation:** Fix CLAUDE.md:78-79 and README.md:53 to match testResetRoute.ts. Stop ignoring resetServerState's return — surface a skipped/warning result when reset fails.

### QUA-053 — Client code references six i18n keys that exist in no locale file (toasts render raw key strings)

**File:** `src/_locales/en.json:1` (+ nl/de/fr.json and the template `src/_locales/*.json`; call sites: `src/_functions/socketInitializer.ts:158,174,207,271,297,325,347,386,390,416`, `src/admin/page.tsx`)
**Area:** consumer-app
**Evidence/description:** socketInitializer.ts and admin/page.tsx emit `notify.*({ key })` / translate for keys absent from all four locales: `common.sessionReplacedElsewhere`, `common.unknownError`, `common.connectionError`, `common.logoutFailed`, `common.invalidGroup`, `common.invalidLocation`. i18nNotify's resolve() falls back to returning the key verbatim, so the user sees a literal `common.unknownError` toast — and Rule 13 makes i18n mandatory. The byte-identical template socketInitializer.ts references the same keys while template locales also lack them, so every scaffolded project ships these broken toasts.
**Why it matters for a consumer:** Every scaffold's connection/session error UX shows raw key strings — the first thing a user sees when anything goes wrong.
**Recommendation:** Add the six keys to all four locale files (repo + template). Consider a CI/lint check cross-referencing `notify({ key })`/`translate({ key })` literals against the locale JSON (dovetails with QUA-022's check-i18n fixes).

### QUA-054 — Leftover debug console.log of filesystem paths on every static request

**File:** `server/prod/serveFile.ts:57-58`
**Area:** consumer-server
**Evidence/description:** serveFile() runs `console.log(filePath)` and `console.log(rootFolder)` on EVERY static-asset / SPA-fallback request. Leftover debugging: floods stdout in production, bypasses getLogger, and discloses absolute server filesystem paths into logs. serveFile is the catch-all handler passed to @luckystack/server, so it fires for index.html and every asset.
**Why it matters for a consumer:** Log noise + path disclosure in the reference app that the template mirrors.
**Recommendation:** Remove the two lines, or route through `getLogger().debug` behind `config.logging.devLogs` so they're silent in production.

### QUA-055 — CI never runs the vitest unit suite (test:unit) or lint:packages — framework package code is unverified in CI

**File:** `.github/workflows/ci.yml:41` (same gap in `.gitlab-ci.yml`; scripts: root `package.json` test:unit / lint:packages)
**Area:** tooling
**Evidence/description:** Root package.json defines `test:unit` (vitest run) and `lint:packages` (eslint over packages/*/src — the publishable framework code), and packages contain real unit tests (extensionRegistry.test.ts, schemaSampleInput.test.ts, walkEndpoints.test.ts, …). ci.yml only runs `npm run lint` (= lint:client + lint:server, excluding packages/) and `npm run test` (the integration sweep, which itself can't pass — QUA-017).
**Why it matters for a consumer:** A repo about to publish 15 packages gates merges on neither the packages' lint contract nor their unit tests — regressions ship to npm unverified.
**Recommendation:** Add CI steps `npm run lint:packages` and `npm run test:unit` (vitest needs no server/Redis). Consider folding lint:packages into lint:all so Rule 11's autonomous `npm run lint` also covers framework code.

### QUA-056 — scripts/bundleServer.mjs imports esbuild as a phantom (undeclared) dependency

**File:** `scripts/bundleServer.mjs:1`
**Area:** tooling
**Evidence/description:** `import { build } from 'esbuild';` — but esbuild appears in NO package.json in the repo (grep-verified across root and all packages). It resolves today only because tsup/vite hoist esbuild into node_modules. `npm run build` / `npm run buildServer` (the production server bundle path, advertised in .gitlab-ci.yml:120) breaks the day tsup changes its esbuild strategy or hoisting differs on a consumer machine.
**Why it matters for a consumer:** The documented prod build can fail with "Cannot find module 'esbuild'" after an unrelated dependency bump.
**Recommendation:** Add `esbuild` to root devDependencies with an explicit range aligned to what tsup currently hoists.

### QUA-057 — @luckystack/core barrel connects to Redis at import time, forcing process.exit workarounds in every generator script and making generateArtifacts Redis-dependent

**File:** `scripts/generateTypeMaps.ts:13-21` (also `scripts/generateServerRequests.ts:214-217`; root cause in packages/core — see QUA-059)
**Area:** tooling
**Evidence/description:** Both generator scripts carry the identical workaround comment: "loading @luckystack/core ... connects to Redis on import. Without an explicit exit the dangling ioredis handle keeps the event loop alive and the script hangs" — followed by forced `process.exit(0/1)`. Consequences: (a) every script touching the barrel must hard-exit, masking genuinely pending async work; (b) `npm run generateArtifacts` — which CI runs with no Redis service — spins up an ioredis connection retrying against nothing; (c) a fresh consumer running postinstall generateArtifacts before configuring Redis hits the same side effect.
**Why it matters for a consumer:** Codegen — a pure transform — requires (or noisily retries) a live Redis, and the exit() escape hatches hide real bugs.
**Recommendation:** Make the core Redis client lazy (connect on first use / `lazyConnect:true` behind a getter) so type-map generation never touches Redis; then drop the process.exit() hatches in both generators. Cross-references QUA-059 (core import-time side effects).

---

## Low

### QUA-058 — Shipped LoginForm hardcodes English UI strings despite the framework's mandatory-i18n rule

**File:** `packages/cli/assets/login/src/_components/LoginForm.tsx:14-18` (also template LoginForm.tsx:14-18 and consumer src copy)
**Area:** pkg-cli
**Evidence/description:** "Sign in to your account", "Create a new account", "Don't have an account yet? ", "Create one now", "Log in", "Sign up" are hardcoded — while the same file imports and uses `useTranslator` for its toasts, and CLAUDE.md Rule 13 makes i18n mandatory for user-facing text. All three mirrors share the issue.
**Why it matters for a consumer:** A non-English product gets an English-only auth surface and must hand-translate the framework's own component.
**Recommendation:** Replace the literals with `translate({ key: 'login.title' })` / `'register.title'` etc., add the keys to the four template locale files, and update the cli asset and template together (the QUA-021 parity test keeps them in sync).

### QUA-059 — Import-time side effects in core: .env load + throw, dev PrismaClient construction, cleanup timer

**File:** `packages/core/src/env.ts:108` (also `db.ts:20-23`, `rateLimiter.ts:334`)
**Area:** pkg-core
**Evidence/description:** `export const env = bootstrapEnv();` makes ANY import of @luckystack/core synchronously read .env/.env.local from process.cwd(), mutate process.env, and THROW on schema failure (a non-numeric SERVER_PORT kills an unrelated CLI/codegen tool at import). db.ts eagerly constructs PrismaClient at import when NODE_ENV !== 'production' (crashes contexts without a generated client). rateLimiter.ts schedules a recurring setTimeout at import. This contradicts the package's own doctrine in projectConfig.ts ("Never read at module load"), and the router already works around it (synchronizedEnvHashes.ts: "without loading the core barrel (which opens a Redis connection)").
**Why it matters for a consumer:** Any tool that merely type-imports core inherits env validation, a Prisma client, and a Redis connection — see QUA-057 for the concrete downstream damage.
**Recommendation:** Make env resolution lazy (`getEnv()` memoized; keep `env` as a Proxy for BC), drop the dev-mode eager Prisma init (globalThis cache already stabilizes HMR on first use), and start the rate-limit cleanup timer on first checkRateLimit call.

### QUA-060 — Dead export isMethodAllowed silently permits OPTIONS for any method-locked route

**File:** `packages/core/src/httpApiUtils.ts:74` (documented in `docs/socket-bootstrap.md:18`)
**Area:** pkg-core
**Evidence/description:** `isMethodAllowed` returns `requestMethod === allowedMethod || requestMethod === 'OPTIONS'`. Grep confirms no framework package calls it (handleHttpApiRequest compares methods directly) — dead code, but exported from the barrel and documented as the method-validation helper. A consumer using it for a custom route would execute their handler on OPTIONS requests, and the CSRF middleware explicitly treats OPTIONS as non-state-changing, so such a route would be CSRF-exempt.
**Why it matters for a consumer:** A documented helper that quietly opens a CSRF-exempt execution path is a trap for custom-route authors.
**Recommendation:** Remove the export, or change semantics to return false for OPTIONS and let the HTTP layer answer preflights before route dispatch; update docs/socket-bootstrap.md accordingly.

### QUA-061 — `--ai-browser` flag is silently ignored when the interactive wizard runs

**File:** `packages/create-luckystack-app/src/index.ts:1112`
**Area:** pkg-create-app
**Evidence/description:** `args.aiBrowserTooling` (and `args.noPresence`) are only consulted in the --no-prompt branch. Running `npx create-luckystack-app my-app --ai-browser=none` without --no-prompt validates the flag (exit 2 on bad value) but then discards it: the wizard asks again and its answer wins, with no warning.
**Why it matters for a consumer:** A flag that is parsed, validated, then dropped is surprising — especially to scripted/AI callers.
**Recommendation:** When a choice-bearing flag is present, pre-seed the wizard default and/or skip that step, or print "note: --ai-browser overridden by wizard answer".

### QUA-062 — No cleanup of a half-written project directory when the scaffold fails midway

**File:** `packages/create-luckystack-app/src/index.ts:1288` (existsSync guard at :1099; throw sources e.g. editScaffoldFile :1015-1019)
**Area:** pkg-create-app
**Evidence/description:** `main().catch` only logs "unexpected error" and exits 1. If copyTree, injectOptionalDeps, or a pruneOptionalPackages token-drift throw fires AFTER mkdirSync/partial copy, the broken half-scaffold stays on disk and a retry immediately dies on "Target directory already exists" with no hint the dir is an aborted partial scaffold.
**Why it matters for a consumer:** A confusing first-run experience; the obvious retry fails for a non-obvious reason.
**Recommendation:** Track that the CLI created targetDir; on error, either remove the partial directory (only when created this run) or print "partial scaffold left at <dir> — delete it before retrying".

### QUA-063 — pickFromList silently substitutes the default for unrecognized input in the non-TTY fallback

**File:** `packages/create-luckystack-app/src/index.ts:188`
**Area:** pkg-create-app
**Evidence/description:** `return match ?? defaultValue;` — in the piped/CI fallback flow (the path a non-TTY AI agent or heredoc script hits), a typo like 'postgres' (valid option: 'postgresql') silently becomes the default ('mongodb'), and the scaffold proceeds with a different database than requested. pickMulti silently drops unknown tokens the same way.
**Why it matters for a consumer:** The only non-interactive selection path fails soft, producing a wrong-database project with zero feedback.
**Recommendation:** Print "Unrecognized answer X — using default Y" at minimum; better, re-prompt up to N times. Same for pickMulti.

### QUA-064 — devkit CLAUDE.md documents exports that do not exist + wrong chokidar version

**File:** `packages/devkit/CLAUDE.md:57-59, 103` (truth: `src/index.ts`, `dist/index.d.ts`, `package.json:59`)
**Area:** pkg-devkit
**Evidence/description:** (1) The public Function Index lists `assertNoDuplicatePageRoutes`, `collectDuplicatePageRoutes`, `formatDuplicatePageRouteIssues`, and type `DuplicatePageRouteIssue` — none exported from src/index.ts (confirmed absent from dist/index.d.ts); the build path works only because typeMapGenerator calls assertNoDuplicatePageRoutes internally. (2) CLAUDE.md documents "chokidar@^4.0.3" while package.json declares `^5.0.0`.
**Why it matters for a consumer:** An AI following the package's own contract file gets import errors.
**Recommendation:** Export the duplicate-page-route trio + type (useful for consumer build scripts) or move those rows to the Internal modules table; update the chokidar line to ^5.0.0.

### QUA-065 — Two `as unknown as` casts in docs-ui index.test.ts (zero-cast policy)

**File:** `packages/docs-ui/src/index.test.ts:64, 68`
**Area:** pkg-docs-ui
**Evidence/description:** `({ url, method }) as unknown as IncomingMessage` and `res as unknown as ServerResponse` — test doubles with explanatory comments, so arguably the documented-exception case; reported per the zero-tolerance instruction so the maintainer can decide.
**Why it matters for a consumer:** Policy consistency; structural doubles can drift from the handler's real surface without compiler help.
**Recommendation:** Define the doubles as `Pick<IncomingMessage, 'url' | 'method'>` / a minimal interface, or use `satisfies` + a single documented cast helper shared across package test suites.

### QUA-066 — Inline script dead/incomplete code: unstyled `.badge` class for tags

**File:** `packages/docs-ui/src/docsHtml.ts:305` (stylesheet: renderDocsCss :27-187; contract: `docs/extension-fields.md`)
**Area:** pkg-docs-ui
**Evidence/description:** The tags extension field renders `<span class="badge">` but the stylesheet defines no `.badge` rule — tags render as plain unstyled text, unlike the styled `.auth-tag` badges, even though extension-fields.md documents tags as rendered "tag badges". Together with the dead `version` param (QUA-007), it indicates the extension-field/runner paths were never visually exercised.
**Why it matters for a consumer:** Documented visual feature silently degraded.
**Recommendation:** Add a `.badge` CSS rule (mirror `.auth-tag`) or reuse the `auth-tag` class for tags.

### QUA-067 — templates.ts header comment documents a built-in `password-reset` template fallback that does not exist in code

**File:** `packages/email/src/templates.ts:11` (truth: `sendEmail.ts:106-110`; accurate doc: `docs/password-reset-integration.md:68`)
**Area:** pkg-email
**Evidence/description:** The module comment states resolution step 2: unregistered templates fall back to a built-in (currently `password-reset` only) rendered with renderEmailLayout. No such fallback exists: sendEmail returns `{ ok: false, reason: 'no-template' }` for any unregistered name, and @luckystack/login builds its reset email inline without the registry. The deep doc gets it right; the in-source comment — what an AI reads first per the project's AI-docs model — is wrong.
**Why it matters for a consumer:** Code written to rely on the fallback silently sends nothing.
**Recommendation:** Either implement the built-in fallback (register it from email's register.ts so login can switch to the template path) or rewrite the comment: "registered templates only; no built-in fallbacks yet — see password-reset-integration.md".

### QUA-068 — registerEmailConfig merges onto DEFAULT_EMAIL_CONFIG, not the active config — a second call silently discards earlier overrides

**File:** `packages/email/src/emailConfig.ts:89` (same pattern: `packages/presence/src/presenceConfig.ts:81`; current call site: `server/server.ts:49`)
**Area:** pkg-email
**Evidence/description:** `activeConfig = deepMerge(DEFAULT_EMAIL_CONFIG, config)` resets to defaults on every call. With the 0.2.0 overlay model there are two natural call sites (consumer server.ts and a `luckystack/email/*.ts` overlay); if both call it, the later call silently wipes the earlier one's keys (overlay sets `envVars`, server.ts later sets `from` → envVars revert to defaults). presence shares identical semantics, so this is a deliberate cross-package pattern — flagged as a footgun, not a bug.
**Why it matters for a consumer:** "Replace, not accumulate" semantics are undocumented and bite exactly when the overlay model encourages a second call site.
**Recommendation:** Either merge onto activeConfig across all packages using the pattern (email + presence + error-tracking together for parity), or document "call exactly once; later calls replace" in every register*Config JSDoc.

### QUA-069 — autoSelectEmailSender passes NaN as SMTP port when the port env var is non-numeric

**File:** `packages/email/src/autoSelect.ts:56`
**Area:** pkg-email
**Evidence/description:** `const resolvedSmtpPort = smtpPortRaw ? Number(smtpPortRaw) : defaults.smtpPort;` — `SMTP_PORT="2525;"` yields NaN, flowing into nodemailer and surfacing only at first send as an opaque connection error. Every other misconfiguration in this package fails loudly at boot by design.
**Why it matters for a consumer:** One typo class escapes the package's otherwise consistent fail-fast posture.
**Recommendation:** Validate: `if (Number.isNaN(n) || n <= 0) throw new Error(...)` — consistent with the existing force-mode boot errors.

### QUA-070 — PROJECT_DOCS_AUDIT falsely records the env-resolver folder as gone, causing the dist-cleanup TODO to be dropped

**File:** `docs/audits/PROJECT_DOCS_AUDIT.md:41` (also `docs/audits/REAUDIT_2026-06-09.md:154`)
**Area:** pkg-env-resolver
**Evidence/description:** The audit states "`packages/env-resolver/` folder does **not exist**; it was already removed" and on that basis instructed removing FINAL_SWEEP.md's "Stale `packages/env-resolver/dist/` — needs removal" as a phantom reference; REAUDIT confirms the removal. On this checkout the folder DOES exist (dist/ mtimes May 29/Jun 2 — predating the Jun-09 audit, so the claim was wrong at audit time or the audit ran on a device where the untracked dir was absent). The audit trail now asserts the cleanup is moot while the leftover keeps regenerating the phantom index entry (QUA-010).
**Why it matters for a consumer:** A future re-audit trusting the record will re-drop the cleanup, and the user works across devices — untracked leftovers are per-checkout.
**Recommendation:** Amend PROJECT_DOCS_AUDIT.md §1.2 (and the REAUDIT note) to state the dist/ is an untracked gitignored leftover that can survive per-checkout; reinstate the cleanup as an actionable pre-publish step.

### QUA-071 — initializeSentry has no idempotency guard yet is called twice in the standard 0.2.0 boot flow

**File:** `packages/error-tracking/src/sentry.ts:57` (doc claim: `docs/sentry-integration.md:137-139`; call sites: `server/server.ts:56` + `register.ts:27`)
**Area:** pkg-error-tracking
**Evidence/description:** The doc claims "The function is idempotent — calling it twice does NOT re-init the SDK". There is no guard, and @sentry/node's `init()` DOES re-initialize (creates and binds a new client). The double call is now the norm: consumer server.ts calls it, then bootstrap auto-imports the register entry which calls it again. Mostly benign (identical options), but any consumer-side `Sentry.init` customization between the two calls gets clobbered, and the doc is wrong.
**Why it matters for a consumer:** Subtle clobbering of Sentry customizations + a false doc guarantee.
**Recommendation:** Add a module-scoped `initialized` flag mirroring autoInstrumentation's `installed` guard (first call wins, debug-log repeats); fix the doc sentence.

### QUA-072 — ErrorTrackerEvent.forwarded is a dead contract field — never read, never set to false

**File:** `packages/error-tracking/src/adapters/runBeforeSend.ts:9` (contract: `packages/core/src/errorTrackerRegistry.ts:21-22`, `docs/adapter-pattern.md:88`)
**Area:** pkg-error-tracking
**Evidence/description:** The contract documents `forwarded: boolean` as "When false, the adapter must not forward this event (beforeSend opt-out)". Every built-in adapter hardcodes `forwarded: true`, runBeforeSend never inspects it, and no code path sets or checks `false` — drop semantics are exclusively the `null` return.
**Why it matters for a consumer:** A custom-adapter author implements a check that can never fire, or sets `forwarded: false` expecting built-ins to honor it (they won't).
**Recommendation:** Remove the field (0.2.0 is the moment for a breaking contract cleanup) or honor it in runBeforeSend (`if (!event.forwarded) return null`). Update adapter-pattern.md either way.

### QUA-073 — logout() bypasses the SessionAdapter with a raw redis.srem (redundant with deleteSession's untrackActive)

**File:** `packages/login/src/logout.ts:34` (adapter path: `session.ts:302`)
**Area:** pkg-login
**Evidence/description:** `await redisClient.srem(activeUsersKeyFor(userId), token);` writes directly to Redis instead of `getSessionAdapter().untrackActive`. For the default adapter it is redundant (deleteSession already untracks in both paths); for a consumer-registered non-Redis adapter it is a no-op write to a nonexistent key plus a leaked abstraction in the one flow documented as adapter-swappable.
**Why it matters for a consumer:** Custom session-adapter authors get an inconsistent seam in the canonical logout flow.
**Recommendation:** Replace with `getSessionAdapter().untrackActive(userId, token)` or delete the line entirely.

### QUA-074 — Documented structural cast `prisma.user as unknown as PrismaUserDelegate` in default user adapter

**File:** `packages/login/src/userAdapter.ts:69` (justification block at :46-66)
**Area:** pkg-login
**Evidence/description:** The cast carries an eslint-disable of no-restricted-syntax and a comment explaining the framework cannot know consumer enum types statically; divergent schemas are directed to registerUserAdapter. Reported for the record per the zero-tolerance policy ("document any structural exceptions and report to user") — the justification is sound.
**Why it matters for a consumer:** None directly; this is the policy's sanctioned boundary, recorded so it stays a conscious decision.
**Recommendation:** Keep as the single documented boundary, but consider a generic `UserDelegateLike` structural interface checked with `satisfies` on the trimmed shape, removing the `unknown` hop while preserving the seam.

### QUA-075 — Root barrel performs import-time side effect (registerDefaultAfkEvent) despite a dedicated /register side-effect entry

**File:** `packages/presence/src/index.ts:29` (proper home: `packages/presence/src/register.ts`)
**Area:** pkg-presence
**Evidence/description:** `registerDefaultAfkEvent()` executes at module load of the main barrel, while the package ships a `./register` subpath explicitly designed as "the side-effect entry". Any import of `@luckystack/presence` — including type-driven or tooling imports — mutates the global activity-event registry. Documented as deliberate, but inconsistent with the package's own register-subpath pattern and makes the barrel non-pure.
**Why it matters for a consumer:** Surprising global mutation from a type-level import; breaks the framework's own bootstrap convention.
**Recommendation:** Move the call into register.ts (auto-imported by bootstrap) or have startActivitySampler lazily register the default event on first start; keep registerDefaultAfkEvent exported for manual hosts.

### QUA-076 — resolveTarget uses console.error instead of the registered logger

**File:** `packages/router/src/resolveTarget.ts:255-257`
**Area:** pkg-router
**Evidence/description:** The fire-and-forget health-publish failure handler logs via `console.error('[router] failed to publish health change:', error)` while the rest of the package routes through `getLogger()` (startRouter.ts, bootHandshake.ts, healthPoller via callback). Note resolveTarget.ts currently imports only types from core, so adding getLogger introduces a runtime import — a deliberate but worth-noting cost.
**Why it matters for a consumer:** This one error class bypasses the consumer's structured/JSON/Datadog log pipeline.
**Recommendation:** Import getLogger and use `getLogger().error('[router] failed to publish health change', { message })`, matching the package convention.

### QUA-077 — `values as Record<string, string>` cast bypasses the per-value runtime guard the adjacent comment promises

**File:** `packages/secret-manager/src/index.ts:203` (comment :189-191; injection at :231)
**Area:** pkg-secret-manager
**Evidence/description:** fetchResolve's comment says the response is "attacker-influenced ... so its shape is not assumed" and narrows `values` to a non-null object — but then iterates `Object.entries(values as Record<string, string>)` without verifying each value is a string. A server returning `{ PTR: 123 }` or `{ PTR: { nested: true } }` flows the non-string into `process.env[name] = value`, coerced to `'123'` / `'[object Object]'`. (Plain `as`, not `as unknown as` — hence low.)
**Why it matters for a consumer:** A compromised/buggy secrets server can inject garbage env values that the hardening comment claims are guarded against.
**Recommendation:** Per-entry guard: skip or throw on `typeof value !== 'string'` — in 'remote' mode a non-string resolved value should arguably throw like a missing pointer.

### QUA-078 — reloadSecretManagerFromFiles silently drops boot-captured pointers absent from the env files, and injects plain values before a remote-mode throw

**File:** `packages/secret-manager/src/index.ts:413` (plain-value injection at :410, atomic boot contrast at :216-222)
**Area:** pkg-secret-manager
**Evidence/description:** `pointerMap = freshPointerMap` replaces the boot-captured pointer map with ONLY pointers parsed from env files. A pointer supplied as a real environment variable (CI shell export, docker `-e`) is captured at boot but vanishes from the refresh set after the first file-triggered reload — subsequent polls stop refreshing it, no warning. Additionally, plain values are written into process.env BEFORE doResolve, which throws in 'remote' mode on an unresolved pointer — a failed reload leaves process.env half-updated, unlike the deliberately atomic boot path. Both dev-hot-reload-only.
**Why it matters for a consumer:** Mixed env-var + env-file pointer setups silently stop rotating secrets in dev; failed reloads leave inconsistent state.
**Recommendation:** Merge instead of replace (`pointerMap = { ...pointerMap, ...freshPointerMap }`, or warn when a boot pointer disappears), and stage plain-value injection until after doResolve succeeds.

### QUA-079 — Stale JSDoc: `dev.watch` claims the optional `dotenv` peer is required, but the package ships its own parser

**File:** `packages/secret-manager/src/index.ts:66` (parser at :267-296; also `src/index.test.ts:320` comment, `README.md:91`)
**Area:** pkg-secret-manager
**Evidence/description:** The SecretManagerConfig `dev.watch` JSDoc says "Requires the optional `dotenv` peer to parse the files." — but parseEnvFile is an in-package parser, and the line-267 comment, CLAUDE.md:71, and docs/architecture.md:58 all state the package is dependency-free with no dotenv involvement. The test comment at index.test.ts:320 has the same drift. Relatedly, in-code "dependency-free" comments understate the real `@luckystack/core` dependency.
**Why it matters for a consumer:** An AI reading the .d.ts hover will wrongly npm-install dotenv.
**Recommendation:** Delete the dotenv sentence from the `watch` JSDoc (and fix the test comment); rephrase "dependency-free" to "no third-party env-parsing dependency".

### QUA-080 — Type-erasing `as` cast on loginWithCredentials result instead of using login's exported return type

**File:** `packages/server/src/httpRoutes/authApiRoute.ts:101-106` (source: `packages/login/src/login.ts:325`)
**Area:** pkg-server
**Evidence/description:** authApiRoute casts the awaited result to a hand-written structural shape because loginWithCredentials has an inferred union return type with no explicit contract. If login's shape changes (errorParams added, reason renamed), this compiles silently and breaks at runtime — exactly the type-drift pattern the strict-typing policy targets.
**Why it matters for a consumer:** The auth route — every consumer's login path — has an unchecked type boundary between two framework packages.
**Recommendation:** Export an explicit `CredentialsLoginResult` discriminated union from @luckystack/login, annotate loginWithCredentials with it, and drop the cast.

### QUA-081 — `prisma as unknown as PrismaPingShape` cast in readiness probe (documented structural exception)

**File:** `packages/server/src/httpRoutes/healthRoutes.ts:30`
**Area:** pkg-server
**Evidence/description:** Carries an eslint-disable + comment: Prisma's generated client exposes `$queryRaw` OR `$runCommandRaw` depending on datasource, so no portable type exists. Reported for the record per the zero-tolerance policy; the justification is sound.
**Why it matters for a consumer:** None directly — recorded so the exception stays conscious.
**Recommendation:** Keep, but consider a runtime-narrowing helper in core (`getPrismaRawProbe(): { queryRaw?; runCommandRaw? }`) so the single sanctioned cast lives in one place instead of a route file.

### QUA-082 — security-defaults.md CSRF section drifted from the csrfMiddleware implementation

**File:** `packages/server/docs/security-defaults.md:83-96` (code: `csrfMiddleware.ts:30, 52-72`, `csrfRoute.ts:30-37`)
**Area:** pkg-server
**Evidence/description:** The doc's activation predicate describes only the session-bound flow. The code now additionally: (1) exempts `/auth/api/credentials` as session bootstrap, and (2) has a complete login-ABSENT stateless double-submit-cookie path (csrf cookie vs header, no session read) with a matching cookie-issuing branch in csrfRoute.ts.
**Why it matters for a consumer:** Consumers and AI agents reason about the security boundary from a stale model — e.g. they won't know login-less apps still get CSRF protection.
**Recommendation:** Update security-defaults.md: add the credentials-bootstrap exemption with its SameSite rationale and a "login-absent double-submit" subsection. Mirror into packages/create-luckystack-app/framework-docs.

### QUA-083 — No tests for either sync transport handler's security pipeline

**File:** `packages/sync/src/handleSyncRequest.ts:314` (also `handleHttpSyncRequest.ts`; existing tests: streamThrottle, streamEmitters only)
**Area:** pkg-sync
**Evidence/description:** Zero unit tests for either handler (repo-wide grep; core's Redis-adapter integration test covers adapter mechanics, not the handlers). The documented pipeline ordering "auth → rate-limit → validate → execute → respond", auth.login/validateRequest gates, ignoreSelf semantics, and fanout error paths — all previously audited and patched — have no regression coverage.
**Why it matters for a consumer:** Already-fixed security behaviors (e.g. the ignoreSelf boolean check) can silently regress; the consumer auto-sweep covers routes, not handler internals.
**Recommendation:** Add vitest coverage with a mocked io + syncObject: login-required rejection, additional-auth rejection with null user, rate-limit rejection + hook dispatch, validation-failure envelope (no raw validator message), ignoreSelf skip, per-recipient error isolation.

### QUA-084 — attachSyncReceiver throws synchronously inside the socket event listener on malformed payloads

**File:** `packages/sync/src/syncRequest.ts:916-924`
**Area:** pkg-sync
**Evidence/description:** In the browser-side receive bridge, a success-status sync frame with no resolvable route key reaches `throw new Error(errorMessage)` inside the `socket.on(socketEventNames.sync, ...)` callback — an uncaught exception in the consumer's app, potentially killing other listeners on the same emit. The function already logged and dev-notified just above; the input is server-controlled, so one malformed frame (e.g. from a buggy custom emit) detonates every connected client.
**Why it matters for a consumer:** A single bad server-side emit becomes a client-wide crash instead of a logged warning.
**Recommendation:** Replace the `throw` with `return` after the existing getLogger().error + notify.error calls.

### QUA-085 — changePassword_v1 has diverged into three non-identical copies (repo / template / cli mirror drift)

**File:** `src/settings/_api/changePassword_v1.ts:28` vs `packages/create-luckystack-app/template/src/settings/_api/changePassword_v1.ts` vs `packages/cli/assets/login/src/settings/_api/changePassword_v1.ts`
**Area:** consumer-app
**Evidence/description:** Beyond line endings, the template/cli copies introduce intermediate `passwordMinLength`/`passwordMaxLength` locals and omit the `//? dispatchHook itself isolates per-handler throws...` comment present in the repo copy. The other settings routes (deleteAccount, listSessions) differ from their cli mirrors only by CRLF — this one is genuine source drift. **Framework, template, and CLI asset have DRIFTED three ways.**
**Why it matters for a consumer:** create-luckystack-app's value proposition is template ≡ reference app; silent drift means consumers get a subtly different file than the docs describe.
**Recommendation:** Pick the canonical version and re-sync all three; add an `npm run` drift check diffing `src/**` against the template and cli mirrors (ignoring line endings only), failing CI on divergence.

### QUA-086 — docs/page.tsx uses `as unknown as DocsResult` + `as never` casts (zero-tolerance policy)

**File:** `src/docs/page.tsx:426, 471`
**Area:** consumer-app
**Evidence/description:** `useState<DocsResult | null>(apiDocs as unknown as DocsResult)` and `upsertSyncEventCallback(callbackParams as never)`. Both carry eslint-disable + explanatory comments (JSON-import widening; runtime-driven dispatch name) — documented structural exceptions, reported per the zero-cast policy. Consumer demo/dev tooling, hence low.
**Why it matters for a consumer:** The reference app models patterns consumers copy; casts here normalize the practice.
**Recommendation:** Generate apiDocs.generated.json alongside a matching exported TS type (or zod-validate into DocsResult); narrow callbackParams against the generated union instead of `as never`. If neither is feasible, note the exception in the strict-typing exception log.

### QUA-087 — Blocked sensitive-file response returns HTTP 200 instead of 403

**File:** `server/prod/serveFile.ts:86` (blocklist at :69-87; correct traversal branch at :60-64)
**Area:** consumer-server
**Evidence/description:** The sensitive-file blocklist (.env/.ts/package.json/schema.prisma/etc.) ends with `return res.end("Forbidden")` with no preceding `res.writeHead`, so Node defaults to 200 OK with body "Forbidden". The traversal guard above correctly uses 403; this branch is inconsistent.
**Why it matters for a consumer:** Monitoring/scanners treat the block as success; semantics matter for caching and security tooling.
**Recommendation:** `res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('Forbidden');`, matching the traversal branch.

### QUA-088 — Stray dev script with hardcoded internal IP shipped in server/dev

**File:** `server/dev/request.py:3`
**Area:** consumer-server
**Evidence/description:** A 9-line ad-hoc Python script hitting `http://192.168.178.68:80` with a hardcoded developer LAN IP. Dead code (nothing references it), out of place in a TypeScript framework's server/dev folder, and it leaks an internal network address into the published repo/scaffold.
**Why it matters for a consumer:** Repo hygiene + minor information disclosure in the reference app.
**Recommendation:** Delete it (developer action — `rm` requires approval per Rule 8). If a manual probe is wanted, replace with a documented npm script or a curl example in docs/.

### QUA-089 — create-server.md documents an overlay order missing the `email` folder that bootstrap.ts actually loads

**File:** `packages/server/docs/create-server.md:16, 131` (truth: OVERLAY_ORDER in `packages/server/src/bootstrap.ts:38-56`)
**Area:** overlays
**Evidence/description:** Both doc occurrences list `core -> deploy -> login -> sentry -> presence -> docs-ui -> server`, but OVERLAY_ORDER includes `email` between login and sentry (and the ls-np sample overlay ships `luckystack/email/init.ts` relying on it).
**Why it matters for a consumer:** An AI agent following the doc concludes a `luckystack/email/` overlay is unsupported and wires email elsewhere.
**Recommendation:** Update both occurrences to `core -> deploy -> login -> email -> sentry -> presence -> docs-ui -> server`, and add a one-liner that folders outside this list are currently skipped.

### QUA-090 — eslint.official.config.js: 20-line `import-x/order` config is dead — immediately overridden by a duplicate key set to 'off'

**File:** `eslint.official.config.js:114` (dead config at :94-113; check the template's copy too)
**Area:** tooling
**Evidence/description:** Lines 94-113 configure `'import-x/order': ['error', {...}]`, then line 114 repeats the key: `'import-x/order': 'off'`. In a JS object literal the second key silently wins — the 20-line configuration is dead and import ordering is not enforced anywhere, while a reader skimming the config reasonably concludes it is.
**Why it matters for a consumer:** Misleading config ships to scaffolds if the template mirrors the same pattern.
**Recommendation:** Delete one of the two: remove 94-113 if ordering is intentionally off (with a one-line comment why), or remove line 114 to enable the rule. Check the template's eslint.official.config.js in the same pass.

### QUA-091 — 75KB scratch file `.publish-dry.out` committed at repo root

**File:** `.publish-dry.out:1`
**Area:** tooling
**Evidence/description:** `git ls-files` shows the file is tracked; `git check-ignore` confirms it is not ignored. A 38k-line `npm publish --dry-run` dump (75,044 bytes) from 2026-06-04 in the repo root — against the repo's own no-loose-root-files hygiene, and it goes stale the moment versions bump for 0.2.0.
**Why it matters for a consumer:** Repo bloat + a stale, misleading publish manifest for anyone (or any AI) who reads it.
**Recommendation:** `git rm --cached .publish-dry.out` and add `.publish-dry.out` (or `*.out`) to .gitignore alongside the existing `.lint-*.out` entries.

### QUA-092 — buildPackages.mjs header topology comment no longer matches the actual WAVES array

**File:** `scripts/buildPackages.mjs:5-9` (actual WAVES :27-43; duplicate list: `scripts/publishPackages.mjs:28-38`)
**Area:** tooling
**Evidence/description:** The header says "wave 2 → error-tracking, email, login, devkit, router, test-runner, create-luckystack-app, docs-ui" in a 4-wave topology. The actual WAVES is 6 waves: wave 2 excludes error-tracking and docs-ui but adds secret-manager; error-tracking is its own wave 3 (with an inline comment why); docs-ui + cli are wave 6. publishPackages.mjs maintains a SECOND independent WAVES list that must be kept manually consistent.
**Why it matters for a consumer:** A maintainer adding the 16th package and trusting the header will misplace it; the dual lists can diverge and break publish ordering.
**Recommendation:** Delete the stale per-wave enumeration from the header (keep only the "within a wave parallel, across waves sequential" explanation), and have publishPackages.mjs import the WAVES array from buildPackages.mjs (or a shared waves.mjs).

---

## Merge notes

| Merged entry | Original area reports folded in |
|---|---|
| QUA-002 | pkg-api (high, handleApiRequest.ts), pkg-core (medium, getParams.ts), pkg-devkit (medium, 7 files), pkg-sync (medium, both sync handlers) — same blanket-disable pattern, kept at the highest reported severity |
| QUA-009 | pkg-email (high, register.ts victim), pkg-server (medium, importIfExistsSpecifier), overlays (medium, auto-register path) — one root cause in `bootstrap.ts:111` |
| QUA-014 | tooling (high, 5-of-11 scripts drift) + pkg-test-runner (high, template testAll.ts `import '../config'` + TEST_OUTPUT_FILE) — testAll is item (2) of the drift set |

Cross-references kept as separate findings (related but distinct): QUA-010 ↔ QUA-070 (env-resolver leftover vs the audit record that wrongly closed it), QUA-007 ↔ QUA-008 (two independent defects in the same try-it-out runner), QUA-013 ↔ QUA-044 (dev loader drops `validation` vs handlers ignoring it even when present), QUA-015 ↔ QUA-026 (stale overlay code vs stale overlay docs), QUA-057 ↔ QUA-059 (tooling symptom vs core root cause), QUA-017 ↔ QUA-055 (sweep job broken vs unit suite never run), QUA-020/QUA-022/QUA-053 (i18n key defects vs the tool that should catch them).
