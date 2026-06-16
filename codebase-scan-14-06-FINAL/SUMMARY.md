# MASTER SUMMARY — Combined Codebase Scan (wave-1 x6 + wave-2 x3)

> Executive picture for the COMPLETE deliverable: **wave-1** (6 independent full-repo scans of commit `302cbf1`) + **wave-2** (3 reconciliation re-scans of the current working tree), reconciled against the code **as it stands now** — branch `chore/package-split-prep`, HEAD `302cbf1` + ~248 uncommitted "this-week" fixes. Date: 2026-06-15.
>
> Detail lives in the five category reports: `SECURITY.md`, `BUGS.md`, `CODE_QUALITY.md`, `FEATURES.md`, `REFACTOR_ROADMAP.md`, grounded in the 18 tree-verified `per-area-reconciled/*.md` files. This file is the one-page top-of-funnel: what is genuinely still open, and what blocks v0.2.0.
>
> **Reconciliation discipline:** every wave-2 "fixed/present" verdict was independently re-confirmed by opening the cited file at the cited line in the live tree — no status was trusted on faith.

---

## 0. UPDATE — post-reconciliation fix pass (2026-06-15)

> After this reconciliation was written, a behavior-preserving fix pass closed **10 of the blockers below** (build/lint/ai:lint green, 1130 unit tests pass). The §1 shortlist is the *pre-fix* snapshot; these are now **FIXED in-tree**:
> **DOCSUI-1** (renderer reads flat shape), **N-1** (serveFile decode guard), **N-2** (getParams stream-error), **N-3** (rate-limit key hashed, not raw token), **N-4** (token no longer leaks to error-tracker/logs), **H-1** (proxy upstream timeout), **H-4** (preEmailSend stop-signal honored), **H-5/H-6** (credentials self-delete + framework Redis keys), **N-7** (CSRF layer wired into the sweep).
>
> **Still genuinely OPEN = decision/feature items only**: H-3 (`/_health` secret-fingerprints — policy), H-7 (graceful shutdown + flushErrorTrackers — MIS-016 feature), H-2/DD-1 (permissive sync receiver-auth default — the 0.2.0 secure-default flip), M-15 (login-lockout DoS reorder), plus the wave-1 bucket-1/2 policy/contract decisions. All await user decisions.

---

## 1. The headline (the only thing that matters for v0.2.0)

**This week's pass genuinely closed the entire wave-1 CRITICAL + flagship-HIGH cluster. NO CRITICAL survives** (the lone NEW critical is dev-only — see below). All three wave-1 cross-repo CRITICALs are verified FIXED in-tree:

- **Router WS-proxy listener-less crash** (C1, unauth DoS, the most-corroborated finding at 6/6) — `wsProxy.ts:59-64` reaps the client socket on `error`/`close` at the top, + RST regression test.
- **Router WS-proxy SSRF / open tunnel** (C3) — `isOriginFormTarget` 400s + `isHostPinned` 502s before any upstream connect, + tests.
- **GET /server.js / *.map source disclosure** (C2) — `SERVE_DENYLIST_REGEX` 404s both before `serveFile`; sourcemaps default off. (Caveat: guards uncommitted; bundle still emitted into `dist/` — the allow-by-default static model survives as an OPEN MEDIUM.)

Alongside them the whole flagship-HIGH band closed and was line-verified: `validateType` fail-OPEN to fail-CLOSED; Sentry replay masking on; `?token=` query-string adoption removed; error-tracker ALS identity bound in prod (adapter path); HTTP `requireRoomMembership` bypass + client-only-route auth gap; OAuth unverified-email account-takeover under `unified`; the OAuth nonce timing compare; the avatar-stream crash; the auth-throttle XFF trust fix.

**What actually blocks v0.2.0 is a much smaller, different set** than wave-1 implied — dominated by **two NEW unauth process-crash DoS paths the in-flight fixes left exposed**, the **surviving router upstream-leg no-timeout**, a **credential-leak cluster** (raw tokens in rate-limit keys / error-tracker context), and two **unwired security-control "shadow-APIs"** (`preEmailSend` suppression no-op, `flushErrorTrackers` never wired into shutdown). Plus the one dev-only NEW critical (docs-ui renderer).

