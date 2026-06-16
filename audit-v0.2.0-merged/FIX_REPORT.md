# v0.2.0 Audit — Multi-Agent Fix Report (Merged, 2 passes)

**Date:** 2026-06-12
**Branch:** `chore/package-split-prep`
**Scope:** Fixes for the **CONFIRMED** / **PARTIALLY-FIXED** findings recorded in `audit-v0.2.0-merged/areas/*.md`.
**Commit status:** ⚠️ **NOT committed yet** — working tree only. Review the diff, run tests, and regenerate AI indexes before committing.

> **Two-pass run.** The first pass fixed **core**, **mcp**, and the cross-cutting **extensibility** seams, but **16 of the 19 areas hit a transient server rate limit** (16 agents fanned out at once) and did not complete. This re-run covered those 16 areas (api, sync, server, login, email, error-tracking, router, test-runner, docs-ui, devkit, cli, create-luckystack-app, repo-src-tooling, docs-coverage, presence, secret-manager). This report merges both passes into one coherent record.

---

## 1. Build / Lint Status

| Gate | Result |
|---|---|
| **Lint** (ESLint, client + server + packages) | 🟢 GREEN — exit 0, no errors |
| **Build** (`build:packages` 16/16 + generateArtifacts + vite client + server bundle) | 🟢 GREEN — exit 0 |
| **ai:lint** (CLAUDE.md invariant linter) | 🟢 GREEN — no invariant violations in scope |
| **Repair rounds used** | **0** (final re-run verify), **1** (pass-1) |
| **Error files** | none |

**Overall: 🟢 GREEN — `all green`.**

### ⚠️ NOT FIXED (areas in `stillFailed`)

Two areas are listed as **stillFailed** in the re-run input. Both were verified to require **no code changes** — the report nonetheless flags them so the user is aware they were not actively patched this pass:

| Area | Why it is in stillFailed | Actual state |
|---|---|---|
| **presence** | 2 PRE-EXISTING lint errors remain in `SocketStatusIndicator.tsx` (`STATUS_TINT[status] ?? …` defensive fallbacks on lines the agent did not author) — left untouched per Rule 27 (out of scope of CFG-38). | All 11 confirmed defects + the doc cluster **were** fixed; 54/54 tests pass. The flag is the residual pre-existing lint noise, not a regression. |
| **secret-manager** | No edits were made. | Every confirmed/partially-fixed finding (SM-01..SM-17) was **already fully resolved in the working tree** by a prior pass; verified line-by-line. Only SM-13 (optional `createSecretManager` factory) remains intentionally unimplemented (deferred, new API surface). |

The final monorepo build + lint reported **GREEN**, so neither stillFailed entry blocks the build.

---

## 2. Findings Fixed

**Grand total fixed across BOTH passes: 209 findings.**

- **Pass 1 (3 areas): 46** — core 28, mcp 14, extensibility 4.
- **Pass 2 (16 areas): 163** — see per-area counts below.

### Pass 1 — high/critical called out

| Area | Count | High/Critical (id — title) |
|---|---|---|
| core | 28 | CORE-02 apiRequest abort singleton aborts unrelated calls; CORE-03 internal abort rejects vs resolves; CORE-05 rate limiter fails OPEN to per-instance memory |
| mcp | 14 | (highest = medium) H1 no programmatic/library surface; import boots server |
| extensibility | 4 | EXT-01 no server start/stop lifecycle + graceful shutdown; EXT-02 no per-message socket interception; EXT-03 no client request-interceptor seam; EXT-04 no sync validate/execute hooks |

### Pass 2 — per-area count + high/critical items

