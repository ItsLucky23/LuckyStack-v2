# LuckyStack v0.2.0 — Security Review

**Scope & methodology.** One combined audit agent per package/area swept the LuckyStack monorepo (`packages/*`, the `create-luckystack-app` template, the consumer-demo `src/`/`server/`/`luckystack/` overlays, and root `scripts/`/`.github/`), cross-checking each candidate finding against the existing per-package config options, the hook contracts in `packages/core/src/hooks/`, the per-package docs, and the prior `docs/audits/` (`SECURITY_AUDIT.md`, `REAUDIT_2026-06-09.md`) so that already-fixed or already-accepted items are not re-reported. Findings are deduplicated across agents and across framework↔template mirror copies — a single entry lists every affected path and flags explicitly where the framework file and its template/asset mirror have **drifted**. Spot-checks of the two highest-impact items (`runtimeTypeValidation.ts:305` prod short-circuit and `loadSocket.ts:414` pre-validation `socket.join`) were verified directly against source.

## Severity index

| ID | Severity | Title | File | Area |
|---|---|---|---|---|
| SEC-01 | high | Raw session token leaked into `rateLimitExceeded` hook payload + dev log (contract says "no tokens") | `packages/api/src/handleApiRequest.ts:142` | pkg-api |
| SEC-02 | high | Runtime input validation is a no-op in production — and docs claim otherwise | `packages/core/src/runtimeTypeValidation.ts:305` | pkg-core |
| SEC-03 | high | Missing `auth` export is fail-open at runtime while generated meta claims login-required | `packages/devkit/src/loader.ts:221` | pkg-devkit |
| SEC-04 | high | Auto-registered ConsoleSender in prod reports `ok:true` and prints reset/email-change tokens to logs | `packages/email/src/register.ts:19` | pkg-email |
| SEC-05 | high | Adapter `beforeSend` transformed event silently discarded — redaction-by-return never applied | `packages/error-tracking/src/adapters/sentry.ts:55` | pkg-error-tracking |
| SEC-06 | high | Sliding session refresh never re-tracks `activeUsers` — revocation misses long-lived sessions | `packages/login/src/session.ts:211` | pkg-login |
| SEC-07 | high | Grace-expiry teardown deletes session while another socket with same token is connected (multi-tab logout) | `packages/presence/src/activity/lifecycle.ts:95` | pkg-presence |
| SEC-08 | high | Router never sets/sanitizes `X-Forwarded-For` — client IP spoofing & rate-limit bypass | `packages/router/src/httpProxy.ts:66` | pkg-router |
| SEC-09 | high | Unhandled rejection in HTTP pipeline crashes the whole process (single-request DoS) | `packages/server/src/createServer.ts:126` | pkg-server |
| SEC-10 | high | `socket.join(token)` before session validation lets a forged token subscribe to any room, bypassing `preRoomJoin` | `packages/server/src/loadSocket.ts:414` | pkg-server |
| SEC-11 | high | Per-recipient "filter" pattern leaks full `serverOutput` to every recipient — docs teach it as field-hiding | `packages/sync/src/_shared/clientFanout.ts:151` | pkg-sync |
| SEC-12 | high | Socket sync path has no top-level error guard — rejected `fetchSockets` or null-user auth crashes process | `packages/sync/src/handleSyncRequest.ts:493` | pkg-sync |
| SEC-13 | medium | `/_health` publicly exposes unsalted SHA-256 of synchronized env secrets (+ bootUuid, envKey) | `packages/server/src/httpRoutes/healthRoutes.ts:84`, `packages/core/src/synchronizedEnvHashes.ts:15` | pkg-server / pkg-core |
| SEC-14 | medium | `system/session` returns the raw session token + csrfToken to client JS, defeating HttpOnly cookie mode | `src/_api/session_v1.ts:17`, `packages/create-luckystack-app/template/src/_api/session_v1.ts` | consumer-app |
| SEC-15 | medium | Template `session_v1` logs the full session (incl. token) to stdout on every request (framework↔template drift) | `packages/create-luckystack-app/template/src/_api/session_v1.ts:15` | consumer-app |
| SEC-16 | medium | Published `add-login` asset exposes raw session tokens to the browser | `packages/cli/assets/login/src/settings/_api/listSessions_v1.ts:33` | pkg-cli |
| SEC-17 | medium | `updateUser` asset writes unvalidated name/theme/language — bypasses `auth.nameMaxLength` | `packages/cli/assets/login/src/settings/_api/updateUser_v1.ts:70` | pkg-cli |
| SEC-18 | medium | OAuth state token not bound to initiating browser — login-CSRF / session fixation | `packages/login/src/login.ts:47` | pkg-login |
| SEC-19 | medium | OAuth `client_secret` and authorization code written to debug logs | `packages/login/src/login.ts:415` | pkg-login |
| SEC-20 | medium | `redisSessionAdapter.setRaw` is non-atomic SET then EXPIRE — crash window creates immortal session | `packages/login/src/sessionAdapter.ts:79` | pkg-login |
| SEC-21 | medium | GitHub/Discord OAuth e-mail accepted without checking provider `verified` flag | `packages/login/src/oauthProviders.ts:183` | pkg-login |
| SEC-22 | medium | Session token leaks into redirect query string in token mode (history/Referer/proxy logs) | `packages/server/src/httpRoutes/authCallbackRoute.ts:66` | pkg-server |
| SEC-23 | medium | OAuth authorize endpoint unauthenticated and not rate limited — unbounded Redis state-key writes | `packages/server/src/httpRoutes/authApiRoute.ts:49` | pkg-server |
| SEC-24 | medium | No PKCE support in the OAuth authorization redirect | `packages/server/src/httpRoutes/authApiRoute.ts:62` | pkg-server |
| SEC-25 | medium | Sync handlers echo raw input-validation messages to clients (schema enumeration) — API fix never ported | `packages/sync/src/handleSyncRequest.ts:419` | pkg-sync |
| SEC-26 | medium | Raw session tokens flow into Sentry context and stream logs without redaction | `packages/sync/src/_shared/clientFanout.ts:111` | pkg-sync |
| SEC-27 | medium | No default receiver authorization: any client can sync into any room or broadcast to `all` | `packages/sync/src/handleSyncRequest.ts:493` | pkg-sync |
| SEC-28 | medium | Raw session tokens written to presence log payloads, bypassing redacted-log-keys | `packages/presence/src/activity/lifecycle.ts:27`, `packages/presence/src/activity/leaveRoom.ts:22` | pkg-presence |
| SEC-29 | medium | `LocationProvider` transmits full query string — sensitive URL params persisted to session/presence | `packages/presence/src/client/LocationProvider.tsx:20` | pkg-presence |
| SEC-30 | medium | No upstream/proxy timeout — hung/slow backend exhausts router connections (slow-loris) | `packages/router/src/httpProxy.ts:59` | pkg-router |
| SEC-31 | medium | Host-shell PTY bridge wired at boot with authentication but no authorization (RCE surface) | `server/hooks/workspacesTerminal.ts:33` | consumer-server |
| SEC-32 | medium | Default `User.email` has no `@unique` — registration dedupe is TOCTOU-racy | `prisma/schema.prisma:65` | consumer-server |
| SEC-33 | medium | Overlay silently falls back to `DEV_*` OAuth creds in prod and registers providers with empty `clientSecret` | `luckystack/login/oauthProviders.ts:34` | overlays |
| SEC-34 | low | Client dev logging prints raw request/response payloads, bypassing redaction registry | `packages/core/src/apiRequest.ts:421` | pkg-core |
| SEC-35 | low | `scanFunctionsFolder` can pollute `Object.prototype` via a directory named `__proto__` | `packages/devkit/src/loader.ts:503` | pkg-devkit |
| SEC-36 | low | `meta.method` interpolated unescaped into class attribute and label in `renderEndpoint` | `packages/docs-ui/src/docsHtml.ts:273` | pkg-docs-ui |
| SEC-37 | low | Try-it-out route/version interpolated into inline `onclick` without escaping | `packages/docs-ui/src/docsHtml.ts:241` | pkg-docs-ui |
| SEC-38 | low | Docs page requires `script-src 'unsafe-inline'` — incompatible with any strict CSP | `packages/docs-ui/src/docsHtml.ts:196` | pkg-docs-ui |
| SEC-39 | low | `Sentry.init` `beforeSend` strips `request.cookies` but not `cookie`/`authorization` headers | `packages/error-tracking/src/sentry.ts:97` | pkg-error-tracking |
| SEC-40 | low | `forgotPassword` logs user e-mail (PII) at info/warn level on every request | `packages/login/src/forgotPassword.ts:30` | pkg-login |
| SEC-41 | low | Client-forgeable `intentionalDisconnect` lets any client opt out of disconnect session teardown | `packages/presence/src/activity/lifecycle.ts:126` | pkg-presence |
| SEC-42 | low | `getCachedResolution` returns live object holding all resolved raw secrets, no redaction option | `packages/secret-manager/src/index.ts:418` | pkg-secret-manager |
| SEC-43 | low | Non-timing-safe comparisons for CSRF tokens and `TEST_RESET_TOKEN` | `packages/server/src/httpRoutes/csrfMiddleware.ts:81` | pkg-server |
| SEC-44 | low | Static `/assets/` path handed to consumer `serveFile` without normalization or dot-segment rejection | `packages/server/src/httpRoutes/staticRoutes.ts:41` | pkg-server |
| SEC-45 | low | `ctx.session.login` mints real Redis sessions with `Math.random` tokens and no run-level cleanup | `packages/test-runner/src/customTests.ts:235` | pkg-test-runner |
| SEC-46 | low | Auth-enforcement layer asserts only the `errorCode` string, never the HTTP status code | `packages/test-runner/src/authEnforcementCheck.ts:92` | pkg-test-runner |
| SEC-47 | low | `scaffold:page` accepts `..` segments and can write outside `src/` (and outside the repo) | `scripts/scaffoldPage.mjs:63` | tooling |
| SEC-48 | low | GitHub Actions workflows run with default token permissions and tag-pinned actions | `.github/workflows/ci.yml:1`, `packages/create-luckystack-app/template/.github/workflows/ci.yml` | tooling |

---

### SEC-01 — Raw session token leaked into `rateLimitExceeded` hook payload + dev log (contract says "no tokens")

