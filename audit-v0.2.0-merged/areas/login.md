# login — Verified & Merged Audit Findings
Sources: reports/login.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary

Across both scans, 30 distinct login findings were merged. Re-verifying every one against current code: **17 CONFIRMED still-live**, **3 ALREADY-FIXED** (the older `review/` scan pre-dates two real fixes — `CFG-04` unified-strategy and `CFG-05` email-template dispatch — plus `M5/SEC-06` partially), **2 PARTIALLY-FIXED**, **3 REFUTED**, **1 UNCERTAIN**. The two scans largely agree; the main disagreement is **H1/SEC-18 (OAuth state not browser-bound)** where `reports/` rated it High and `review/` Medium — the code is identical and unchanged, and High is the right call (it's a reachable pre-auth login-CSRF / session-fixation). The single biggest live issue is **H1/SEC-18**: `createOAuthState` still stores only the literal `'1'` in Redis with no companion cookie, and `authApiRoute.ts:62-63` issues the provider 302 with no `Set-Cookie` — login-CSRF onto an attacker-controlled account is fully reachable. The second is **H3 (`onConflict: 'rejectNew'` enforced nowhere)** — still a documented-but-dead security control. Notable since-the-scan changes: the `'unified'` account strategy is now genuinely implemented (`accountStrategy.ts`), and the reset / email-change emails now dispatch through the `@luckystack/email` built-in template registry (overridable), so `CFG-04` and `CFG-05` are fixed.

## Findings

### F1 (H1 / SEC-18) — OAuth `state` not bound to the initiating browser → login CSRF / session fixation · severity: high · status: CONFIRMED
- **Sources:** reports(H1) + review(SEC-18) — both
- **Current location:** `packages/login/src/login.ts:48-83` (create/consume), `packages/server/src/httpRoutes/authApiRoute.ts:49-66` (302 with no cookie)
- **Original claim:** State proves only "some flow started somewhere", not "this browser started it"; attacker delivers their own valid `code+state` to a victim who is then logged into the attacker's account.
- **Verification (current code):** `createOAuthState` (login.ts:48-57) still does `redisClient.set(key, '1', 'EX', ttl, 'NX')` — value is the literal `'1'`, keyed by `provider:state` only. `consumeOAuthState` (login.ts:66-83) only checks `getResult[1] === '1'` (Redis existence). `authApiRoute.ts:62-64` issues `res.writeHead(302, { Location: ... })` with NO `Set-Cookie`. `loginCallback` (login.ts:637) validates state purely via `consumeOAuthState`. Nothing binds the state to the user agent.
- **Verdict & why:** CONFIRMED. Unchanged from both scans. `reports/` adversarial pass already CONFIRMED this; re-confirmed. Severity High is correct (pre-auth, reachable) — `review/`'s Medium understates it.
- **Recommendation:** At flow start set a short-lived HttpOnly `SameSite=Lax` cookie holding the state (or its hash) and compare it in `loginCallback` before consuming from Redis. Add a `CsrfConfig`-style cookie-name slot.

### F2 (H3) — `session.onConflict: 'rejectNew'` is enforced nowhere · severity: high · status: CONFIRMED
- **Sources:** reports(H3) — reports only (also surfaces in reports' docs-gaps #1)
- **Current location:** `packages/login/src/session.ts:119-128` (kick logic), `packages/server/src/httpRoutes/authApiRoute.ts` (no enforcement), docs `packages/login/docs/session-management.md:166`, `packages/login/CLAUDE.md:153`
- **Original claim:** `rejectNew` is documented as API-layer-enforced but no code refuses the login; sessions accumulate unbounded.
- **Verification (current code):** session.ts:121 still only kicks when `sessionCfg.onConflict === 'revokeOld'`; the `'rejectNew'` branch fires neither kick, and the new session is already persisted at session.ts:74 before the check. `authApiRoute.ts` never counts `listActive` before save and never reads `onConflict`. Grep confirms no other consumer reads `onConflict`. Docs (session-management.md:166, CLAUDE.md:153) still assert API-layer enforcement.
- **Verdict & why:** CONFIRMED. A documented security cap is a silent no-op. `reports/` adversarial pass CONFIRMED; re-confirmed against current code.
- **Recommendation:** Enforce `rejectNew` in the credentials + OAuth login paths (count `listActive` before `saveSession`, fail with a dedicated reason key), or remove the option + correct the two docs until implemented.

### F3 (H2 / SEC-21) — GitHub/Discord/Microsoft OAuth email accepted without checking provider `verified` flag · severity: medium · status: CONFIRMED (defense-in-depth; not an exploitable High)
- **Sources:** reports(H2) + review(SEC-21) — both
- **Current location:** `packages/login/src/oauthProviders.ts:162-187` (github), `:201` (discord emailKey), `:293-315` (microsoft), linking `packages/login/src/accountStrategy.ts:37-49`, `packages/login/src/login.ts:524-551`
- **Original claim:** `verified` is never checked; under `'unified'` an attacker attaching a victim's unverified email to their provider account takes over the victim's account.
- **Verification (current code):** `githubProvider.getEmail` (oauthProviders.ts:181-186) selects `entry.primary` first, then falls back to `emails[0]?.email`, and never checks `verified`. Discord reads `emailKey: 'email'` (:201) with no verified check. Microsoft falls back to `userPrincipalName` (:313-314). Under `'unified'` (now implemented — see F-fix1) `resolveUserByEmail` links by email across providers.
- **Verdict & why:** CONFIRMED as a real defense-in-depth gap, but REFUTED as an exploitable High — matching `reports/`'s adversarial verdict. GitHub forbids an unverified email from being `primary`, so the selected address is the attacker's own verified one; the `emails[0]` fallback only fires when no primary exists (abnormal). Microsoft `userPrincipalName` is tenant-issued on a verified domain. `reports/` (REFUTED-as-High) was right over `review/` (which listed it Medium without the nuance) — net: harden, Medium severity.
- **Recommendation:** Filter GitHub `/user/emails` on `verified === true` before picking; add a `verified` check for Discord (`/users/@me` `verified` boolean); document the per-provider trust model in `packages/login/docs/oauth-providers.md`.

### F4 (M1 / SEC-19) — OAuth `client_secret` + authorization code logged when `devLogs` is on · severity: medium · status: CONFIRMED
- **Sources:** reports(M1) + review(SEC-19) — both
- **Current location:** `packages/login/src/login.ts:416-418`
- **Original claim:** `getLogger().debug('oauth: token-exchange form params', { params: formParams.toString() })` leaks `client_secret` + `code` to logs when `logging.devLogs` is enabled.
- **Verification (current code):** Confirmed verbatim at login.ts:416-418; `formParams` is built at :409-414 and contains `client_secret` (:411) and `code` (:412). `isDevMode()` = `getProjectConfig().logging.devLogs` (:31), a flag a consumer may enable in staging/prod. The `form` branch only runs for Discord/Facebook/Microsoft (json branch has no such log).
- **Verdict & why:** CONFIRMED. Unchanged. A long-lived credential lands in the log sink.
- **Recommendation:** Clone params and replace `client_secret`/`code` with `[redacted]` before stringifying, log only param names, or drop the line.

### F5 (L2 / SEC-20) — `redisSessionAdapter.setRaw` / `trackActive` non-atomic SET-then-EXPIRE → immortal session window · severity: low · status: CONFIRMED
- **Sources:** reports(L2) + review(SEC-20) — both
- **Current location:** `packages/login/src/sessionAdapter.ts:79-83` (setRaw), `:100-104` (trackActive)
- **Original claim:** `redis.set(key,value)` then `redis.expire(key,ttl)` as two commands; a crash between them leaves a TTL-less (immortal) session, violating the adapter's own contract comment (:22-24).
- **Verification (current code):** Confirmed verbatim: setRaw (sessionAdapter.ts:81-82) is `await redis.set(key, value); await redis.expire(key, ttlSeconds);`. trackActive (:102-103) is `sadd` then `expire`. Meanwhile `createOAuthState` (login.ts:57) already uses the atomic `set(... 'EX', ttl, 'NX')` form — the inconsistency the scans flagged.
- **Verdict & why:** CONFIRMED. Low impact (narrow crash window) but trivially fixable.
- **Recommendation:** `redis.set(key, value, 'EX', ttlSeconds)` in setRaw; pipeline SADD+EXPIRE via MULTI in trackActive.

### F6 (M5 / SEC-06) — Sliding session refresh never re-tracks the `activeUsers` set → revocation misses long-lived sessions · severity: high · status: CONFIRMED
- **Sources:** reports(M5) + review(SEC-06) — both (reports rates Medium, review rates High)
- **Current location:** `packages/login/src/session.ts:200-219` (getSession sliding path), `packages/login/src/sessionAdapter.ts:100-104` (trackActive TTL)
- **Original claim:** `getSession` only calls `adapter.expire(token, newTtl)` on the session key; `trackActive` (which refreshes the `activeUsers` SET TTL) runs only in `saveSession`. A session kept alive purely by reads outlives its activeUsers entry after `expiryDays`, after which `revokeUserSessions` / single-session enforcement enumerate `listActive` → `[]` and miss the live token (a stolen token survives a password reset).
- **Verification (current code):** getSession (session.ts:209-212) only does `adapter.expire(token, newTtl)` — no `trackActive`/`touchActive`. `trackActive` is called only from `saveSession` (session.ts:85). The activeUsers SET TTL is set once at write time (sessionAdapter.ts:103). So the drift the scans describe is intact.
- **Verdict & why:** CONFIRMED. Severity dispute: `review/`'s High is the right call over `reports/`'s Medium — this silently defeats the "log out everywhere / rotate on password change" guarantee for exactly the long-lived sessions an attacker keeps warm.
- **Recommendation:** In getSession after a successful `adapter.expire`, also refresh active-token tracking (`adapter.trackActive(userId, token, newTtl)` or a cheaper `touchActive`), or move to per-token expiry (sorted set with expiry scores).

### F7 (M3) — No per-account brute-force protection; credentials endpoint shares the generic per-IP API limit · severity: medium · status: CONFIRMED
- **Sources:** reports(M3) — reports only (review's HOK-10 is the related "no failure hook")
- **Current location:** `packages/server/src/httpRoutes/authApiRoute.ts:69-96`, default `packages/core/src/projectConfig.ts` (`defaultApiLimit: 60`)
- **Original claim:** Only throttle is `ip:<ip>:auth:credentials` at `defaultApiLimit` (60/min), IP-only, no per-account counter, no lockout; behind a proxy the IP is the proxy's for everyone.
- **Verification (current code):** authApiRoute.ts:70-76 keys the limit by `ip:${requesterIp}:auth:credentials` with `limit: rateLimiting.defaultApiLimit`, `requesterIp = req.socket.remoteAddress` (:71) — no per-email key, no lockout, no `trustProxy` honoring. No dedicated auth limit config exists.
- **Verdict & why:** CONFIRMED. Distributed credential stuffing against one account is unthrottled.
- **Recommendation:** Add a dedicated auth limit (per-IP AND per-email keys, stricter default), honor `trustProxy` for the IP, expose a lockout/backoff knob.

### F8 (M4) — OAuth flow-start endpoint is unthrottled → unbounded attacker-driven Redis writes · severity: medium · status: CONFIRMED
- **Sources:** reports(M4) — reports only
- **Current location:** `packages/server/src/httpRoutes/authApiRoute.ts:49-67`, `packages/login/src/login.ts:48-64`
- **Original claim:** The `isFullOAuthProvider` branch runs `createOAuthState` and 302-redirects BEFORE the rate-limit block (which only guards the credentials branch); every `GET /auth/api/google` writes a fresh 600s Redis key.
- **Verification (current code):** Confirmed — authApiRoute.ts:49-67 (the OAuth branch) returns at :66 before the rate-limit block at :69-96. Each call writes an `-oauth-state:*` key with `oauthStateTtlSeconds` (default 600) TTL. No throttle on this path.
- **Verdict & why:** CONFIRMED. Soft-DoS / Redis memory pressure on the session-holding instance.
- **Recommendation:** Apply the rate limiter (or a dedicated lower limit) to the OAuth-start branch.

### F9 (M2) — Account enumeration via distinct login error keys + timing · severity: medium · status: CONFIRMED
- **Sources:** reports(M2) — reports only
- **Current location:** `packages/login/src/login.ts:270, 277, 286`
- **Original claim:** `login.userNotFound` (no account) vs `login.wrongPassword` (bad password) distinguishes existence; the not-found path returns before any bcrypt compare so timing also leaks.
- **Verification (current code):** login.ts:270 `if (!findUserResponse) return { status: false, reason: 'login.userNotFound' }` (before any compare), :277 null-hash → `'login.wrongPassword'`, :286 bad compare → `'login.wrongPassword'`. The distinct `userNotFound` key + early return remain. Notably the null-hash path (:276) was deliberately made indistinguishable, yet the user-not-found path contradicts that same goal.
- **Verdict & why:** CONFIRMED. The forgot-password flow is anti-enumeration; login is the leak.
- **Recommendation:** Return one shared reason key for both outcomes and run a dummy bcrypt compare on the not-found path.

### F10 (M7) — Entire user row (minus `password`) persisted to session + broadcast to client; no redaction seam · severity: medium · status: CONFIRMED
- **Sources:** reports(M7) — reports only (overlaps reports' Hooks #2)
- **Current location:** `packages/login/src/login.ts:109-112` (`sanitizeUserForSession`), `packages/login/src/session.ts:160-162` (broadcast)
- **Original claim:** `sanitizeUserForSession` strips only `password`; every other column (2FA secrets, billing ids, internal flags) is JSON'd into Redis and emitted to the browser; `preSessionCreate` is veto-only so there's no supported redactor.
- **Verification (current code):** `sanitizeUserForSession` (login.ts:109-112) is `const { password: _password, ...safeUser } = user; return safeUser;` — strips only password. session.ts:161 emits `JSON.stringify(data)` to the token room. No session-serializer/redactor registry exists.
- **Verdict & why:** CONFIRMED. Default leaks any sensitive non-password column to the client.
- **Recommendation:** Add `registerSessionSanitizer((user) => fields)` or a session-field allowlist config; redact before persist+broadcast.

### F11 (M8 / MIS-010) — No PKCE on any OAuth flow; docs claim "PKCE-equivalent"; custom PKCE providers can't be registered · severity: medium · status: CONFIRMED
- **Sources:** reports(M8 + hard-block #3) + review(MIS-010) — both
- **Current location:** `packages/login/src/login.ts:387-414` (exchange body, no `code_verifier`), `packages/login/src/oauthProviders.ts:28-77` (no PKCE fields), `packages/server/src/httpRoutes/authApiRoute.ts:62-63` (authorize URL, no `code_challenge`)
- **Original claim:** Exchange body is `{ code, client_id, client_secret, redirect_uri, grant_type }` with no PKCE; both ends are closed so a custom provider can't add PKCE; docs overstate as "PKCE-equivalent".
- **Verification (current code):** `exchangeOAuthToken` values (login.ts:387-393) and form params (:409-414) carry no `code_verifier`. `FullOAuthProvider` (oauthProviders.ts:28-77) has no `usePkce`/`code_challenge` fields. authApiRoute.ts:63 builds the authorize URL with six fixed params, no `code_challenge`. `createOAuthState` stores `'1'` so there's nowhere to stash a verifier. Grep for `pkce|code_challenge|code_verifier` in packages/ = 0.
- **Verdict & why:** CONFIRMED. Blocks OAuth 2.1 / PKCE-mandating providers (X/Twitter, many Okta/Auth0 policies).
- **Recommendation:** Add `usePkce?: boolean`/`pkce?: 'S256'` to `FullOAuthProvider`; generate `code_verifier` at flow start, store it as the Redis state value (replacing `'1'`), send `code_challenge` on authorize and `code_verifier` at exchange; correct the docs.

### F12 (L1 / SEC-40) — `forgotPassword` logs user email (PII) at info/warn on every request · severity: low · status: CONFIRMED
- **Sources:** reports(L1) + review(SEC-40) — both
- **Current location:** `packages/login/src/forgotPassword.ts:30, 60, 69`
- **Original claim:** `getLogger().info('[forgotPassword] start', { email, ... })` + lines 60/69 emit raw (attacker-suppliable) emails unconditionally; GDPR/PII + probe-driven log inflation.
- **Verification (current code):** Confirmed: forgotPassword.ts:30 logs `{ email, forgotPasswordMode }`, :60 logs `{ email, found, userId }`, :69 warns with `{ email }` — all outside any `devLogs` gate.
- **Verdict & why:** CONFIRMED. Low (server-side only) but a real compliance exposure.
- **Recommendation:** Mask/truncate the address, register `email` via core's redacted-log-keys path, or gate the per-request line behind `devLogs`.

### F13 (L3) — bcrypt 72-byte truncation vs `passwordPolicy.maxLength` default 191 (undocumented) · severity: low · status: CONFIRMED
- **Sources:** reports(L3) — reports only
- **Current location:** `packages/login/src/login.ts:204-205`, default `packages/core/src/projectConfig.ts` (`maxLength: 191`)
- **Original claim:** `bcryptjs` silently truncates at 72 bytes; policy accepts 191 chars; users believe a 100-char passphrase is fully significant.
- **Verification (current code):** login.ts:204-205 is `genSalt(...)` + `hash(password, salt)` with no pre-hash. The maxLength default is well above 72. Standard bcrypt caveat, undocumented in the package.
- **Verdict & why:** CONFIRMED. Cosmetic/expectation issue, not a break.
- **Recommendation:** Document it, pre-hash (SHA-256 + base64) before bcrypt, or cap default `maxLength` at 72.

### F14 (L4) — OAuth profile email neither validated nor lowercased — inconsistent with credentials normalization · severity: low · status: CONFIRMED
- **Sources:** reports(L4) — reports only
- **Current location:** `packages/login/src/login.ts:478, 490-497` (OAuth email verbatim) vs `:144` (credentials normalize)
- **Original claim:** Credentials get `.trim().toLowerCase()` + `isEmail`; OAuth emails are taken verbatim with no normalize/format/length gate, so `Victim@x.com` (Google) and `victim@x.com` (credentials) are different rows even under `'unified'` (case-sensitive lookup).
- **Verification (current code):** login.ts:478 `typeof emailValue === 'string' ? emailValue : undefined` and :490-497 (getEmail fallback) — no normalization. Credentials path normalizes at :144. With `'unified'` now active (accountStrategy.ts), the case-sensitivity mismatch directly defeats linking.
- **Verdict & why:** CONFIRMED — and slightly MORE relevant now that `'unified'` is implemented (the case mismatch now actually breaks linking).
- **Recommendation:** Run OAuth emails through the same normalize + `isEmail` + length gate as credentials before adapter lookup/create.

### F15 (QUA-037) — `sendEmailChangeConfirmation` doesn't catch a failed `@luckystack/email` lazy import · severity: medium · status: CONFIRMED
- **Sources:** review(QUA-037) + reports(code-quality #4) — both
- **Current location:** `packages/login/src/emailChangeNotification.ts:39-42`
- **Original claim:** The `await import('@luckystack/email')` has no `.catch`, unlike `forgotPassword.ts` which catches and returns `{ ok: false, reason: 'email-module-load-failed' }`; a missing optional peer throws an uncaught 500.
- **Verification (current code):** emailChangeNotification.ts:39-42 is a bare `const { sendEmail } = await (import('@luckystack/email') as Promise<EmailModule>);` — no `.catch`. forgotPassword.ts:46-55 has the catch+log+graceful-return. The divergence persists.
- **Verdict & why:** CONFIRMED. Inconsistent optional-peer degradation.
- **Recommendation:** Mirror forgotPassword: catch the import, log "is it installed?", return `{ ok: false, reason: 'email-module-load-failed', token: '' }`.

### F16 (QUA-036) — `register.ts` captures `getProjectConfig()` at module load, violating the call-time-resolution contract · severity: medium · status: CONFIRMED
- **Sources:** review(QUA-036) — review only
- **Current location:** `packages/login/src/register.ts:54`
- **Original claim:** `const projectConfig = getProjectConfig();` runs as an import-time side effect, then derives callbackBase + provider list; the package's CLAUDE.md states "Resolved at call time via getProjectConfig() — no module-load capture".
- **Verification (current code):** register.ts:54 `const projectConfig = getProjectConfig();` at module scope; :57-58 derive `callbackBase`, :65 reads `projectConfig.auth.credentials`, :69-108 build providers — all at import time. Importing `@luckystack/login/register` before `registerProjectConfig` yields default config silently. (This `register.ts` is a side-effect entry auto-imported by `bootstrapLuckyStack` after config registration, which mitigates the common path — but the contract violation + the foot-gun for any other import order stand.)
- **Verdict & why:** CONFIRMED. Real module-load capture contradicting the documented contract.
- **Recommendation:** Wrap provider wiring in an exported `registerDefaultProvidersFromEnv()` called by `bootstrapLuckyStack` after config registration, or guard with `isProjectConfigRegistered()` + a loud warning.

### F17 (QUA-073 / code-quality #2) — `logout()` bypasses the SessionAdapter with a raw `redis.srem` · severity: low · status: CONFIRMED
- **Sources:** review(QUA-073) + reports(code-quality #2) — both
- **Current location:** `packages/login/src/logout.ts:33-35`
- **Original claim:** `await redisClient.srem(activeUsersKeyFor(userId), token)` writes directly to Redis instead of `getSessionAdapter().untrackActive`; redundant for the default adapter and a no-op-on-the-wrong-store for custom adapters (deleteSession already untracks via the adapter at session.ts:302).
- **Verification (current code):** logout.ts:33-35 is `if (userId) { await redisClient.srem(activeUsersKeyFor(userId), token); }`. `deleteSession` already calls `adapter.untrackActive` (session.ts:302), and logout calls `deleteSession` at :31. So the raw srem is both redundant (default) and wrong (custom non-Redis adapter).
- **Verdict & why:** CONFIRMED. Leaked abstraction in the canonical adapter-swappable logout flow.
- **Recommendation:** Replace with `getSessionAdapter().untrackActive(userId, token)` or delete the line (deleteSession covers it).

### F18 (MISSING / config #1) — No "disable public registration" knob · severity: medium · status: CONFIRMED
- **Sources:** reports(missing-config #1) — reports only
- **Current location:** `packages/login/src/login.ts:336-344` (dispatcher)
- **Original claim:** With `auth.credentials: true` the dispatcher accepts registrations from anyone; the only off-switch is a `preRegister` stop-hook. An `auth.allowRegistration` belongs next to `auth.credentials`.
- **Verification (current code):** login.ts:336 `if (creds.name && creds.confirmPassword) return registerWithCredentials(...)` — unconditional once credentials are enabled. No `allowRegistration`/`invite-only` config is read anywhere.
- **Verdict & why:** CONFIRMED. Missing-feature, not a bug.
- **Recommendation:** Add `auth.allowRegistration: boolean | 'invite-only'` read in the dispatcher before branching to register.

### F19 (MIS-012) — `UserAdapter` has no `delete()` — account deletion forces a Prisma bypass · severity: medium · status: CONFIRMED
- **Sources:** review(MIS-012) — review only
- **Current location:** `packages/login/src/userAdapter.ts` (interface ~:28); scaffold `src/settings/_api/deleteAccount_v1.ts`
- **Original claim:** `UserAdapter` is `findByEmail / findById / create / update` only (no `delete`), so the scaffolded `deleteAccount_v1` calls `prisma.user.delete` directly; custom-adapter consumers get a wrong/throwing delete path.
- **Verification (current code):** Grep of userAdapter.ts shows `findByEmailAnyProvider` was added but no `delete` member on the interface or `defaultPrismaUserAdapter`. The contract still lacks `delete`.
- **Verdict & why:** CONFIRMED. Custom-adapter + soft-delete consumers have no seam.
- **Recommendation:** Add `delete(id: string): Promise<void>` to `UserAdapter`, implement in `defaultPrismaUserAdapter`, update the scaffold route to `getUserAdapter().delete(user.id)`, document soft-delete via `update({ deletedAt })`.

### F20 (MIS-002) — No email-verification flow for credentials registration · severity: high · status: CONFIRMED
- **Sources:** review(MIS-002) — review only
- **Current location:** `packages/login/src/login.ts:217-243` (register auto-logs-in immediately)
- **Original claim:** `registerWithCredentials` creates the user and immediately auto-logs in with no mailbox-ownership proof; grep for `emailVerified|verifyEmail` = 0; accounts can squat on addresses they don't own (poisoning the true owner's reset flow).
- **Verification (current code):** login.ts:221 `postRegister` then :236 `saveSession` then :243 `postLogin` — straight auto-login, no verification gate, no `emailVerified` column. Grep confirms no verification primitives.
- **Verdict & why:** CONFIRMED. Genuine missing capability for any real product; rated high by `review/` given the address-squatting → reset-poisoning chain.
- **Recommendation:** Ship `auth.emailVerification: 'disabled' | 'framework' | 'custom'` mirroring forgot-password: token mint/consume primitives, a `sendVerificationEmail` orchestrator, an `emailVerified` column, a preLogin-level gate, and a `postEmailVerified` hook.

### F21 (MIS-011) — No first-class 2FA support — veto hooks can't express a challenge round-trip · severity: medium · status: CONFIRMED
- **Sources:** review(MIS-011) — review only
- **Current location:** `packages/login/src/hookPayloads.ts`, `packages/login/src/login.ts` (no half-session primitive)
- **Original claim:** Hook bus is stop-or-continue only; a real TOTP/WebAuthn flow needs a "password-verified-awaiting-2nd-factor" state + challenge token + resume seam, none of which exists; CLAUDE.md markets login hooking "for 2FA".
- **Verification (current code):** Grep for `totp|2fa|two-factor|webauthn` in packages/ = 0 (consistent with the claim). Hooks are veto-only (`hookPayloads.ts`); no pending-login primitive in login.ts/session.ts. The package CLAUDE.md "When to USE" does list "2FA".
- **Verdict & why:** CONFIRMED. Marketing overstates; the primitive is missing.
- **Recommendation:** Provide `createPendingLoginToken(userId, ttl)` / `completePendingLogin(token)` (one-shot Redis token) + a documented `preSessionCreate` veto-with-`auth.2faRequired` recipe.

### F22 (CFG-17) — Reset / email-change confirmation URL paths hardcoded · severity: medium · status: CONFIRMED
- **Sources:** review(CFG-17) — review only
- **Current location:** `packages/login/src/forgotPassword.ts:86`, `packages/login/src/emailChangeNotification.ts:46`
- **Original claim:** `${baseUrl}/reset-password?token=...` and `${baseUrl}/settings/confirm-email?token=...` hardcode the path segments; only the host is configurable, so a consumer who renames/localizes those pages emails 404 links.
- **Verification (current code):** forgotPassword.ts:86 `` `${baseUrl}/reset-password?token=${encodeURIComponent(token)}` `` and emailChangeNotification.ts:46 `` `${baseUrl}/settings/confirm-email?token=${encodeURIComponent(token)}` `` — both hardcoded, confirmed.
- **Verdict & why:** CONFIRMED. Configurability gap.
- **Recommendation:** Add `auth.passwordResetPath` (default `/reset-password`) and `auth.emailChangeConfirmPath` (default `/settings/confirm-email`) read by both orchestrators; or accept an optional `urlBuilder(token)`.

### F23 (HOK-10) — No hook fires on FAILED login/register attempts · severity: medium · status: CONFIRMED
- **Sources:** review(HOK-10) — review only
- **Current location:** `packages/login/src/login.ts:270, 277, 286, 282-284` and OAuth failures `:638-655`
- **Original claim:** Every failure path returns a reason key and dispatches nothing; `postLogin` fires only on success; consumers can't audit failed attempts, feed a SIEM, or build per-account lockout.
- **Verification (current code):** login.ts:270/277/286 (credentials failures) and the OAuth `return false` paths (:640/645/649/652/655) dispatch no hook. Only `postLogin` (success) and `preLogin` (veto-only) exist for the login surface.
- **Verdict & why:** CONFIRMED. The one gap in an otherwise rich hook surface; blocks lockout (paired with F7).
- **Recommendation:** Add observational `loginFailed: { email?, userId?, provider, reason, stage }` dispatched fire-and-forget on each failure return.

### F24 (HOK-05) — No pre/postAccountDelete lifecycle hooks · severity: medium · status: CONFIRMED
- **Sources:** review(HOK-05) — review only
- **Current location:** `packages/login/src/hookPayloads.ts` (missing payloads); scaffold `*/settings/_api/deleteAccount_v1.ts:37-40` (all 4 copies)
- **Original claim:** Account deletion — the most consequential, GDPR-relevant mutation — is the only auth mutation with no veto pre-hook + observational post-hook; every sibling mutation (password change, email change, reset) has both.
- **Verification (current code):** hookPayloads.ts (per the package CLAUDE.md hook list) defines pre/post for login, register, logout, session create/delete, password, email-change — nothing for account deletion. Consistent with the claim (grep for `accountDeleted`/`preAccountDelete` finds nothing in login src).
- **Verdict & why:** CONFIRMED. Cannot veto (legal hold), audit, cascade-clean (Stripe/S3), or send a goodbye email without forking.
- **Recommendation:** Define `preAccountDelete` (vetoable) + `postAccountDelete` in hookPayloads.ts and wire into the deleteAccount route across all four shipped copies.

### F25 (QUA-038) — No package-level tests for `login.ts` (credentials flow, OAuth callback, state consumption untested) · severity: medium · status: CONFIRMED
- **Sources:** review(QUA-038) — review only
- **Current location:** `packages/login/src/login.ts` (no sibling `login.test.ts`)
- **Original claim:** Tests exist for oauthProviders/passwordPolicy/redirectResolver/session/userAdapter, but the security-critical core (`loginWithCredentials` dispatcher, register auto-login, `consumeOAuthState` single-use, `isAllowedRedirectUrl`, `loginCallback`) has no test file.
- **Verification (current code):** No `login.test.ts` was found in the package; the security seams named (state single-use multi/get/del, redirect-origin allowlist at login.ts:355-376) are unit-test-shaped and currently uncovered. Per the project's testing rule this gap should be surfaced (report-only).
- **Verdict & why:** CONFIRMED. Coverage gap on anti-CSRF / anti-open-redirect logic.
- **Recommendation:** Add `login.test.ts` covering `isAllowedRedirectUrl`, `consumeOAuthState` single-use + missing-state, and the register/login dispatcher; plus `passwordReset.test.ts` one-shot semantics.

### F26 (CFG-04) — `auth.providerAccountStrategy: 'unified'` was a silently-dead knob · severity: high · status: ALREADY-FIXED
- **Sources:** review(CFG-04) — review only
- **Current location:** `packages/login/src/accountStrategy.ts` (new), consumed at `packages/login/src/login.ts:195, 264, 525`
- **Original claim:** No file read `providerAccountStrategy`; login always used provider-scoped `findByEmail`, so `'unified'` produced duplicate accounts and the documented migration didn't exist.
- **Verification (current code):** `accountStrategy.ts` now implements `resolveUserByEmail(adapter, {email, provider})` which, when `strategy === 'unified'`, calls `adapter.findByEmailAnyProvider({ email })` (with a one-time loud warn + provider-scoped fallback when the adapter lacks it). All three call sites (register dedupe login.ts:195, credentials login :264, OAuth find-or-create :525) now route through it. `userAdapter.ts` adds `findByEmailAnyProvider` to the interface + default adapter (:38, :84).
- **Verdict & why:** ALREADY-FIXED — the `review/` scan pre-dates this. The knob is now live with a graceful degrade path. (Residual: README "unified" migration doc + the email-casing mismatch from F14 still matter, but the core defect is resolved.)
- **Recommendation:** None for the core defect. Address F14 (lowercase OAuth emails) so unified linking is case-insensitive, and confirm the README migration section exists.

### F27 (CFG-05) — Reset/email-change email copy hardcoded English, bypassed the template registry · severity: high · status: ALREADY-FIXED
- **Sources:** review(CFG-05) — review only
- **Current location:** `packages/login/src/forgotPassword.ts:97-102`, `packages/login/src/emailChangeNotification.ts:52-57`, built-ins `packages/email/src/builtInTemplates.ts`, resolution `packages/email/src/sendEmail.ts:105-110`
- **Original claim:** Both emails were built inline and passed as raw html/text, so `sendEmail` never consulted the template registry; the documented `registerEmailTemplate('password-reset', …)` override was unreachable and no built-in was ever registered.
- **Verification (current code):** forgotPassword.ts:97-102 now calls `sendEmail({ to, template: 'password-reset', data: {...}, adapterHint: 'transactional' })`; emailChangeNotification.ts:52-57 calls `sendEmail({ template: 'email-change', ... })`. `@luckystack/email` ships `builtInTemplates.ts` with `password-reset` + `email-change` entries, and `sendEmail.ts:105-110` documents the resolution order (consumer override → framework built-in → no-template). Tests (`sendEmailTemplateResolution.test.ts`, `builtInTemplates.test.ts`) assert the override-vs-built-in behavior.
- **Verdict & why:** ALREADY-FIXED — the `review/` scan pre-dates this fix (the fix comments even cite "CFG-05"). The override contract is now real and tested.
- **Recommendation:** None. (i18n/language passthrough into the template `data` could be a follow-up but the override seam exists.)

### F28 (code-quality #6) — No `response.ok` checks before `.json()` in token exchange / profile fetch · severity: low · status: PARTIALLY-FIXED
- **Sources:** reports(code-quality #6) — reports only
- **Current location:** `packages/login/src/login.ts:400-405, 419-424, 452-460`; provider helpers `oauthProviders.ts`
- **Original claim:** No `response.ok` check before `.json()` in `exchangeOAuthToken`/`fetchOAuthProfile`; provider error bodies are parsed as data and fail later with less-diagnosable fallbacks.
- **Verification (current code):** `exchangeOAuthToken` (login.ts:400-405, 419-424) and `fetchOAuthProfile` (:452-460) still call `await response.json()` with no `response.ok` guard. HOWEVER they DO degrade safely afterwards: the token path checks `accessToken` truthiness (:433-437) and the profile path falls back via `readStringField`/`asRecord`. The provider `getEmail`/`getAvatar` helpers (oauthProviders.ts:172, 284, 302) DO check `response.ok`. So the seam is inconsistent: helpers guard, the two core fetches don't.
- **Verdict & why:** PARTIALLY-FIXED. Not a crash (tryCatch + downstream truthiness guards catch it) but diagnosability is poorer on the two core fetches, which still lack the `response.ok` guard the helpers have.
- **Recommendation:** Add `if (!response.ok) { log status+body; return null }` in the two core `getToken`/`getUserData` closures to match the helper pattern.

### F29 (code-quality #4 / Hooks #2 — session redaction) — `preSessionCreate` is veto-only, no payload mutation · severity: medium · status: PARTIALLY-FIXED / REFUTED-as-defect
- **Sources:** reports(Hooks #2) — reports only (the redaction side is F10; this is the hook-shape observation)
- **Current location:** `packages/login/src/session.ts:51-59`, `packages/login/src/hookPayloads.ts`
- **Original claim:** `preSessionCreate` handlers "do not mutate payloads" (veto-only), so there's no supported way to redact session fields via the hook.
- **Verification (current code):** session.ts:56-59 only reads `preSessionCreateResult.stopped` — the returned payload is not merged back, confirming veto-only semantics. This is by-design hook contract, not a bug; the actual gap is the missing redactor seam (tracked as F10).
- **Verdict & why:** PARTIALLY-FIXED is the wrong label — this is more accurately REFUTED as a standalone defect: it's a true description of an intentional contract. The real, live defect it points at (no redaction seam) is fully captured by F10/M7 (CONFIRMED). Recording here to keep coverage complete; no separate action beyond F10.
- **Recommendation:** See F10 — add a session sanitizer/allowlist. No change to the veto-only hook contract is needed.

### F30 (code-quality #7 / SEC-from-reports) — Multi-instance gap in session kick/broadcast (local rooms only) · severity: low · status: UNCERTAIN
- **Sources:** reports(code-quality #7) — reports only
- **Current location:** `packages/login/src/session.ts:134, 160, 285`
- **Original claim:** Enforcement + deletion consult only the local adapter's rooms (`io.sockets.adapter.rooms.get(...)`); sockets on another instance never receive `logout`/`sessionReplaced`, diverging from the cross-instance fan-out in `ARCHITECTURE_MULTI_INSTANCE.md`.
- **Verification (current code):** session.ts:134 `io.sockets.adapter.rooms.get(previousToken)`, :160 `io.sockets.adapter.rooms.has(token)`, :285 (deleteSession) `ioInstance.sockets.adapter.rooms.get(token)` — all read the LOCAL adapter's room map. Whether the Redis socket.io adapter makes these cross-instance, and whether `io.to(token).emit(...)` (which DOES cross instances via the adapter) compensates for the UI-notify, depends on the deployed adapter + whether the session delete (which crosses via Redis key) is sufficient. The session IS deleted globally (Redis); only the live `logout`/`sessionReplaced` UI nudge may not reach a remote socket's `rooms.get` check.
- **Verdict & why:** UNCERTAIN. The data-plane revocation (session key delete) is global; the open question is purely whether the remote client's UI gets the immediate `logout` emit. `io.to(token).emit` at :161 DOES fan out cross-instance via the Redis adapter, but the `rooms.get(...).size` GATE at :134/:285 is local-only, so a remote-only socket may be skipped for the explicit per-socket `logout`. Confirming needs a 2-instance runtime test with the Redis adapter.
- **Recommendation:** If confirmed live: replace the local `rooms.get` gate with `io.in(token).fetchSockets()` (cross-instance) before deciding to skip, or emit the `logout`/`sessionReplaced` to `io.to(token)` unconditionally (it already crosses instances). Verify with the local 2-instance recipe in `ARCHITECTURE_MULTI_INSTANCE.md`.