### Genuinely STILL-OPEN / NEW — the v0.2.0 blocker shortlist (ordered by priority)

| # | Sev | Status | ID | What | Location |
|---|---|---|---|---|---|
| 1 | HIGH | NEW | N-1 | Unauth single-request process crash: `serveFile` runs `decodeURIComponent(url)` unguarded; `GET /assets/%ZZ` to URIError to unhandled rejection to worker exit. No `process.on(unhandledRejection)` anywhere; voided `handleHttpRequest` has no `.catch`. | `server/prod/serveFile.ts:54`; `staticRoutes.ts:50-58`; `createServer.ts:194-195` |
| 2 | HIGH | NEW | N-2 | Same crash CLASS, distinct path: `getParams` request-stream `error` rejects (`req.on(error, reject)`); a client RST mid-body on POST/PUT/DELETE to unhandled rejection to worker crash. | `core/getParams.ts:111-113`; `server/httpHandler.ts:190`; `createServer.ts:195` |
| 3 | HIGH | OPEN/NEW | H-1 | Router WS **and** HTTP upstream leg has NO timeout (`transport.request` passes none; grep=0). A backend that accepts TCP but never answers pins both sockets indefinitely to resource-exhaustion DoS, unauth-reachable on the WS path via a stalled `system` backend. (wave-1 only caught the now-fixed client-disconnect leg.) | `router/wsProxy.ts:96-119`; `httpProxy.ts:96-119` |
| 4 | HIGH | NEW | N-3 | Per-route rate-limit bucket keyed on the **RAW SESSION TOKEN** to token verbatim in Redis key names + the dev warn log; contradicts the CLAUDE.md "never the raw token" invariant. | `api/handleApiRequest.ts:141-143,162`; `handleHttpApiRequest.ts:318-320` |
| 5 | HIGH | NEW | N-4 | Dead `redactToken` helper + raw bearer token leaks to the error-tracker context: `clientFanout.ts:111` passes raw `targetToken` into the `tryCatch` error-context (to `captureException`); neither key is in `DEFAULT_REDACTED_LOG_KEYS`. Not dev-gated. | `sync/_shared/redactToken.ts` (dead); `clientFanout.ts:111`; `streamEmitters.ts:222-223` |
| 6 | HIGH | OPEN | H-3 | Unauthenticated `/_health` publishes unsalted `sha256(secret)` env fingerprints + raw `bootUuid` + `envKey` by default (`healthHash.mode:plain`); the `@bootUuid` salt mitigation is **dead** on this caller. | `server/healthRoutes.ts:80-89`; `projectConfig.ts:703-706` |
| 7 | HIGH | OPEN/NEW | H-4 | `preEmailSend` stop-signal IGNORED — `sendEmail` discards the `DispatchResult`, never checks `.stopped`. A GDPR opt-out / unsubscribe / bounce suppression list ships as a silent no-op; suppressed recipients still get mail, `sendEmail` returns `{ok:true}`. Docs advertise it as live. | `email/sendEmail.ts:199-204` |
| 8 | HIGH | OPEN | H-5 | Credentials user can NEVER self-delete — server requires a password the UI never sends to always `login.wrongPassword` (GDPR right-to-erasure break). Present in consumer `src/`, the shipped CLI asset, AND the scaffolder template; the route's own test passes `password` directly so it stays green. | `src/settings/page.tsx:271-289`; `deleteAccount_v1.ts:29-33` (x3 surfaces) |
| 9 | HIGH | OPEN | H-6 | Consumer `src/settings/_api/*` session handlers hand-build Redis keys with `process.env.PROJECT_NAME`, bypassing `sessionKeyFor`/`activeUsersKeyFor` to silent multi-tenant / config-divergence break. The shipped CLI asset is correct; consumer `src/` is the regressed twin. | `src/settings/_api/{listSessions,revokeSession,deleteAccount}_v1.ts` |
| 10 | HIGH | OPEN | H-7 | `flushErrorTrackers()` never wired into server shutdown — `createServer` lost graceful `stop()`; only dev-only `process.exit(0)` handlers exist. Buffered PostHog/Sentry events dropped every redeploy; Redis pub/sub + sockets never drained. | `server/createServer.ts:70-71,194-206`; `errorTrackerRegistry.ts:175-186` |
| 11 | HIGH | OPEN | M-15 | Login lockout amplified into a remote DoS: full password-policy validation runs on the LOGIN branch AND policy-failure trips the per-account lockout counter to an attacker locks ANY victim by POSTing policy-violating passwords for their email (no real-password guess). | `login.ts:316->:532`; `authLockout.ts:84-89` |
| 12 | HIGH | OPEN | H-2 / DD-1 | Default sync receiver-auth is fully permissive (`allowClientReceiverAll:true`, `requireRoomMembership:false`) to any client may broadcast to all or unjoined rooms (cross-tenant fanout). The HTTP-bypass + client-only-route halves are now FIXED; this surviving permissive-default posture is also the headline **0.2.0 secure-default flip** (DD-1). | `core/projectConfig.ts:773-774`; `sync/_shared/receiverAuth.ts` |