- **File:** `packages/api/src/handleApiRequest.ts:142` (and `:144`, `:152`); mirror `packages/api/src/handleHttpApiRequest.ts:302-304`, `:314`
- **Area:** pkg-api
- **Evidence/description:** For authenticated callers the per-route rate-limit key is built as `token:<requesterIdentity>:api:<resolvedName>` where `requesterIdentity = token` (handleApiRequest.ts:131-133; identical in handleHttpApiRequest.ts:302-304). That full key — containing the raw bearer session token — is then passed verbatim into `dispatchHook('rateLimitExceeded', { key: rateLimitKey, ... })` (handleApiRequest.ts:144 / handleHttpApiRequest.ts:314) AND logged via `getLogger().warn('api: rate limit exceeded ...', { route, key: rateLimitKey })` (handleApiRequest.ts:152). The hook payload type promises the opposite: `RateLimitExceededPayload.key` is documented as "The key that exceeded its limit (sanitized — no tokens)" (`packages/core/src/hooks/types.ts:204-205`), and `rate-limiting.md` advertises this hook for "dashboards / alerting" and "IP-banning". Framework log redaction does not save consumers: the token is embedded inside a `key` string and `key` is not in `DEFAULT_REDACTED_LOG_KEYS` (`packages/core/src/redactedLogKeys.ts:10-18`). Not in `docs/audits/` (those cover IP-bypass H-1/H-3 and IPv6 keying M-7/M-8, not this token leak).
- **Why it matters for a consumer:** Consumers persist what they were explicitly told is safe — a live session token — into audit logs and external alerting sinks, turning a documented "sanitized" field into an account-takeover primitive.
- **Recommendation:** Pass a sanitized key to the hook + log (hash or truncate the token, or substitute the userId: `token:user:<userId>:api:<route>`). Keep the raw token only for the internal `checkRateLimit` call. Honor the existing "no tokens" type contract literally.

### SEC-02 — Runtime input validation is a no-op in production — and docs claim otherwise

- **File:** `packages/core/src/runtimeTypeValidation.ts:305-307` (verified); consumers `packages/api/src/_shared/socketValidationStage.ts:55`, `httpValidationStage.ts:38`
- **Area:** pkg-core
- **Evidence/description:** `validateInputByType` short-circuits with `if (process.env.NODE_ENV === 'production') { return { status: 'success' }; }` (lines 305-307, confirmed in source) **before** any validation. This is the ONLY input validator wired into the API/sync pipelines, so every endpoint in production accepts arbitrary JSON shapes — a handler typed `data: { email: string }` can receive objects, enabling Prisma filter-operator injection (e.g. `{ contains: ... }` flowing into a `where` clause) and unexpected-shape crashes. Worse, `packages/devkit/docs/runtime-type-resolver.md:3` claims "runtime input validation in prod uses the pre-generated Zod schemas in apiInputSchemas.generated.ts" — but a grep across `packages/{api,sync,server,core}/src` finds ZERO request-time consumers of `apiInputSchemas` (only the test-runner uses it, for fuzz input generation). `docs/ARCHITECTURE_API.md:407` advertises a `validate` stage with no prod caveat. The skip is acknowledged only in `packages/core/docs/session-types.md:154`. Not covered by `docs/audits/SECURITY_AUDIT.md`.
- **Why it matters for a consumer:** A consumer reads the docs, believes prod requests are schema-validated, and writes handlers that trust `data` shape — every endpoint is then open to type-confusion and Prisma operator injection in exactly the environment that matters.
- **Recommendation:** Wire the already-generated Zod schemas into the prod path: when `NODE_ENV === 'production'`, look up the route's schema from the registered `apiInputSchemas` map and run `schema.safeParse(value)`, falling back to success only when no schema exists. Alternatively pre-resolve `inputType` text at codegen and run the dependency-free `validateType()` walk in prod. Until fixed, correct the false claim in `devkit/docs/runtime-type-resolver.md` and add the caveat to `ARCHITECTURE_API.md`.

### SEC-03 — Missing `auth` export is fail-open at runtime while generated meta claims login-required

- **File:** `packages/devkit/src/loader.ts:221` (also `:292`, `:355`, `:431`); prod generator `scripts/generateServerRequests.ts`; runtime `packages/api/src/handleApiRequest.ts:76`, `handleHttpApiRequest.ts:258`; AST extractor `packages/devkit/src/typeMap/apiMeta.ts:241`, `:268`, `packages/devkit/src/typeMap/emitterArtifacts.ts:380-389`
- **Area:** pkg-devkit
- **Evidence/description:** The dev loader registers routes with `login: auth.login || false` (loader.ts:221, :292) and syncs with `auth: resolvedSyncModule.auth || {}` (:355, :431). The prod generator emits `auth: ("auth" in mod ? mod.auth : {})`. Runtime enforcement (`if (apiEntry.auth.login && !user?.id)`) therefore treats a route file that omits `export const auth` as PUBLIC in both dev and prod. The AST extractor defaults the OPPOSITE way: `extractAuth` returns `{ login: true }` when the export is absent/unparseable (apiMeta.ts:241, :268), and `apiMetaMap` emission repeats it (emitterArtifacts.ts:380-389). So `apiDocs.generated.json`, the docs-ui, and the test-runner auth sweep all report the route as login-required while the live handler accepts anonymous callers — a silent auth bypass masked by tooling that claims protection. Mitigation in practice: the scaffold template always writes an `auth` export, so this bites only when a developer deletes/renames it — which is exactly when you want fail-closed. Not in `docs/audits/SECURITY_AUDIT.md`.
- **Why it matters for a consumer:** A protected route silently becomes public the moment its `auth` export is dropped, and every diagnostic surface lies about it being protected — the worst possible failure mode for an auth gate.
- **Recommendation:** Pick ONE default and apply it everywhere; fail-closed is correct (Rule 19). In `loader.ts` use `login: auth.login ?? true` (and `auth: resolvedSyncModule.auth ?? { login: true }` for syncs), mirror the same default in `generateServerRequests.ts`, keep `apiMeta.ts` at `{ login: true }`. Alternatively make a missing `auth` export a hard load error so the route never registers ambiguously.

### SEC-04 — Auto-registered ConsoleSender in production reports `ok:true` and prints reset/email-change tokens to logs

- **File:** `packages/email/src/register.ts:19`; `packages/server/src/bootstrap.ts:103-108`; `packages/email/src/autoSelect.ts:85`; `packages/email/src/senders/console.ts:17-29`; guard at `packages/email/src/sendEmail.ts:89-90`
- **Area:** pkg-email
- **Evidence/description:** `register.ts` runs `registerEmailSender(autoSelectEmailSender())` as an import-time side effect, auto-imported at boot by `bootstrapLuckyStack` (bootstrap.ts:103-108). When no `RESEND_API_KEY`/`SMTP_HOST` env is set — e.g. a prod box where env vars were forgotten — `autoSelect` falls through to `ConsoleSender` (autoSelect.ts:85) with no `NODE_ENV` check and no warning. Consequences: (1) `ConsoleSender` returns `{ ok: true }`, so `forgotPassword`/email-change report success while no mail is delivered; (2) it prints the full body — including the tokenized reset/confirm URL — via `console.log` (console.ts:17-29), persisting live auth tokens into prod log aggregation. The documented mitigation `registerEmailConfig({ required: process.env.NODE_ENV === 'production' })` (`packages/email/docs/error-handling.md:246`) is DEFEATED: `required` only fires when NO sender is registered (sendEmail.ts:89-90), and ConsoleSender IS a registered sender. `adapters.md:168` even claims "misconfiguration never silently falls through to ConsoleSender in production" — true only for the `force=` path, false for the 0.2.0 zero-code auto-wire that is now the default. Not in `docs/audits/` (predate the 0.2.0 `register.ts` auto-wire).
- **Why it matters for a consumer:** A forgotten env var turns password-reset and email-change into a silent no-op that *also* dumps the very tokens those flows are meant to protect into production logs — and the documented hardening knob does not stop it.
- **Recommendation:** In `autoSelectEmailSender` (or `register.ts`): when `force` is unset, no provider env matches, and `NODE_ENV === 'production'`, either throw or emit `getLogger().error` with a clear message, gated by a new `emailConfig.allowConsoleInProduction` (default false = throw, consistent with the fail-loud peer-dep policy). Alternatively make `required: true` also reject the `console` adapter outside dev.

### SEC-05 — Adapter `beforeSend` transformed event is silently discarded — redaction-by-return never applied

- **File:** `packages/error-tracking/src/adapters/sentry.ts:55`; mirrors `adapters/datadog.ts:81-99`, `adapters/posthog.ts:58-96`; `packages/error-tracking/src/runBeforeSend.ts`
- **Area:** pkg-error-tracking
- **Evidence/description:** All three built-in adapters run `const filtered = runBeforeSend(options.beforeSend, {...})` and only check truthiness (`if (!filtered) return;`), then forward the ORIGINAL `error`/`context`/`message` — never `filtered.payload`. `runBeforeSend.ts`'s jsdoc says it returns "the (possibly transformed) event", and the `(event) => ErrorTrackerEvent | null` signature (mirroring Sentry's `beforeSend`, whose canonical use is PII scrubbing) invites consumers to return a redacted copy. A consumer who immutably returns `{...event, payload: {...event.payload, context: scrubbed}}` believes PII is scrubbed, but the unredacted context is still sent. Only in-place mutation of `event.payload.context` works (undocumented, and it leaks the mutation into every subsequent adapter in the fan-out chain since the same `context` object is shared). The `docs/auto-instrumentation.md` "Redaction layers" example works only by accident of mutation. No test covers adapter `beforeSend` at all (`adapter.test.ts` tests only the registry).
- **Why it matters for a consumer:** A consumer's PII-scrubbing `beforeSend` written the natural (immutable) way is a no-op — sensitive context still reaches the third-party error backend, with no test or type signal that anything is wrong.
- **Recommendation:** In each adapter forward from the returned event: `const evt = runBeforeSend(...); if (!evt) return; const { error, context } = evt.payload as {...}; ...` — or change the hook type to `(event) => boolean` and document drop-only semantics. Either way add adapter-level tests asserting a transforming `beforeSend` changes what reaches the SDK, and that one adapter's hook cannot mutate what another receives.

