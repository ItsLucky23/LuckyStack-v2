# server — Verified & Merged Audit Findings
Sources: reports/server.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
Both scans were re-checked against the current `packages/server/src` surface. Almost every finding is still LIVE — the package edge code was not meaningfully altered by commit 302cbf1 ("login/wizard/cli flow") or the uncommitted working-tree edits, which touched the consumer app and docs, not the server package internals. Of the 24 merged findings: 18 CONFIRMED, 1 PARTIALLY-FIXED, 4 REFUTED/clarified (mostly docs-drift or theoretical), 1 UNCERTAIN. The single biggest live issue is **SEC-10** — `socket.join(token)` in the reconnect rejoin block still runs BEFORE the session is validated, so an unauthenticated socket that names a private room as its "token" is silently joined to that room and receives its sync fan-out; this is High and unambiguously present at `loadSocket.ts:414`. The two scans largely agreed; where the older review/ scan called something High that reports/ down-graded (e.g. SEC-09 unhandled-rejection DoS vs reports/'s "no top-level tryCatch" note), the code confirms the review/ severity — there is still no top-level guard in `handleHttpRequest` and the call site is `void`-dispatched. The older review/ scan's only genuinely stale claims are docs-drift items (QUA-082 CSRF doc) where the code already grew the login-absent branch the doc omits — i.e. the CODE is ahead of the doc, the inverse of the usual staleness.

## Findings

### SEC-10 — `socket.join(token)` before session validation lets a forged token subscribe to any room · severity: high · status: CONFIRMED
- **Sources:** review(SEC-10) / reports(Hooks gap, partial)
- **Current location:** `packages/server/src/loadSocket.ts:412-421` (`await socket.join(token)` at :414, `readSession` at :415)
- **Original claim:** The reconnect rejoin block joins `socket.join(token)` from attacker-controlled handshake data before any session check, and `preRoomJoin` never fires, so an unauthenticated socket can join any room by naming it as its token.
- **Verification (current code):** The block is unchanged. `const token = extractTokenFromSocket(socket)` (line 120) is fully client-controlled (cookie/header). At line 414 `await socket.join(token)` runs first; line 415 then reads the session. If the session is null, `getSessionRoomCodes(null→[])` returns `[]` so no `roomCodes` are replayed — BUT the socket is already a member of the room named `token`. The Socket.io CORS callback (line 91) allows origin-less (non-browser) clients. No `preRoomJoin`/`preRoomRejoin` hook runs on this path (the hook only fires in the explicit `joinRoom` handler at line 210). Any sync fan-out to that room reaches this socket.
- **Verdict & why:** CONFIRMED and the most serious live issue in the package. The explicit `joinRoom` handler (line 199-237) correctly validates session + runs `preRoomJoin` first; the rejoin block does neither for the private token-room join.
- **Recommendation:** Reorder: `const session = await readSession(token); if (!session) return;` BEFORE any `socket.join(token)`. Only then join the token room and `getSessionRoomCodes(session)`. Optionally run `preRoomJoin` per replayed roomCode on reconnect.

### SEC-09 — No top-level error guard in the HTTP pipeline (single-request unhandledRejection DoS) · severity: high · status: CONFIRMED
- **Sources:** review(SEC-09)
- **Current location:** `packages/server/src/createServer.ts:125-127` (`void handleHttpRequest(...)`); `packages/server/src/httpHandler.ts:208-307` (no top-level tryCatch); unwrapped awaits at `staticRoutes.ts:42,53,71`, `authCallbackRoute.ts:59`, `httpHandler.ts:165,280`
- **Original claim:** `handleHttpRequest` is dispatched as `void handleHttpRequest(req,res,options)` with no `.catch`, and the function body has no top-level tryCatch; any throw from a consumer `serveFile`, a Redis blip during `refreshSessionCookieIfPresent`, etc. becomes an unhandledRejection — fatal by default on Node ≥ 15.
- **Verification (current code):** `createServer.ts:126` is still `void handleHttpRequest(req, res, options);` with no `.catch`. `handleHttpRequest` (httpHandler.ts:208) has no enclosing tryCatch. `refreshSessionCookieIfPresent` (line 280) awaits `readSession` unguarded; `serveWithRewrittenUrl` awaits `serveFile` with only a `finally` that restores `req.url` (no catch). No `process.on('unhandledRejection')` handler exists in the package.
- **Verdict & why:** CONFIRMED. review/ rated this High; reports/ noted "no top-level tryCatch" without a severity. The code confirms a remotely-triggerable crash path, so High is the right call.
- **Recommendation:** Wrap the `handleHttpRequest` body (or the call site `.catch`) to log + captureException + respond 500 when `!res.writableEnded`. Individually guard the consumer `serveFile`/`serveFavicon` awaits.

### SEC-13 — `/_health` exposes unsalted SHA-256 of synchronized env secrets + bootUuid + envKey, unauthenticated · severity: medium · status: CONFIRMED
- **Sources:** review(SEC-13) — merged pkg-server + pkg-core
- **Current location:** `packages/server/src/httpRoutes/healthRoutes.ts:77-91`; `packages/core/src/synchronizedEnvHashes.ts:29-37`
- **Original claim:** `handleHealthRoute` answers any unauthenticated GET with `{ bootUuid, envKey, synchronizedHashes }`; the hashes are plain unsalted `sha256(value)` of the deployConfig `synchronizedEnvKeys` (shared secrets), enabling key-name disclosure + offline dictionary attack on low-entropy secrets.
- **Verification (current code):** Exact match. `handleHealthRoute` has no token/origin/IP gate and returns `bootUuid`, `resolveEnvKey()`, and `computeSynchronizedEnvHashes()`. `synchronizedEnvHashes.ts:15-17` is `createHash('sha256').update(value).digest('hex')` — no salt, no HMAC. No `healthExposeHashes` config knob exists.
- **Verdict & why:** CONFIRMED. Medium is correct (high-entropy secrets aren't practically recoverable from SHA-256, but key names + low-entropy values + stable bootUuid fingerprint all leak).
- **Recommendation:** HMAC the hashes with a per-handshake shared secret (or at minimum salt with bootUuid), and add `http.healthExposeHashes` (default false) returning only `{ status }` to unauthenticated callers.

### SEC-23 — OAuth authorize endpoint unauthenticated and not rate-limited (unbounded Redis state-key writes) · severity: medium · status: CONFIRMED
- **Sources:** review(SEC-23)
- **Current location:** `packages/server/src/httpRoutes/authApiRoute.ts:49-67` (rate-limit block at :70-96, BELOW the early return)
- **Original claim:** The full-OAuth branch calls `login.createOAuthState(provider.name)` (a Redis SETNX+TTL write) and 302-redirects for every unauthenticated GET; the per-IP `checkRateLimit` only guards the credentials branch which is after the early `return true`.
- **Verification (current code):** Confirmed exactly. `if (login.isFullOAuthProvider(provider))` (line 49) creates state and `return true` at line 66 — the `checkRateLimit` block at lines 70-96 is never reached for the OAuth-authorize path. A scripted client mints unbounded `*-oauth-state:*` keys.
- **Verdict & why:** CONFIRMED. Unauthenticated Redis-amplification DoS, bounded only by state TTL.
- **Recommendation:** Move `checkRateLimit` above the `isFullOAuthProvider` branch (key `ip:<ip>:auth:oauth-state`), or add a dedicated `rateLimiting.authLimit` applied to all `/auth/api/*`.

### MIS-017 — No per-account brute-force protection on credentials login · severity: medium · status: CONFIRMED
- **Sources:** review(MIS-017)
- **Current location:** `packages/server/src/httpRoutes/authApiRoute.ts:69-96`
- **Original claim:** The only login defense is a per-IP `checkRateLimit` using the GENERAL `defaultApiLimit`; no per-account keying, no dedicated auth knob, and `defaultApiLimit: false` removes ALL login throttling.
- **Verification (current code):** Confirmed. The limit key is `ip:${requesterIp}:auth:credentials` with `limit: rateLimiting.defaultApiLimit`, and the whole block is gated on `defaultApiLimit !== false && > 0` — so setting it false silently disables login throttling. No `email:<hash>` per-account counter; `@luckystack/login` has no lockout logic.
- **Verdict & why:** CONFIRMED. Per-account throttling is table-stakes and absent; achievable via the `preLogin` hook but not framework-owned.
- **Recommendation:** Add `rateLimiting.auth: { perIp, perAccount, windowMs, lockoutMs? }` and a second `checkRateLimit` keyed on `sha256(email)` counting only failed attempts.

### MIS-016 — No graceful shutdown: no close(), dev SIGINT/SIGTERM hard-exit, no onShutdown hook · severity: medium · status: CONFIRMED
- **Sources:** review(MIS-016)
- **Current location:** `packages/server/src/createServer.ts:105-106`; `RunningLuckyStackServer` in `types.ts`
- **Original claim:** Returned server exposes only `{ httpServer, ioServer, listen }`; dev signals map straight to `process.exit(0)`; prod has no signal handler; no `io.close()`, Redis/Prisma disconnect, or `onShutdown` hook.
- **Verification (current code):** Confirmed. `process.once('SIGINT', () => process.exit(0))` and the same for SIGTERM at lines 105-106, only inside the `enableDevTools` branch (so prod has nothing). `createServer` returns `{ httpServer, ioServer, listen }` (line 186) — no `close`. No `onShutdown` hook in core's HookPayloads.
- **Verdict & why:** CONFIRMED. Medium — consumers CAN hand-roll using the returned handles, but every prod deploy needs draining.
- **Recommendation:** Add `close(opts?)` to the returned server (stop accept → `io.close()` → drain → dispatch new `onShutdown` hook → disconnect Redis/Prisma) and wire SIGTERM/SIGINT to it in prod too.

### HOK-15 — No postHttpRequest hook (latency/status for the full HTTP surface) · severity: medium · status: CONFIRMED
- **Sources:** review(HOK-15)
- **Current location:** `packages/server/src/httpHandler.ts:250` (`preHttpRequest` dispatched); `packages/core/src/hooks/types.ts:301` (only `preHttpRequest` in the map)
- **Original claim:** Pipeline dispatches `preHttpRequest` but has no post counterpart; no hook carries final statusCode + duration for static/SPA/auth/custom/403 paths — so the "latency timer" `preHttpRequest`'s own comment advertises can never be stopped.
- **Verification (current code):** Confirmed. `dispatchHook('preHttpRequest', ...)` at line 250 (comment even says "latency timer"). Grep of `core/src/hooks/types.ts` returns only `preHttpRequest: PreHttpRequestPayload` — no `postHttpRequest`. `postApiRespond`/`postSyncFanout` cover only `/api` and `/sync`.
- **Verdict & why:** CONFIRMED. Genuine extensibility gap for access logs / RED metrics over the whole surface.
- **Recommendation:** Add a `postHttpRequest` hook fired after dispatch with `{ statusCode, durationMs, routePath, requestId }`.

### CFG-22 / Hard-block — Socket.io ServerOptions not pass-through (only 3 keys) · severity: medium · status: CONFIRMED
- **Sources:** reports(Hard blocks + Missing config) / review(CFG-22) — both
- **Current location:** `packages/server/src/loadSocket.ts:87-102`; `LoadSocketOptions` at :78-80
- **Original claim:** `new SocketIOServer(httpServer, { cors, maxHttpBufferSize, pingTimeout, pingInterval })` — only those keys are settable. No `transports`, `path`, `connectionStateRecovery`, `perMessageDeflate`, `allowUpgrades`, `connectTimeout`, `allowRequest`. Structural dead-end without forking.
- **Verification (current code):** Confirmed exactly. The constructor hardcodes those four properties; `LoadSocketOptions` exposes only `maxHttpBufferSize`; `projectConfig.socket` carries only the three numerics. No spread of an arbitrary options bag.
- **Verdict & why:** CONFIRMED. reports/ called it a "structural dead end" and a hard block; review/ rated it Medium configurability. Both are right — it's a real limitation; Medium severity fits.
- **Recommendation:** Add `socket.serverOptions?: Partial<ServerOptions>` to ProjectConfig (or `ioOptions` on `LoadSocketOptions`/`CreateLuckyStackServerOptions`) spread LAST, documenting that cors/origin stays framework-owned.

### CFG-23 — OVERLAY_ORDER is a fixed whitelist; unknown subfolders + nested files silently skipped · severity: medium · status: CONFIRMED
- **Sources:** review(CFG-23) — merged pkg-server + overlays
- **Current location:** `packages/server/src/bootstrap.ts:38-56` (loader at :63-93, non-recursive `readdirSync` at :86)
- **Original claim:** `loadOverlayFolder` iterates only the hardcoded `OVERLAY_ORDER` and reads only top-level `*.ts`/`*.js`; any other subfolder (`stripe`, `monitoring`, a typo `logins`) or nested file is skipped with zero warning; no `overlayOrder`/`extraOverlayPackages` option.
- **Verification (current code):** Confirmed. `OVERLAY_ORDER` is the fixed 8-element array; the loop `for (const packageName of OVERLAY_ORDER)` skips anything else (`continue` at :76 when the dir is absent, never iterating unknown dirs at all). `fs.readdirSync(packageDir)` is non-recursive. `BootstrapLuckyStackOptions` exposes only `overlayRoot` + `skipOverlayLoad`. No boot warning for unloaded subfolders.
- **Verdict & why:** CONFIRMED. Both a configurability gap and a silent-failure trap.
- **Recommendation:** After walking OVERLAY_ORDER, load remaining subfolders alphabetically (last-writer-wins is already safe) or add `overlayOrder`/`extraOverlayPackages`; emit a boot warning for any unloaded `luckystack/` subfolder or nested `.ts`.

### QUA-009 — Bootstrap empty catch silently swallows optional-package `/register` failures · severity: high · status: CONFIRMED
- **Sources:** review(QUA-009, merged pkg-email/pkg-server/overlays)
- **Current location:** `packages/server/src/bootstrap.ts:111-119` (`importIfExistsSpecifier`); victim `packages/email/src/register.ts:19`
- **Original claim:** `importIfExistsSpecifier` is `try { await import(specifier); } catch { /* empty */ }` — a register module that throws DURING import (peer-dep guard, syntax error) never logs, so `RESEND_API_KEY` set + `resend` not installed boots silently with no sender; the same applies to every optional package's register.
- **Verification (current code):** Confirmed. `importIfExistsSpecifier` (lines 111-119) has a bare `catch { }` with only a comment, no `getLogger().error`/`captureException`. `email/src/register.ts:19` is a module-level `registerEmailSender(autoSelectEmailSender())` — a factory-time throw lands inside this swallowed import.
- **Verdict & why:** CONFIRMED. This neutralizes the documented fail-loud peer-dep guard on the default 0.2.0 auto-wire path. review/ rated it High (from the email-victim angle); the server-side root cause is real and unchanged.
- **Recommendation:** In the catch, `getLogger().error('[luckystack:bootstrap] <specifier> failed to load — feature disabled', { err })` + captureException; consider hard-failing when the feature's env keys ARE set.

### QUA-016 — Overlay loader dynamic-imports consumer `.ts` at runtime; broken/silently-skipped under prod `node dist/server.js` · severity: high · status: CONFIRMED (server-side mechanism); deploy impact UNCERTAIN
- **Sources:** review(QUA-016)
- **Current location:** `packages/server/src/bootstrap.ts:58-61, 81-91`
- **Original claim:** `loadOverlayFolder` does `await import(pathToFileURL(filePath).href)` on `<ROOT>/luckystack/**/*.ts`; under the documented prod entry `node dist/server.js`, esbuild can't follow the fs-driven import → either ERR_UNKNOWN_FILE_EXTENSION on `.ts`, or (dist-only deploy) `fs.existsSync` fails and ALL overlays silently skip.
- **Verification (current code):** The server-side mechanism is confirmed: `importIfExists` (line 58-61) gates on `fs.existsSync(filePath)` then `await import(pathToFileURL(filePath).href)`, and the loader resolves `.ts` candidates (`index.ts`, then `*.ts` at :89). If `luckystack/` is absent next to dist, every overlay is silently skipped (no log). The `.ts`-in-prod failure depends on the actual bundling/deploy contents, which I did not execute.
- **Verdict & why:** CONFIRMED that the loader imports raw `.ts` by fs path and silently no-ops when the folder is absent; the precise prod crash-vs-skip outcome is UNCERTAIN without an executed prod boot. Either branch is a real footgun.
- **Recommendation:** Pick an explicit prod story (static overlay-index injection at bundle time, or compile `luckystack/**` to `dist/luckystack/*.js`), and at minimum log every overlay file loaded/skipped at boot + document the Node-version + deploy-contents requirement in HOSTING.md.

### QUA-043 — withSessionLock serializes per-process only; cross-instance roomCodes RMW race · severity: medium · status: CONFIRMED
- **Sources:** review(QUA-043)
- **Current location:** `packages/server/src/loadSocket.ts:36-49` (RMW in join/leave at :223-228, :282-287)
- **Original claim:** `withSessionLock` is an in-memory `Map<string, Promise>`, so join/leave/updateLocation read-modify-write of `session.roomCodes` is serialized only within one instance; two tabs on two instances both do readSession→spread→writeSession and the last writer drops the other's roomCode.
- **Verification (current code):** Confirmed. `sessionLocks` is a module-level `Map` (line 36); join does `readSession` (line 200) → `getSessionRoomCodes` → spread → `writeSession` (line 228); leave mirrors it. Nothing uses the cross-instance `acquireLease`/`releaseLease` core primitives for this. The session blob lives in shared Redis.
- **Verdict & why:** CONFIRMED. Multi-instance is the documented scaling path, so the race is reachable. Medium (intermittent, only loses replay membership on reconnect).
- **Recommendation:** Wrap the RMW in `acquireLease('session-lock:<token>')` or store roomCodes as a Redis SET (SADD/SREM) instead of a session field; document the limitation in ARCHITECTURE_MULTI_INSTANCE.md.

### SEC-22 / M2 — Session token leaks into redirect query string in based-token OAuth callback · severity: medium · status: CONFIRMED
- **Sources:** reports(M2) / review(SEC-22) — both
- **Current location:** `packages/server/src/httpRoutes/authCallbackRoute.ts:64-66`
- **Original claim:** When `config.session.basedToken`, the callback 302-redirects with the fresh token in the query string (`Location: ${redirectUrl}${separator}token=${newToken}`); query strings leak via Referer, history, proxy logs. Inconsistent with credentials-login which uses the `X-Session-Token` header.
- **Verification (current code):** Confirmed exactly at lines 64-66. By contrast `authApiRoute.ts:131` delivers the token via `res.setHeader('X-Session-Token', ...)` for the same based-token mode — so the two paths are inconsistent as both scans noted.
- **Verdict & why:** CONFIRMED. Both scans agree (reports Medium, review Medium).
- **Recommendation:** Deliver the token in the URL FRAGMENT (`#token=`), read+stripped client-side via `history.replaceState`, or use a one-time short-TTL exchange code swapped over POST.

### M3 — Origin-exempt paths reflect arbitrary request Origin into ACAO with credentials · severity: medium · status: CONFIRMED
- **Sources:** reports(M3)
- **Current location:** `packages/server/src/httpHandler.ts:127-129` then `:41-49`
- **Original claim:** For `isOriginExemptPath(routePath)` the gate is skipped (`return { origin, rejected: false }` without validating origin), then `setSecurityHeaders` reflects the raw request Origin into `Access-Control-Allow-Origin` plus `Access-Control-Allow-Credentials: true`.
- **Verification (current code):** Confirmed. `enforceOriginPolicy` returns the unvalidated `origin` for exempt paths (line 128). `setSecurityHeaders` (called unconditionally at line 233) does `res.setHeader('Access-Control-Allow-Origin', origin)` (line 43) and `if (cors.credentials) ... 'Access-Control-Allow-Credentials', 'true'` (line 47-49). So a browser-driven cross-origin credentialed request to a webhook prefix gets its origin reflected.
- **Verdict & why:** CONFIRMED, Medium-leaning-low as reports noted (webhook handlers should reject unsigned callers and rarely return secrets).
- **Recommendation:** On exempt paths, omit CORS reflection or still pass the Origin through `allowedOrigin()` for the header decision.

### SEC-44 / M1 — `/assets/*` static branch does no path-traversal validation, bypasses the char-restricted regex · severity: medium · status: CONFIRMED
- **Sources:** reports(M1) / review(SEC-44) — both
- **Current location:** `packages/server/src/httpRoutes/staticRoutes.ts:35-43`
- **Original claim:** The `/assets/` branch matches `routePath.includes('/assets/')` then slices and forwards the raw, un-decoded URL to consumer `serveFile` with no `..`/encoded-traversal rejection — unlike the `KNOWN_STATIC_FILE_REGEX` branch which forbids those chars. Traversal safety left entirely to the consumer; no documented contract.
- **Verification (current code):** Confirmed. Line 35 `if (routePath.includes('/assets/'))`, line 41 `routePath.slice(routePath.indexOf('/assets/'))` → `serveWithRewrittenUrl(... assetPath)`. No `decodeURIComponent`, no `..` check, no `path.normalize`. The regex branch (line 6/47) is strict but the `/assets/` branch is reached first and is permissive.
- **Verdict & why:** CONFIRMED, Medium. reports rated M1 Medium; review rated SEC-44 Low (noting the shipped template handler + Vite middleware are safe). Resolution: the framework owns the edge and provides zero defense-in-depth, so Medium is the fair call — the risk materializes for any consumer who hand-rolls `serveFile`.
- **Recommendation:** Before delegating: `decodeURIComponent` in a `tryCatchSync`, reject `..` segments / NUL bytes with 400, `path.posix.normalize` the asset path. Document the `serveFile` traversal-safety contract.

### SEC-43 / L1 — Non-timing-safe comparisons for CSRF tokens and TEST_RESET_TOKEN · severity: low · status: CONFIRMED
- **Sources:** reports(L1) / review(SEC-43) — both
- **Current location:** `packages/server/src/httpRoutes/csrfMiddleware.ts:54, 81`; `packages/server/src/httpRoutes/testResetRoute.ts:26`
- **Original claim:** Token comparisons use plain `===`/`!==` (`provided === cookieValue`, `provided === csrfSession.csrfToken`, `req.headers['x-test-reset-token'] !== requiredToken`); no `crypto.timingSafeEqual`.
- **Verification (current code):** Confirmed at all three sites: csrfMiddleware.ts:54 (`provided === cookieValue`), :81 (`provided === csrfSession.csrfToken`), testResetRoute.ts:26 (`!== requiredToken`).
- **Verdict & why:** CONFIRMED, Low. Network-side timing attacks on 32/64-byte hex tokens are largely theoretical, and `/_test/reset` is dev/test-gated. Hardening only.
- **Recommendation:** Add a `timingSafeStringEqual(a, b)` helper in `@luckystack/core` (length check + `crypto.timingSafeEqual`) and use it at all three sites.

### CFG-21 — OAuth authorize URL hardcodes `prompt=select_account`, no extra-params knob · severity: medium · status: CONFIRMED
- **Sources:** review(CFG-21)
- **Current location:** `packages/server/src/httpRoutes/authApiRoute.ts:62-64`
- **Original claim:** The authorize URL is built with exactly six fixed params including hardcoded `&prompt=select_account`; the OAuthProvider interface has no extra-authorization-params field, blocking Google offline access (`access_type=offline&prompt=consent`), `prompt=none`, OIDC `nonce`, Auth0 `audience`, Microsoft `domain_hint`.
- **Verification (current code):** Confirmed. Line 63 template literal: `...&response_type=code&prompt=select_account&state=${state}` — no spread of provider-supplied extra params.
- **Verdict & why:** CONFIRMED. Realistic provider needs are blocked even for custom registered providers.
- **Recommendation:** Add `extraAuthorizationParams?: Record<string,string>` to OAuthProvider (with `prompt` defaulting to `select_account`); spread into the URLSearchParams.

### SEC-24 — No PKCE support in the OAuth authorization redirect · severity: medium · status: CONFIRMED
- **Sources:** review(SEC-24)
- **Current location:** `packages/server/src/httpRoutes/authApiRoute.ts:62-64`
- **Original claim:** The authorize URL has no `code_challenge`/`code_challenge_method`; the login package has no PKCE plumbing at all. OAuth 2.1 / current BCP recommends PKCE even for confidential clients (protects against auth-code injection).
- **Verification (current code):** Confirmed — the URL at line 63 contains only `client_id, redirect_uri, scope, response_type, prompt, state`; no PKCE params. (Login-package PKCE absence is consistent with the URL having nothing to send.)
- **Verdict & why:** CONFIRMED. A baseline gap relative to current OAuth guidance; `state` mitigates CSRF but not code injection. Medium — bounded by confidential-client secret + state, but a security-first framework should close it.
- **Recommendation:** Generate a `code_verifier` alongside the state, store it in the Redis state record, send the S256 `code_challenge` in the authorize URL, pass the verifier at token exchange. Gate via a per-provider `pkce` flag.

### QUA-080 — Type-erasing `as` cast on loginWithCredentials result · severity: low · status: CONFIRMED
- **Sources:** review(QUA-080)
- **Current location:** `packages/server/src/httpRoutes/authApiRoute.ts:101-106`
- **Original claim:** authApiRoute casts the awaited result to a hand-written structural shape because `loginWithCredentials` has an inferred union return with no explicit contract; a shape change compiles silently and breaks at runtime.
- **Verification (current code):** Confirmed. Lines 101-106: `(await login.loginWithCredentials(params, ...)) as { status; reason; newToken; session } | undefined`.
- **Verdict & why:** CONFIRMED, Low. The auth route's cross-package boundary is unchecked.
- **Recommendation:** Export an explicit `CredentialsLoginResult` discriminated union from `@luckystack/login`, annotate the method, drop the cast.

### L2 — Origin-exempt prefix match has no path boundary · severity: low · status: CONFIRMED
- **Sources:** reports(L2)
- **Current location:** `packages/server/src/originExemptRegistry.ts:36`
- **Original claim:** `isOriginExemptPath` is `exemptPaths.some((m) => routePath.startsWith(m.pathPrefix))`, so a registered prefix `/webhook` also exempts `/webhookadmin`, `/webhook-internal`.
- **Verification (current code):** Confirmed at line 36 — plain `startsWith`, no segment-boundary check. Consumer-controlled and docs advise a trailing-slash prefix, but the registry enforces nothing.
- **Verdict & why:** CONFIRMED, Low (consumer mitigates by registering `/webhooks/`).
- **Recommendation:** Match on `=== prefix` or `startsWith(prefix + '/')`.

### CFG-40 — Hardcoded static-file extension whitelist 404s robots.txt/sitemap.xml/fonts · severity: low · status: CONFIRMED
- **Sources:** review(CFG-40)
- **Current location:** `packages/server/src/httpRoutes/staticRoutes.ts:6` (extname branch at :58)
- **Original claim:** `KNOWN_STATIC_FILE_REGEX` allows only `png|jpg|jpeg|gif|svg|html|css|js` outside `/assets/`; any other extension hits the `path.extname` branch and 404s before serveFile — so `/robots.txt`, `/sitemap.xml`, `/manifest.json`, `.webp`, `.woff2`, `.map` all 404 by default.
- **Verification (current code):** Confirmed. Regex at line 6 lists exactly those 8 extensions; line 58 `if (path.extname(routePath))` returns 404 for any other extension before consulting `serveFile`.
- **Verdict & why:** CONFIRMED, Low. Workaround exists (`registerCustomRoute` runs before the static fallback).
- **Recommendation:** Make the list a `http.staticFileExtensions` knob (default-extended with txt,xml,json,ico,webp,woff,woff2,map), or pass unmatched-extension paths to `serveFile` (which 404s on miss anyway).

### HOK-27 — Origin-policy 403 (missing Origin, state-changing) dispatches no hook · severity: low · status: CONFIRMED
- **Sources:** review(HOK-27)
- **Current location:** `packages/server/src/httpHandler.ts:131-140`
- **Original claim:** `enforceOriginPolicy`'s no-origin fail-close branch ends with a bare `403 Forbidden` and dispatches nothing; the disallowed-origin branch gets `corsRejected` indirectly via core's `allowedOrigin`, but the missing-Origin rejection is invisible to monitoring.
- **Verification (current code):** Confirmed. The `if (!origin) { if (isStateChangingMethod) { ...403... } }` branch (lines 131-140) calls no `dispatchHook`. The `else if (!allowedOrigin(origin))` branch relies on core's `allowedOrigin` dispatching `corsRejected`.
- **Verdict & why:** CONFIRMED, Low. "403 with no log line" is the realistic webhook-wiring pain; the framework's other rejection paths all have hooks.
- **Recommendation:** Dispatch an `originRejected`/`corsRejected` hook (with a `reason: 'missing-origin'`) before the 403.

### argv PORT_PATTERN accepts out-of-range ports · severity: low · status: CONFIRMED
- **Sources:** reports(Code quality)
- **Current location:** `packages/server/src/argv.ts:23, 40-46`
- **Original claim:** `PORT_PATTERN = /^\d+$/` accepts out-of-range ports (`999999`, `0`) with no 1–65535 check; the bad value only surfaces as a later listen error.
- **Verification (current code):** Confirmed. `PORT_PATTERN = /^\d+$/` (line 23); `parseServerArgv` only tests `PORT_PATTERN.test(portArg)` then `Number.parseInt` (lines 40-46) — no range validation.
- **Verdict & why:** CONFIRMED, Low robustness nit.
- **Recommendation:** After parse, reject `port < 1 || port > 65535` with the same descriptive error.

### QUA-082 — security-defaults.md CSRF section drifted from csrfMiddleware (docs stale, code ahead) · severity: low · status: CONFIRMED (doc drift, code is correct)
- **Sources:** review(QUA-082) / reports(Docs gaps) — both
- **Current location:** `packages/server/docs/security-defaults.md:83-96` vs `csrfMiddleware.ts:30, 52-72`
- **Original claim:** The doc describes only the session-bound flow; the code additionally exempts `/auth/api/credentials` (session bootstrap) and has a complete login-ABSENT stateless double-submit-cookie path.
- **Verification (current code):** The CODE is correct and complete: csrfMiddleware.ts:30 has `isAuthBootstrap = routePath === '/auth/api/credentials'`; lines 52-72 implement the login-absent double-submit (cookie vs `x-csrf-token` header, no session read). The DOC omits both. So this is a doc-drift finding, not a code defect — the code is AHEAD of the doc.
- **Verdict & why:** CONFIRMED as documentation drift (Low). Notably this is the inverse of the usual stale-scan problem: the review/ scan's "drift" is real but the gap is the doc lagging the code, not a code bug.
- **Recommendation:** Update security-defaults.md to document the credentials-bootstrap exemption and the login-absent double-submit subsection; mirror into framework-docs.

### QUA-081 — `prisma as unknown as PrismaPingShape` cast in readiness probe · severity: low · status: REFUTED (sanctioned exception, not a defect)
- **Sources:** review(QUA-081)
- **Current location:** `packages/server/src/httpRoutes/healthRoutes.ts:30`
- **Original claim:** A `prisma as unknown as PrismaPingShape` cast exists in the readiness probe (reported for the record per zero-tolerance policy; justification sound).
- **Verification (current code):** Present at line 30 with an `eslint-disable no-restricted-syntax` and a multi-line comment explaining Prisma exposes `$queryRaw` OR `$runCommandRaw` per datasource so no portable type exists; the code then captures each method into a local and `typeof`-narrows (lines 36-46) to avoid further casts.
- **Verdict & why:** REFUTED as a defect — review/ itself classed it as a documented structural exception with sound justification. Nothing to fix; the cast is the single sanctioned datasource-conditional seam.
- **Recommendation:** Optional: move the cast into a core `getPrismaRawProbe()` helper so it lives in one place. No action required.

### Code-quality — `loadSocket` connect handler is a god function (~310 lines) · severity: low · status: CONFIRMED
- **Sources:** reports(Code quality)
- **Current location:** `packages/server/src/loadSocket.ts:119-431`
- **Original claim:** `io.on(connect, ...)` handles presence connect/disconnect, api/sync dispatch, cancellation, join/leave room, location update, activity sampler, and room-rejoin in one closure — SRP violation, hard to test in isolation.
- **Verification (current code):** Confirmed. The connect closure spans lines 119-431 (~312 lines) with all those concerns inline.
- **Verdict & why:** CONFIRMED, Low (maintainability, not a runtime defect).
- **Recommendation:** Extract per-concern registrars (`registerRoomHandlers(socket)`, `registerActivityHandlers(socket)`, `registerRejoin(socket)`, ...).

### Hooks gap — No framework affordance to reject/rate-limit a websocket connection beyond io.use · severity: low · status: CONFIRMED
- **Sources:** reports(Hooks gap)
- **Current location:** `packages/server/src/loadSocket.ts:106-119`
- **Original claim:** `loadSocket` accepts every connection (anonymous sockets allowed by design); a consumer wanting per-IP connection caps / upgrade throttling must hand-roll it inside an `io.use` middleware with no framework affordance.
- **Verification (current code):** Confirmed. `applySocketMiddlewares(io)` (line 109) is the only pre-connect seam; the connect handler (line 119) unconditionally proceeds. No connection-cap/throttle hook.
- **Verdict & why:** CONFIRMED, Low. Acceptable (the `io.use` escape hatch exists) but undocumented as a recipe.
- **Recommendation:** Document an `io.use` per-IP connection-cap recipe, or add an optional `preSocketConnect` veto hook.