| Area | Fixed | High / Critical (id — title) |
|---|---|---|
| **api** | 9 | F2 per-route rate limit keyed on raw token (anon bypass); F3 raw token leaked into rateLimitExceeded hook + log |
| **sync** | 16 | SYNC-02 no top-level error guard + validateRequest(user!) crash; SYNC-04 raw validation messages echoed (schema enum); SYNC-03 _client filter leaks full serverOutput; SYNC-11 no per-route rate limit; (SYNC-06 dev loader drops errorFormatter/validation — verified already-fixed) |
| **server** | 16 | SEC-10 socket.join(token) before session validation; SEC-09 no HTTP top-level error guard (DoS); QUA-009 bootstrap empty catch swallows /register failures |
| **login** | 24 | F2 onConflict 'rejectNew' enforced nowhere; F6 sliding refresh never re-tracks activeUsers set |
| **email** | 20 | F1 preEmailSend stop-signal never honored; F3 ConsoleSender in prod swallows mail + leaks tokens |
| **error-tracking** | 18 | (highest = medium) ET-01 raw cookie/authorization headers in Sentry; ET-03 user email shipped with no opt-out; ET-12/13/14 init not extensible / overlay no-op / PostHog handle |
| **router** | 12 | (highest = medium) SEC-30 no upstream timeout (slow-loris); M1 unauthenticated/unnamespaced Redis health channel; CFG-18 ignores REDIS_USER |
| **test-runner** | 30 | H1/SEC-45 weak-entropy never-cleaned real sessions; HOK-03 extension registry never invoked |
| **docs-ui** | 22 | DUI-01 renderer JSON-shape mismatch (crit); DUI-02 try-it posts wrong URL; DUI-03 no CSRF; DUI-04 auto-mount shadows consumer |
| **devkit** | 24 | DK-01 builtin allow-list hard-aborts on Uint8Array/URL; DK-05 missing/non-literal auth fails OPEN; DK-24 dev loader drops sync errorFormatter (verified already-fixed) |
| **cli** | 22 | HB1/QUA-003 stale half-merged LoginForm asset; HB2/MIS-005 add-login copies handlers the pruner deletes |
| **create-luckystack-app** | 38 | H1/SEC-16 listSessions raw tokens; H2/SEC-14 system/session returns token; QUA-004 Windows install fail; Hard-1 prod refs unbuilt dist/server.js; Hard-2 scaffold:page bad template union; QUA-006 verbatim framework CLAUDE.md; F-02 SQL migrate script; F-08 POSIX bin symlink |
| **repo-src-tooling** | 25 | SEC-14 system/session returns raw token + csrfToken |
| **docs-coverage** | 14 | H1 registerSessionProvider documented nowhere |
| **presence** | 13 | QUA-039 userBack not gated by reconnect/broadcaster; SEC-07 grace-expiry deletes shared session while another tab live |
| **secret-manager** | 0 (17 verified already-fixed) | — (all SM-01..SM-17 already resolved in tree) |

> Counts use each area's reported `fixed[]` length. `secret-manager` made 0 edits (all already resolved). Several entries in `sync`/`devkit` are "verified already-fixed in current tree" and counted as resolved.

---

## 3. Deferred Findings — ⚠️ NEEDS HUMAN / PRODUCT DECISION

**This is the most important section.** These were intentionally **not fixed** — product call, out of scope, or residual-risk-by-design.

### Pass 1 deferrals

| Area | ID | Title | Reason |
|---|---|---|---|
| core | CORE-01 | Runtime input validation is a no-op in production | Wiring pre-generated Zod into the prod path is an architectural pipeline change; loud-opt-out vs full Zod-in-prod is a product decision. |
| core | CORE-04 | trustProxy:false default collapses per-IP buckets behind a proxy | Spoof-safe default intentional; observed-burst warning is a feature, not a defect fix. |
| core | CORE-10 | Login-absent CSRF uses non-HttpOnly SameSite=Lax double-submit cookie | `__Host-` default needs the server CSRF cookie builder (out of area). Residual-risk-by-design. Pairs with CORE-39. |
| core | CORE-25 | useTheme local state with closed light\|dark union | Shared context/store + wider type is a BC-sensitive React redesign. |
| core | CORE-26 | Language changes detected by polling, no push API | Event/subscriber seam is a design enhancement; polling kept as fallback. |
| core | CORE-38 | CORS function-resolver is synchronous | Socket.io CORS callback is sync — structural constraint. |
| core | CORE-39 | Session cookie attributes not fully customizable | Cookie builder lives in packages/server; HttpConfig fields alone are inert. Pairs with CORE-10. |
| mcp | H2 | Artifact locations hardcoded; luckystack.ai.json ignored | The MCP server queries (not reads-whole); a config seam now is speculative. |
| mcp | C3-extra | Forward-dependency tool + full-text ADR-body search | New features beyond the one concrete gap (get_product added). No spec. |

### Pass 2 deferrals

