# LuckyStack — Security & Correctness Scan (2026-07-02)

**Scope:** Full codebase — all 15 `@luckystack/*` packages + `create-luckystack-app`, the consumer `src/` app, `server/`, `scripts/`, `shared/`, `functions/`, and root config files.
**Method:** 10 parallel audit agents (one per surface). Each verified — did not assume — the current state of every previously-flagged critical. The two highest-severity findings were re-verified by hand against the source (notes below). **This is report-only. Nothing was fixed.**

Per-area detail lives in `codebase-scan-02-07/findings/*.md`. This file is the ranked master list.

## Fixes applied this session (verified, tested)

- **C1 (router CRITICAL)** — `resolveTarget.ts`: added an own-property `ownBinding()` guard on both binding lookups so inherited keys (`__proto__`/`constructor`/`toString`) resolve to `undefined` → clean 502 instead of a bogus target. `httpProxy.ts`: added a last-resort `.catch` on the bare `void handleRequest(...)` so any pre-listener throw returns 500 instead of an unhandled rejection / process exit; comment corrected. Regression test added (`resolveTarget.test.ts`, 5 inherited-key cases). All 182 package tests pass.
- **Auth LOW (logout token-in-logs)** — `login/src/logout.ts:28`: full token in a debug log replaced with `tokenPrefix` (matches the convention at `:63` + `session.ts`).
- **M7 (PostHog scrubbing bypass)** — `error-tracking/adapters/posthog.ts`: `captureException` now receives a rebuilt scrubbed Error (message/stack) instead of the raw error, mirroring the Sentry adapter's ET-O2 pattern.

Everything else below is **report-only** — left for your decision (see the open questions at the end of the session).

## Follow-up (2026-07-02, after user review): H1 + M6 reclassified as by-design + documented

The user confirmed both are config-toggleable by design, not bugs — and asked to document them so scans stop re-flagging:

- **H1 → ADR 0018** (`docs/decisions/0018-*.md`). The session token is meant to reach page JS **only in `sessionBasedToken` mode** (sessionStorage/dev); in cookie mode it's the HttpOnly credential and must not. **Fix applied:** the framework `updateSession` broadcast (`packages/login/src/session.ts:244`) now sends the token-stripped projection in cookie mode (reusing `persistedWithoutToken`), so the continuous path no longer leaks. **Known follow-up (in the ADR):** `session_v1`'s initial-load response still returns the token in cookie mode; fully closing it needs the client session type to drop the required `token` (type-generation change). Files tagged `//? @adr 0018`: `session.ts`, `session_v1.ts`, `SessionProvider.tsx`.
- **M6 → ADR 0019** (`docs/decisions/0019-*.md`). Email `@unique` is opt-in, governed by `auth.providerAccountStrategy`: default `'per-provider'` intentionally omits it (same email across providers = separate rows); `'unified'` requires the consumer to add it. `confirmEmailChange` already does an app-level cross-provider collision check; the residual TOCTOU is closed only by the opt-in index. Files tagged `//? @adr 0019`: `accountStrategy.ts`, `confirmEmailChange_v1.ts`. Also documented in `docs/ARCHITECTURE_SESSION.md` (token-exposure contract section).

Net: both drop off the "to fix" list. The remaining genuine to-fix items are the four MEDIUMs below (M2/M3 auth, M4 DoS, M5 multi-tenant, M7 done, M8) plus the H1 initial-load follow-up.

## Second follow-up (2026-07-02): ALL remaining findings fixed + verified

Everything below is now fixed on the working tree (1451 tests pass, tsc/lint/build all clean):

