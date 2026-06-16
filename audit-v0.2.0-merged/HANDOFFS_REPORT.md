# Cross-Package Handoff Report — v0.2.0

> Follow-up to `FIX_REPORT.md`. This report covers the cross-package handoff pass: landing the ~30 dependent-side wiring items from `FIX_REPORT.md` §4 against the phase-1 core contract.

---

## 1. Header

| | |
|---|---|
| Date | 2026-06-13 |
| Branch | `chore/package-split-prep` |
| Committed | **NO** — working tree changes, not yet committed |
| Purpose | Land the ~30 cross-package handoffs from `FIX_REPORT.md` §4 against the new `@luckystack/core` phase-1 contract, plus the two user overrides (auth-absent = public, DK-05 reversal; email config-driven uniqueness) already applied before this run. |
| Repair rounds | 1 |

---

## 2. Build / Lint Status

**GREEN — all clean.**

```
lint:  PASSED (lint:client + lint:server, eslint, zero errors)
build: PASSED
  - build:packages: 16/16 succeeded in 30.53s
    OK core, email, login, devkit, router, test-runner, create-luckystack-app,
       secret-manager, mcp, error-tracking, api, sync, presence, server, docs-ui, cli
  - generateArtifacts: OK (18 API files, 5 sync server files;
    apiTypes.generated.ts + generatedApis presets created)
  - client vite build: 502 modules in 4.63s
  - server build: dist/server.js 517.6kb in 150ms
```

Non-fatal warnings only (NOT errors, no source files affected):
- `[EVAL]` direct eval in third-party `node_modules/vconsole/dist/vconsole.min.js` (×2)
- `[PLUGIN_TIMINGS]` vite:css build-time note

> Note: during the parallel fix-agent run, per-package `tsc -p packages/<x>` reported errors in api / sync / login / server / router / error-tracking / presence. These were **stale-`core/dist` artifacts only** — every agent verified its imports against live `packages/core/src` and the final serialized `build:packages` (which rebuilds `core/dist` first) is green. No real type errors remain.

---

## 3. Core Additions (phase-1 contract)

### New hooks

| Hook | Payload | Origin | Semantics |
|---|---|---|---|
| `postHttpRequest` | `{method,url,requestId,statusCode,durationMs}` | server HOK-15 | Observational, fires on every exit path. |
| `apiAuthRejected` | `{routeName,reason,userId,ip?,transport?,failedKey?}` | api F9 | Observational, every auth-fail path. `reason` ∈ login-required / additional-failed / invalid-condition. |
| `preSyncRecipient` | `{routeName,receiver,recipientSocketId,recipientUserId,serverOutput}` | sync SYNC-22 | Per-recipient; stop signal **SKIPS that ONE recipient**, does NOT abort the fanout. |
| `corsRejected` (extended) | added optional `reason` ∈ origin-not-allowed / origin-missing / origin-malformed | server HOK-27 | — |
| `sessionCreated` / `sessionRevoked` | `{token,userId,...}` | login CORE-40 | Now barrel-exported; login dispatches on mint/revoke. |

### New config keys

| Key | Default | Behavior note |
|---|---|---|
| `validation.runtimeMode` | `'enforce'` | **NON-byte-identical** — prod input validation now ACTUALLY runs. Set `'off'` to restore old no-op. |
| `rateLimiting.skipLoopbackInDev` | `false` | Opt-in loopback skip (replaces spoofable NODE_ENV inference). |
| `rateLimiting.identity?` | unset | `(params) => {scope,id}\|null` — per-route rate-limit basis. |
| `rateLimiting.auth` | `{enabled:false,maxAttempts:5,windowMs:900000}` | Per-account brute-force lockout slot. |
| `sync.allowClientReceiverAll` | `true` | — |
| `sync.requireRoomMembership` | `false` | — |
| `sync.flushPressure` | `{highWaterMarkChunks:1000,lowWaterMarkChunks:250,maxBufferedBytes:5242880}` | Stream backpressure. |
| `sync.requestTimeoutMs` | `30000` | `false` disables; settles `sync.requestTimeout`/504 instead of hanging. |
| `http.healthHash` | `{mode:'plain',salt:''}` | `mode` ∈ plain/salted/hmac; salt sentinel `'@bootUuid'`. |
| `http.sessionCookieDomain?` | unset | host-only. |
| `http.sessionCookiePrefix?` | unset | `__Host-` / `__Secure-`. |
| `http.sessionCookieSecure?` | unset | derives from env SECURE. |
| `socket.activityHeartbeatThrottleMs` | `10000` | — |
| `auth.allowRegistration` | `true` | `false` rejects register. |
| `auth.passwordResetPath` | `'/reset-password'` | — |
| `auth.emailChangeConfirmPath` | `'/confirm-email-change'` | — |
| `deploy.routing.{upstreamTimeoutMs,websocketService,routerHealthPath,maxRequestBodyBytes}?` | undefined | undefined ⇒ router built-in default. |