| Area | ID | Title | Reason |
|---|---|---|---|
| api | F1 | Runtime input validation no-op in production | Root cause in core (NODE_ENV prod short-circuit) + wiring generated schemas; cross-package. |
| api | F9 | No apiAuthRejected hook | Needs new hook in core's HookPayloads; dispatch sites ready. |
| api | F11 | Backpressure interval/threshold + rate-limit identity/loopback config | Needs new core config keys; security-relevant halves addressed by F2/F3/F5. |
| sync | SYNC-07 | No default receiver authorization (any client → any room / 'all') | Needs core config knobs (allowClientReceiverAll/requireRoomMembership); preSyncAuthorize is current mitigation. |
| sync | SYNC-09 | syncRequest promise never settles when evicted offline | Needs onDrop callback in core's offlineQueue. |
| sync | SYNC-15 | Stream backpressure constants hardcoded | Needs core config keys (sync.flushPressure). |
| sync | SYNC-18 | No server-initiated typed sync emit (cron/webhook) | Genuine new feature; auth-bypass/identity model needs product decision. |
| sync | SYNC-19 | No tests for either sync transport security pipeline | Added redactToken test; full handler suite is large/brittle, deferred deliberately. |
| sync | SYNC-22 | No per-recipient hook to mutate/filter fanout set | Needs new core hook (preSyncRecipient). |
| sync | SYNC-24 | _client can't run cross-instance / can't veto fanout (UNCERTAIN) | By-design (documented §7); cross-instance claim needs multi-instance runtime test. |
| server | SEC-13 | /_health exposes unsalted SHA-256 of env secrets, unauthenticated | Spans core (HMAC/salt + config) AND router (boot handshake compares raw hashes). |
| server | SEC-22/M2 | Session token in OAuth callback redirect query string | Fragment migration needs matching consumer src/main.tsx change. |
| server | MIS-017 | No per-account brute-force protection on credentials login | Needs core rateLimiting.auth config + login lockout. Per-IP throttle now in place (SEC-23). |
| server | HOK-15 | No postHttpRequest hook | Needs core hook payload + map entry. |
| server | HOK-27 | Missing-Origin 403 dispatches no hook | corsRejected payload core-owned; needs a reason field. |
| server | CFG-21 | OAuth authorize hardcodes prompt=select_account | Needs OAuthProvider.extraAuthorizationParams (login-owned). |
| server | SEC-24 | No PKCE in OAuth redirect | Spans login + core (verifier storage + token exchange). |
| server | QUA-080 | Type-erasing cast on loginWithCredentials result | Needs login to export a discriminated CredentialsLoginResult. |
| server | QUA-043 | withSessionLock per-process only; cross-instance RMW race | core acquireLease is non-blocking; correct fix needs retry/backoff design + ARCHITECTURE update. |
| server | QUA-016 | Overlay loader dynamic-imports .ts at runtime; broken under prod dist | Needs explicit prod overlay story (bundle/compile) + HOSTING docs. |
| server | loadSocket-god-function | ~310-line connect handler | Large refactor; surgical-change mandate, socket hot path risk. |
| server | socket-connection-cap-hook | No WS connection reject/rate-limit beyond io.use | io.use escape hatch exists; doc/feature work. |
| login | F1 | OAuth state not bound to initiating browser (login CSRF) | Needs server cookie at flow start; login enabler is dead control without it. |
| login | F11 | No PKCE on any OAuth flow | Split across server + login; half-impl is dead code; product decision. |
| login | F7 | No per-account brute-force; trustProxy not honored | Throttle keying in server + auth config slot in core. |
| login | F18 | No 'disable public registration' knob | Needs auth.allowRegistration on core ProjectConfig. |
| login | F20 | No email-verification flow for credentials registration | New feature spanning core/db/email/UI; product decisions. |
| login | F21 | No first-class 2FA support | New feature (pending-login primitive + config); product decisions. |
| login | F22 | Reset/email-change paths hardcoded | Needs auth.passwordResetPath / emailChangeConfirmPath in core. |
| login | F30 | Multi-instance gap in session kick/broadcast (UNCERTAIN) | Data-plane revocation already global; live UI nudge needs 2-instance runtime test. |
| email | F2 | EmailMessage supports no attachments/custom headers | EmailMessage type owned by core; threading needs the core field first. |
| email | F17 | No mutate/observe final provider payload; no per-send override | Subsumed by F2 (needs core provider-passthrough field). |
| email | F16-theme | Full theme/palette parameterization of renderEmailLayout | Speculative; lang (the real defect) fixed; no current caller. |
| error-tracking | ET-10 | Adapter beforeSend transformed event discarded | REFUTED / already-fixed in tree. |
| error-tracking | ET-24 | registerSentryConfig replace-not-accumulate | REFUTED — standard last-write-wins registry semantics. |
| error-tracking | ET-20 | ErrorTrackerEvent.forwarded partly-dead field | PARTIALLY-FIXED; remaining smell lives in core contract. |
| router | SEC-08 | Router never sets/sanitizes X-Forwarded-For | REFUTED — backend trustProxy defaults false; router is internal hop behind TLS edge. |
| router | CC | Duplicate Redis client for boot compare | Cosmetic; audit recommends leaving as-is. |
| router | core-routing-config-keys | Read knobs from deploy.routing.* | Fields live in core DeployRoutingShape; implemented via StartRouterInput/CLI instead. |
| test-runner | QUA-Code#1 | 4× duplicated fetch/timeout/parse block | Pure refactor; timeout-drift already fixed (CFG-24). |
| test-runner | QUA-Code#6 | customTests.ts God-file (5 jobs) | Pure structural refactor; no defect. |
| test-runner | Hooks#4/HOK-18 | No per-file beforeAll/afterAll for Layer 5 | Genuine feature needing discovery/contract change. |
| test-runner | Hard-block#1 | Auto-sweep can't cover sync routes | Roadmap limitation; substantial new capability. |
| docs-ui | DUI-12 | Two `as unknown as` casts in index.test.ts | Documented structural-test-double exception; lint ignores *.test.ts. |
| docs-ui | DUI-20 | Minor config/code-quality polish knobs | Audit rates all low; acceptable for a dev tool. |
| devkit | DK-07 | DEAD CODE: typeMap/emitter.ts (303 lines) | Report-only per audit + Rule 27; recommend user delete. |
| devkit | DK-09 | Blanket eslint-disable on 7 framework files | Needs iterative lint runs barred from this phase; dedicated cleanup. |
| devkit | DK-14-hooks | registerDevHooks lifecycle registry | Dispose-handle half fixed; hooks-registry half is new public API. |
| devkit | DK-25 | God functions / duplicated helpers | Report-only maintainability; large refactor. |
| cli | CFG-08/E1 | FEATURES registry closed; no plugin/manifest | New plugin system with security implications + schema design. |
| cli | HOK-20 | No profile-updated hook on updateUser/updatePreferences | Needs payload in @luckystack/login. |
| cli | MIS-023 | No `luckystack remove <feature>` | Documented roadmap gap; net-new inverse command. |
| cli | SEC-L4 (re-auth) | deleteAccount skips re-auth for OAuth | Hook half fixed; re-auth-for-passwordless is product/UX. |
| cli | config-gap#2/#3 | Scan ignore lists + dump dir hardcoded; no --out/--stdout | Additive scope-creep beyond confirmed defects. |
| cli | CQ-5 | package.json rewrite normalizes indent/EOL | Cosmetic; left surgical. |
| create-app | L5 | sessionStorage-mode OAuth token in ?token= URL | Off by default; main.tsx already strips it. Redesign out of scope. |
| create-app | Hooks-2 | No prod static-file seam (noopServeFile 404) | Deliberate documented design (CDN/nginx); real serveFile adds traversal surface. |
| create-app | L6/F-05 | OAuth origins pre-filled into global CORS | Design-smell; scoping to callback route is cross-package security change. |
| create-app | L3 | OAuth accounts deletable without re-auth | New feature; preAccountDelete hook is interim seam. |
| create-app | CFG-10/HOK-22/F-24/25/26 | --template/--post-scaffold/--pm/--dir/dep-table | Enhancements, not defects. |
| create-app | SERVER_PORT=80 | Privileged default dev port | Ripples through config/env/OAuth/banner; deliberate documented default. |
| create-app | Code-quality-3/4/6/7 | god component, blanket disable, dup templates, ls-np/ | Large refactors of generated/reference files; report-only. |
| repo-src-tooling | QUA-086 | docs/page.tsx uses `as unknown as`/`as never` (Rule 21) | Fix is generateArtifacts + generator change (devkit, barred this phase); documented + warn-only. |
| repo-src-tooling | C/CFG | Activity-heartbeat throttle hardcoded 10s | Needs new core ProjectConfig key. |
| repo-src-tooling | QUA-085 | changePassword_v1 diverged into 3 copies | repo src is canonical; drift in create-app/cli mirrors (out of area). |
| repo-src-tooling | #3 | playground streamToToken unauthenticated streaming | Deliberate documented login:false demo; keep out of non-demo templates. |
| presence | MIS-003 | No userLeft/offline peer event on hard disconnect/grace | Needs socketEventNames.userLeft in core; HOK-12 hook is interim seam. |
| presence | C1 | Client activity-heartbeat throttle hardcoded 10s | Consumer-owned template (Rule 7b), out of presence scope. |
| presence | QUA-075 | Root barrel import-time side effect | PARTIALLY-MISSTATED; auto-register deliberate + documented. |
| presence | Q2 | socketLeaveRoom misnamed; params inert | Report-don't-auto-fix; rename breaks public barrel signature. |
| presence | D2 | ARCHITECTURE_MULTI_INSTANCE.md omits presence | Root-level doc outside presence; cross-package doc work. |
| secret-manager | SM-13 | createSecretManager(config) instance factory | New public API surface, not a defect; audit rated low; foot-guns already mitigated by SM-15/16. |