### SEC-06 — Sliding session refresh never re-tracks `activeUsers` set — revocation misses long-lived sessions

- **File:** `packages/login/src/session.ts:211`; `packages/login/src/sessionAdapter.ts:100-104`; default `packages/core/src/projectConfig.ts:442`
- **Area:** pkg-login
- **Evidence/description:** `getSession`'s sliding expiration only calls `adapter.expire(token, newTtl)` on the session key. `adapter.trackActive` (which also refreshes the `${project}-activeUsers:<userId>` SET's TTL, sessionAdapter.ts:100-104) runs only inside `saveSession`. With default `session.expiryDays: 7` (projectConfig.ts:442), a session kept alive purely by authenticated reads outlives its `activeUsers` entry after 7 days. From then on `revokeUserSessions` (password change, the "rotate every session" path in `confirmEmailChange_v1`, `deleteAccount`) and single-session enforcement enumerate `listActive(userId)` and see nothing — a stolen token older than `expiryDays` survives a password reset. `login docs/session-management.md` even promises "an active user is never logged out", making the drift inevitable.
- **Why it matters for a consumer:** The security-critical "log out all sessions / rotate on password change" guarantee silently fails for exactly the long-lived sessions an attacker would keep warm — the user changes their password believing they evicted the intruder, but the stale token persists.
- **Recommendation:** In `getSession`, after a successful `adapter.expire`, also refresh active-token tracking (e.g. `adapter.trackActive(userId, token, newTtl)` or a cheaper `adapter.touchActive(userId, ttl)`). Alternatively use per-token TTLs (a sorted set with expiry scores) instead of one TTL on the whole set.

### SEC-07 — Grace-expiry teardown deletes session while another socket with same token is connected (multi-tab logout)

- **File:** `packages/presence/src/activity/lifecycle.ts:95-109`; related `packages/server/src/loadSocket.ts:331-335`, `:414`
- **Area:** pkg-presence
- **Evidence/description:** The disconnect grace timer is keyed by session token, and its expiry body unconditionally runs `await socketLeaveRoom(...)` then `await removeSession(token)` (lifecycle.ts:95-109). Two browser tabs share one session cookie/token but hold two sockets. When tab B closes, `socketDisconnecting` arms the timer; tab A stays connected so `socketConnected` never fires again to cancel it; after `transportCloseMs` (60s) the shared session is deleted out from under still-active tab A — the user is logged out across all tabs. Nothing in the timer body or `loadSocket.ts:331-335` checks for remaining live sockets on the token. Every socket joins its private token room at `loadSocket.ts:414` (`await socket.join(token)`), so the data needed for the check already exists. Only reachable when `socketActivityBroadcaster` is enabled, but that is the package's primary mode.
- **Why it matters for a consumer:** A completely normal user behaviour (multiple tabs) randomly logs the user out of all of them after 60s — a reliability bug that also weakens the session model by deleting live sessions.
- **Recommendation:** In the timeout callback (or before arming the timer) bail out when the token still has live sockets: `const live = getIoInstance()?.sockets.adapter.rooms.get(token)?.size ?? 0; if (live > 0) return;`. Add a lifecycle test: two sockets, one disconnects, advance timers, assert `removeSession` not called.

### SEC-08 — Router never sets/sanitizes `X-Forwarded-For` — client IP spoofing & rate-limit bypass

- **File:** `packages/router/src/httpProxy.ts:66-74`; mirror `packages/router/src/wsProxy.ts:43-52`; backend trust `packages/core/src/resolveClientIp.ts:85-90`, `packages/server/src/httpRoutes/apiRoute.ts:67-71`
- **Area:** pkg-router
- **Evidence/description:** The HTTP proxy forwards client request headers verbatim (`stripHopByHopHeaders` keeps everything except hop-by-hop) and sets only `x-forwarded-host`, `x-forwarded-proto`, `x-luckystack-resolved-env`, `x-luckystack-via-fallback` (httpProxy.ts:67-74). It NEVER sets or overwrites `x-forwarded-for`; `wsProxy.ts:43-52` has the same omission. The documented topology puts this router as the trusted reverse proxy in front of `@luckystack/server`, whose IP resolution (resolveClientIp.ts:85-90) trusts the LEFTMOST `x-forwarded-for` entry whenever `http.trustProxy: true` — which a consumer MUST enable because behind the router `req.socket.remoteAddress` is the router's own IP (apiRoute.ts:67-71). Because the router forwards the client's own XFF untouched, a malicious client sends `X-Forwarded-For: 1.2.3.4` and the backend keys rate limits / audit logs to the spoofed value; rotating the header per request defeats per-IP rate limiting entirely and poisons logs. (Distinct from the older `SECURITY_AUDIT` item about the backend not reading XFF — that was the backend half; this is the router failing to populate the trusted header.)
- **Why it matters for a consumer:** The router is the "trusted proxy" the whole `trustProxy` model assumes, yet it lets clients fully control the header that model trusts — per-IP rate limiting and IP-based audit logging are bypassable by any client.
- **Recommendation:** In `httpProxy` and `wsProxy`, overwrite (not append-if-absent) the forwarded-for chain with the real peer: drop any client-supplied `x-forwarded-for`/`x-real-ip` from the stripped header set, then set `x-forwarded-for` to `req.socket.remoteAddress` (append to a sanitized chain only if you trust the immediate downstream). Also set `x-real-ip`. Document that the backend keeps `trustProxy: true` only behind this router.

### SEC-09 — Unhandled rejection in HTTP pipeline crashes the whole process (single-request DoS)

- **File:** `packages/server/src/createServer.ts:126`; `packages/server/src/httpHandler.ts` (no top-level tryCatch); unwrapped awaits `staticRoutes.ts:42,53,71`, `faviconRoute.ts:6`, `authApiRoute.ts:123`, `csrfRoute.ts:46`, `httpHandler.ts:165`
- **Area:** pkg-server
- **Evidence/description:** `createServer.ts:126` does `void handleHttpRequest(req, res, options);` and `handleHttpRequest` has NO top-level tryCatch — `request-pipeline.md` even documents "The orchestrator itself never wraps the table in tryCatch". Several awaited calls inside are unwrapped: `await options.serveFile(req, res)` (staticRoutes.ts:42,53,71), `await options.serveFavicon(res)` (faviconRoute.ts:6), `await login.deleteSession(token, ...)` (authApiRoute.ts:123), `readSession` in csrfRoute.ts:46, and `refreshSessionCookieIfPresent` (httpHandler.ts:165). Any throw (a buggy consumer `serveFile`, a Redis blip mid-request) becomes an unhandled promise rejection, which on Node ≥ 15 terminates the process by default. No `process.on('unhandledRejection')` handler exists anywhere in `packages/` or the consumer template (verified by grep).
- **Why it matters for a consumer:** One malformed request that hits a throwing consumer static handler repeatably crashes the entire server — a trivial, remotely-triggerable DoS in production.
- **Recommendation:** Wrap the body of `handleHttpRequest` in `tryCatch(...)`: on error log + `captureException` + respond 500 if `!res.writableEnded`. Alternatively wrap the call site `handleHttpRequest(req,res,options).catch(...)`. Also wrap the consumer-supplied `serveFile`/`serveFavicon` calls individually (same treatment `customRoutes.ts` already gives third-party handlers).

### SEC-10 — `socket.join(token)` before session validation lets a forged token subscribe to any room, bypassing `preRoomJoin`

- **File:** `packages/server/src/loadSocket.ts:414` (verified); CORS `loadSocket.ts:91`; hook only at `:210`
- **Area:** pkg-server
- **Evidence/description:** On socket connect, the rejoin block runs `await socket.join(token);` (loadSocket.ts:414, confirmed in source) BEFORE `readSession(token)` is checked (`:415`). `token` comes from `extractTokenFromSocket(socket)` — fully attacker-controlled handshake data (cookie/header) — and the Socket.io CORS callback allows origin-less (non-browser) clients (`:91`). An attacker can connect with `token` = any known/guessable ROOM NAME (e.g. `lobby`, a game code, a tenant channel) and is joined to that room with no session check and WITHOUT the `preRoomJoin` auth-veto hook firing (it only runs in the explicit `joinRoom` handler, `:210`). The attacker's socket then receives every sync fan-out emitted to that room (default fan-out emits `serverOutput` to all members; per-client `_client` filter files are optional). Not covered by `docs/audits/SECURITY_AUDIT.md` or `REAUDIT_2026-06-09.md` (verified by grep).
- **Why it matters for a consumer:** Any room a consumer treats as private (tenant channel, game lobby, per-user feed) is silently joinable by an unauthenticated socket that simply names it as its token — a real-time data leak that bypasses the very hook consumers are told to use for room auth.
- **Recommendation:** Reorder the rejoin block: `const session = await readSession(token); if (!session) return;` BEFORE any `socket.join(...)`. Only join the private token room and `session.roomCodes` when the session resolves. Optionally run `preRoomJoin` (or a dedicated `preRoomRejoin` hook) for each replayed `roomCode` so consumer auth vetoes apply on reconnect too.

### SEC-11 — Per-recipient "filter" pattern leaks full `serverOutput` to every recipient — docs teach it as field-hiding

- **File:** `packages/sync/src/_shared/clientFanout.ts:151-163`; docs `packages/sync/docs/server-vs-client-handlers.md:105`, Example B `:238-269`
- **Area:** pkg-sync
- **Evidence/description:** `clientFanout.ts:151-163` builds the per-recipient success envelope as `{ cb, fullName, serverOutput, clientOutput: clientSyncResult, ... }` — `serverOutput` is always included verbatim for every recipient. But `server-vs-client-handlers.md` (line 105 table: "Hide a field from non-owner viewers | Yes | Per-recipient filter", plus Example B lines 238-269) teaches consumers to put the sensitive record in `serverOutput` (`return { status: 'success', card }` including `privateNotes`) and "strip" it in `_client`. The doc itself shows the non-owner wire frame as `{ serverOutput, clientOutput: { card: { privateNotes: null } } }` and says "the client-side handler chooses which to render" — i.e. the secret field travels to every room member's browser and is hidden only by rendering choice. Any recipient reads `serverOutput.card.privateNotes` straight off the socket frame. Not covered by `docs/audits/SECURITY_AUDIT.md`.
- **Why it matters for a consumer:** An AI-driven or doc-following consumer ships the canonical "hide a private field" recipe and silently broadcasts that private field to every room member — a data leak that *looks* correct in the UI.
- **Recommendation:** Either (a) let `_client` suppress/override the shared payload (honor a `serverOutputOverride` key in the `_client` return, or a per-route `export const omitServerOutputForRecipients = true` that emits only `clientOutput` when a `_client` file exists), or (b) at minimum rewrite Example B + the section-4 table to state that `serverOutput` always reaches every recipient unfiltered and sensitive fields must be fetched inside `_client`, never returned from `_server`.