> **Dev-only NEW CRITICAL (not an end-user/security breach, but a 0.2.0 publish-blocker):** the docs-ui shipped renderer reads the WRONG artifact shape — it iterates a NESTED `apis[page][name][version]` map while the emitter + committed `apiDocs.generated.json` are FLAT `apis[page] = Entry[]`. Every route renders as scrambled rows, syncs never render, the correct renderer (`renderCore.ts`) is dead code, and a wrong-shaped test fixture keeps CI green over the broken path. Dist ships the bug. Blast radius is dev-only (`enabledInProd:false` default), so it is recorded outside the cross-repo CRITICAL column — but it blocks publishing working docs-UI. `docs-ui/docsHtml.ts:339-342` vs `devkit/emitterArtifacts.ts:62,269,281`.

After this shortlist, the actionable remainder is Medium/Low: leak-cluster widening (`M-4`/`M-5` legacy-Sentry raw-context + identity bleed, `M-6` PostHog/Datadog message scrub, `M-7` redacted-key-set gaps), the test-runner CSRF coverage gap (`N-7`/`N-8`), twin-drift correctness (api/sync, socket/HTTP, src/template/asset), the default-insecure-by-design 0.2.0 hardening ADRs (`DD-1`..`DD-9`), god-function decomposition, and proposed new framework primitives — **none v0.2.0-blocking**.

---

## 2. NEW criticals/highs wave-2 caught that wave-1 missed

Wave-2's value was finding regressions the in-flight fixes themselves introduced plus gaps all 6 wave-1 runs missed — every one re-verified against the current tree:

| ID | Sev | What wave-2 caught that wave-1 did not | Location |
|---|---|---|---|
| DOCSUI-1 | **CRITICAL** (dev-only) | docs-ui live renderer walks the WRONG artifact shape (nested vs flat array) to every route garbled, syncs never rendered, correct `renderCore.ts` is dead code, a fictional fixture keeps CI green. The package's sole function is broken; dist ships it. | `docs-ui/docsHtml.ts:339-342` |
| N-1 | HIGH | Unauth `decodeURIComponent` process-crash DoS in `serveFile` (`GET /assets/%ZZ`) — no `unhandledRejection` backstop anywhere. | `serveFile.ts:54` |
| N-2 | HIGH | `getParams` request-stream `error` reject to worker crash on a client RST mid-body (same class as N-1, distinct path). | `core/getParams.ts:111-113` |
| H-1 | HIGH | Router upstream leg (WS + HTTP) has NO timeout to half-open pair accumulation; wave-1 only caught the now-fixed client-disconnect leg. | `router/wsProxy.ts:96-119` |
| N-3 | HIGH | Per-route rate-limit bucket keyed on the raw session token (in Redis keys + dev logs); refutes the wave-1 "key never contains the token" baseline. | `api/handleApiRequest.ts:141-143` |
| N-4 | HIGH | Dead `redactToken` helper while raw bearer tokens reach the error-tracker context (un-gated). | `sync/clientFanout.ts:111` |
| H-4 | HIGH | `preEmailSend` stop-signal ignored — suppression seam is a silent no-op (wave-1 audited a phantom file). | `email/sendEmail.ts:199-204` |
| B7 / API-O1 | HIGH | api `packages/api/CLAUDE.md` documents a hook+helper+config surface absent from code (`apiAuthRejected`, `preSocketMessage`, `applyGlobalIpRateLimit`, `rateLimiting.identity`, `skipLoopbackInDev` — all grep=0). | `packages/api/CLAUDE.md` vs `api/src/*` |
| N-7 | MED | test-runner CSRF-enforcement layer fully built + tested but never exported / never run to default `npm run test` gives ZERO CSRF coverage. | `test-runner/index.ts`; `runAllTests.ts:88-133` |