**Total deferred: 9 (pass 1) + 58 (pass 2) = 67.**

---

## 4. Cross-Package Handoffs — NEEDS A FOLLOW-UP PASS

Changes that require lockstep edits in a sibling package or the consumer repo root.

### Pass 1

| Source ID | Needs | Why |
|---|---|---|
| CORE-06-sync | @luckystack/sync (syncRequest) | Core added sync.requestTimeoutMs; ack-timeout wiring lives in sync. |
| CORE-07 | @luckystack/router + @luckystack/server | Salting/HMAC would break router cross-env hash compare; /_health gate lives in server. |
| CORE-18 | @luckystack/router | Project name in BOOT_KEY_PREFIX needs router's bootHandshake reader in lockstep. |
| CORE-40-dispatch | @luckystack/login | Core added sessionCreated/sessionRevoked hooks; dispatch must fire from login. |
| CORE-17-env-template | consumer .env_template / .env.local_template | New Redis reconnect knobs documented per Rule 17 (repo root, out of core). |

### Pass 2 (grouped by target)

| Source ID | Needs | Why |
|---|---|---|
| api F1 / sync SYNC-02-root | **core** validateRequest null-safe + prod Zod wiring | All 4 transports pass `user!`; null crash + prod no-op are core-owned. |
| api F4 | **core** validateRequest signature + **server** loadSocket .catch | Harden the throw at source + add fire-and-forget catch. |
| api F5 / F11 | **core** RateLimitingConfig.skipLoopbackInDev + identity callback | Loopback skip + identity basis need config keys. |
| api F7 | **core** widen applyErrorFormatter input (ApiResponseEnvelope) | Eliminates the double-cast in both api handlers. |
| api F9 / server HOK-15 / server HOK-27 / sync SYNC-22 | **core** hooks/types.ts new payloads | apiAuthRejected, postHttpRequest, corsRejected reason, preSyncRecipient. |
| sync SYNC-11-emit | **devkit** loader + prod generator emit `rateLimit` for sync _server | Handler consumes it; loader must populate it. |
| sync SYNC-07 / SYNC-15 | **core** projectConfig sync.* keys | Receiver-authz flags + flushPressure constants. |
| sync SYNC-09 | **core** offlineQueue onDrop callback | Resolve evicted offline request instead of hanging. |
| sync SYNC-17-redact | **core** DEFAULT_REDACTED_LOG_KEYS + captureException sanitize | Defense-in-depth for raw-token log sites. |
| server SEC-13 | **core** (HMAC/salt + config) + **router** bootHandshake | Health hash exposure fix must keep boot handshake working. |
| server SEC-22/M2 | consumer **src/main.tsx** | Read location.hash instead of searchParams for OAuth token. |
| server CFG-21 / QUA-080 / MIS-017 / SEC-24 | **@luckystack/login** (+ core) | extraAuthorizationParams, CredentialsLoginResult, per-account lockout, PKCE. |
| login F1 / F7 / F11 | **@luckystack/server** authApiRoute (+ core) | OAuth state browser-binding cookie, auth rate-limit keying, PKCE challenge. |
| login F18 / F22 | **core** projectConfig | auth.allowRegistration, auth.passwordResetPath/emailChangeConfirmPath. |
| login F19 / F24 | **create-luckystack-app** / **cli** scaffold deleteAccount_v1 | Route through adapter.delete + dispatch pre/postAccountDelete (4 copies). |
| email F2 | **core** emailRegistry EmailMessage | Add attachments/headers; adapters then thread them through. |
| error-tracking ET-02/04/05/08/11/15/16/20 | **core** errorTrackerRegistry / sentrySetup | ALS per-event identity, capture-path redaction, append primitive, fan-out logging, span handle, pre-capture filter, flush lifecycle. |
| router core-DeployRoutingShape | **core** deployConfigRegistry | upstreamTimeoutMs/websocketService/routerHealthPath/maxRequestBodyBytes from deploy.routing.*. |
| test-runner QUA-014 / M1-env | **create-luckystack-app** + repo-root scripts/testAll.ts | config import + TEST_OUTPUT_FILE + TEST_ALLOW_REMOTE (now required for remote URLs). |
| docs-ui DUI-04 | **@luckystack/server** customRoutesRegistry | Keyed-replace semantics so an overlay can replace the docs-ui handler. |
| devkit DK-05-codegen / DK-06-codegen / DK-14-server-type | repo-root scripts + **create-app** template + **server** createServer | DK-05 codegen mirror lives in devkit `emitterArtifacts.ts` (apiMetaMap) — now PUBLIC-by-default to match runtime (revised 2026-06-13); __proto__ guard in codegen; capture DevWatcherHandle. |
| repo-src-tooling QUA-057 / QUA-085 / CFG-28-template / C-CFG | **core** side-effect-free barrel + **create-app/cli** re-sync + **core** config key | Lazy Redis/Prisma connect, changePassword/lintInvariants mirror sync, throttle config. |
| presence core-userLeft / server-loadSocket-gate / socket-room-formatter / leaveRoom-token-warn | **core** + **server** | userLeft event name, broadcaster gating at caller, room-name formatter hook, token redaction in shared leaveRoom warn. |
| docs-coverage (many) | per-package **CLAUDE.md** + barrels | core/api/sync/login/devkit/create-app/test-runner CLAUDE.md + barrel-export reconciliation (package-owned). |

