# Auth / Session Security Audit — `@luckystack/login` + core session/cookie/token

Date: 2026-07-02
Scope: `packages/login/`, session/auth/cookie/token code in `packages/core/`, `shared/`, `functions/`.
Also read (for verifying the security claims the login code makes): `packages/server/src/httpRoutes/{authApiRoute,authCallbackRoute,csrfMiddleware,sessionCookie}.ts`, `packages/server/src/httpHandler.ts`, `packages/core/src/projectConfig.ts` defaults.

## Overall assessment

This surface is **heavily hardened and previously audited** — SEC-/LOGIN-F/QUA- fix markers are everywhere and most of the classic issues are already closed correctly and verifiably:

- **Session fixation**: a fresh 32-byte token is minted on every login/register/OAuth callback; the old token is deleted. No fixation.
- **User enumeration (login)**: not-found and wrong-password both return `login.wrongPassword`, and the not-found path runs a bcrypt compare against a cost-matched dummy hash (`getDummyBcryptHash`) so the timing channel is closed. Solid.
- **OAuth CSRF / login-CSRF / session-fixation via delivered code+state**: closed by the browser-binding nonce (`ls-oauth-state` cookie, SHA-256 hashed at rest in Redis, `timingSafeEqual` compared) plus single-use `MULTI GET+DEL` state consumption with fail-closed DEL check. PKCE supported.
- **Open redirect on OAuth callback**: `isAllowedRedirectUrl` rejects `\`-normalization tricks, protocol-relative `//host`, `javascript:` (opaque origin), and validates against `allowedOrigins`. `return_url` is stored server-side (not echoed) and validated before use.
- **Token/reset/email-change tokens hashed at rest** (`sha256` key, atomic single-use consume, prior-token invalidation).
- **Cookie flags**: session cookie is `HttpOnly; SameSite=<config>; Path=/; [Secure]`; OAuth-state cookie is `HttpOnly; SameSite=Lax; Max-Age`. `__Host-`/`__Secure-` prefix support exists.
- **Bearer-in-cookie-mode bypass** (CORE-O10) closed by default (`acceptBearerInCookieMode:false`).
- **Prior audit items VERIFIED fixed**: cross-provider unverified-email **linking** is now fail-closed (`findOrCreateOAuthUser`, requires `emailVerified` for a cross-provider link); the per-account lockout exists (`authLockout.ts`).

Findings below are the residual gaps. No CRITICAL / no outright auth-bypass found. The most important is the residual OAuth **account-creation** (not linking) gap under a custom provider (M2) and the lockout defaults/TOCTOU (M1/M3).

---

## MEDIUM

### M1 — Per-account brute-force lockout is OFF by default; only a generous per-IP cap protects credentials login
Files: `packages/core/src/projectConfig.ts:745-750` (`rateLimiting.auth.enabled:false`, `maxAttempts:5`, `maxAttemptsPerAccount:50`), `packages/login/src/authLockout.ts:45-63`, `packages/server/src/httpRoutes/authApiRoute.ts:125-178`.

By default `rateLimiting.auth.enabled === false`, so `isAccountLocked` / `recordAuthFailure` are no-ops and **every function in `authLockout.ts` is inert**. The only remaining protection on `/auth/api/credentials` is the general per-IP API limit (`defaultApiLimit:60` per 60s → the endpoint keys `ip:<ip>:auth:credentials`, limit 60/min).

Consequences:
- 60 password guesses/minute *per IP* against a single account is high for online guessing (~86k/day/IP).
- **Distributed** credential stuffing (one account, many IPs) is completely unthrottled until a consumer opts into `rateLimiting.auth` — which is exactly the attack the module was written for.
- Additional deployment footgun: with `http.trustProxy:false` (default) behind a proxy/CDN, `resolveClientIp` returns the proxy's address, so *all* clients share one per-IP bucket — the auth IP limit degrades to a shared global counter (throttles legit users, doesn't isolate an attacker).

Why it's wrong: a security control that defends against the named threat (distributed stuffing) ships disabled, and the fallback per-IP cap is loose and proxy-fragile. Recommend documenting/defaulting `rateLimiting.auth.enabled:true` for credentials apps, or at least emitting a boot warning when `auth.credentials` is enabled but `rateLimiting.auth.enabled` is false.