**The docs-ui renderer/emitter verdict (the one notable FALSE-POSITIVE to record):** the wave-2 run-3 claim that `registerErrorFormatter` is a "shadow API never consulted by any framework error path" is **bogus (FP-5)** — a stale-scope grep that only searched the server package. The registry was relocated to `@luckystack/core`; `applyErrorFormatter(...)` IS called in `api/handleApiRequest.ts:355,420`, `api/handleHttpApiRequest.ts:133`, and `sync/_shared/errorBuilders.ts:69`, so a consumer's registered formatter does reach the api/sync error envelopes. No action. The genuine docs-ui defect is the renderer artifact-shape mismatch above (DOCSUI-1), not the emitter/formatter wiring.

---

## 3. Counts by status (across both waves, reconciled)

Each category report deduplicates the same issue to one row across both waves; totals differ because the reports cover different lenses (security exploits vs crash/correctness bugs vs maintainability vs capability gaps vs the unified roadmap). The **REFACTOR_ROADMAP** is the closest thing to a single combined universe.

| Report | NEW | OPEN | DEFERRED-DECISION | FIXED | FALSE-POSITIVE | Total distinct |
|---|---:|---:|---:|---:|---:|---:|
| SECURITY | 13 | 38 | 9 | 17 | 11 | 88 |
| BUGS | 14 | 78 | 13 | 70 | 18 | 193 |
| CODE_QUALITY | 29 | 52 | 15 | 27 (groups) | 16 (groups) | 139 |
| FEATURES | 9 | 31 | 10 | 9 | 7 | 66 |
| **REFACTOR_ROADMAP** (unified universe) | **43** | **107** | **21** | **81** | **30** | **282** |

By severity, the actionable (NEW + OPEN) set in the unified roadmap:

- **CRITICAL: 1 — dev-only** (docs-ui renderer artifact-shape mismatch). **Zero end-user/security criticals remain open.**
- **HIGH: ~21** — headline = N-1/N-2 (unauth process-crash DoS), H-1 (router upstream timeout), the N-3/N-4/M-4/M-5/M-6/M-7 credential-leak cluster, H-3 (`/_health`), H-4 (`preEmailSend`), H-5/H-6 (consumer twin-drift), H-7 (flush-on-shutdown), M-15 (login-lockout DoS), H-2/DD-1 (sync receiver-auth flip).
- **MEDIUM / LOW: the long tail** — twin-drift correctness, shadow-API wiring, redaction widening, god-function decomposition, the 0.2.0 hardening ADRs, and missing primitives. None blocking.

> The whole wave-1 CRITICAL/flagship cluster (2 cross-repo CRITICALs + 8 flagship HIGHs in SECURITY; 3 CRITICALs + 16 HIGHs in BUGS) is now **FIXED** in-tree and line-verified.

---

## 4. What changed since wave-1

