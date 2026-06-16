# LuckyStack — FINAL Combined Security Report (codebase-scan-14-06-FINAL)

The single authoritative, fully-reconciled security record. Merges **wave-1** (6 independent top-level scans `codebase-scan-14-06` … `--6`, plus the r5 gap-sweeps and the per-area merges, consolidated in `codebase-scan-14-06-MERGED/SECURITY.md`) with **wave-2** (3 independent re-audit runs `--1`, `--3`, `--4`; run `--2` was an input digest and was ignored), each row re-verified against the CURRENT working tree (branch `chore/package-split-prep`, HEAD `302cbf1` + ~248 uncommitted fixes from this week's remediation pass). Date: 2026-06-15.

Every wave-2 "fixed/present" claim was independently re-confirmed by opening the cited file at the cited line in the live tree — no status was trusted on faith. Corroboration columns: **W1 n/6** = how many of the six wave-1 top-level reports raised it; **W2 n/3** = how many of the three wave-2 runs raised it.

## Headline

This week's pass **genuinely closed the entire wave-1 CRITICAL/flagship-HIGH cluster**: the router WS-proxy crash + SSRF (C-1/S-1), the `dist/server.js` source disclosure (C-2, mitigated in-tree), the `validateType` fail-OPEN (H-1), Sentry replay masking (H-2), unverified-OAuth-email account-takeover under `unified` (H-3), the `?token=` query-string adoption (H-4), the per-request error-tracker ALS identity bleed for the adapter path (H-8), sync `requireRoomMembership` HTTP bypass + client-only-route auth gap (H-7/H-11), and the OAuth nonce timing compare (L-2). **No CRITICAL survives.**

What remains splits into three themes: (1) **two genuinely NEW unauth process-crash DoS paths** wave-1 missed (`serveFile` malformed-`%` decode, N-1; `getParams` request-stream error, N-2) plus the surviving router **upstream-leg no-timeout** (H-1); (2) a recurring **"shadow-API / unwired-security-control"** theme (the raw-session-token rate-limit key, the legacy-Sentry raw-context leak, the `preEmailSend` suppression no-op, the unwired test-runner CSRF layer, the dead `redactToken` helper while raw tokens reach the trackers); (3) the **default-insecure-by-design** posture decisions deferred to the 0.2.0 hardening ADR (permissive sync receiver-auth, rate-limiter fail-open, `/_health` plain hashes, cookie-mode Bearer fallback). The consumer-`src`/CLI-asset **credentials self-delete** GDPR break persists end-to-end across every surface.

---

## Status counts

| Status | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| **NEW** (wave-2 found, verified real) | 0 | 4 | 6 | 3 | 13 |
| **OPEN** (known, still present) | 0 | 6 | 18 | 14 | 38 |
| **DEFERRED-DECISION** (real, pending policy/ADR) | 0 | 1 | 5 | 3 | 9 |
| **FIXED** (verified resolved in-tree) | 2 | 8 | 4 | 3 | 17 |
| **FALSE-POSITIVE** (verified bogus / by-design) | — | — | — | — | 11 |
| **TOTAL** | 2 | 19 | 33 | 23 | 88 |

> Actionable now = NEW + OPEN = **51** (10 High, 24 Medium, 17 Low). DEFERRED-DECISION = 9 (mostly the 0.2.0 secure-default flips). FIXED = 17 (the whole wave-1 CRIT/flagship cluster). FALSE-POSITIVE = 11. Where waves/runs disagreed on severity, the merged author-adjusted severity is taken and both noted inline.

---

# ACTIONABLE — NEW + OPEN (by severity)

## HIGH

### N-1 — `serveFile` malformed-`%` URL → unguarded `decodeURIComponent` throw → unhandled rejection → process crash (unauth DoS) · NEW
- **Severity:** High · **Status:** NEW · **W1:** 0/6 · **W2:** 1/3 (r3) · **Area:** root-server
- **Location:** `server/prod/serveFile.ts:54` (decode); `packages/server/src/httpRoutes/staticRoutes.ts:50-58` (`/assets/*` branch skips `KNOWN_STATIC_FILE_REGEX`; denylist doesn't match `%ZZ`); `packages/server/src/httpHandler.ts:306` (no try/catch around `dispatchRoutes`); `packages/server/src/createServer.ts:194-195` (`void handleHttpRequest(...)`, no `.catch`).
- **Detail:** `GET /assets/%ZZ` reaches `serveFile` raw; `decodeURIComponent` throws `URIError`; there is NO `process.on('unhandledRejection')` anywhere in `packages/*/src`, `server/`, `shared/`, `functions/`, so Node's default policy terminates the worker. Verified crash chain end-to-end. Trivially scriptable, unauthenticated.
- **Fix:** `tryCatchSync(() => decodeURIComponent(url))` → 400 on failure; add `.catch()` on the voided `handleHttpRequest` (500, never reject unhandled) and/or wrap `dispatchRoutes` in try/catch. Add a global `process.on('unhandledRejection')` backstop.

### N-2 — `getParams` request-stream `'error'` → unhandled promise rejection → remote worker crash (unauth DoS) · NEW
- **Severity:** High · **Status:** NEW · **W1:** 0/6 · **W2:** 1/3 (r1 CORETRANSPORT-01; cross-filed in core) · **Area:** core / root-server
- **Location:** `packages/core/src/getParams.ts:111-113` (`req.on('error', e => reject(e))`); caller `server/httpHandler.ts:190` has no top-level try/catch; dispatch `server/createServer.ts:195` fires it as `void`.
- **Detail:** A client RST / aborted mid-body on a POST/PUT/DELETE makes `getParams` reject; with no surrounding catch and the `void` dispatch, it becomes an unhandled rejection → process exit under Node default. Same crash CLASS as N-1 and the wave-1 avatar-stream crash (now fixed), distinct path. Core-owned reject site, but only crashes because of the un-wrapped server caller.
- **Fix:** core-side, resolve `null` (the parser's documented "no usable body" signal) on `'error'` instead of rejecting; server-side, add the `.catch()` backstop (shared with N-1).

### N-3 — Per-route rate-limit bucket keyed on the RAW SESSION TOKEN (token in Redis keys + dev logs) · NEW
- **Severity:** High (r4) / Medium (r1) · **Status:** NEW · **W1:** 2/6 (api#16, framed token-SAFE) · **W2:** 3/3 (r1,r3,r4) · **Area:** api
- **Location:** `packages/api/src/handleApiRequest.ts:141-143,162`; `packages/api/src/handleHttpApiRequest.ts:318-320`.
- **Detail:** `requesterIdentity = token ?? resolvedIp; key = \`${keyPrefix}:${requesterIdentity}:api:${name}\``. Authenticated callers embed the raw bearer token verbatim in the rate-limit Redis key AND in the dev `warn` log (`{ key: rateLimitKey }`, :162). Directly contradicts the CLAUDE.md "keyed on validated `user.id` … never the raw token" invariant; the wave-1 baseline's "key never contains the token" is REFUTED in current code. The mislabeled `rateLimitExceeded` `scope:'user'` (api O13, Low) compounds it — labeled `'user'` while the key holds the token.
- **Fix:** key on `user.id` when authenticated (else resolved IP); route through the documented `rateLimiting.identity`; add a test asserting no key contains the token.

### N-4 — Dead `redactToken`/`redactTokens` helper + raw bearer token leaks to error-tracker context (sync) · NEW
- **Severity:** High · **Status:** NEW · **W1:** 0/6 · **W2:** 1/3 (--3 SYNC-N2) · **Area:** sync
- **Location:** `packages/sync/src/_shared/redactToken.ts:17-27` (dead — sole importer is its own test); leak sites `_shared/clientFanout.ts:111` (`targetToken: tempToken` into the `tryCatch` error-context → `captureException`), `_shared/streamEmitters.ts:222-223` (`{ tokens: filtered }` log); core `DEFAULT_REDACTED_LOG_KEYS` (exact-match, so `targetToken`/`tokens` NOT masked).
- **Detail:** `targetToken` is the recipient's full raw session token. The error-tracker path fires whenever a route's optional `_client` handler throws AND a tracker is registered — NOT dev-gated (the stream-log half IS dev-gated behind `logging.stream`). Raw replayable bearer tokens can reach Sentry/PostHog/Datadog context. The mitigating control (the `redactToken` helper, shipped specifically for these sites) was written but never wired — key-name mismatch. Tightly related to the raw-token-into-`_client` foothold (sync O14, Low).
- **Fix:** route the two call sites through `redactToken`/`redactTokens` (call-site redaction is the complete fix; note the legacy Sentry slot forwards context WITHOUT `sanitizeForLog`, so `registerRedactedLogKeys` alone fixes only the adapter path).

### H-1 — Router WS + HTTP upstream leg has NO timeout → half-open pair accumulation (resource-exhaustion DoS) · OPEN/NEW
- **Severity:** High · **Status:** OPEN (NEW this week; wave-1 only caught the now-fixed client-disconnect leg) · **W1:** new · **W2:** 3/3 · **Area:** router
- **Location:** `packages/router/src/wsProxy.ts:96-119`; `packages/router/src/httpProxy.ts:96-119`.
- **Detail:** `transport.request({...})` on both proxies passes no `timeout` option and no `.setTimeout(...)` (grep-confirmed: zero `setTimeout`/`timeout` on `transport.request`). A backend that accepts the TCP connection but never answers fires none of `'upgrade'`/`'response'`/`'error'`; for WS only client disconnect reaps it, so a client that stays connected pins both sockets indefinitely. `startRouter.ts:152-153` bounds only the INBOUND server. Unauthenticated-reachable on the WS path (any client + a stalled `system` backend).
- **Fix:** set `timeout` on `transport.request(...)` (or `forwardRequest.setTimeout(ms,...)`) from a `routing.upstreamTimeoutMs` knob; 504 + destroy on `'timeout'`; arm a WS handshake watchdog. Add a silent-upstream test.

### H-2 — Default receiver-authorization is fully permissive: any client may broadcast to `'all'` or to unjoined rooms (cross-tenant fanout) · OPEN
- **Severity:** High (r4,r6) / Medium (r1,r2,r5) · **Status:** OPEN (known) — also tracked DEFERRED-DECISION (0.2.0 secure-default flip, DD-1) · **W1:** 5/6 · **W2:** 3/3 · **Area:** sync / core
- **Location:** defaults `packages/core/src/projectConfig.ts:773-774` (`allowClientReceiverAll:true`, `requireRoomMembership:false`); enforcement `packages/sync/src/_shared/receiverAuth.ts:46-68`; call sites `handleSyncRequest.ts:475`, `handleHttpSyncRequest.ts:374`.
- **Detail:** By default `authorizeSyncReceiver` allows any receiver including cluster-wide `'all'` (a `fetchSockets()` amplifier) and never-joined rooms; only the opt-in `preSyncAuthorize` hook gates it. On a `login:false` route this is fully unauthenticated — a user in room A can push `serverOutput`/`broadcastStream` into room B (info injection / cross-tenant real-time data). The HTTP-transport bypass half (wave-1 H-7) and client-only-route auth gap (wave-1 H-11) are now FIXED; this permissive-default posture is the surviving core of the finding.
- **Fix (decision):** flip to secure-by-default for 0.2.0 (`requireRoomMembership:true`, `allowClientReceiverAll:false`) with explicit opt-out + membership from session `roomCodes`; at minimum boot/scaffold-warn and ship the secure keys commented in `config.ts`. Cross-package coordination (core owns defaults, sync owns enforcement). See DD-1.

### H-3 — Unauthenticated `/_health` publishes unsalted `sha256(secret)` fingerprints (+ `bootUuid` + `envKey`) by default; the `@bootUuid` salt mitigation is DEAD on this caller · OPEN
- **Severity:** High · **Status:** OPEN (known) · **W1:** 3/6 (6/6 at server-area level) · **W2:** 3/3 · **Area:** server / core
- **Location:** `packages/server/src/httpRoutes/healthRoutes.ts:80-89`; `packages/core/src/synchronizedEnvHashes.ts`; default `packages/core/src/projectConfig.ts:703-706` (`{mode:'plain', salt:''}`).
- **Detail:** `handleHealthRoute` runs pre-params, no auth/origin. It calls `computeSynchronizedEnvHashes()` with NO bootUuid, so `resolveHealthHashConfig(undefined)` collapses to plain unsalted `sha256(value)` for each `synchronizedEnvKeys` entry (the repo's deploy config registers `COOKIE_SECRET`) = a stable offline dictionary/rainbow oracle; `envKey` + `bootUuid` leak unconditionally (topology disclosure / router-handshake-forgery aid). `verifyBootstrap` only WARNs (added this week), never hard-fails. The dead-`@bootUuid`-salt is the strongest concrete defect. `/readyz` also runs an unauth, un-rate-limited Redis PING + Prisma `SELECT 1` per hit (server O17, Low — amplification lever; fold into the same gating).
- **Fix:** pass bootUuid into the hash; don't co-disclose raw bootUuid in the same body; default `'hmac'`/salted when `synchronizedEnvKeys` is non-empty, OR gate `synchronizedHashes`+`envKey` behind a router-probe token / internal bind (keep bare `{status}`/`bootUuid` liveness). Rate-limit `/readyz`. (Decision: DD-3.)

### H-4 — `preEmailSend` stop-signal IGNORED — documented suppression/abort seam is a silent no-op · OPEN/NEW
- **Severity:** High · **Status:** NEW (this week, wave-1 audited a phantom file) · **W1:** 0/6 · **W2:** 2/3 (r1,r4) · **Area:** email
- **Location:** `packages/email/src/sendEmail.ts:199-204` (discards the `DispatchResult`); dispatch DOES return `{stopped,signal}` at `packages/core/src/hooks/registry.ts:44-68`; docs README.md:140-155 + CLAUDE.md:15,47 advertise suppression as LIVE (hooks.md:135 admits the gap).
- **Detail:** `sendEmail` awaits `dispatchHook('preEmailSend', …)` and discards the result, never checks `.stopped`, falls straight to `sender.send`. A consumer/AI wiring a GDPR opt-out / bounce / unsubscribe suppression list ships a no-op: suppressed recipients still get mail and `sendEmail` returns the adapter success result, silently. HIGH not CRITICAL only because a secondary doc discloses the gap.
- **Fix:** check `pre.stopped` and short-circuit with `{ ok:false, reason: signal.errorCode ?? 'email.suppressed' }` BEFORE `sender.send`; add an orchestration test asserting `sender.send`/`postEmailSend` are skipped.

### H-5 — Credentials user can NEVER self-delete account — server requires a password the UI never sends (GDPR right-to-erasure break) · OPEN
- **Severity:** High · **Status:** OPEN (known) — present across consumer `src`, CLI asset, AND scaffolder template (one root bug, three surfaces) · **W1:** 4/6 · **W2:** 3/3 (root-src), 1/3 (cli/scaffolder) · **Area:** root-src / cli / scaffolder / login
- **Location:** `src/settings/page.tsx:271-289`, `packages/cli/assets/login/src/settings/page.tsx:284`, `template/src/settings/page.tsx:281-285` — all send only `{ confirmation:'DELETE' }`; server `deleteAccount_v1.ts:29-33` requires `data.password` whenever the account has a password hash; `ConfirmMenu.tsx:11,27` + `menuHandler.ts:56` only resolve `Promise<boolean>`, discarding any typed input.
- **Detail:** Every credentials account enters the `if (dbUser?.password)` branch with `data.password` undefined → `ok=false` → always `login.wrongPassword`. OAuth-only delete works, masking the bug. The route's own `_v1.tests.ts` passes `password` directly, so it stays green while the UI is broken — NO real-flow regression test. Fails CLOSED (over-restrictive, not a security hole) → High not Critical.
- **Fix:** extend `ConfirmMenu`/`menuHandler.confirm` to return the typed value; collect + send `data.password` for credentials accounts; add a UI happy-path regression test; mirror to all three surfaces. (Inverse edge, Medium: a null/empty-hash credentials account skips the gate and is deletable with `DELETE` alone — `deleteAccount_v1.ts:29` gates on hash truthiness not provider.)

### H-6 — Consumer `src/settings/_api/*` session handlers hand-build Redis keys with `process.env.PROJECT_NAME` → multi-tenant / config-divergence break · OPEN
- **Severity:** High (Medium per wave-2 severity vote) · **Status:** OPEN (verified real) · **W1:** 1/6 (partial) · **W2:** 2/3 · **Area:** root-src
- **Location:** `src/settings/_api/listSessions_v1.ts:20,23,30,32`; `revokeSession_v1.ts:21,32`; `deleteAccount_v1.ts:20,38` — all `const PROJECT_NAME = process.env.PROJECT_NAME ?? 'luckystack'` + template literals, bypassing `formatKey`/`sessionKeyFor`/`activeUsersKeyFor`.
- **Detail:** Byte-identical under default config; silently divergent when project name is set via `session.projectName` config (env unset) OR a `registerRedisKeyFormatter` (multi-tenant) is installed → `listSessions` returns empty, `revokeSession` can't resolve a session, `deleteAccount` leaves a stale activeUsers set (sign-out-everywhere gap). This is the dogfood example AI clones first (Rule 12 points agents at `src/` / `AI_PROJECT_INDEX`). The shipped CLI asset already imports the helpers correctly — consumer `src/` is the regressed twin (root-src O3 is the same root cause: `src/` copies drifted behind the hardened asset; `listSessions`/`revokeSession` use 64-char `id` while the asset uses 16-char `handle`).
- **Fix:** import `sessionKeyFor`/`activeUsersKeyFor` from `@luckystack/login`; delete the local `PROJECT_NAME`; re-sync the `src/` copies from the asset; add an `ai:check-template-drift` CI gate + an `ai:lint` invariant flagging `process.env.PROJECT_NAME` Redis-key literals in `_api`/`_sync`.

### H-7 — `flushErrorTrackers()` never wired into server shutdown — buffered PostHog/Sentry events dropped every redeploy · OPEN
- **Severity:** High · **Status:** OPEN (known) · **W1:** 2/6 · **W2:** 3/3 (error-tracking), 2/3 (server SERVER-02) · **Area:** server / error-tracking
- **Location:** `packages/server/src/createServer.ts:70-71` (SIGINT/SIGTERM `process.exit(0)`, dev-only inside `initDevTools`); `:194-206` returns only `{ httpServer, ioServer, listen }` — no `stop()`; primitive `errorTrackerRegistry.ts:175-186`; `grep flushErrorTrackers packages/server/src` → ZERO.
- **Detail:** `createLuckyStackServer` lost graceful shutdown. The only signal handlers are dev-only and exit immediately; posthog-node batches in memory and the prior accessor was removed so flush is now the ONLY drain path → buffered telemetry lost on every shutdown/redeploy. Sockets/Redis-adapter never drained on a non-`process.exit` teardown; a post-listen `httpServer 'error'` is unhandled → crash. The error-tracking + core primitives are complete; only the `@luckystack/server` `preServerStop`/prod-SIGTERM subscriber is missing.
- **Fix:** add `stop()` to `RunningLuckyStackServer` (`await ioServer.close()` + Redis pub/sub `.quit()` + `httpServer.close()` + `await flushErrorTrackers()`), persistent `httpServer.on('error', log)`, wire prod signals → `stop()`.

---

## MEDIUM

### N-5 — File-reload pointer-map merged BEFORE the resolve it depends on → failed remote reload permanently pollutes the in-memory pointer map · NEW
- **Severity:** Medium · **Status:** NEW · **W1:** 0/6 · **W2:** 2/3 · **Area:** secret-manager
- **Location:** `packages/secret-manager/src/index.ts:746` (merge) then `:751` (`doResolve` may throw, no rollback).
- **Detail:** `pointerMap = { ...pointerMap, ...freshPointerMap }` is committed before `await doResolve(...,'file-reload')`, which throws in remote mode on an unresolvable pointer. A bad dev `.env.local` edit poisons every later `refreshSecretManager()`/poll for the process lifetime (operator must restart). Dev-path + remote-mode only.
- **Fix:** build the merged map locally; commit to `pointerMap` only after `doResolve` succeeds (mirror the plain-value apply-after-success ordering).

### N-6 — Contract sweep treats any well-formed error envelope as PASS → broken-validation routes pass green · NEW
- **Severity:** Medium · **Status:** NEW · **W1:** 0/6 · **W2:** 1/3 (r3) · **Area:** test-runner
- **Location:** `packages/test-runner/src/contractCheck.ts:85-114` (`status:'error' && errorCode` → pass at :96-114).
- **Detail:** A route that rejects ALL input (broken validation, an always-throwing guard caught into a 500-envelope) passes the contract layer. Combined with the fuzz sample fail-open, the happy-path probe frequently sends a body the route's own Zod rejects yet counts green — the headline X/Y overstates security health.
- **Fix:** when `inputFor` produced a non-empty sample, assert `status:'success'`, OR surface error-envelope passes as a distinct "soft pass / returned error" category.

### N-7 — CSRF-enforcement layer is dead surface: written + tested but never exported / never run → zero CSRF coverage in the default sweep · NEW
- **Severity:** Medium (all 3 runs rated it the top live test-runner item) · **Status:** NEW · **W1:** 0/6 · **W2:** 3/3 · **Area:** test-runner
- **Location:** `index.ts:1-69` (no csrf export); `runAllTests.ts:88-133` (`runSweepLayers` runs only contract→auth→rate-limit→fuzz); `csrfEnforcementCheck.ts:34` + `runCsrfEnforcementTests.ts:27` fully implemented but unreachable (package.json exposes only the `.` barrel).
- **Detail:** The default `npm run test` sweep gives ZERO CSRF-enforcement coverage; a consumer who disables/misconfigures CSRF still gets a fully green run. The middleware it verifies is real (`server/src/httpRoutes/csrfMiddleware.ts`).
- **Fix:** export `runCsrfEnforcementCheck`/`runCsrfEnforcementTests` and add as a 5th sweep layer gated on a valid session; bundle the GET-method guard (test-runner #9) into the same change.

### N-8 — Authenticated sweep layers omit the CSRF header the server enforces; the mutating-method partition was removed · NEW
- **Severity:** Medium · **Status:** NEW/known · **W1:** 2/6 + 3/6 · **W2:** 3/3 · **Area:** test-runner
- **Location:** `runAllTests.ts:73-80` (`buildAuthHeaders` — Cookie only); `contractCheck.ts:46-53`, `rateLimitCheck.ts:36-44`, `fuzzCheck.ts:42`; vs `customTests.ts:319` (Layer-5 sends it correctly).
- **Detail:** On cookie-mode + CSRF-on, contract/fuzz false-PASS (`auth.csrfMismatch` is a valid error envelope → "covered" though the handler never ran) and rate-limit false-FAILs. The prior `safeMap`/`MUTATING_METHODS` partition is GONE, so on a token-mode/CSRF-off project the fuzz layer now hits every authenticated DELETE/PUT with junk bodies — a real mutation risk on body-ignoring routes.
- **Fix:** thread the session CSRF token into the authenticated sweep builders; restore a mutating-method partition / opt-in gate for fuzz under auth, or `skip` state-changing cookie-mode routes.

### M-1 — Cookie-mode sessions silently accept `Authorization: Bearer` (+ socket `handshake.auth.token`) → CSRF model bypass for a stolen token · OPEN
- **Severity:** Medium · **Status:** OPEN (known) — also DD-4 · **W1:** 4/6 (#5) · **W2:** 1/3 (r3 CORE-N8) · **Area:** core / server
- **Location:** `packages/core/src/extractTokenFromRequest.ts:30-34`; `extractToken.ts:27-32` (socket twin).
- **Detail:** Cookie mode (`!session.basedToken`) returns `cookieToken ?? bearerToken`. A cookie-mode deployment (chosen to keep the token out of JS reach + lean on SameSite) still authenticates a request presenting `Authorization: Bearer`, so a leaked/XSS-exfiltrated token is usable over the transport SameSite does not govern; the operator can't opt out.
- **Fix:** make the cross-transport fallback opt-in (`http.acceptBearerInCookieMode`, default false); when false, cookie-mode extractors return only the cookie token.

### M-2 — `trustProxy`/XFF resolution trusts the LEFTMOST (client) hop → per-IP rate-limit evasion + audit-IP spoofing; default-false collapses per-IP to global · OPEN
- **Severity:** Medium (disputed High) · **Status:** OPEN (known) · **W1:** 4/6 · **W2:** 3/3 · **Area:** core / api / router
- **Location:** `packages/core/src/resolveClientIp.ts:85-91` (`:89` `split(',')[0]`); `handleHttpApiRequest.ts:282`; `handleApiRequest.ts:613`; `server/src/httpRoutes/apiRoute.ts`.
- **Detail:** Two faces — (a) default `trustProxy:false` behind a reverse proxy keys every client into `ip:<proxyIp>` / `UNKNOWN_CLIENT_IP` → per-IP cap degrades to a global cap; (b) with `trustProxy:true` the resolver trusts the leftmost (client) XFF hop → rotate a forged IP to evade per-IP caps / poison audit. Default `trustProxy:false` is the safe gate so default deploys are inert; settled at MEDIUM (exploitable only on the opt-in posture). The HTTP `'unknown'`/`'anonymous'` literal collapse (api O9, sync O11) and the `/auth/api` throttle keying on raw socket address are the same root.
- **Fix:** resolve from the RIGHT with a trusted-hop-count / known-proxy CIDR; prefer `X-Real-IP`; boot-warn when `trustProxy:false` && inbound XFF present; don't treat `UNKNOWN_CLIENT_IP` as loopback.

### M-3 — HTTP loopback rate-limit skip is spoofable + ignores `skipLoopbackInDev`/`isLoopbackIp` · OPEN/NEW
- **Severity:** High (r1) / Medium (r3) · **Status:** NEW · **W1:** 0/6 · **W2:** 3/3 · **Area:** api
- **Location:** `packages/api/src/handleHttpApiRequest.ts:359-362`.
- **Detail:** `requesterIsLoopback = process.env.NODE_ENV !== 'production' && requesterIp.startsWith('127.')`, reading neither the documented `rateLimiting.skipLoopbackInDev` (default false) nor `isLoopbackIp`. In any non-prod deploy a 127.x-looking IP defeats the cross-route `:api:all` abuse cap; remote-spoof requires `trustProxy:true` + leaky XFF. The documented config knob is an unconditional no-op (the "shadow-API" half). Socket transport diverges (no loopback skip) — twin drift.
- **Fix:** gate on `skipLoopbackInDev && isLoopbackIp(resolvedIp)` using the `resolveClientIp`-derived IP.

### M-4 — Legacy `sentrySetup.captureException`/`captureMessage` forward RAW context as Sentry `extra` — bypasses `sanitizeForLog` (PII/secret leak) · OPEN
- **Severity:** High→Medium · **Status:** OPEN (known) · **W1:** 1/6 · **W2:** 3/3 (error-tracking O2) + 2/3 (core O4) · **Area:** error-tracking / core
- **Location:** `packages/core/src/sentrySetup.ts:42-66` (`:44` `sentry.captureException(error, { extra: context })`).
- **Detail:** `sanitizeForLog` runs only inside the `captureExceptionAcrossTrackers` fan-out, a different path; `builtinBeforeSend` only deletes `request.cookies`, never `event.extra`. A `captureException(err, { token:'secret' })` on the still-exported `initializeSentry()`/`initSharedSentry` slot ships secrets verbatim. This is the MOST-COMMON Sentry config (DSN, no separate adapter). Falsifies the `errorTrackerRegistry.ts:17-21` "raw token never reaches Sentry" comment. Materializes only when a consumer puts a secret in context → defense-in-depth Medium.
- **Fix:** `sanitizeForLog(context)` once at the top of both legacy fns before the legacy slot + fan-out (idempotent). A single root fix — make `initializeSentry()` register `createSentryAdapter()` — also closes M-5 (legacy identity bleed) and the legacy double-capture (error-tracking N5). Worth an ADR.

### M-5 — Legacy Sentry identity is a per-request process-global scope → cross-request user bleed on the `initializeSentry()`-only path · OPEN/NEW
- **Severity:** High→Medium · **Status:** NEW nuance (wave-1 folded the adapter path into the now-FIXED ET-02) · **W1:** 0/6 (legacy path) · **W2:** 1/3 · **Area:** error-tracking
- **Location:** `packages/error-tracking/src/autoInstrumentation.ts:76-80` (`propagateIdentity` → `setSentryUser`); `sentrySetup.ts:42-48`.
- **Detail:** The ALS fix (now FIXED for the adapter path) covers consumers who register `createSentryAdapter()`. A consumer using ONLY `initializeSentry()` has the legacy `sentrySetup` slot as the sole Sentry sink, relying on the process-global `setUser` scope that `propagateIdentity` overwrites per request — no `withIsolationScope`/`withScope` anywhere. Under concurrency, request A's error files under request B's identity.
- **Fix:** route `initializeSentry()` through `createSentryAdapter` (reads ALS per-event), OR have `sentrySetup.captureException` attach `getCurrentErrorTrackerIdentity()` per event. Same root as M-4.

### M-6 — `error.message` / `error.stack` forwarded to PostHog & Datadog bypass redaction (key-based scrub only) · OPEN
- **Severity:** Medium · **Status:** OPEN (known) · **W1:** 1/6 · **W2:** 3/3 · **Area:** error-tracking / core
- **Location:** `packages/error-tracking/src/adapters/posthog.ts:81,84`; `adapters/datadog.ts:128,135`; `errorTrackerRegistry.ts` (`sanitizeForLog` is key-based).
- **Detail:** Adapters read raw `fwdError.message`/`.stack`, so `new Error(\`token ${raw}\`)` reaches PostHog `error.message` / Datadog `error.msg`+`error.stack` verbatim; only Sentry scrubs SDK-side. Non-Sentry backends get no automatic string scrub. Related: `builtinBeforeSend` scrubs ONLY `request.cookies` — narrower than wave-1 claimed; misses `request.data`/`query_string`/`extra`/headers (error-tracking O5).
- **Fix:** central value-level scrub of `error.message`+`error.stack` in `captureExceptionAcrossTrackers`; extend `builtinBeforeSend` to `request.query_string`/`data`/`extra` + sensitive header names derived from `getRedactedLogKeys()`.

### M-7 — `redactedLogKeys` default set omits `csrftoken`/`apikey`/`secret`/`accesstoken`/`refreshtoken`; exact-match only · OPEN
- **Severity:** Medium · **Status:** OPEN (known) — deferred in wave-1 LOW as a policy change · **W1:** 4/6 · **W2:** 3/3 · **Area:** core
- **Location:** `packages/core/src/redactedLogKeys.ts:10-18` (defaults), `:30-32` (exact match).
- **Detail:** Defaults are only `password,confirmpassword,token,newtoken,authorization,cookie,set-cookie`; `token` ≠ `csrftoken`, `userPassword` not caught. The session carries a live `csrfToken`. This is the substrate that makes N-3/N-4/M-6 leak (the raw-token/secret keys aren't in the set). More aggressive redaction can hide legit debug fields → a conscious policy call.
- **Fix:** add the missing keys + suffix matching (`*token`,`*secret`,`*password`).

### M-8 — Default rate limiter fails OPEN: `store:'memory'` per-process; `onStoreError:'memory'` default; `'deny'` honored only inside `isRedisMode()` · OPEN
- **Severity:** Medium · **Status:** OPEN (known) — confirmed deliberate fail-open stance; also DD-2 · **W1:** 5/6 · **W2:** 2/3 · **Area:** core / api
- **Location:** `packages/core/src/rateLimiter.ts:228-235`; defaults `projectConfig.ts:665,671`.
- **Detail:** Default `store:'memory'` keeps per-process counters → effective limit `limit×instanceCount`; with `store:'redis'`, `onStoreError` defaults to `'memory'` so a Redis outage silently relaxes the cap; `check()` only enters the deny branch inside `if (isRedisMode())`, so memory mode ignores `'deny'` entirely (false fail-closed assurance). The in-memory store is also unbounded (no LRU cap → OOM under key rotation, core O7).
- **Fix (decision):** honor `'deny'` regardless of store, or default `onStoreError:'deny'` for `store:'redis'`/production; boot-warn `store:'memory'`+multi-instance; cap the in-memory Map (LRU); document memory mode single-instance/dev only.

### M-9 — `clearAllRateLimits` (Redis `clearAll`) SCAN+DEL on `${getRedisPrefix()}:*` is project-rooted + publicly exported with NO dev/test guard · OPEN
- **Severity:** Medium · **Status:** OPEN (known) · **W1:** 1/6 · **W2:** 2/3 · **Area:** core
- **Location:** `packages/core/src/rateLimiter.ts:258-278`, exported via `index.ts`.
- **Detail:** A single call wipes every tenant's rate-limit counters (prefix is project-rooted, app-global by the documented formatter); the JSDoc frames it as a benign "testing/restart" helper. (The r5 sweep refuted the "cross-tenant leak" framing — rate-limits are app-global by design — so the narrower defects stand: fleet-wide reset + unguarded public export.)
- **Fix:** gate behind `NODE_ENV!=='production'` or require an explicit namespace arg; add a scoped `clearRateLimits(prefix)` variant; document fleet-wide.

### M-10 — `processUpload` / consumer avatar route trust client `contentType`, no size / magic-byte / pixel cap before `sharp` · OPEN
- **Severity:** Medium · **Status:** OPEN (known) · **W1:** 3/6 · **W2:** 3/3 (verified delegated to core `processUpload`) · **Area:** core / root-src
- **Location:** core `processUpload`; consumer `updateUser_v1.ts` hands attacker `contentType` + base64 straight to `sharp(...).webp()`.
- **Detail:** No built-in size/MIME/content check; a small base64 pixel-bomb drives CPU/memory (authenticated DoS), and if any code trusts `contentType` for an allow-list it becomes load-bearing (stored-XSS via `image/svg+xml`/polyglot). The asset-side guard is defense-in-depth; the real residual belongs to core `processUpload`.
- **Fix:** in `processUpload` accept a `maxBytes` (or read `requestBodyMaxBytes`) and reject oversize; allow-list `contentType` + set `sharp(...).limitInputPixels(...)` framework-side.

### M-11 — `EmailMessage.attachments` + `headers` are typed + JSDoc-promised but silently dropped by `toProviderPayload` (a test pins the drop) · OPEN
- **Severity:** Medium · **Status:** OPEN (known) · **W1:** 0/6 (surfaced E14-adjacent) · **W2:** 3/3 · **Area:** email / core
- **Location:** `packages/email/src/adapters/providerPayload.ts:17-29`; contract `packages/core/src/emailRegistry.ts:48-61`; test `providerPayload.test.ts` pins the drop.
- **Detail:** Core declares both fields a real contract; the shared mapper projects only 8 scalar fields. A consumer sets `attachments` (invoice) or `headers['List-Unsubscribe']`/idempotency key, the type accepts it, send returns `{ok:true}`, the data never reaches Resend/nodemailer (both natively support these). Security-relevant because the missing CR/LF defense (email O9) becomes live IF this is fixed without adding header key/value sanitization.
- **Fix:** forward them in `toProviderPayload` + add `stripCrlf` on forwarded header keys/values, OR remove/`@deprecated` the fields so the type stops promising delivery.

### M-12 — `renderEmailLayout` interpolates `ctaUrl` raw into `href` and `accent` raw into `background:` (no escaping/validation) · OPEN
- **Severity:** Medium · **Status:** OPEN (known) · **W1:** 2/6 (cosmetic framing — re-characterized) · **W2:** 2/3 · **Area:** email
- **Location:** `packages/email/src/renderEmailLayout.ts:52-53`.
- **Detail:** Every text field IS `escapeHtml`'d, but `accent` (`background:${accent}`) and `ctaUrl` (`href="${ctaUrl}"`) are raw on an exported general-purpose helper. Built-in reset/confirm URLs are server-built (not exploitable today), but a consumer/AI passing user-derived `ctaUrl`/`accent` gets attribute-breakout (`"`) / `javascript:` link. Rule 7a: a framework-shipped "safe layout" primitive should be safe-by-default.
- **Fix:** `new URL()` scheme-allowlist + `escapeHtml(parsed.href)` for href; validate `accent` against a color regex with a default fallback; keep raw URL only in the plain-text branch (update the pinning test).

### M-13 — `confirmEmailChange` collision re-check non-atomic AND scoped to `provider:'credentials'` (misses OAuth-row collisions under `unified`) · OPEN
- **Severity:** Medium (run4-7 rated Low; merged Medium for the `unified` correctness hole) · **Status:** OPEN (new) · **W1:** 0/6 · **W2:** 1/3 · **Area:** login
- **Location:** `confirmEmailChange_v1.ts:50-59` (`findFirst({email,provider:'credentials',NOT:{id}})` then separate `update`).
- **Detail:** Non-atomic check-then-write, and the provider scope drops OAuth rows, so under `unified` a confirmed email-change can collide with an existing OAuth account. Pairs with the non-deterministic `findByEmailAnyProvider` (login LOGIN-04: `findFirst` no `orderBy` makes the cross-provider link guard non-deterministic) and the register-time TOCTOU (login F7).
- **Fix:** rely on the DB unique constraint (treat unique-violation as collision); drop the `provider:'credentials'` scope under `unified`; add deterministic ordering to `findByEmailAnyProvider`.

### M-14 — Email-change initiated with NO current-password re-auth → session-hijack → account takeover via email rotation · OPEN/NEW
- **Severity:** Medium · **Status:** NEW · **W1:** 0/6 · **W2:** 1/3 · **Area:** login
- **Location:** `requestEmailChange_v1.ts:26-65` (requires only `auth.login:true`).
- **Detail:** Never re-verifies the current password (contrast `deleteAccount_v1.ts:30`, `changePassword`). The confirm link goes to the NEW address so the legit owner never sees it; on confirm all sessions are revoked → real owner locked out.
- **Fix:** require + verify current password for credentials accounts; add the password field to the UI; optionally notify the OLD address.

### M-15 — Per-account login lockout amplified into a remote DoS by full password-policy validation on the LOGIN path · OPEN
- **Severity:** Medium→High (amplification) · **Status:** OPEN (known, amplified this week into LOGIN-03) · **W1:** 1/6 (#8) · **W2:** 3/3 · **Area:** login
- **Location:** `login.ts:316` (`validateCredentialsShape`→`validatePassword`) called `:532` BEFORE the login/register split; `authLockout.ts:84-89` (`NON_COUNTING_REASONS` excludes `login.password*`).
- **Detail:** Full password-policy validation runs on the login branch (leaks the exact policy to unauth probers; locks out pre-policy-tightening passwords) AND policy-failure reasons trip the per-account lockout counter. Combined: an attacker locks any victim by POSTing policy-violating passwords for their email — no real-password guess needed. (The register path separately skips the lockout check entirely, login F15 — unbounded `resolveUserByEmail` via register.)
- **Fix:** cheap shape-checks only on login (empty/length cap), full policy on register; collapse policy fails to `login.wrongPassword`; add `login.password*` to `NON_COUNTING_REASONS`; apply the lockout/throttle on the register lookup.

### M-16 — Auto-mount docs-UI prod gate is env-only and fails OPEN on staging/preview/unset hosts; the documented opt-out env no longer exists · OPEN
- **Severity:** Medium · **Status:** OPEN (known; slightly worse — escape hatch removed) · **W1:** 3/6 (graded High) · **W2:** 3/3 · **Area:** docs-ui
- **Location:** `packages/docs-ui/src/index.ts:107`; `register.ts:19` (auto-mounts unconditionally, no `authorize` hook).
- **Detail:** Gate is `NODE_ENV === 'production' && !enabledInProd` — an internet-reachable staging host without `NODE_ENV=production` serves the full API catalogue to anonymous callers. The `LUCKYSTACK_DOCS_UI_DISABLE_AUTOMOUNT` opt-out the wave-1 merge cited NO LONGER EXISTS (grep=0). The JSON 404 also discloses the absolute filesystem path (`expectedAt`, docs-ui #8).
- **Fix:** fail-closed for non-loopback binds unless explicitly enabled; add a required `authorize?: (req)=>boolean` hook when `enabledInProd`; gate `expectedAt` behind dev.

### M-17 — Login-absent double-submit CSRF token is unsigned / not `__Host-`-hardened → sibling-subdomain/MITM cookie-injection bypass · OPEN
- **Severity:** Medium (r3,r6) / Low (r2) · **Status:** OPEN (known) · **W1:** 3/6 (4/6 server-area) · **W2:** corroborated (server O16) · **Area:** server / core
- **Location:** `csrfRoute.ts:30-37`; `csrfMiddleware.ts:53-73` (`provided === cookieValue` echo, :57).
- **Detail:** A plain `randomBytes` cookie accepted when `cookie===header`; nothing enforces `__Host-`/`SameSite=Strict`. A cooperating/compromised sibling subdomain (or MITM on a non-HTTPS subpath) can set a parent-domain `csrf-token` cookie and forge a matching header. Session-bound (login-present) path unaffected. Note: a `timingSafeStringEqual` helper + test were ADDED this week but are imported NOWHERE in prod (server O3) — a misleading dead surface.
- **Fix:** HMAC-sign the double-submit token with a server secret, or `__Host-`-prefix + `SameSite=Strict` the CSRF cookie by default; route the three CSRF/test-reset compares through the unused `timingSafeStringEqual` or delete it.

### M-18 — State-changing custom routes (`registerCustomRoute` POST) + `/auth/callback` fall outside the CSRF gate · OPEN
- **Severity:** Medium · **Status:** OPEN (known) · **W1:** 4/6 · **W2:** 2/3 · **Area:** server / core
- **Location:** `csrfMiddleware.ts:24,32-40` (`looksLikeFrameworkRoute` matches only `/api/`,`/sync/`,`/auth/api/`); `authCallbackRoute.ts:43-46`; name-inferred `get*`/`fetch*`/`list*` GETs are CSRF + origin exempt.
- **Detail:** Cookie-auth custom mutating routes rely solely on the origin gate (nothing warns at registration); the `/auth/callback` exemption relies on `@luckystack/login` validating OAuth state; a side-effecting `get*` route (e.g. `getAndRotateToken_v1`) bypasses CSRF and is callable header-less. Pairs with M-19.
- **Fix:** extend CSRF to non-exempt custom POST by default with per-route opt-out; gate exemptions on the actual `sessionCookieSameSite==='Strict'`; surface in `ai:lint` that `get*`/`list*` GETs must be side-effect-free.

### M-19 — HTTP-method gate (`httpMethod`) enforced ONLY on the HTTP transport — a read-only/GET route is mutating over the socket · OPEN
- **Severity:** Medium · **Status:** OPEN (known) · **W1:** 1/6 · **W2:** 3/3 · **Area:** api
- **Location:** `handleHttpApiRequest.ts:393-407` (gate) vs `handleApiRequest.ts` (no method check anywhere); client `apiRequest` sends no method over sockets.
- **Detail:** A `GET`/read-only route (or one named `getX`/`listX` to infer GET) is fully callable + mutating over the websocket by any authenticated client, while docs assert "both transports execute the same sequence." Pairs with M-18's GET-CSRF-exemption: the naming convention silently sets a route's security posture. (Run-4's "HIGH transport-asymmetry vuln" framing was self-disputed — method is a CSRF/HTTP-semantics control, not an authz boundary; the socket is origin-gated + runs `readSession`+auth per message — so the real concern is the route-authoring hazard, kept Medium.)
- **Fix:** document the asymmetry loudly, or enforce method on the socket; refuse GET inference for `auth.login:true` without explicit `httpMethod:'GET'`.

### M-20 — Object/`Record` input boundary does not reject prototype-polluting keys at the request gate (request-side residual) · OPEN
- **Severity:** Medium · **Status:** OPEN (known; the validator-internal half is now FIXED) · **W1:** 1/6 · **W2:** carried · **Area:** api / core
- **Location:** body parsed with raw `JSON.parse`; `getParams`/`validateApiMessage`.
- **Detail:** `validateType` now rejects `__proto__`/`constructor`/`prototype` (core F3, FIXED) and `deepMerge` strips them, but a `Record`-typed route's `data` still reaches the handler with these keys present if app code deep-merges/assigns without the guard — a defense-in-depth gap at the request gate. Reduced from wave-1 (the validator no longer admits them blanket).
- **Fix:** strip/reject `__proto__`/`constructor`/`prototype` own-keys in `getParams`/`validateApiMessage`.

### M-21 — `system/logout` socket shortcut bypasses the response-hook chain + per-route rate-limit; always reports `success:true` · OPEN
- **Severity:** Medium · **Status:** OPEN (known) · **W1:** 5/6 (api-area) · **W2:** 3/3 · **Area:** api
- **Location:** `packages/api/src/handleApiRequest.ts:452-459`.
- **Detail:** Emits a hand-built `{status:'success',httpStatus:200,result:true}` directly via `socket.emit`, skipping `emitApiResult`/`preApiRespond`/`transformApiResponse`/`applyErrorFormatter`/`postApiRespond` (audit log, response signing/redaction) and the per-route rate-limit bucket (logout is spammable; only the global IP cap applies, uncapped when `defaultIpLimit:false`); `performLogout`'s real status is discarded. Pre-auth, takes a caller-supplied token. (The documented `applyGlobalIpRateLimit` cap it should use does not exist — api O1 shadow-API.)
- **Fix:** route logout through `emitApiResult`/the normal hook chain; reflect `performLogout`'s status; apply a small dedicated IP-keyed bucket independent of `defaultIpLimit`.

### M-22 — Secret-manager defaults POST every pointer-shaped inherited env value off-host (response/error caps now FIXED) · OPEN
- **Severity:** Medium · **Status:** OPEN (known) · **W1:** 3/6 · **W2:** 3/3 · **Area:** secret-manager
- **Location:** `index.ts:254` (`toNameFilter(undefined)`→`()=>true`), `:286-289` (`capturePointers` scans all `process.env`), `:524-528` (re-capture on empty re-runs the full scan, SM-N5).
- **Detail:** With `envNames` unset, `capturePointers` walks all `process.env` and POSTs anything matching `^(.+)_V(\d+)$` (e.g. `RELEASE_TAG=build_2024_V2`) off-host (default-allow is the footgun). The unbounded response body + raw error log are now FIXED (`MAX_RESOLVE_BODY_BYTES = 1 MiB` streamed cap; `errorMessage(error)`). Validator accepts userinfo in the `url` (SM O2, Low — URL-embedded creds bypass the bearer-token contract). Otherwise one of the cleanest modules; fail-open on unset URL is confirmed by-design (FP-1).
- **Fix:** require `envNames` (or restrict the default scan to `.env`-sourced names) + boot-warn; reject `parsed.username||parsed.password` in `validateUrl`.

### M-23 — `resolveSender` silently falls through when an EXPLICITLY-requested email `adapter` is unregistered → silent mis-delivery of security mail · OPEN
- **Severity:** Medium · **Status:** OPEN (known) — also DD-9 (explicit-vs-hint policy) · **W1:** 5/6 · **W2:** 2/3 · **Area:** email
- **Location:** `packages/email/src/sendEmail.ts:64-76`.
- **Detail:** `if (input.adapter){ const named=getEmailSenderByName(input.adapter); if(named) return named; /* fall through */ }` — routes through default (or `ConsoleSender` in a misconfigured prod box) while the caller sees `{ok:true}`. Confused-deputy / silent mis-delivery for security mail (login passes `adapterHint:'transactional'`).
- **Fix:** distinguish explicit `adapter` (warn / `{ok:false,reason:'unknown-adapter'}` in strict mode) from best-effort `adapterHint` (keep silent fall-through).

---

## LOW (actionable)

### L-1 — Dev REPL exposes session enum/read/delete + `console.log`s full session objects (tokens/PII), gated only on `NODE_ENV` · OPEN
- **W1:** 6/6 (root-server) / 3/6 (merge) · **W2:** 3/3 · **Area:** root-server
- **Location:** `server/utils/repl.ts:43-61`; gate `server/server.ts:72`. A single unset env flag turns a staging box into a live session-dump console.
- **Fix:** explicit `LUCKYSTACK_REPL=1` opt-in (or `NODE_ENV==='development'` only); redact the token field; hard-fail the prod runbook when `NODE_ENV` is unset.

### L-2 — Two committed `console.log(filePath)`/`console.log(rootFolder)` on the production static-serve hot path (FS-path disclosure into logs) · OPEN/NEW
- **W1:** new · **W2:** 2/3 · **Area:** root-server
- **Location:** `server/prod/serveFile.ts:57-58` (present in HEAD) — run for EVERY asset/probe request, disclosing absolute FS paths.
- **Fix:** delete both lines or gate behind `config.logging.devLogs` + `getLogger().debug`.

### L-3 — Source-disclosure denylist branch returns `res.end("Forbidden")` with NO `writeHead` → defaults to HTTP 200 · OPEN/NEW
- **W1:** new · **W2:** 1/3 · **Area:** root-server
- **Location:** `server/prod/serveFile.ts:88` (vs the 403 traversal branch :62). Caches/CDNs may treat the disclosure-block response as cacheable success.
- **Fix:** `res.writeHead(403, {'Content-Type':'text/plain'})` before `res.end('Forbidden')`.

### L-4 — `serveFile` path-containment guard uses `startsWith(rootFolder)` without a trailing separator (sibling-prefix) · OPEN
- **W1:** 6/6 (latent) · **W2:** 3/3 · **Area:** root-server / core
- **Location:** `server/prod/serveFile.ts:60`; consumer `serveFile.ts:57`. A sibling `dist-secret/` satisfies `startsWith('/app/dist')`. NOT exploitable today (normalize→strip-`..`→re-anchor); latent if normalization is refactored.
- **Fix:** `=== root || startsWith(root + path.sep)`, or `path.relative(root, filePath)` + reject `..`/absolute.

### L-5 — Password-reset / email-change tokens travel in the URL query string + are stored UN-hashed in Redis + auto-consumed on mount · OPEN
- **W1:** 3/6 (query-string) / 1/6 (un-hashed) · **W2:** 1/3 + 3/3 · **Area:** root-src / login
- **Location:** `src/reset-password/page.tsx:12` + `src/settings/confirm-email/page.tsx:14` read `?token=`; `passwordReset.ts:34` + `emailChange.ts:32` use the raw 64-char token as the Redis key. Query-string credential lands in access logs / history / `Referer`, never `replaceState`-stripped; a Redis dump exposes directly-replayable live tokens. confirm-email auto-consumes the token on page mount (root-src O7) — link-prefetchers/AV burn it before the human clicks; no prior-token invalidation on re-issue (login F16). Wave-2 reframes the query-string half as Low (standard email-link design), bounded by single-use TTL.
- **Fix:** deliver in `#token=` fragment + `replaceState`-strip (or `?code=`-for-token over POST); store `sha256(token)` as the key; require an explicit confirm-button click; invalidate prior tokens on issue. (A shared hashed-at-rest `oneTimeToken` core primitive closes all of these.)

### L-6 — OAuth `loginCallback` redirect allowlist treats `/\`-prefixed relative paths as same-origin (open-redirect edge) · OPEN
- **W1:** 2/6 · **W2:** carried · **Area:** login
- **Location:** OAuth `OA-2`. The general backslash case is now FIXED (login F12: `if (url.includes('\\')) return false`); this is the residual `/\` edge / regression-test gap. `isAllowedRedirectUrl` is otherwise a verified fail-closed allow-list.
- **Fix:** keep the backslash reject before the same-origin shortcut; detect relative via `URL.canParse` without a guessable placeholder origin; add a validator regression test.

### L-7 — `escapeHtml` only safe for text/quoted-attribute contexts; JSDoc over-broad · OPEN
- **W1:** 3/6 · **W2:** 2/3 · **Area:** core / docs-ui / email
- **Location:** `packages/core/src/escapeHtml.ts:10-20`. Escapes only the five canonical entities — unsafe for unquoted attributes / URL / JS / CSS — while the JSDoc frames it as the source of truth, inviting the M-12 email + docs-ui CSS-injection sites downstream. docs-ui `branding.brandColor`/`fontFamily` are interpolated raw into inline `<style>` (docs-ui #9, config-trust today).
- **Fix:** tighten the JSDoc to "ONLY safe in quoted-attribute / text contexts"; provide context-specific helpers; validate docs-ui branding fields.

### L-8 — Translation/error-normalizer interpolates `param.key` raw into `new RegExp` (latent ReDoS / regex-injection + `$`-substitution corruption, 3 copies) · OPEN
- **W1:** 2/6 · **W2:** 3/3 · **Area:** core / root-server
- **Location:** `server/utils/responseNormalizer.ts:87-88`; `packages/core/src/react/TranslationProvider.tsx:92-97`; ui-builder prototype. All build `new RegExp(\`{{${param.key}}}\`)` with no `escapeRegExp` + `$`-interpreting `String.replace`. Latent today (every producer passes a literal key); the next error code echoing a user field name as the key makes it live (`(` → uncaught `SyntaxError` on the error path = DoS; `$&` corrupts the message). The r5 ReDoS sweep otherwise found the codebase clean.
- **Fix:** `finalResult.replaceAll(\`{{${param.key}}}\`, () => String(param.value))`; promote a shared `escapeRegExp`; fix the TranslationProvider client twin.

### L-9 — Test-runner webhook POSTs the full summary with no SSRF guard (warning added; URL unvalidated) · OPEN
- **W1:** 2/6 · **W2:** — · **Area:** test-runner
- **Location:** `runRegisteredLayers.ts:35-57`. A plaintext-http-to-non-loopback `console.warn` was ADDED this week (test-runner #32 FIXED), but the runtime is still unwired (#3) and the URL is not hard-validated; metadata is forwarded verbatim to any reporter `webhookUrl`. Consumer-configured.
- **Fix:** document the bearer `webhookAuth` slot + that metadata is forwarded verbatim.

### L-10 — mcp `readDocFile` containment guard is lexical (case-sensitive, no symlink/realpath) · OPEN
- **W1:** 3/6 · **W2:** 2/3 · **Area:** mcp
- **Location:** `packages/mcp/src/artifacts.ts:38-41`. A guard now EXISTS (null-byte reject + `path.relative` escape reject — mcp #20 FIXED). Residual: case-insensitive FS mis-compare + a symlink inside root pointing outward passes. Defense-in-depth only — every real caller passes a hardcoded literal; the re-export means a future consumer tool COULD forward user input.
- **Fix:** `fs.realpath` both root + target + case-normalize before the prefix compare, IF/when user input can reach it.

### L-11 — PostHog/Datadog distinctId is the raw user-id with no anonymization toggle · OPEN
- **W1:** 1/6 · **W2:** carried · **Area:** error-tracking
- **Location:** `sendUserEmail:false` suppresses email but the distinctId/`usr.id` is always the raw `user.id`; a deployment may wrongly assume identity is anonymized.
- **Fix:** document that `sendUserEmail:false` only redacts email, or add a `pseudonymizeUserId`/`distinctIdHash` option.

### L-12 — Browser-MCP servers wired unpinned (`@playwright/mcp@latest`, `chrome-devtools-mcp@latest`, now also `@luckystack/mcp@latest`) — supply-chain drift · OPEN
- **W1:** 2/6 · **W2:** 3/3 (worse: now uniform `@latest`) · **Area:** cli / devkit / scaffolder
- **Location:** `wireAiBrowserTooling` (`--ai-browser=all`); scaffolder `src/index.ts:1124-1125,1572`. The wave-1 "pinned `@luckystack/mcp` counter-example" no longer exists. Opt-in + `permissions.ask`-gated, dev-tools only.
- **Fix:** pin to `^${luckystackVersion}` (first-party) / a known-good range, or document the deliberate exemption.

### L-13 — `deleteAccount` / legacy raw-`redis` ordering + adapter-bypass edges · OPEN/NEW
- **W2:** 1/3 · **Area:** login / root-src
- **Location:** `deleteAccount_v1.ts:59-62` wipes sessions + raw `redis.del(activeUsersKeyFor)` BEFORE the `adapter.delete` that can throw (user signed out of a still-existing account; raw del leaks the active-set on a non-Redis adapter); legacy `sessionKeyFor`/`activeUsersKeyFor` exports drive consumer routes to bypass the `SessionAdapter` (login F39). Report-without-auto-fix bucket.
- **Fix:** delete first (or wrap), route active-set cleanup through the adapter; provide adapter-level `listActiveWithMeta`/handle-resolver primitives.

### L-14 — Provider `getAvatar` path-injection watch-item (Discord/Microsoft now FIXED) · OPEN
- **W1:** 2/6 · **W2:** — · **Area:** login
- **Status:** mostly FIXED — `oauthProviders.ts:270` (Discord), `:367` (Microsoft) now `encodeURIComponent`-wrapped. Retained only as a watch-item: any NEW provider added without the wrapper re-opens path-injection within the fixed host. Report-only.

---

# DEFERRED-DECISION (real, pending a policy / ADR / feature call)

These are the "default-insecure-by-design / 0.2.0 hardening" decisions and a few contract changes. Each is a conscious tradeoff — the decision is *whether* to change the default/contract, not whether the gap exists.

| # | Finding | Sev | W1 | W2 | Location | Decision needed |
|---|---|---|---|---|---|---|
| DD-1 | Sync receiver-auth secure-default flip (`requireRoomMembership:true`, `allowClientReceiverAll:false`) — 0.2.0 cross-package hardening (also actionable H-2) | High | 5-6/6 | 3/3 | `core/projectConfig.ts:773-774` + sync enforcement | Flip defaults for the 0.2.0 major (with opt-out) vs boot-warn + ship secure keys commented. Coordinate core ⇄ sync. |
| DD-2 | Rate-limiter fail-open defaults (`store:'memory'`, `onStoreError:'memory'`, `'deny'` Redis-only) — actionable M-8 | Med | 5/6 | 2/3 | `core/rateLimiter.ts:228-235` | Honor `'deny'` regardless of store / default `'deny'` for prod-Redis, vs keep availability-over-security + boot-warn. |
| DD-3 | `/_health` plain-hash default — actionable H-3 | Med | 1/6 (6/6 area) | 2/3 | `core/projectConfig.ts:703-706` | Default `'hmac'`/salted vs gate behind a router-probe token; either is a default change. |
| DD-4 | Cookie-mode Bearer fallback opt-in (`http.acceptBearerInCookieMode`) — actionable M-1 | Med | 4/6 | 1/3 | `core/extractTokenFromRequest.ts:30-34` | Make the cross-transport fallback opt-out (security) vs keep it (compat). |
| DD-5 | `requestEmailChange` `auth.emailTaken` authenticated enumeration oracle | Low | 4/6 | 3/3 | `requestEmailChange_v1.ts:42-48` | Accept (write an ADR; in-code comment documents the tradeoff, rate-limited 5/window) vs generic "confirmation sent if available". |
| DD-6 | Account-lockout as a remote DoS lever (email-only keyed, fires on non-existent accounts; distinct `accountLocked` reason re-opens enumeration) | Med | 3/6 | 1/3 | `login.ts:432-437`; `authLockout.ts` | Opt-in default-off; IP+account composite key / progressive delay vs hard refuse. (The password-policy AMPLIFICATION M-15 is a clear bug regardless.) |
| DD-7 | Router request-body size cap REMOVED at the edge (`maxRequestBodyBytes` gone); no edge deny-gate (`proxyRequestGate`) on either transport | Med | 1/3 (regr) / 3/3 (gate) | — | `router/httpProxy.ts:191`; `wsProxy.ts` (no hooks) | Re-introduce an edge body cap (config-driven 413) or document delegation to the backend; add a fail-CLOSED `proxyRequestGate` (banned-IP/maintenance/edge-auth) or document its absence. |
| DD-8 | Email send-timeout (none), ConsoleSender token redaction (none), CRLF defense-in-depth (none) — NEW features relative to the simplified tree | Low-Med | — | 1-2/3 | `packages/email/src/**` | Whether to add the hardening (the gaps are real: email O7/O8/O9). |
| DD-9 | Email `adapterHint` explicit-vs-hint policy (resolution of M-23) | Med | 5/6 | 2/3 | `sendEmail.ts:64-76` | Should an explicit-adapter miss fail/warn or silently fall through. |

---

# FIXED (verified resolved in current tree — compact)

The whole wave-1 CRITICAL/flagship cluster landed this week. Each was re-confirmed at file:line.

| # | Finding (wave-1 id) | Sev | W1 | Where fixed |
|---|---|---|---|---|
| F-1 | Router WS proxy listener-less client socket → unauth crash DoS (C-1) | Crit | 6/6 | `wsProxy.ts:59-64` `onClientGone` at top + `wsProxy.test.ts` RST regression |
| F-2 | Router WS proxy missing origin-form / host-pin → SSRF / open tunnel (C-1/S-1) | Crit | 4/6 | `wsProxy.ts:70-73,86-89` + `proxyUtils.ts:64-78` (`isOriginFormTarget`/`isHostPinned`) + tests |
| F-3 | `dist/server.js` / `*.map` source disclosure (C-2) | Crit→High | 4/6 | `staticRoutes.ts:14,43-47` `SERVE_DENYLIST_REGEX` + consumer denylist + sourcemaps default OFF. **Caveat:** guards UNCOMMITTED; bundle still emitted into `dist/` (allow-by-default model = OPEN server #2 / root-server #2). |
| F-4 | `validateType`/`validateInputByType` fails OPEN on unrecognized shapes (H-1) | High | 6/6 | `core/runtimeTypeValidation.ts:363-373` fail-CLOSED terminal; Record values + array elements validated; proto-keys rejected; `MAX_VALIDATION_DEPTH=64`; `safeValidateType` |
| F-5 | Sentry Session Replay masking OFF → PII to third party (H-2) | High | 6/6 | `src/_functions/sentry.ts:62-63` `maskAllText:true`+`blockAllMedia:true` + `beforeSend` strips token/code |
| F-6 | Unverified-OAuth-email account takeover under `unified` (H-3) | High | 6/6 | `login.ts:846` fail-closed cross-provider link guard; Google `email_verified`+v3, Discord `verified`, Microsoft UPN behind `allowUpnFallback:false` |
| F-7 | Session token from URL query string (`?token=`) → fixation/leak (H-4) | High | 4/6 | `src/page.tsx:13-26` branch removed; `//?` forbids re-adding; fragment-only in `main.tsx` |
| F-8 | Per-request error-tracker ALS identity never bound in prod (H-8, adapter path) | High | 6/6 | all 4 handlers open `runWithErrorTrackerIdentityScope` pre-await; PostHog+Datadog+Sentry read `getCurrentErrorTrackerIdentity()` |
| F-9 | sync HTTP `requireRoomMembership` bypass (H-7) | High | 6/6 | `handleHttpSyncRequest.ts:374` derives membership from session `roomCodes`; `receiverAuth.ts:64` fail-CLOSED on null |
| F-10 | Client-only sync routes skip auth + validation (H-11) | High | 2/6 | both transports reject `!syncObject[\`${name}_server\`]` with `sync.notFound` |
| F-11 | `ErrorPage` renders full JS stack in prod (H-10) | High | 3/6 | `src/_components/ErrorPage.tsx:37` `DEV ? error.stack : null`. **NOTE:** scaffolder template twin NOT propagated (scaffolder N2, OPEN) |
| F-12 | Playground unauth `streamToToken` + arbitrary-recipient `testEmail` (M-14) | High→Med | 3/6 | `streamToToken_server_v1.ts:36` `login:true`+`MAX_TARGETS=10`; `testEmail_v1.ts:35` hard-refuses `!dev` |
| F-13 | `validateType`/`sanitizeForLog` unbounded recursion (stack DoS) (M-3) | Med | 3/6 | `runtimeTypeValidation.ts:184` depth cap; `logSanitize.ts`/`redactedLogKeys.ts` `MAX_SANITIZE_DEPTH` + WeakSet |
| F-14 | Auth throttle ignored `http.trustProxy` (raw `remoteAddress`) (M-7) | Med | 4/6 | `authApiRoute.ts:95` `resolveClientIp({trustProxy})`; `resolveRequesterIp.ts` extracted |
| F-15 | `resolveSyncValidationMode` fail-open typo + array/non-object guard (M-20) | Med | 1-2/6 | `validationMode.ts:27` whitelist; `handleSyncRequest.ts:274` rejects arrays/null |
| F-16 | OAuth state-nonce `!==` non-constant-time (L-2) | Low | 4/6 | `login.ts:213-216` `timingSafeEqual` + length guard |
| F-17 | Secret-manager raw error-object log + unbounded resolve body (M-22 halves) | Med/Low | 3/6 | `errorMessage(error)` everywhere; `MAX_RESOLVE_BODY_BYTES=1 MiB` streamed cap + Content-Length pre-check |

---

# FALSE-POSITIVE (verified bogus / by-design — one line each)

| # | Claim | Why bogus |
|---|---|---|
| FP-1 | secret-manager fail-OPEN on unset URL / `local`/`hybrid` is a vuln | Confirmed deliberate, regression-tested, user-memory-backed; once `url` set + package installed it is fail-CLOSED (unresolved pointer throws). |
| FP-2 | SSRF beyond the router WS proxy | r5 gap-sweep: every server-side egress sink (boot handshake, OAuth exchange/profile, secret-manager resolve, health poller, provider sub-fetches) is config/provider-pinned; the WS proxy (now FIXED) was the ONLY request-controlled SSRF. |
| FP-3 | OAuth open-redirect / `redirect_uri` injection | `isAllowedRedirectUrl` is a fail-closed exact-origin allow-list; `redirect_uri` pinned to immutable `provider.callbackURL`. Only the `/\` backslash edge (L-6) warrants a guard. |
| FP-4 | `server.js.map` / `.env` / runtime-secret disclosure via the static bug | `.map` 404s; `.env` secrets are env-injected at runtime, not inlined into the esbuild bundle. Only application source (`server.js`) could leak — now denylisted. |
| FP-5 | server `registerErrorFormatter` is a dead "shadow API" | Relocated to `@luckystack/core`; `applyErrorFormatter` IS called in api/sync handlers (`handleApiRequest.ts:355,420`, `handleHttpApiRequest.ts:133`, sync `errorBuilders.ts:69`). The scan grepped only the server package. |
| FP-6 | Socket transport enforces no HTTP method = HIGH transport-asymmetry vuln | Method is a CSRF/HTTP-semantics control, not an authz boundary; the socket is origin-gated + runs `readSession`+auth per message; docs state method is HTTP-only. Real residual is the route-authoring hazard, kept as M-19, not a vuln. |
| FP-7 | Template `updateUser_v1` "persist arbitrary theme/language" | `language`/`theme` are Prisma DB ENUMs; an out-of-enum value throws `PrismaClientValidationError` before the write. Only a low consistency/drift gap remains. |
| FP-8 | `updateUser` `LANGUAGE_RE` "session-language poisoning" | The regex accepts `zz`/`xx-YY` but blast radius is the attacker's OWN session (self-inflicted fallback-translation) — validator-tightness, not security. |
| FP-9 | Email `sanitizeHeaderMap`/`withSendTimeout`/`redactUrlSecrets`/`safeColor`/`safeCtaUrl` defects | Phantom code — none of these symbols ever existed in git history (wave-1 audited a hallucinated `sendEmail.ts`). The genuine residuals (no CRLF defense, no timeout, raw ConsoleSender, raw ctaUrl/accent) are re-characterized as OPEN/DEFERRED (M-12, email O7/O8/O9). |
| FP-10 | Router `proxyRequestGate` deny-gate "fails open on throw" / "never applied to WS" | The gate the baseline assumed NEVER existed (`grep proxyRequestGate` = 0). No fail-open to fix; the real "no edge deny capability" gap is DD-7. |
| FP-11 | Consumer `src/_functions/sentry.ts` replay PII leak (carried by some wave-2 top-level runs) | Self-refuted on re-trace: `:62-63` sets `maskAllText:true`+`blockAllMedia:true`+token/code strip; `replaysOnErrorSampleRate=1` is a volume knob. = FIXED F-5, not open. |

---

## Top action items (highest confidence × impact)

1. **N-1 / N-2** — kill the two NEW unauth process-crash DoS paths (`serveFile` `%`-decode + `getParams` request-stream error) AND add the missing global `process.on('unhandledRejection')` + `.catch()` on the voided `handleHttpRequest`. The only remaining remote-unauth crashers.
2. **H-1 (router upstream-leg no-timeout)** — add `routing.upstreamTimeoutMs` + WS handshake watchdog; the surviving router DoS.
3. **N-3 / N-4 / M-4 / M-5 / M-6 / M-7** — the credential-leak cluster: stop keying rate-limit on the raw token, wire `redactToken`, sanitize the legacy-Sentry slot (one ADR closes M-4/M-5 + the double-capture), value-scrub error.message/stack, and widen `redactedLogKeys`.
4. **H-2 / DD-1** — flip sync receiver-auth secure-by-default for 0.2.0 (cross-package ADR). The headline 0.2.0 hardening item.
5. **H-3 / DD-3** — fix the dead `@bootUuid` salt and default `/_health` to hmac/salted or gate behind a router token.
6. **H-5 / H-6** — the consumer-facing twin-drift duo: fix credentials self-delete end-to-end (extend `menuHandler.confirm`) and route session handlers through `sessionKeyFor`; back both with an `ai:check-template-drift` CI gate.
7. **H-4 (preEmailSend no-op) / H-7 (flush-on-shutdown)** — wire the two unwired-security-control shadow-APIs that silently drop suppression decisions and buffered telemetry.
8. **N-7 / N-8 (test-runner CSRF)** — wire the CSRF-enforcement sweep layer + thread the session CSRF token so the default sweep actually exercises CSRF.