### Changed signatures (all backward-compatible)

| Signature | Change |
|---|---|
| `validateRequest({auth,user})` | `user` now `BaseSessionLayout \| null \| undefined` (was required). Never throws; `additional[]` on null user ⇒ `{status:'error',errorCode:'auth.forbidden',httpStatus:403}`. |
| `computeSynchronizedEnvHashes(bootUuid?)` | Added OPTIONAL param. Zero-arg callers unchanged. |
| `hashSynchronizedValue(value, bootUuid?)` | Added OPTIONAL 2nd param; default still unsalted sha256. |
| `ErrorTracker.flush?()` | Added OPTIONAL method. Existing adapters unaffected. |

### Notable new exports (from `@luckystack/core` barrel)

`isLoopbackIp`; `sanitizeForLog`, `DEFAULT_REDACTED_LOG_KEYS`, `REDACTED_PLACEHOLDER`; `appendErrorTracker`, `runWithErrorTrackerIdentity`, `getCurrentErrorTrackerIdentity`, `registerPreCaptureFilter`, `startSpanHandle`, `flushErrorTrackers`; `registerRoomNameFormatter`, `getRoomNameFormatter`, `formatRoomName`, `defaultRoomNameFormatter`; `hashSynchronizedValueWith`, `resolveHealthHashConfig`; `applyCookiePrefixConstraints`; types `SpanHandle`, `PreCaptureFilter`, `RoomNameFormatter`, `EmailAttachment`, `QueueDropReason`, `CookiePrefixConstraints`, the new config interfaces + hook payload types.

Core also added 23 regression tests (`validateRequest`, `runtimeTypeValidation`, `redactedLogKeys`, `synchronizedEnvHashes`); 188/188 core tests pass.

---

## 4. Dependents Wired

| Package | Handoff IDs wired |
|---|---|
| **api** | **F9** dispatch `apiAuthRejected` on every auth-fail path (both transports). **F4** drop `user!` assertion / null-safe `validateRequest` delegation. **F5/F11** `rateLimiting.identity` basis + opt-in `skipLoopbackInDev` via `isLoopbackIp` (both transports). **F7** drop the two `applyErrorFormatter` double-casts. **F1** honor core's now-live prod validation (CLAUDE.md caveat replaced). |
| **sync** | **SYNC-07** new `_shared/receiverAuth.ts` (reject `'all'` / non-member rooms per the two flags). **CORE-06** drop `user!` + ack-timeout from `sync.requestTimeoutMs`. **SYNC-09** `onDrop` so evicted offline requests settle. **SYNC-22** per-recipient `preSyncRecipient` (skip-one). **SYNC-15** drain threshold from `flushPressure.maxBufferedBytes`. **SYNC-17** verified already landed. **SYNC-11-emit** handler-side verified (devkit owns the emit half). |
| **login** | **F1** OAuth-state browser-binding (cookie nonce). **F11** PKCE seam (S256, default-off). **F7/MIS-017** per-account lockout (`authLockout.ts`, default-off). **F18** `auth.allowRegistration` gate. **F22** `passwordResetPath`/`emailChangeConfirmPath`. **CFG-21** `extraAuthorizationParams`. **QUA-080** discriminated `CredentialsLoginResult`. **CORE-40** `sessionCreated`/`sessionRevoked` dispatch. |
| **server** | **SEC-13** `/_health` via `computeSynchronizedEnvHashes(bootUuid)`. **HOK-15** `postHttpRequest` try/finally dispatch. **HOK-27** `corsRejected{reason:'origin-missing'}`. **SEC-22** OAuth callback token in URL fragment. **login-F7-server** per-account brute-force gate on credentials branch. |
| **email** | **F2** thread `attachments` + custom `headers` through pipeline (SMTP/Resend spread, Console prints names, CR/LF strip). **F17** `preEmailSend` live-`message` mutate/observe seam (re-sanitized after hook). |
| **error-tracking** | **ET-02** per-event identity via `getCurrentErrorTrackerIdentity()`. **ET-04/ET-08** satisfied in core (verified). **ET-05** `appendErrorTracker` (no clobber). **ET-11/ET-20** `startSpanHandle` fallback for real span duration. **ET-15** re-export `registerPreCaptureFilter`. **ET-16** `flush?()` on all 3 adapters + `flushErrorTrackers`. |
| **router** | **deploy.routing.*** fallback layer in `startRouter.ts`. **SEC-30** `maxRequestBodyBytes` enforcement (413). **SEC-13 router half** boot-handshake hash threads `fallbackBootUuid`. |
| **presence** | **MIS-003/core-userLeft** broadcast `socketEventNames.userLeft` on grace-expiry. **socket-room-formatter** route room codes through `formatRoomName`. **leaveRoom-token-warn** verified already redacting. |
| **create-luckystack-app** | **test-runner QUA-014/M1-env** `TEST_ALLOW_REMOTE` opt-in. **login F19/F24** `deleteAccount` verified wired. **email schema** `@@unique([email,provider])` verified. |
| **cli** | **login F19/F24** mirror `deleteAccount_v1` asset into add-login bundle (byte-identical to template). |
| **repo-src-tooling** | **SEC-22 client half** `src/main.tsx` reads token from URL fragment. **C-CFG** `socketInitializer.ts` reads `socket.activityHeartbeatThrottleMs`. |
| **devkit** | **SYNC-11-emit** dev loader populates `rateLimit` on sync `_server` entries. **DK-06** prototype-pollution guard verified complete. **DK-14-dispose** watcher dispose handle verified. |
| **docs-coverage** | **D2** remove stale login-dep claims in api/sync CLAUDE.md. New hooks + config keys + barrel-export rows across core/api/sync/login/devkit CLAUDE.md + ARCHITECTURE_API.md + EXTENSION_POINTS.md. **DK-05** public-default doc. Email config-driven uniqueness doc. |