- **All wave-1 CRITICALs closed.** Both router wsProxy CRITICALs (crash C1, SSRF C3) and the /server.js source-disclosure (C2, mitigated at the deny-list) are FIXED — including the **router package itself**, which IS re-verified in the FINAL reconciliation (`per-area-reconciled/router.md` + `wsProxy.test.ts`). No CRITICAL survives except the dev-only docs-ui renderer wave-2 found.
- **Most of the wave-1 HIGH band closed** (line-verified): validator fail-CLOSED + Record/array/proto hardening + depth cap; Sentry replay masking; `?token=` removal; error-tracker ALS scope (adapter path); HTTP/SSE `requireRoomMembership` + client-only-sync rejection; OAuth unverified-email link guard; OAuth nonce timing compare; avatar-stream crash; auth-throttle `trustProxy`.
- **The in-flight fixes introduced fresh regressions wave-2 caught:** the two unauth process-crash paths (N-1 `serveFile` percent-decode, N-2 `getParams` stream error) now have no `unhandledRejection` backstop; `createServer.stop()` was removed, which incidentally drained the Redis-quit leak but also deleted the only graceful-shutdown seam (now H-7); the legacy-Sentry slot (M-4/M-5) and the dead `redactToken` (N-4) leave a credential-leak residue; the api/sync transport twins still diverge on rate-limit + auth blocks.
- **Two unifying wave-1 themes still hold and got fresh instances:** (1) **hand-synced transport/template-twin drift** (socket/HTTP, api/sync, src/template/asset, root/template generators) — a shared `_shared/*Stage` pipeline + an `ai:lint` behavioral-parity gate would kill the class; (2) **shadow-APIs** — typed/documented/tested seams with ZERO production call-sites (`preEmailSend`, `flushErrorTrackers`, the test-runner CSRF + extension layers, `posthogConfig.ts`, the api CLAUDE.md phantom hooks, `redactToken`, `timingSafeStringEqual`, the docs-ui `renderCore` renderer). Making divergence + dead-wiring a build error (a `luckystack doctor` preflight + contract-honesty lint) is the single highest-leverage program.

---

## 5. Top action items (highest confidence x impact)

1. **N-1 / N-2** — kill the two NEW unauth process-crash DoS paths (`serveFile` percent-decode + `getParams` stream error) AND add the missing global `process.on(unhandledRejection)` + a `.catch()` on the voided `handleHttpRequest`. The only remaining remote-unauth crashers.
2. **H-1** — add `routing.upstreamTimeoutMs` + a WS handshake watchdog to both proxies; the surviving router DoS.
3. **N-3 / N-4 / M-4 / M-5 / M-6 / M-7** — the credential-leak cluster: stop keying rate-limit on the raw token, wire `redactToken`, sanitize the legacy-Sentry slot (one ADR closes M-4/M-5 + the double-capture), value-scrub `error.message`/`stack`, widen `redactedLogKeys`.
4. **H-5 / H-6** — the consumer twin-drift duo: fix credentials self-delete end-to-end (extend `menuHandler.confirm` to return the typed value) and route session handlers through `sessionKeyFor`; back both with an `ai:check-template-drift` CI gate.
5. **H-4 (preEmailSend no-op) / H-7 (flush-on-shutdown)** — wire the two unwired security-control shadow-APIs that silently drop suppression decisions and buffered telemetry; re-home graceful shutdown lost when `createServer.stop()` was removed.
6. **H-3 / DD-3** — revive the dead `@bootUuid` salt and default `/_health` to hmac/salted (or gate behind a router-probe token).
7. **H-2 / DD-1** — flip sync receiver-auth secure-by-default for 0.2.0 (cross-package core/sync ADR). The headline 0.2.0 hardening item.
8. **DOCSUI-1** (dev-only publish-blocker) — serialize `renderCore.ts`'s flat-array renderer into the page (or rewrite `buildGroups` to iterate arrays) and replace the fictional nested test fixture.
9. **N-7 / N-8** — wire the test-runner CSRF-enforcement sweep layer + thread the session CSRF token so the default sweep actually exercises CSRF.
10. **Structural (H-TWIN):** collapse each transport twin onto one shared staged pipeline + an `ai:lint` behavioral-parity invariant. Highest-leverage change in the repo — it kills the drift class that produced N-1/N-2/SRV-O1 and most behavior bugs.

---

*Inputs: `codebase-scan-14-06-FINAL/{SECURITY,BUGS,CODE_QUALITY,FEATURES,REFACTOR_ROADMAP}.md` + the 18 tree-verified `per-area-reconciled/*.md` files. Wave-1 source: `codebase-scan-14-06-MERGED/` (synthesis of the 6 raw run folders). All FIXED/NEW/FALSE-POSITIVE verdicts independently confirmed by opening cited files at current lines in HEAD `302cbf1` + uncommitted.*