Note (tradeoff, when enabled): `maxAttemptsPerAccount:50` is a cross-IP bare-account counter — an attacker spraying 50 wrong passwords across IPs locks the victim's account for everyone (self-DoS). This is the documented account-lock DoS tradeoff; 50 is a reasonable margin but worth surfacing.

### M2 — OAuth first-login account CREATION is not gated on `emailVerified` (account squatting via a non-verifying provider)
File: `packages/login/src/login.ts:920-1030` (`findOrCreateOAuthUser`), creation branch `:1000-1029`.

The cross-provider **link** guard (`:945-970`) correctly requires `emailVerified` before linking an OAuth sign-in into an existing account created by another provider. But when **no** account exists, the **create** branch (`:1000-1029`) never checks `profile.emailVerified` — it creates the row with whatever email the provider returned.

Failure scenario: a consumer registers a **custom** OAuth provider (Okta/Apple/X/etc.) that does not set `emailVerifiedKey` and does not filter via `getEmail` (so `emailVerified` stays `false`). An attacker authenticates to that provider with an unverified `victim@corp.com` claim and the framework **creates an account bound to the victim's email**. Under `'unified'` this then blocks/absorbs the victim's later signup (`login.emailExists`), and a subsequent verified provider sign-in by the victim links *into the attacker-seeded account* (both parties share it). Under `'per-provider'` the same squatting happens within that provider scope.

Built-in providers are safe (Google `email_verified`, GitHub/Microsoft verified-`getEmail`, Discord `verified`, Facebook returns only confirmed emails). The gap is real only for a custom, non-verifying provider — but the framework should fail closed by construction, not rely on every custom provider author setting `emailVerifiedKey`. Recommend: refuse creation when `emailVerified === false` under `'unified'` (or globally), or require providers to opt into "trust unverified" explicitly.

### M3 — Lockout counter check is a non-incrementing read decoupled from a fire-and-forget increment (TOCTOU under concurrency)
Files: `packages/login/src/login.ts:288-299` (`emitLoginFailed` → `void dispatchHook('loginFailed', …)`, never awaited), `:521` / `:548` / `:562` (check via `isAccountLocked`, a read), `packages/login/src/authLockout.ts:71-119,161-170`.

`isAccountLocked` uses `getRateLimitStatus` (read-only, non-incrementing). The increment happens later, asynchronously, inside the `loginFailed` hook handler dispatched **fire-and-forget** (`void dispatchHook`) and not awaited by the request. So a burst of N concurrent login POSTs for one account all pass the lock check before any of their increments land — the per-account cap can be overshot by the in-flight concurrency window.

Impact is bounded in practice by the atomic per-IP `checkRateLimit` (single IP capped at 60/min regardless), so this mainly weakens the *cross-IP per-account* cap under distributed+concurrent load, and only when M1's feature is enabled. Still, the lockout is not a hard gate. Recommend making the credentials path *increment-then-check* atomically (or await the record before responding on failure).

---

## LOW

### L1 — Full session token written to logs at debug level in `logout`
File: `packages/login/src/logout.ts:28` — `getLogger().debug(\`logout: user ${userId ?? '?'}\`, { token })`.

Every other session log site deliberately logs `token.slice(0, 8)` only (see `session.ts:58,144,264`, and the tracing block in this same file at `:62-67` which uses `tokenPrefix`). This one line logs the **entire live session token**. The default logger is a plain console/pino sink; `sanitizeForLog`/redaction is only applied on the error-tracker capture fan-out, not on ordinary `getLogger().debug(...)`, so the raw credential lands in the log stream whenever debug logging is on. Change to `tokenPrefix: token?.slice(0,8)`.

### L2 — CSRF exemption of `/auth/api/credentials` (and callback) is silently coupled to `SameSite=Strict`
Files: `packages/server/src/httpRoutes/csrfMiddleware.ts:29-48` (exempts `isAuthBootstrap` + `isCallbackPath`), `packages/core/src/projectConfig.ts:766` (`sessionCookieSameSite:'Strict'` default).