---

## 5. STILL Deferred (remains for a human)

> Especially: anything needing a real OAuth provider, runtime/E2E testing, or a product decision.

| ID | Area | Reason still open |
|---|---|---|
| **F11-pkce-e2e** | login | PKCE seam fully wired (default-off) but needs a **real PKCE-mandating provider** (X/Twitter, Okta/Auth0) for end-to-end verification. Authorize-URL `code_challenge` emission is server-owned. |
| **SEC-24 / PKCE** | login (E2E only) | **CORRECTION (verified post-run): the server half DID land** — `packages/server/src/httpRoutes/authApiRoute.ts:91-126` calls `createOAuthState({usePkce})`, Set-Cookies `ls-oauth-state=stateCookie`, and appends `code_challenge=…&code_challenge_method=S256` when the provider opts in. OAuth state browser-binding (F1) is COMPLETE end-to-end. The only thing left for PKCE is per-provider `usePkce:true` opt-in + an E2E test against a real PKCE-mandating provider (X/Okta/Auth0); existing non-PKCE flows are byte-identical. |
| **F20 / email-verification** | login | Email-verification flow for credentials registration — new feature spanning core/db/email/UI + product decision. |
| **F21 / 2FA** | login | First-class 2FA (pending-login primitive) — new feature + product decision. |
| **SEC-L4 deleteAccount re-auth** | cli | Re-auth for OAuth/passwordless users on account delete — product/UX decision. |
| **CORE-01 residual** | core | Prod runs structural `validateType` against generated type text, but the dev-only DEEP type resolver (TS compiler API) does NOT run in prod; full Zod-schema-in-prod not wired (consumer/api/devkit follow-up). |
| **Health-hash gating** | core/server/router | Salt/HMAC primitives + config landed (default `'plain'` = byte-identical). Actual `/_health` gating + router compare with non-plain mode is a lockstep server+router edit, only partially done. |
| **Per-account lockout depth** | login/server | Server gate is a coarse fixed-window cap; deeper "count only FAILED + reset-on-success + cross-instance" lockout via login's `loginFailed` hook is the login half (config slots landed). |
| **ET-02 transport-binding** | api/sync | `runWithErrorTrackerIdentity(user, fn)` must wrap each request handler (api+sync own this). Until then, attribution falls back to per-request `setUser` closure (no regression). |
| **F5 test-runner loopback** | consumer config.ts | With `skipLoopbackInDev` default `false`, dev/test loopback now hits the global per-IP bucket. Consumer/test-runner must set `rateLimiting.skipLoopbackInDev:true` to restore the old dev skip. |
| **SYNC-15 residual** | sync | `lowWaterMarkChunks` hysteresis + `AVG_PACKET_BYTES`/`POLL_INTERVAL_MS` constants stay hardcoded (no core config slot). |
| **SYNC-11-emit prod half** | scripts | `scripts/generateServerRequests.ts` (repo root) still omits `rateLimit` from its sync `_server` map (one-line add). Dev-loader half done. |
| **ET-01/03/12/13/17/18/19/23, ET-21/22** | error-tracking | Package-local legacy-Sentry config/PII + Datadog tag/span fixes — no phase-1 core dependency, out of handoff scope. |
| **F25 login.test.ts** | login | No handler suite for `consumeOAuthState` single-use / `isAllowedRedirectUrl` / dispatcher (pre-existing gap; `authLockout.test.ts` added for new logic). |
| **H5 asOAuthUserData barrel export** | login | Documented-but-not-barrel-exported; adding the re-export is a code change for the login owner. |
| **CORE-15 env.ts** | core | `export const env = bootstrapEnv()` still runs at import (reads `.env`, can throw) — separate finding, out of Redis/Prisma scope. |
| **cli asset settings parity (SEC-M1/SEC-16)** | cli | `page.tsx`/`listSessions`/`revokeSession` asset copies still use `token` not opaque `handle`; belongs to the opaque-handle handoff. |