### SEC-12 — Socket sync path has no top-level error guard — rejected `fetchSockets` or null-user auth crashes process

- **File:** `packages/sync/src/handleSyncRequest.ts:493-495` (also `:332`); contrast `handleHttpSyncRequest.ts:226`, `:294`; caller `packages/server/src/loadSocket.ts:155-160`; `packages/core/src/validateRequest.ts:71`
- **Area:** pkg-sync
- **Evidence/description:** `handleHttpSyncRequest` wraps its entire body in `tryCatch` (line 226) precisely so "the span always closes — including on an unexpected throw", but `handleSyncRequest` has no equivalent: `await readSession`, `getRuntimeSyncMaps()`, `checkRateLimit`, and especially `await ioInstance.fetchSockets()` / `io.in(receiver).fetchSockets()` (lines 493-495, which reject on Redis-adapter timeouts in multi-instance setups) are unguarded. The caller invokes it as `void (async () => { ... })()` with no catch (loadSocket.ts:155-160), so any throw becomes an unhandledRejection — fatal by default on modern Node. Concrete remote trigger: a route with `auth: { additional: [...] }` but no `login: true` makes line 332 `validateRequest({ auth, user: user! })` pass `null` into `'key' in user` (validateRequest.ts:71), a TypeError any anonymous socket can fire at will. The `user!` non-null assertion (also at handleHttpSyncRequest.ts:294, where it is at least caught) hides the hole.
- **Why it matters for a consumer:** A multi-instance Redis blip, or any anonymous socket hitting a misconfigured `additional`-only route, crashes the whole server — a remotely-triggerable DoS that the HTTP twin is already protected against.
- **Recommendation:** Wrap `handleSyncRequest`'s body in the same `tryCatch` envelope the HTTP path uses (emit `sync.serverExecutionFailed` + `cleanupRequest` on unexpected throw), and guard the anonymous case explicitly: `if (auth.additional?.length && !user) return auth.required` instead of `user!`.

### SEC-13 — `/_health` publicly exposes unsalted SHA-256 of synchronized env secrets (+ bootUuid, envKey)

- **File:** `packages/server/src/httpRoutes/healthRoutes.ts:77-91` (`:84`); `packages/core/src/synchronizedEnvHashes.ts:15-17`
- **Area:** pkg-server / pkg-core *(merged — two agents reported the same endpoint from the server-route side and the hash-function side)*
- **Evidence/description:** `handleHealthRoute` answers any unauthenticated GET with `{ bootUuid, envKey: resolveEnvKey(), synchronizedHashes }` (healthRoutes.ts:77-91). `computeSynchronizedEnvHashes()` returns plain unsalted `sha256(value)` of every env var listed in deployConfig `synchronizedEnvKeys` (synchronizedEnvHashes.ts:15-17) — by design these are shared secrets like session-encryption keys. There is no token, origin, or IP gate in the handler and no knob to suppress the hash payload. An internet-reachable backend therefore leaks (a) which secret env keys exist (key names are the JSON keys), (b) deterministic hashes enabling offline dictionary/brute-force of low-entropy secrets, and (c) a stable `bootUuid` for fingerprinting/restart detection. Not present in `docs/audits/` (only router health-store poisoning was assessed). Medium not high because high-entropy secrets are not practically recoverable from SHA-256.
- **Why it matters for a consumer:** Any consumer who exposes the default health endpoint publicly hands attackers an offline-crackable digest of their session-encryption key plus the names of every shared secret.
- **Recommendation:** Key the hash — HMAC-SHA256 with a per-handshake shared secret (require routers to send a handshake token and compute `HMAC(token, value)`), or at minimum salt with the current `bootUuid` so hashes are not stable across boots. Add `projectConfig.http.healthExposeHashes: boolean` (default false) returning only `{ status }` to unauthenticated callers, and gate `envKey`/hashes behind a `X-LuckyStack-Handshake` token check.

### SEC-14 — `system/session` returns the raw session token + csrfToken to client JS, defeating HttpOnly cookie mode

- **File:** `src/_api/session_v1.ts:17`; template mirror `packages/create-luckystack-app/template/src/_api/session_v1.ts`
- **Area:** consumer-app
- **Evidence/description:** `main` returns `result: user` verbatim. The framework session object includes `token` (used as `user.token` in changePassword/updateUser/etc.) and `csrfToken` (config.ts `SessionLayout`). In cookie mode the session token is deliberately stored in an HttpOnly cookie so page JS cannot read it (XSS-exfil mitigation). This endpoint is fetched on every `SessionProvider` mount (`apiRequest({ name: 'system/session' })`) and hands the token straight back into JS memory, so an XSS payload can read it from the response. It ships in the template, so every consumer inherits it. (Distinct from the report-only `listSessions` case, SEC-16.)
- **Why it matters for a consumer:** The entire point of HttpOnly cookie mode is negated — any XSS becomes a full session-token theft via a single first-party API call the app makes on every load.
- **Recommendation:** Strip credential fields before returning: `const { token: _t, csrfToken: _c, ...publicUser } = user; return { status: 'success', result: publicUser };`. Better: provide a framework `toPublicSession()` helper in `@luckystack/core` so every consumer route is safe by default.

### SEC-15 — Template `session_v1` logs the full session (incl. token) to stdout on every request

- **File:** `packages/create-luckystack-app/template/src/_api/session_v1.ts:15`
- **Area:** consumer-app
- **Evidence/description:** The shipped template copy of the session endpoint contains `console.log(user);` inside `main`, printing the entire resolved session — including the session `token` and `csrfToken` — to server logs on every `system/session` fetch (fired on each SPA mount). The repo's own `src/_api/session_v1.ts` does NOT have this line, so this is a **framework↔template mirror drift**: the template is the stale/buggy copy.
- **Why it matters for a consumer:** Every scaffolded project leaks live session and CSRF tokens into server stdout/log aggregation by default, on the most frequently-hit endpoint.
- **Recommendation:** Remove `console.log(user)` from the template file and re-sync it with `src/_api/session_v1.ts`. If session debugging is wanted, gate it behind `logging.devLogs` and redact `token`/`csrfToken` via `getRedactedLogKeys()`.

### SEC-16 — Published `add-login` asset exposes raw session tokens to the browser

- **File:** `packages/cli/assets/login/src/settings/_api/listSessions_v1.ts:33`; same byte-identical copy in the `create-luckystack-app` template
- **Area:** pkg-cli
- **Evidence/description:** The handler returns `{ token, expiresInSeconds, isCurrent }` per active session — the full raw Redis session tokens of every device the user is signed in on. The audit brief lists the consumer-demo `src/settings/_api/listSessions_v1.ts` as a known, deliberate DEMO decision, but this byte-identical copy ships in the published `@luckystack/cli` npm package and is copied into EVERY project that runs `npx luckystack add login` (and the template). In cookie mode the whole point of the HttpOnly cookie is that page JS never sees tokens; this endpoint hands all of the user's device tokens to any script on the page, converting any XSS into full multi-device session hijack surviving the current tab. `docs/audits/` contains no mention of `listSessions`, so the asset/template copies appear undecided rather than accepted.
- **Why it matters for a consumer:** Every consumer who installs the login feature ships an endpoint that defeats HttpOnly-cookie XSS protection across all of a user's devices.
- **Recommendation:** Return opaque session identifiers instead of raw tokens (e.g. `sha256(token).slice(0,12)` plus `createdAt`/expiry/`isCurrent`) and change `revokeSession_v1` to accept that id, resolving it server-side by iterating `activeUsers` smembers and comparing hashes. Apply to the cli asset, the template, and the consumer demo together — or explicitly extend the documented demo exception to cover the published copies.

### SEC-17 — `updateUser` asset writes unvalidated name/theme/language — bypasses `auth.nameMaxLength`

- **File:** `packages/cli/assets/login/src/settings/_api/updateUser_v1.ts:67-72` (`:70`); contrast sibling `updatePreferences_v1.ts:27-29`; policy `packages/login/src/login.ts:158`
- **Area:** pkg-cli
- **Evidence/description:** Lines 67-72 copy `name`, `theme`, `language` straight from `data` into the Prisma update + saved session with no runtime validation — `SessionLayout['theme']` typings are compile-time only and the wire accepts any JSON. The register path enforces `auth.nameMaxLength` (login.ts:158 `if (creds.name && creds.name.length > authLimits.nameMaxLength) …`), but a logged-in user can then PATCH their name to any string up to `http.requestBodyMaxBytes`, bypassing the policy; `theme`/`language` accept arbitrary strings that flow into the session object and back to clients. The sibling `updatePreferences_v1.ts` explicitly allow-lists and type-checks every field (lines 27-29). Medium not high: size is bounded by the configurable body cap, values are not used in raw queries, and the file is consumer-owned after copy — but it ships as the framework's reference implementation in both the cli asset and the template.
- **Why it matters for a consumer:** The reference implementation teaches an input-trust anti-pattern and lets authenticated users bypass the documented name-length policy and pollute session/theme/language fields with arbitrary strings.
- **Recommendation:** Mirror `updatePreferences`' allow-list style: enforce `getProjectConfig().auth.nameMaxLength` on name, validate `theme` against the known union, validate `language` against the project's locale list, and reject the avatar data-URL when `contentType` is not in an `image/*` allow-list before base64-decoding.

### SEC-18 — OAuth state token not bound to initiating browser — login-CSRF / session fixation