- **M4** — `authApiRoute.ts`: per-IP rate-limit (`ip:<ip>:auth:oauth-init`) before the OAuth-init Redis write.
- **M8** — `runAuthEnforcementTests.ts`: routes in `apiMethodMap` but absent from `apiMetaMap` now record a `skipped`/"auth unverifiable" result instead of a silent continue.
- **M2** — `login.ts` `findOrCreateOAuthUser`: fail-closed guard refuses OAuth account CREATION when `!emailVerified` (symmetric with the link guard). New generic `emailImpliesVerified` provider flag set on `facebookProvider` (fixes L3 so Facebook signup still works).
- **M1** — one-shot boot warning when credentials logins fail while `rateLimiting.auth.enabled:false` (default kept opt-in — force-enabling the cross-IP counter introduces a bounded victim-account-lock DoS the operator should choose consciously).
- **M3** — the two wrong-password paths now `await dispatchHook('loginFailed')` so the lockout increment lands before the response (closes the sequential TOCTOU; residual concurrent window documented, bounded by the atomic per-IP cap).
- **M5** — all content-room operations (join/leave/evict/rejoin in `loadSocket.ts`) use the canonical `'broadcast'` purpose so they match the sync membership-check + fanout byte-for-byte; only `'presence'` is a separate room family. Registry type-doc codifies the rule.
- **H1 (fully closed)** — new `ClientSessionLayout = Omit<SessionLayout,'token'|'csrfToken'>`; `session_v1` + the `updateSession` broadcast never carry the token to page JS; `BaseSessionLayout.token`/`HookSessionShape.token` relaxed to optional so a token-less client type satisfies the client generics — the consumer `SessionLayout` keeps `token: string` required, so **server-side typing is untouched**. Regression test in `session_v1.tests.ts` asserts token/csrfToken absence. See ADR 0018 (rewritten to the type-enforced decision).

M6/H1 remain by-design where noted (ADR 0018/0019). This scan's actionable findings are now all addressed; the LOW items in the per-area files remain report-only.

---

## Headline

The codebase is **mature and heavily hardened**. Every previously-flagged CRITICAL is verified fixed: wsProxy crash + SSRF, `server.js` source-disclosure, OAuth unverified-email *linking*, `validateType` fail-open, MT-3 room bypass, the Windows `npm.cmd` install bug, PM `.includes()` detection, `resolveLuckyStackRange` `file:`-spec footgun, DOCSUI-01 emitter/renderer drift, stale-asset scaffold parity. Core crypto/proto-pollution/type-validation primitives are all correct.

**1 new CRITICAL** (verified) and **1 HIGH** (verified) are genuinely new and worth acting on. The rest are MEDIUM/LOW hardening items and default-posture choices.

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 1 |
| MEDIUM | 8 |
| LOW | ~30 (per-area files) |

---

## CRITICAL

### C1 — Router: unauthenticated prototype-key path crashes the whole process (fallback mode)
**Files:** `packages/router/src/resolveTarget.ts:258` · `packages/router/src/httpProxy.ts:117` (+ bare `void handleRequest` at `:62`)
**Verified by hand.** A single unauthenticated request `GET /api/__proto__/x` (or `/api/constructor/x`, `/api/toString/x`):
1. `resolveServiceKey` returns the raw path segment `__proto__` as the service key (no key-name validation).
2. `resolveTarget.ts:258` does `fallbackEnv.bindings[service]` with **no `hasOwnProperty` guard** → `bindings['__proto__']` returns `Object.prototype` (truthy, non-string); `bindings['constructor']` returns the `Object` function.
3. `if (fallbackBinding)` passes → `resolve()` returns `{ target: <non-string> }`.
4. `httpProxy.ts:117` `new URL(pathname, resolved.target)` throws `Invalid URL` **before** the stream `'error'` listeners are registered (those are at `:301-303`).
5. The throw rejects the promise from the bare `void handleRequest(...)` (`:62`) → unhandled rejection → **process exit** under Node's default `--unhandled-rejections=throw`.