---

## 6. Behavioral Changes to Review

These are the changes that are **NOT byte-identical** to pre-0.2.0 behavior. Review before shipping:

1. **Prod input validation now ENFORCED** (`validation.runtimeMode` default `'enforce'`). The old prod no-op is gone — malformed API input is now rejected in production. Set `validation.runtimeMode:'off'` to restore the old behavior. *(Biggest change.)*
2. **OAuth state is now browser-bound** (login F1) — the server sets the `ls-oauth-state` HttpOnly cookie at the authorize redirect (`authApiRoute.ts`) and the callback rejects any flow whose cookie nonce doesn't match the hash stored with the Redis state. Both halves landed; verified end-to-end. Existing Google/GitHub flows keep working (the cookie is set for every OAuth authorize).
3. **`/_health` hash can be salted/HMAC** (`http.healthHash`) — default `'plain'` keeps it byte-identical, but enabling salt/hmac requires lockstep server+router config.
4. **Registration gated** by `auth.allowRegistration` (default `true` = open, no change unless set `false`).
5. **Loopback rate-limit behavior changed** — `skipLoopbackInDev` defaults `false`, so dev/test loopback now hits the per-IP bucket unless the consumer opts in.
6. **OAuth based-token delivered in URL fragment** (`#token=`) not query string (SEC-22) — needs the server callback + `src/main.tsx` client read in lockstep (both wired).
7. **Capture-path context auto-sanitized** (`sanitizeForLog` on the error-tracker fan-out) — raw tokens nested in context no longer reach adapters.
8. **Sync ack-timeout** (`sync.requestTimeoutMs` default 30000) — a sync request that previously hung now settles with `sync.requestTimeout`/504.

---

## 7. Dev Actions Required

1. **`npx prisma generate`** — to pick up the composite email index `@@unique([email, provider])` from the earlier user-override change (if the client isn't already regenerated). A `prisma migrate` may also be needed if a DB exists.
2. **`npm install`** — no new runtime deps were added by this pass, but run if the lockfile drifted from parallel work. (Optional peers nodemailer/resend/posthog/sentry/hot-shots remain optional.)
3. **Consumer `config.ts`** — set `rateLimiting.skipLoopbackInDev:true` if you want the old unconditional dev loopback rate-limit skip back.
4. **Server start is a developer action** — restart `npm run server` + `npm run client` after pulling these changes; do not skip.

---

## 8. Next Steps

1. **Run tests** — `npm run test` (auto-sweep + per-route). Core 188/188, api+sync 80, login 68/68, error-tracking 55/55, router 53/53, devkit 104/104, email 34, server 21/21 already pass in isolation; run the full suite end-to-end.
2. **Review the diff** — `git diff` across all `packages/*` + `src/`; focus on the behavioral changes in §6.
3. **Land the lockstep server PKCE/cookie edit** (§5 SEC-24) so login F1/F11 function end-to-end.
4. **Regenerate AI indexes** — the `.githooks/pre-commit` hook runs `ai:index` / `ai:capabilities` / `ai:project-index` / `ai:decisions` / `ai:runbooks` / `ai:product` / `ai:graph` on commit; no manual run needed.
5. **Branch-log** — the orchestrator appends a single combined `branch-logs/chore--package-split-prep.md` entry + bumps `INDEX.md` (parallel agents deliberately skipped per-agent appends to avoid races).
6. **Commit** — once tests + diff review pass, commit on `chore/package-split-prep`.