- **File:** `packages/login/src/login.ts:47`; `packages/server/src/httpRoutes/authApiRoute.ts:50-63`; `authCallbackRoute.ts`
- **Area:** pkg-login
- **Evidence/description:** `createOAuthState` stores `state` only server-side in Redis (`redisClient.set(key, '1', 'EX', ttl, 'NX')`) and `consumeOAuthState` merely checks the value exists (`getResult[1] === '1'`). Nothing ties the state to the browser that started the flow — no companion HttpOnly cookie (verified: `authApiRoute.ts:50-63` sets no state cookie and `authCallbackRoute.ts` checks none). An attacker can initiate the flow, complete provider auth for THEIR account, withhold their callback, and deliver the unused `code+state` URL to a victim; the victim's browser passes state validation and receives a `Set-Cookie` session for the attacker's account (classic OAuth login-CSRF / session fixation). Single-use NX prevents replay but not this third-party redemption.
- **Why it matters for a consumer:** A victim can be silently logged into an attacker-controlled account, after which anything the victim enters (payment details, documents, messages) lands in the attacker's account.
- **Recommendation:** At `/auth/api/<provider>` time also set a short-lived HttpOnly `SameSite=Lax` cookie containing the state (or its hash); in `loginCallback` compare the cookie against the `state` query param before consuming from Redis. Add the cookie name to a `CsrfConfig`-style per-package config.

### SEC-19 — OAuth `client_secret` and authorization code written to debug logs

- **File:** `packages/login/src/login.ts:415` (params built at `:410`)
- **Area:** pkg-login
- **Evidence/description:** In `exchangeOAuthToken`'s form branch: `if (isDevMode()) { getLogger().debug('oauth: token-exchange form params', { params: formParams.toString() }); }` — `formParams` contains `client_secret` (line 410) and the live authorization `code`. `isDevMode()` maps to `logging.devLogs`, a flag a consumer may legitimately enable in staging/production for diagnostics; the secret then lands in whatever log sink is registered (Pino→Datadog etc.). Core's `registerRedactedLogKeys` cannot catch it because the secret is embedded inside the single `params` string.
- **Why it matters for a consumer:** A consumer who turns on dev logs to debug an OAuth issue silently exfiltrates their OAuth client secret to their log aggregator.
- **Recommendation:** Log a redacted copy: clone the params, replace `client_secret`/`code` with `[redacted]` before stringifying (or log only param NAMES plus `redirect_uri`), or drop the line entirely.

### SEC-20 — `redisSessionAdapter.setRaw` is non-atomic SET then EXPIRE — crash window creates immortal session

- **File:** `packages/login/src/sessionAdapter.ts:79` (and `:100-104` for `trackActive`)
- **Area:** pkg-login
- **Evidence/description:** `setRaw` does `await redis.set(key, value); await redis.expire(key, ttlSeconds);` as two separate commands. If the process dies or the connection drops between them, the session key persists with NO TTL — a token that never expires, violating the adapter's own contract comment ("Implementations MUST honour the TTL — sessions without one would never expire"). `trackActive` (lines 100-104, SADD+EXPIRE) has the same shape with lower impact.
- **Why it matters for a consumer:** A momentary Redis hiccup at the wrong instant mints a session that outlives all expiry/revocation logic — an indefinitely valid credential the consumer cannot see is special.
- **Recommendation:** Use the atomic form `redis.set(key, value, 'EX', ttlSeconds)` (the same shape already used in `createOAuthState`, login.ts:56). For `trackActive`, pipeline SADD+EXPIRE via MULTI.

### SEC-21 — GitHub/Discord OAuth e-mail accepted without checking provider `verified` flag

- **File:** `packages/login/src/oauthProviders.ts:183`; lookup `packages/login/src/login.ts:521`
- **Area:** pkg-login
- **Evidence/description:** `githubProvider.getEmail` picks `entry.primary && typeof entry.email === 'string'` (falling back to `emails[0]?.email`) from `/user/emails` and never checks the `verified` field GitHub returns. `discordProvider` likewise reads `emailKey: 'email'` from `/users/@me` without checking Discord's `verified` boolean. An attacker who attaches an unverified address to their own provider account can then log into the LuckyStack account previously created by the real owner of that address via the same provider (`findByEmail` is email+provider keyed, login.ts:521). Impact bounded by per-provider account scoping and provider-side restrictions — hence medium.
- **Why it matters for a consumer:** Account takeover via unverified-email claim on a provider, against any consumer relying on GitHub/Discord login.
- **Recommendation:** In `githubProvider.getEmail` require `entry.verified === true`; for Discord add a `getEmail`/post-profile check that `userData.verified === true`. Document the requirement in `packages/login/docs/oauth-providers.md`.

### SEC-22 — Session token leaks into redirect query string in token mode (history/Referer/proxy logs)

- **File:** `packages/server/src/httpRoutes/authCallbackRoute.ts:64-66` (`:66`)
- **Area:** pkg-server
- **Evidence/description:** When `config.session.basedToken` is true, the OAuth callback 302-redirects with the freshly minted session token in the QUERY STRING: `res.writeHead(302, { Location: \`${redirectUrl}${separator}token=${newToken}\` })`. Query strings persist in browser history, intermediate proxy/CDN access logs, and can leak via the `Referer` header from the landing page (the `Referrer-Policy` set by this server does not govern the public frontend origin the user is redirected to). Not covered by `docs/audits/SECURITY_AUDIT.md` (its OAuth items are state-TTL and redirect_uri re-validation).
- **Why it matters for a consumer:** In token mode the session credential ends up in shared browser history and any logging proxy between user and frontend — a passive token-disclosure channel.
- **Recommendation:** Deliver the token in the URL FRAGMENT (`#token=...`), which never reaches servers/Referer, and have the client read+strip it via `history.replaceState`; or use a one-time short-TTL exchange code in the query that the client swaps for the real token over POST.

### SEC-23 — OAuth authorize endpoint unauthenticated and not rate limited — unbounded Redis state-key writes

- **File:** `packages/server/src/httpRoutes/authApiRoute.ts:49-67` (`:49`); rate-limit block at `:69-96`
- **Area:** pkg-server
- **Evidence/description:** In `handleAuthApiRoute`, the full-OAuth branch (lines 49-67) calls `login.createOAuthState(provider.name)` — a Redis SETNX write with TTL — and returns a 302, for every unauthenticated GET to `/auth/api/<provider>`. The per-IP rate limit (lines 69-96) only guards the credentials branch BELOW the early return. A scripted client creates unlimited `${project}-oauth-state:*` keys (default TTL 10 min), inflating Redis memory and SCAN costs at zero cost to the attacker. GET also passes the origin gate without an `Origin` header.
- **Why it matters for a consumer:** A trivial unauthenticated loop can balloon a consumer's Redis with state keys, degrading the whole session/cache store.
- **Recommendation:** Move the `checkRateLimit` block above the `isFullOAuthProvider` branch (key e.g. `ip:<ip>:auth:oauth-state`), or add a dedicated `rateLimiting.authLimit` knob applied to all `/auth/api/*` requests.

### SEC-24 — No PKCE support in the OAuth authorization redirect

- **File:** `packages/server/src/httpRoutes/authApiRoute.ts:62-64` (`:62`)
- **Area:** pkg-server
- **Evidence/description:** The authorize URL contains only `client_id, redirect_uri, scope, response_type=code, prompt, state` — no `code_challenge`/`code_challenge_method`, and the login package has no PKCE plumbing at all (grep for `pkce`/`code_challenge` across `packages/` and docs returns nothing). OAuth 2.1 / current BCP recommends PKCE even for confidential clients (protects against authorization-code injection). The `state` token mitigates classic CSRF but not code injection. Prior audit item 14 covers state TTL and redirect_uri re-validation, not PKCE.
- **Why it matters for a consumer:** Without PKCE, a leaked/intercepted authorization code can be injected — a gap relative to current OAuth security baseline that a security-first framework should close by default.
- **Recommendation:** Add optional PKCE: generate `code_verifier` alongside the state token, store it in the Redis state record, send `code_challenge` (S256) in the authorize URL, pass the verifier at token exchange. Gate via provider flag `pkce?: boolean | 'S256'` (default on for providers that support it).

### SEC-25 — Sync handlers echo raw input-validation messages to clients (schema enumeration) — API fix never ported

- **File:** `packages/sync/src/handleSyncRequest.ts:415-423` (`:419`); mirror `packages/sync/src/handleHttpSyncRequest.ts:368-377`; the API fix that should have been ported lives in `packages/api/src/_shared/socketValidationStage.ts:70-81`, `httpValidationStage.ts:53-62`
- **Area:** pkg-sync
- **Evidence/description:** `handleSyncRequest.ts:415-423` returns `errorCode: 'sync.invalidInputType', errorParams: [{ key: 'message', value: inputValidation.message }]` to the requesting socket; `handleHttpSyncRequest.ts:368-377` does the same over HTTP. `inputValidation.message` contains exact field/type details ("clientInput.userId should be string"). `docs/audits/SECURITY_AUDIT.md` flagged exactly this class for `handleHttpApiRequest.ts:470-478` and `REAUDIT_2026-06-09` verified the fix — but only in the API package (validation stages now return a generic code, routing detail to the `postApiValidate` hook + dev logs). The sync transports were never given the same treatment, so any sync route with `auth: { login: false }` lets unauthenticated callers enumerate its input schema, and authenticated callers can enumerate every route's schema. The handlers' own comment ("Auth runs first so unauthenticated probes can't … learn input shape") only holds for login-required routes.
- **Why it matters for a consumer:** The schema-enumeration hole the framework already closed for HTTP APIs is still open on the sync transports — attackers map the consumer's entire data model from error messages.
- **Recommendation:** Mirror the API fix: return generic `sync.invalidInputType` with no `message` param to the client; send the detailed validator message to dev logs and a (new) `postSyncValidate` hook only. Apply to both `handleSyncRequest.ts:415-423` and `handleHttpSyncRequest.ts:368-377`.

### SEC-26 — Raw session tokens flow into Sentry context and stream logs without redaction