**Impact:** Any anonymous client takes down every backend behind the router with one GET. **Precondition:** an `environment.fallback` is configured (split/fallback mode — the package's primary multi-instance production mode). Without a fallback env the same request degrades to a clean 502, so downgrade to **HIGH** for single-env deployments.
**Note:** the guarding comment at `httpProxy.ts:56-60` ("errors are handled inside handleRequest … registered before any I/O") is inaccurate — the `new URL` at `:117` runs before those listeners and is unguarded (this is finding R-MED below).

---

## HIGH

### H1 — Consumer: session-bootstrap endpoint returns the raw session token to page JS
**File:** `src/_api/session_v1.ts:19` (route `api/system/session/v1`, `auth.login:false`)
**Verified by hand.** `main` returns `result: user`, and `user` is a `SessionLayout`, which includes `token: string` (`config.ts:316`). In the default cookie mode (`sessionBasedToken:false`) the token is the **HttpOnly-cookie credential** — handing it to page JS in the response body defeats HttpOnly and enables token theft via any XSS.
**Direct contradiction:** the sibling `src/settings/_api/listSessions_v1.ts:20-23` documents *"The raw token is the HttpOnly-cookie credential, so it must NEVER reach page JS"* and returns a SHA-256 handle instead. `session_v1.ts` should strip `token` (and `csrfToken`) from `user` before returning.
**Deeper trace (added this session — why this is NOT a safe blind fix):**
- The token reaches page JS via **two** paths, not one: `session_v1`'s response **and** the framework's `updateSession` broadcast at `packages/login/src/session.ts:244` (`io.to(token).emit(updateSession, JSON.stringify(persisted))`, where `persisted` includes the token; comment: *"preserve the existing token so the client doesn't have to re-fetch"*). `src/_providers/SessionProvider.tsx` stores the full session (token included) in React state from **both** paths.
- The token in React state is **not** load-bearing for the socket: `src/_sockets/socketInitializer.ts:83-85` reads the handshake token from **sessionStorage**, not `session.token`. So stripping `token` from `session_v1` would not break the socket in either mode — but it is **incomplete**, because the `updateSession` broadcast still delivers the token to page JS.
- Therefore the real decision is framework-level: should the token reach page JS at all in cookie mode? A complete fix means the framework stops broadcasting the token (and `session_v1` strips it); a defense-in-depth-only fix strips `session_v1` and leaves the broadcast. **Left for your decision — not auto-fixed.** `session_v1.tests.ts` exists but does not assert token-absence.

---

## MEDIUM

### M1 — Auth: OAuth account *creation* does not check `emailVerified` (custom providers)
`packages/login` `login.ts:1000-1029`. First-login account creation binds to the provider's email without an `emailVerified` check. Built-in providers are safe; a custom non-verifying provider lets an attacker create an account on a victim's email → account squatting / shared-account takeover under `'unified'` linking. The framework doesn't fail closed by construction. (The prior *linking* bug is fixed; this is the *creation* path.)

### M2 — Auth: per-account brute-force lockout ships disabled by default
`rateLimiting.auth.enabled: false`. Only a loose, proxy-fragile per-IP 60/min cap protects credential login by default, leaving distributed credential stuffing unthrottled. A lockout module exists but is off.

### M3 — Auth: lockout check is TOCTOU
The lockout gate is a non-incrementing read decoupled from a fire-and-forget, un-awaited increment → concurrent bursts overshoot the per-account cap.

### M4 — Server: unauthenticated OAuth-init is a Redis write-amplification DoS
`GET /auth/api/<provider>` writes a Redis state entry per request, no rate limit, passes the origin gate (GET). TTL-bounded but unbounded-rate memory amplification from anonymous clients. See `findings/server.md`.

### M5 — Sync: `purpose`-aware room-formatter mismatch breaks multi-tenant sync
Sockets JOIN with `formatRoomName(..., {purpose:'join'})` (`loadSocket.ts:199/295/498`) but membership-auth + fanout + streaming resolve with `{purpose:'broadcast'}` (`handleSyncRequest.ts:561/898`, `handleHttpSyncRequest.ts:718`, `streamEmitters.ts:192`). A `purpose`-aware custom `registerRoomNameFormatter` makes join ≠ broadcast → legit members rejected + fanout hits an empty room. No effect on stock (identity formatter), only the exact multi-tenant case the `purpose` field exists to support. In-code comments claiming "same physical room" are wrong. **HIGH for multi-tenant deployments.**

### M6 — Consumer/Prisma: `email` lacks `@unique`, breaking a race backstop
**Verified by hand.** `prisma/schema.prisma:65` `email String` has no `@unique` (zero `@unique` in the schema), yet `src/settings/_api/confirmEmailChange_v1.ts` relies on "the DB unique index on email" as its concurrency backstop → concurrent email-change/register can create duplicate-email accounts (TOCTOU).

### M7 — Error-tracking: PostHog `captureException` bypasses secret scrubbing
`packages/error-tracking/src/adapters/posthog.ts:110-113` passes the raw error object to `posthog-node` (which extracts message/stack itself), bypassing the ET-O2 scrubbing that Sentry/Datadog apply. The leaky branch is untested (mock client lacks `captureException`).

### M8 — Test-runner: auth sweep silently drops routes missing from `apiMetaMap`
`packages/test-runner` — routes present in `apiMethodMap` but absent from `apiMetaMap` are skipped with no record and no assertion (only a fully-empty meta map warns). A route could silently escape the auth-enforcement sweep. Low real-world probability (maps co-generated) but it's the one genuine "silent pass" pattern.

---

## Notable LOW / config items (full lists in per-area files)

- **R-MED (router):** `handleRequest` has no try/catch before its stream `'error'` listeners — a throwing custom `ServiceResolver` also takes the router down (same window as C1). `findings/router.md`.
- **Config C-01 (dead flag):** `deploy.config.ts:144` `development.switchNewTrafficToLocalWhenHealthy: true` is declared + typed but read by nothing. `findings/config.md`.
- **Config C-04 (timing):** `config.ts` reads `EMAIL_FROM` / `DNS` / `EXTERNAL_ORIGINS` at import time, before `resolveSecretsIfConfigured` runs (`server.ts:52`), so secret-manager pointers for those never apply.
- **Auth LOW:** full session token logged at debug in `logout.ts:28` (credential-in-logs); the `/auth/api/credentials` CSRF exemption silently relies on `SameSite=Strict` and breaks to login-CSRF if a consumer sets `SameSite=None`.
- **Email LOW:** `autoSelectEmailSender` silently falls back to `ConsoleSender` in production, logging password-reset URLs/tokens to server logs.
- **Server LOW:** CORS reflects unvalidated Origin + credentials on origin-exempt webhook paths; webhook/streaming-upload handlers bypass `requestBodyMaxBytes` by design (must self-limit); `startsWith` origin-exempt prefix can over-exempt siblings.
- **Sync/API LOW:** no handler-level payload/receiver size cap; `readSession` runs before rate-limit; HTTP-sync membership uses persisted `session.roomCodes` vs live `socket.rooms` (staleness).
- **Core LOW:** `redis` proxy lacks `ownKeys`/`getOwnPropertyDescriptor` traps (enumeration inconsistency vs `prisma`); `applyErrorFormatter` logs a false "formatter threw" on falsy return; `isLoopbackIp` regex accepts out-of-range octets (dev-only).
- **docs-ui LOW:** `sanitizeCssValue` misses `image-set(` / `cross-fade(` (consumer branding only, not attacker input).
- **CLI:** `template/scripts/prismaWithSecrets.ts:35` is the last `shell:true` + bare-`prisma` spawn (works via npm-script PATH; odd one out vs the hardened pattern).
- **Test-coverage gaps:** `src/billing/_api/listInvoices_v1.ts` and `src/vehicles/_api/listVehicles_v1.ts` ship auth-gated with NO sibling `_v1.tests.ts`; `session_v1.tests.ts` does not assert token-absence (relevant to H1).

---

## Verified-clean (prior criticals re-checked today, confirmed fixed)

wsProxy mid-handshake crash · HTTP/WS SSRF · `server.js` source-disclosure · OAuth unverified-email linking · `validateType` fail-open · MT-3 sync room bypass · Windows `npm.cmd` space-in-path install bug (source + `dist`) · PM `.includes()` detection · `resolveLuckyStackRange` `file:`-spec footgun · stale-LoginForm scaffold asset drift · DOCSUI-01 emitter↔renderer shape drift · MCP tools (read-only, path-contained). Core has no `eval`/`child_process`/XSS sinks and no `Math.random()` on any security path.