**Total cross-package handoffs: 5 (pass 1) + ~25 grouped (pass 2).** Highest-leverage single target is **@luckystack/core** (new hook payloads, config keys, null-safe validateRequest, registry primitives) — most pass-2 items bottom out there.

---

## 5. Files Touched (per area)

| Pass | Area | Files touched (incl. tests) | Tests added |
|---|---|---|---|
| 1 | core | 23 | 3 files (configUtils, httpApiUtils, resolveClientIp) |
| 1 | mcp | 9 | 1 file (artifacts.test.ts) |
| 1 | extensibility | 16 (core/api/sync/server) | 1 file (apiInterceptors.test.ts, 6 cases) |
| 2 | api | 6 | 6 cases (rate-limit key, hook key, anon IP, F4 forbidden, F8 relaxed ×2) |
| 2 | sync | 12 | 1 file (redactToken.test.ts) |
| 2 | server | 18 | 3 files (timingSafeEqual, originExemptRegistry, argv) |
| 2 | login | 17 | 1 file (sessionSanitizer.test.ts) |
| 2 | email | 20 | 6 test files updated/added |
| 2 | error-tracking | 15 | 2 files (datadog.regression, sentryConfig) |
| 2 | router | 12 | 4 cases (httpProxy.test.ts) |
| 2 | test-runner | 25 | 2 files (fuzzCheck, walkEndpoints) |
| 2 | docs-ui | 14 | 3 files (renderCore, docsHtml, index) — 24 tests |
| 2 | devkit | 21 | 2 files (apiMeta, routingRules) — 8 cases |
| 2 | cli | 15 | 1 file (assetParity.test.ts) — 20 tests |
| 2 | create-luckystack-app | 34 | index.test.ts (3 cases) |
| 2 | repo-src-tooling | 27 | session_v1.tests.ts (regression) |
| 2 | docs-coverage | 7 | none (docs-only) |
| 2 | presence | 19 | 2 files — 7 cases |
| 2 | secret-manager | 0 | 0 (all already fixed) |