- **File:** `packages/sync/src/_shared/clientFanout.ts:103-115` (`:111`); `packages/sync/src/streamEmitters.ts:222-224`; `packages/core/src/tryCatch.ts`, `sentrySetup.ts:38-51`, `redactedLogKeys.ts`
- **Area:** pkg-sync
- **Evidence/description:** `clientFanout.ts:103-115` passes `targetToken: tempToken` (the RECIPIENT's raw session token) as `tryCatch` context; core `tryCatch.ts` forwards context verbatim to `captureException(error, { extra: context })` (sentrySetup.ts:38-51) with no redaction, so whenever a `_client` handler throws, a live bearer credential is persisted in the error tracker (possibly third-party SaaS). Separately, `streamEmitters.ts:222-224` logs `{ tokens: filtered, payload }` — the full `streamTo` token list — when `logging.stream` is enabled. The redaction registry exists (`redactedLogKeys.ts` redacts `token`) but is only applied in `@luckystack/server`'s `httpHandler` via `sanitizeForLog`, never to `tryCatch`/`captureException` context or `getLogger` metadata, and the keys here (`targetToken`, `tokens`) are not in the default list anyway. Prior audits only flagged a dead-code token broadcast in presence; this path is live.
- **Why it matters for a consumer:** Live recipient session tokens land in the error tracker / stream logs on any `_client` error, defeating both HttpOnly cookie mode and the redaction facility the consumer believes protects them.
- **Recommendation:** Hash or truncate tokens before putting them in `tryCatch` context (`targetToken: token.slice(0,8)+'…'`), add `targettoken`/`tokens` to `DEFAULT_REDACTED_LOG_KEYS`, and run `captureException` extra-context through `sanitizeForLog` (or a core equivalent) before handing it to trackers.

### SEC-27 — No default receiver authorization: any client can sync into any room or broadcast to `all`

- **File:** `packages/sync/src/handleSyncRequest.ts:493` (non-emptiness check at `:246`, hook at `:351-356`)
- **Area:** pkg-sync
- **Evidence/description:** The only check on the client-supplied `receiver` is non-emptiness (line 246). The sender need not be a member of the target room (`socket.rooms.has(receiver)` is never consulted), and `receiver === 'all'` (line 493) fans out to every connected socket cluster-wide. So any authenticated user can inject events into arbitrary rooms (including other users' per-token rooms, given a token) and trigger O(all-sockets) broadcast amplification, bounded only by the shared `rateLimiting.defaultApiLimit`. An escape hatch exists — the `preSyncAuthorize` hook is documented for "room-membership rules" (`:351-356`) — so this is insecure-by-default + missing-knob, not a missing capability: a consumer who doesn't know to write that hook ships open rooms. `docs/room-fanout.md` only says "Avoid in production" about `all`; `docs/ARCHITECTURE_SYNC.md` never mentions membership.
- **Why it matters for a consumer:** Out of the box, any logged-in user can push events into other users' rooms and trigger cluster-wide broadcast storms — the secure path requires knowledge the docs don't surface.
- **Recommendation:** Add per-package config knobs with safe defaults for 0.2.0: `sync.allowClientReceiverAll: false` (reject `all` from clients unless enabled) and opt-in `sync.requireRoomMembership: true` (cheap `socket.rooms.has(receiver)` check on the socket path). Document the threat model + the `preSyncAuthorize` recipe prominently in `ARCHITECTURE_SYNC.md`.

### SEC-28 — Raw session tokens written to presence log payloads, bypassing redacted-log-keys

- **File:** `packages/presence/src/activity/lifecycle.ts:27` (also `:33`); `packages/presence/src/activity/leaveRoom.ts:22`; doc anti-pattern `packages/presence/docs/lifecycle.md:83`; registry `packages/core/src/redactedLogKeys.ts:13`
- **Area:** pkg-presence
- **Evidence/description:** `getLogger().debug('presence: user came back', { token })` (lifecycle.ts:27, :33) and `getLogger().warn('presence: no session data for given token', { token })` (leaveRoom.ts:22 — warn level, so it fires in production) pass the raw session token straight to the logger. Core ships a redaction registry (`token` is a default-redacted key, redactedLogKeys.ts:13) but redaction is only applied where callers route through `packages/server/src/logSanitize.ts`; `getLogger()` itself does not sanitize, so a consumer-registered Pino/Datadog logger persists live session tokens. The consumer-facing example at `lifecycle.md:83` teaches the same anti-pattern. Not covered by `docs/audits/SECURITY_AUDIT.md` (which only flagged the now-fixed `afkEvent` token broadcast).
- **Why it matters for a consumer:** Presence (the package's primary mode) persists live session tokens into the consumer's production log sink, and the docs actively teach the unsafe pattern.
- **Recommendation:** Log a non-reversible identifier (`{ token: token.slice(0, 8) + '…' }` or a hash), or run presence log payloads through the same sanitizer the server uses. Fix the `docs/lifecycle.md:83` example too.

### SEC-29 — `LocationProvider` transmits full query string — sensitive URL params persisted to session/presence

- **File:** `packages/presence/src/client/LocationProvider.tsx:18-26` (`:20`); server handler `packages/server/src/loadSocket.ts:344-373`
- **Area:** pkg-presence
- **Evidence/description:** `sendLocationUpdate` copies EVERY entry of `globalThis.location.search` into `searchParams` and emits it to the server. The server handler stores the whole object on the session via `writeSession` and exposes it through the `onLocationUpdate` hook; the documented purpose is showing other users "John is on /settings". URLs routinely carry secrets — password-reset tokens, OAuth `code`/`state` on callback pages, invite codes — which get persisted into Redis session state and potentially fanned out to peer-facing presence UIs. There is no allowlist, denylist, or off-switch for search params short of disabling the whole provider (`locationProviderEnabled`). The payload is also unvalidated/unbounded client input stored server-side.
- **Why it matters for a consumer:** Any consumer with presence enabled silently persists (and potentially shows other users) the secrets that ride in URLs — reset tokens, OAuth codes, invite codes.
- **Recommendation:** Strip search params by default and add a knob, e.g. `registerPresenceConfig({ location: { includeSearchParams: false, searchParamFilter?: (key) => boolean } })`, or a `filterSearchParams` prop on `LocationProvider`. At minimum drop keys matching the redacted-log-keys set (`token`, `code`, `state`).

### SEC-30 — No upstream/proxy timeout — hung/slow backend exhausts router connections (slow-loris)

- **File:** `packages/router/src/httpProxy.ts:59`; mirror `packages/router/src/wsProxy.ts:35`; only existing timeout `healthPoller.ts:32` (dev-gated via `startRouter.ts:142`)
- **Area:** pkg-router
- **Evidence/description:** `transport.request({...})` in httpProxy.ts:59 sets no `timeout` and the code never calls `forwardRequest.setTimeout(...)` or `socket.setTimeout(...)`; wsProxy.ts:35 is identical. The only timeout is the 2s health-probe in healthPoller.ts:32, which never runs in production (the poller is gated to `isDevMode` in startRouter.ts:142). A backend that accepts the TCP connection but never responds (or responds slowly) holds the client↔router↔upstream sockets open indefinitely. There is no config knob to bound this; `req.pipe` body forwarding is also unbounded.
- **Why it matters for a consumer:** An internet-facing router has a resource-exhaustion / slow-loris vector with no mitigation knob — a hung upstream or slow client can pin connections until the router runs out.
- **Recommendation:** Add a configurable upstream timeout (`deploy.routing.upstreamTimeoutMs`, default ~30000) wired into `transport.request({ timeout })` plus a `forwardRequest.on('timeout', ...)` that destroys the socket and emits the existing `routing.upstreamUnreachable` 502. Consider also a `deploy.routing.maxRequestBodyBytes` cap.

### SEC-31 — Host-shell PTY bridge wired at boot with authentication but no authorization (RCE surface)

- **File:** `server/hooks/workspacesTerminal.ts:33` (env gate `:25`, env passthrough `:39-45`); registered unconditionally in `server/server.ts:61`
- **Area:** consumer-server
- **Evidence/description:** `registerWorkspacesTerminalHooks()` is called unconditionally in `server/server.ts:61` for every boot. It registers a Socket.io middleware that, on `ws-term:start`, spawns a real host shell (`pty.spawn(shell, ...)`, `cwd=process.cwd()`) piped to the browser, with the FULL `process.env` passed through (lines 39-45). The only gate is `NODE_ENV !== 'production' || WORKSPACES_TERMINAL_ENABLED === '1'` (line 25). The framework auth middleware only AUTHENTICATES the socket — there is no authorization check (e.g. admin-only) — so ANY logged-in user gets a host shell with the server's secrets in env. A stranger scaffolding from this repo inherits this RCE surface, active in any non-production `NODE_ENV` (dev/test/staging). The comment correctly calls it an RCE surface but ships it wired-in regardless.
- **Why it matters for a consumer:** Any authenticated user on a dev/test/staging box gets a full host shell with the server's secrets — remote code execution by design, inherited by anyone who scaffolds from this repo.
- **Recommendation:** Gate the listener behind an explicit admin/authorization check inside the middleware (read the session via the token and require `user.admin`) in addition to the env flag, and scrub secrets from the spawned env rather than forwarding all of `process.env`. Alternatively move the hook registration out of the default scaffold `server.ts` so a stranger does not inherit it by default.

### SEC-32 — Default `User.email` has no `@unique` — registration dedupe is TOCTOU-racy

- **File:** `prisma/schema.prisma:65`; flow `packages/login/src/login.ts:194`, `:205`; lookup `packages/login/src/userAdapter.ts:74`
- **Area:** consumer-server
- **Evidence/description:** The scaffold `User` model declares `email String` with no `@unique` (line 65). The credentials register flow checks `findByEmail({ email, provider: 'credentials' })` (login.ts:194) and only then `create(...)` (`:205`); login lookup uses `findFirst({ where: { email, provider } })` (userAdapter.ts:74). With no DB-level uniqueness, two concurrent registrations for the same email+provider both pass the existence check and both insert, producing duplicate accounts; subsequent `findFirst` is then non-deterministic about which account authenticates. This is the framework's default auth-backing schema, shipped to every consumer.
- **Why it matters for a consumer:** A registration race produces duplicate accounts for one email, after which login non-deterministically authenticates into different accounts — a correctness and account-integrity hazard in the default auth schema.
- **Recommendation:** Add a uniqueness constraint to the scaffold schema — `@@unique([email, provider])` (or `email @unique` if single-provider) — and document it in the `User`-model comment block. The DB constraint closes the race the application-level check cannot.

### SEC-33 — Overlay silently falls back to `DEV_*` OAuth creds in prod and registers providers with empty `clientSecret`

- **File:** `luckystack/login/oauthProviders.ts:34` (also `:22-23`, `:35-36`); canonical `packages/login/src/register.ts` has neither problem
- **Area:** overlays
- **Evidence/description:** `const useProdCreds = prod && secure;` with `prod = process.env.NODE_ENV !== 'development'` and `secure = process.env.SECURE === 'true'` (lines 22-23, 34-36) means a production boot where `SECURE` is unset/false silently uses `DEV_GOOGLE_CLIENT_ID`/`DEV_GOOGLE_CLIENT_SECRET` etc. — dev OAuth app credentials serving production traffic with no warning, violating the project's fail-fast policy. Additionally, because activation gates on `CLIENT_ID` alone and `env()` defaults to `''`, setting `GOOGLE_CLIENT_ID` without `GOOGLE_CLIENT_SECRET` registers a provider with `clientSecret: ''` — the button appears (via GET `/auth/providers`) but every token exchange fails at runtime with no boot-time diagnostic. Medium rather than high because this is the framework repo's own consumer-demo overlay (not shipped via `create-luckystack-app`'s `template/`) — but the repo is the reference people copy. The canonical `packages/login/src/register.ts` has neither problem (framework↔overlay drift).
- **Why it matters for a consumer:** Anyone copying the reference overlay can ship dev OAuth credentials to production, or a half-configured provider whose login button silently fails — both with zero boot-time diagnostic.
- **Recommendation:** Adopt `register.ts` semantics: select `DEV_*` keys purely on `NODE_ENV !== 'production'`, and require BOTH `*_CLIENT_ID` and `*_CLIENT_SECRET` before registering a provider. Better: delete the overlay entirely so the canonical logic is the only logic. Optionally have provider factories throw at registration when `clientSecret` is empty (fail-fast).

### SEC-34 — Client dev logging prints raw request/response payloads, bypassing the redaction registry

- **File:** `packages/core/src/apiRequest.ts:421` (also response at `:446`); registry `packages/core/src/redactedLogKeys.ts`; only consumer `packages/server/src/logSanitize.ts`
- **Area:** pkg-core
- **Evidence/description:** `apiRequest` logs the full outgoing payload (`getLogger().debug(..., { APINAME: sanitizedName, data })`, line 421) and the full response envelope (line 446) when `logging.devLogs` is on. The redacted-log-keys registry exists exactly for this, but only `logSanitize.ts` consumes `isRedactedLogKey` — the client transport never filters, so password/token-bearing payloads land verbatim in the browser console and any console-forwarding tooling. Low because gated behind the dev-only `devLogs` flag.
- **Why it matters for a consumer:** With dev logs on, login/credential payloads print to the browser console unredacted, despite a redaction facility the consumer reasonably assumes is global.
- **Recommendation:** Run `data` and the response through a shared sanitize helper (mask keys matching `isRedactedLogKey`, recursively) before logging — export the server's `sanitizeForLog` from core so both transports share it.

### SEC-35 — `scanFunctionsFolder` can pollute `Object.prototype` via a directory named `__proto__`

- **File:** `packages/devkit/src/loader.ts:503-521` (`:503`); codegen mirror `scripts/generateServerRequests.ts`
- **Area:** pkg-devkit
- **Evidence/description:** The devFunctions tree walk does `let target: Record<string, unknown> = devFunctions; for (const part of basePath) { ... target = target[part] as Record<string, unknown>; } target[fileName] = resolvedFunctionModule;`. `basePath` segments are raw directory names from the consumer's `serverFunctionDirs`. A folder named `__proto__` makes `target[part]` resolve to `Object.prototype`, so the next `target[fileName] = module` writes onto `Object.prototype` for the whole dev server process. Low because the attacker is the consumer's own filesystem and it is dev-only, but it is the classic recursive-merge pollution shape in framework code.
- **Why it matters for a consumer:** A directory named `__proto__` in a functions folder silently corrupts every object in the dev process — a confusing, hard-to-diagnose failure (and a latent injection shape if directory names ever become less trusted).
- **Recommendation:** Initialize the tree with `Object.create(null)` and/or skip reserved keys: `if (part === '__proto__' || part === 'constructor' || part === 'prototype') continue;`. Apply the same guard in the codegen mirror in `generateServerRequests.ts`.

### SEC-36 — `meta.method` interpolated unescaped into class attribute and label in `renderEndpoint`

- **File:** `packages/docs-ui/src/docsHtml.ts:273`; contract claim `packages/docs-ui/docs/html-generation.md:125`, foreign-JSON acceptance `:39`
- **Area:** pkg-docs-ui
- **Evidence/description:** `renderEndpoint` builds `<span class="method ${method}">${method}</span>` (docsHtml.ts:273) where `method = (meta.method || 'POST').toUpperCase()` comes straight from the fetched JSON with no `escapeHtml` — every other interpolation in the same template is escaped. `html-generation.md:125` claims "The renderer never inserts unescaped user-supplied strings." The artifact is normally produced by devkit (method typed as a 4-value union), so exploitation requires a tampered/hand-written artifact or a future emitter passing arbitrary strings — hence low — but the docs-ui contract explicitly accepts foreign JSON ("any URL that returns the expected JSON shape works", `:39`), making this a stored-XSS seam into a developer's browser. Distinct from the prior audit's refuted "implicit-any embedded JS" finding (`REAUDIT_2026-06-09.md:49`), which was about typing.
- **Why it matters for a consumer:** A developer pointing the docs UI at a foreign/tampered artifact can be hit with stored XSS in their own browser, against the renderer's stated escaping guarantee.
- **Recommendation:** Escape the label (`${escapeHtml(method)}`) and whitelist the class (`['GET','POST','PUT','DELETE'].includes(method) ? method : 'POST'`). One-line fix that also restores the `html-generation.md` escaping guarantee.

### SEC-37 — Try-it-out route/version interpolated into inline `onclick` without escaping

- **File:** `packages/docs-ui/src/docsHtml.ts:241`; foreign-JSON acceptance `html-generation.md:39`
- **Area:** pkg-docs-ui
- **Evidence/description:** `renderTryItOut` concatenates `'<button onclick="runEndpoint(this,\'' + route + '\',\'' + version + '\',...)">'` (docsHtml.ts:241) where `route`/`version` derive from JSON page/name/version values with no escaping (neither HTML-attribute nor JS-string). A page or route name containing `'`, `"`, or `&#39;` breaks out of the JS string inside the `onclick` attribute, allowing script injection into the developer's browser. Filesystem route names rarely contain quotes, but POSIX allows them, and foreign JSON sources are an accepted input. Low because `enableTryItOut` is off by default and the data source is normally trusted.
- **Why it matters for a consumer:** Same stored-XSS class as SEC-36, via the try-it-out controls when a route name contains quote characters or the artifact is foreign.
- **Recommendation:** Stop using inline `onclick`: render the button with escaped `data-route`/`data-version` attributes and bind via `addEventListener` in the same pass that binds the `.endpoint` click toggles. This also removes a blocker for strict CSP (SEC-38).

### SEC-38 — Docs page requires `script-src 'unsafe-inline'` — incompatible with any strict CSP

- **File:** `packages/docs-ui/src/docsHtml.ts:196-387` (`:196`), inline `onclick` at `:241`; registry `packages/server/src/securityHeadersRegistry.ts:4-5`
- **Area:** pkg-docs-ui
- **Evidence/description:** The page is one inline `<script>` block (docsHtml.ts:196-387) plus inline `onclick` handlers (`:241`). The framework explicitly invites consumers to register a Content-Security-Policy via `registerSecurityHeaders` (applied to every response including this one), but any policy without `'unsafe-inline'` breaks the docs page silently. Dev-only by default so impact is low, yet the advertised `enabledInProd` developer-portal use case collides directly with a hardened CSP.
- **Why it matters for a consumer:** A consumer who hardens their CSP (as the framework encourages) silently breaks the docs UI, and the in-prod developer-portal use case forces a choice between the docs and a strict CSP.
- **Recommendation:** Generate a per-response nonce in `mountDocsUi`, stamp it on the `<script>` tag, expose it to the template builder, and replace inline `onclick` with `addEventListener` (see SEC-37). Optionally document the interaction in `docs/theming.md` until implemented.

### SEC-39 — `Sentry.init` `beforeSend` strips `request.cookies` but not `cookie`/`authorization` headers

- **File:** `packages/error-tracking/src/sentry.ts:97`; docs `sentry-integration.md`, `auto-instrumentation.md`
- **Area:** pkg-error-tracking
- **Evidence/description:** The built-in redaction only does `delete event.request.cookies`. `event.request.headers` (which can carry `cookie` and `authorization` with the session bearer token when Sentry's http integration attaches request data) is left intact. Mitigated in practice because `@sentry/node` defaults `sendDefaultPii: false`, which already filters these — hence low — but the docs present this `beforeSend` as the redaction layer, and the consumer cannot harden it since the init options are not extensible (see the separate configurability finding outside this dimension).
- **Why it matters for a consumer:** If a consumer enables `sendDefaultPii` or relies on the documented redaction layer, session bearer tokens in request headers still reach Sentry.
- **Recommendation:** Also delete `event.request.headers.cookie` and `event.request.headers.authorization` (case-insensitive) in the built-in `beforeSend`, and/or let consumers supply an SDK-level `beforeSend` via `registerSentryConfig`.

### SEC-40 — `forgotPassword` logs user e-mail (PII) at info/warn level on every request

- **File:** `packages/login/src/forgotPassword.ts:30` (also `:61`, `:70`, `:113`)
- **Area:** pkg-login
- **Evidence/description:** `getLogger().info('[forgotPassword] start', { email, ... })` plus lines 61, 70, 113 emit the raw e-mail address (attacker-supplied for unmatched lookups) into the log stream on every reset request, including unauthenticated probes. PII retention in logs is a GDPR concern for the framework's target consumers, and the unmatched-email warn line can fill logs from enumeration probes. Low because logs are server-side only.
- **Why it matters for a consumer:** Persistent PII (and probe-driven log inflation) in the consumer's log store, a compliance exposure for EU-facing apps.
- **Recommendation:** Mask the address (e.g. `m***@domain`) or register `email` in core's `registerRedactedLogKeys` path; demote the per-request start line to `debug` behind `logging.devLogs`.

### SEC-41 — Client-forgeable `intentionalDisconnect` lets any client opt out of disconnect session teardown

- **File:** `packages/presence/src/activity/lifecycle.ts:126-133` (`:126`); effect at `:88-91`
- **Area:** pkg-presence
- **Evidence/description:** The `intentionalDisconnect` socket event is fully client-controlled: emitting it adds the token to `clientSwitchedTab`, which both shortens the grace window AND sets `deleteSessionOnDisconnect = false` (lifecycle.ts:88-91), so the session survives in Redis until its TTL instead of being deleted on disconnect. A client that always emits this before disconnecting permanently bypasses delete-session-on-disconnect. Low because the client only preserves its own session (no escalation) and the Redis TTL still bounds it — but it silently weakens whatever security property the disconnect-delete was meant to provide, and the trade-off is undocumented.
- **Why it matters for a consumer:** A consumer relying on disconnect-time session deletion as a security boundary has it silently defeated by any client emitting one event.
- **Recommendation:** Document the trust model in `docs/disconnect-grace.md` (tab-switch signal is client-asserted; session-on-disconnect deletion is best-effort, TTL is the real bound). Optionally rate-limit/ignore repeat `intentionalDisconnect` per connection or make tab-switch's `deleteSessionOnDisconnect` configurable.

### SEC-42 — `getCachedResolution` returns live object holding all resolved raw secrets, no redaction option

- **File:** `packages/secret-manager/src/index.ts:418`
- **Area:** pkg-secret-manager
- **Evidence/description:** `export const getCachedResolution = (): CachedResolution | null => cachedResolution;` hands out the internal mutable reference whose `values` map is `pointer -> RAW secret value` for every secret. The JSDoc sells it as "for diagnostics" with no warning — the obvious consumer move (dump it into a `/health` or debug endpoint, or a log line) leaks every secret at once; the returned reference is also mutable, so consumer code can corrupt the cache. `SECURITY_AUDIT.md` item 11 said "treat `getCachedResolution()` output as sensitive" but only the response-filtering half was implemented; the sensitivity half was not actioned, so this is the residual rather than a re-report. Low because it requires consumer misuse.
- **Why it matters for a consumer:** A consumer following the "diagnostics" framing can trivially serialize every raw secret into a response or log, or accidentally mutate the live secret cache.
- **Recommendation:** Return a defensive copy; add a prominent JSDoc warning ("contains raw secret values — never serialize into responses/logs"); consider a redacted default, e.g. `getCachedResolution({ redact = true })` returning `{ fetchedAt, pointers: string[] }` unless values are explicitly requested.

### SEC-43 — Non-timing-safe comparisons for CSRF tokens and `TEST_RESET_TOKEN`

- **File:** `packages/server/src/httpRoutes/csrfMiddleware.ts:81` (also `:54`); `packages/server/src/httpRoutes/testResetRoute.ts:26`
- **Area:** pkg-server
- **Evidence/description:** Secret comparisons use plain `===`/`!==`: csrfMiddleware.ts:54 (`provided === cookieValue`), csrfMiddleware.ts:81 (`provided === csrfSession.csrfToken`), and testResetRoute.ts:26 (`req.headers['x-test-reset-token'] !== requiredToken`). `timingSafeEqual` is used nowhere in framework code (only a docs webhook example). Remote timing attacks against V8 string comparison of 64-char hex tokens are largely theoretical, and `/_test/reset` is dev/test-gated — hence low — but a security-first framework should set the example its own docs teach.
- **Why it matters for a consumer:** A theoretical timing side-channel on CSRF/test-reset tokens, and an inconsistency with the framework's own security guidance.
- **Recommendation:** Add a shared `timingSafeStringEqual(a, b)` helper in `@luckystack/core` (length check + `crypto.timingSafeEqual` over utf8 buffers) and use it at all three sites.

### SEC-44 — Static `/assets/` path handed to consumer `serveFile` without normalization or dot-segment rejection

- **File:** `packages/server/src/httpRoutes/staticRoutes.ts:35-43` (`:41`)
- **Area:** pkg-server
- **Evidence/description:** `handleStaticAndSpaFallback` matches `routePath.includes('/assets/')` and forwards `routePath.slice(routePath.indexOf('/assets/'))` verbatim to the consumer's `serveFile`. `routePath` is the raw, un-decoded `req.url` prefix — `/assets/../.env` or `/assets/%2e%2e/...` passes through untouched. Traversal protection is left entirely to the consumer handler; a naive `serveFile` (`path.join(root, url)` + decode) is exploitable. Defense-in-depth gap in framework code; low because the shipped template handler and Vite middleware are safe.
- **Why it matters for a consumer:** A consumer who writes their own `serveFile` without traversal guards inherits a path-traversal hole the framework could have closed centrally.
- **Recommendation:** Before delegating: `decodeURIComponent` in a `tryCatchSync`, reject paths containing `..` segments or NUL bytes with 400, and `path.posix.normalize` the asset path. Same guard before the `KNOWN_STATIC_FILE_REGEX` branch.

### SEC-45 — `ctx.session.login` mints real Redis sessions with `Math.random` tokens and no run-level cleanup

- **File:** `packages/test-runner/src/customTests.ts:235` (teardown gap at `:418`)
- **Area:** pkg-test-runner
- **Evidence/description:** `buildSessionHelpers` creates a server-accepted session token as `const token = \`test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}\`;` (line 235) and persists it via `saveSession(token, sessionData, true)`. `Math.random` is not cryptographically secure and the timestamp prefix is guessable, so the effective entropy is ~41 bits of non-CSPRNG output with a known structure. These are real sessions in the same Redis the server reads. `runCustomTests` never calls `session.logout()` in teardown (per-case cleanup at line 418 only closes watchers), so sessions outlive the run until TTL. Low because `/_test/reset` gating means this only matters on a network-reachable dev/staging instance — but that is exactly the deployment the `TEST_RESET_TOKEN` docs anticipate.
- **Why it matters for a consumer:** On a reachable staging box, a guessable `test-*` session is an authenticated foothold that lingers after the test run.
- **Recommendation:** Use `crypto.randomUUID()` or `crypto.randomBytes(24).toString('base64url')` for the token (drop the predictable prefix or keep `test-` purely as a namespace), and call `deleteSession` for any still-active `state.token` in the per-case teardown next to `closeAllWatchers`.

### SEC-46 — Auth-enforcement layer asserts only the `errorCode` string, never the HTTP status code

- **File:** `packages/test-runner/src/authEnforcementCheck.ts:81-102` (`:92`); contract claim `README.md:45`
- **Area:** pkg-test-runner
- **Evidence/description:** `runAuthEnforcementCheck` passes whenever the JSON body is `{ status: 'error', errorCode: 'auth.required' }` (lines 81-102) — `response.status` is recorded but never asserted, even though `README.md:45` promises the layer verifies "the framework's standard 401 shape". An endpoint (or a consumer's `registerErrorFormatter`) that returns HTTP 200 with an `auth.required` body would pass the sweep, and intermediaries/caches treat 200 differently from 401. Low: the guard still proves the request was blocked; only the status-code half of the contract is unverified.
- **Why it matters for a consumer:** The auth sweep can green-light an endpoint that returns the right body with the wrong status, masking a misconfigured error formatter that breaks caches/intermediaries.
- **Recommendation:** Add `if (response.status !== 401) return { status: 'fail', reason: \`expected HTTP 401, got ${response.status}\` }` (optionally behind an `expectedHttpStatus?: number` input for consumers with custom formatters).

### SEC-47 — `scaffold:page` accepts `..` segments and can write outside `src/` (and outside the repo)

- **File:** `scripts/scaffoldPage.mjs:54`, `:63`; same shape in `scripts/scaffoldRouteTest.mjs:55`, `:203`; both template mirror copies
- **Area:** tooling
- **Evidence/description:** `normalizedArg` (line 54) strips leading/trailing slashes but never rejects `..` segments; `validatePagePath` only checks reserved `_` folders, and `..` passes as a "visible" segment. Line 63 then does `path.join(SRC_DIR, ...folderSegments, 'page.tsx')`, so `npm run scaffold:page ../../../somewhere/evil` resolves and writes `page.tsx` outside `src/` and outside the repo. Threat model is soft (local dev tool) BUT `CLAUDE.md` Rule 8 lists scaffold commands as AI-autonomous, so a confused/prompt-injected agent can be steered into writing files at arbitrary paths without a permission prompt. Same construction exists in `scaffoldRouteTest.mjs` (page joined at line 55, write at 203 — partially mitigated by requiring an existing route file) and both template mirrors.
- **Why it matters for a consumer:** An AI agent running the autonomous scaffold command can be steered (via prompt injection) into writing files anywhere on disk, with no permission gate.
- **Recommendation:** After computing `absoluteTargetPath`, assert containment: `if (!path.resolve(absoluteTargetPath).startsWith(SRC_DIR + path.sep)) fail('path escapes src/')` — or reject any segment equal to `..` up front. Apply to `scaffoldPage.mjs`, `scaffoldRouteTest.mjs`, and their template mirrors.

### SEC-48 — GitHub Actions workflows run with default token permissions and tag-pinned actions

- **File:** `.github/workflows/ci.yml:1`; mirror `packages/create-luckystack-app/template/.github/workflows/ci.yml`
- **Area:** tooling
- **Evidence/description:** Neither `.github/workflows/ci.yml` nor the consumer-shipped copy declares a `permissions:` block, so `GITHUB_TOKEN` gets the repo-default permission set (write on older-default repos). Actions are pinned by mutable tag (`actions/checkout@v4`, `actions/setup-node@v4`) rather than commit SHA. For a CI that runs `npm ci` + arbitrary build scripts on `pull_request`, this is standard supply-chain hardening that is missing — and the template version propagates the gap into every scaffolded project.
- **Why it matters for a consumer:** Every scaffolded project inherits a CI with over-broad token scope and mutable action pins — a supply-chain footgun if an action tag is hijacked or a malicious PR runs.
- **Recommendation:** Add top-level `permissions: contents: read` to both workflow files and pin actions to full commit SHAs (e.g. `actions/checkout@<sha> # v4`). Low urgency, cheap, and it ships to every consumer.