The exemption's own comment justifies itself with "Cross-site abuse is already prevented by the SameSite=Strict session cookie." That's true at the default, but `sessionCookieSameSite` is consumer-configurable to `'Lax'` or `'None'`. With `'None'` a cross-site POST *does* carry the session cookie, and because the endpoint is CSRF-exempt, **login-CSRF becomes possible** (force a victim into an attacker-controlled session, or trigger register). No code warns when `sessionCookieSameSite !== 'Strict'` while relying on it for CSRF. Recommend a boot warning, or don't couple the exemption's safety to a mutable config value.

### L3 — Facebook provider never sets `emailVerified = true` despite the code asserting Facebook emails are verified (fail-closed functional bug)
File: `packages/login/src/oauthProviders.ts:279-309`.

`facebookProvider` has no `emailVerifiedKey` and no `getEmail`, and the comment (`:293-297`) states "the presence of `email` IS the verified signal." But `fetchOAuthProfile` only sets `emailVerified` via `emailVerifiedKey` or a `getEmail` accessor — so for Facebook it stays `false`. Consequence: under `'unified'`, a legitimate Facebook sign-in can never **link** to an existing account created by another provider with the same email (the M2/SEC-21 guard refuses it). This fails *closed* (secure) but contradicts the documented provider behavior and breaks unified linking for Facebook users. Either set `emailVerified: true` for Facebook explicitly, or update the comment/behavior.

### L4 — Registration path is a user-enumeration oracle
File: `packages/login/src/login.ts:421-424` (`login.emailExists`).

`registerWithCredentials` returns `login.emailExists` for a taken address vs `login.userCreated` otherwise, so the register endpoint reveals whether an email has an account — in contrast to the carefully anti-enumeration forgot-password flow (`forgotPassword.ts:60-75`, always `ok`). This asymmetry is largely inherent to registration UX and is a common accepted tradeoff; flagging for awareness (mitigations: generic "check your email to finish signup" + email-verification-based registration).

### L5 — Session/OAuth-state cookie `Secure` flag depends on config/env that can be unset in HTTPS prod
File: `packages/server/src/httpRoutes/sessionCookie.ts:7-10` (`resolveCookieSecure = sessionCookieSecure ?? secureEnv === 'true'`), used by `authApiRoute.ts:89` and `httpHandler.ts` cookie builder.

If a production HTTPS deploy sets neither `http.sessionCookieSecure` nor `SECURE=true`, both the session-token cookie and the OAuth-state cookie are sent **without** `Secure`. Correct-by-default only when the operator remembers the flag. Consider deriving `Secure` from request TLS/`X-Forwarded-Proto` when `trustProxy`, or defaulting it on in prod. (`__Host-`/`__Secure-` prefixes force it, but those are opt-in too.)

### L6 — Fire-and-forget `void` calls lack error isolation (possible `unhandledRejection`)
Files: `packages/login/src/login.ts:600-601` (`void clearAuthFailures(email, requesterIp)` / `void clearAuthFailures(email)`), and the various `void dispatchHook(...)` sites.

`clearAuthFailures` awaits `clearRateLimit` with no internal `tryCatch`; called as `void clearAuthFailures(...)` with no `.catch`, a Redis error becomes an unhandled promise rejection (process-level noise / potential crash under strict rejection handling) on the success path of an otherwise-completed login. `dispatchHook` is expected to isolate handler errors, but the bare `void clearAuthFailures` is not wrapped. Minor; add a `.catch` or internal `tryCatch`.

---

## Verified NOT vulnerable (skepticism applied)

- **OAuth state replay / cross-browser**: single-use (`MULTI GET+DEL`, fail-closed on DEL error) + nonce browser-binding + `timingSafeEqual`. Good.
- **Login timing/response enumeration**: dummy bcrypt compare at configured cost on the no-account/no-hash path; identical reason key. Good.
- **OAuth-only accounts can't be credentials-logged-in**: null password hash → dummy compare → `wrongPassword`. Good.
- **Token embedded in stored session value**: stripped before persist (`session.ts:157`), re-attached on read. Good.
- **Password bcrypt 72-byte truncation**: capped at register (`passwordPolicy.ts:38-39`); login intentionally skips policy and lets bcrypt compare decide (M-15). Correct.
- **Open redirect via `//`, `\`, `javascript:`**: rejected by `isAllowedRedirectUrl`. Good.
- **`extraSessionFields` privilege injection**: framework-owned keys (`id/token/csrfToken/password`) stripped + credential-like key names warned. Good.