---

## 6. Per-Area Notable Behavioral Changes (review these)

- **api:** Rate-limit keys change from `token:<token>:…` to `user:<id>:…` / `ip:<ip>:…` — in-flight buckets reset once on deploy (harmless). `system/logout` now returns 429 under heavy IP load (was uncapped).
- **core (pass 1):** `apiRequest` internal-abort now **resolves** (not rejects), matching the external path. Rate-limiter `onStoreError` defaults to `'memory'` (fail-open preserved; opt into `'deny'`).
- **devkit:** **DK-05 public-by-default (revised 2026-06-13, user override)** — an API route omitting `export const auth` (or omitting/non-literal `login`) is PUBLIC (`login: false`) consistently across dev runtime, the AST extractor, the generated `apiMetaMap`, and the test-runner auth sweep (the original defect was the runtime↔tooling DISAGREEMENT, now removed). Any route that needs auth MUST declare `auth: { login: true }`. **DK-20** changes `registerRoutingRules` to compose-semantics (use new `resetRoutingRules()` for a clean slate).
- **test-runner:** `runAllTests` now **throws** on a non-loopback baseUrl unless `allowRemoteTarget:true` — CI pointed at a remote URL must set `TEST_ALLOW_REMOTE` (cross-package). Authenticated sweep skips PUT/DELETE for contract+rate-limit unless `mutatingMethodsSweep:true`. New CSRF + registered-extension layers run inside `runAllTests`.
- **error-tracking:** `DEFAULT_SENTRY_CONFIG` no longer suppresses `ECONNREFUSED` — DB/Redis outages now reach the tracker (re-add via `registerSentryConfig` if undesired).
- **login:** `rejectNew` now actually blocks at the session limit (F2). Account-enumeration unified to one `login.wrongPassword` + dummy bcrypt compare (F9).
- **DEV ACTIONS required (repo-src-tooling):** (1) ~~**SEC-32** needs `prisma generate` + db push/migrate for the new `@unique` email constraint~~ — **SUPERSEDED (user decision 2026-06-13):** the hard `email @unique` was removed. Account uniqueness is config-driven via `auth.providerAccountStrategy`: `'per-provider'` (default) ⇒ DB `@@unique([email, provider])`; `'unified'` ⇒ application-level dedup via `findByEmailAnyProvider` (optional DB `email @unique` for race-proofing). The root schema now matches the template (`@@unique([email, provider])`); still re-run `prisma generate` + db push/migrate to apply the composite constraint. (2) `npm install` to pick up the new `esbuild` devDependency.

---

## 7. Next Steps

1. **Run the full test suite** — `npm run test` on the merged tree (per-area agents ran scoped vitest; run the whole suite once).
2. **Review the diff** — especially §6 behavioral changes (api rate-limit keys; devkit fail-closed auth; test-runner remote-target throw; error-tracking ECONNREFUSED).
3. **Run the DEV ACTIONS** — `prisma generate` + db push/migrate (now for the `@@unique([email, provider])` composite, NOT the superseded `email @unique` — see §6 SEC-32 note) and `npm install` (esbuild) before running the app.
4. **Regenerate AI indexes** — `npm run ai:capabilities`, `npm run ai:project-index`, `npm run ai:graph` (new exports + hook names landed). `ai:index` already refreshed by docs-coverage.
5. **Action the cross-package handoffs (§4)** in a follow-up pass — most bottom out in **@luckystack/core** (hook payloads, config keys, null-safe validateRequest, registry primitives).
6. **Decide the deferred items (§3)** — 67 product/architecture calls (PKCE, prod Zod validation, 2FA, email verification, receiver authz, __Host- cookies, brute-force lockout, …).
7. **Append a branch-log entry** for this combined two-pass run and update `branch-logs/INDEX.md` (some areas deliberately skipped it to avoid append races).
8. **Commit when satisfied** (on `chore/package-split-prep`).
