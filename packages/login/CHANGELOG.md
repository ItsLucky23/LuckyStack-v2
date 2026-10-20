# Changelog

All notable changes to `@luckystack/login` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.16.0] - 2026-10-20

### Added

- **`FullOAuthProvider.accountIdKey`** names the userinfo field that holds the provider's stable user id. Every built-in sets it: Google `sub`, GitHub `id`, Discord `id`, Facebook `id`, Microsoft `id` (the Entra object id). A custom provider opts in by setting it (ADR 0086).
- **Optional `UserAdapter.findByProviderAccountId({ provider, providerAccountId })`**, plus `providerAccountId` on `UserRecord` and `UserAdapterCreateInput`. The default Prisma adapter implements it.
- **Optional `userId` on the `preLogin` payload.** For an OAuth login into an existing account, `preLogin` now receives that account's id and its stored email, not the email the provider reports now, so a block by email or id still holds after the user changes the email at the provider.
- **OAuth `loginFailed` reasons for the binding refusals:** `oauth.accountIdMissing` (the userinfo response lacks the declared id), `oauth.accountBoundElsewhere` (the account with this email is bound to another id) and `oauth.emailUnverified` (an unverified email met an existing account; before 0.16 the cross-provider case reported `oauth.userResolveFailed`). A refusal about an existing account carries its `userId`.

### Changed

- **Breaking:** OAuth accounts are bound to the provider's user id (ADR 0086). A sign-in first looks up the account by provider and id; an account found that way signs in even when the email changed at the provider, as long as the provider still returns a usable email, and its stored email is kept. Only when no account has the id does the email decide: an account of the same provider, or one whose record has no `provider`, bound to a different id is refused, even with a verified email (a stored id of any type counts, compared as a string); an unbound account signs in, and is bound, only when the provider verified the email. A new account stores the id. Upgrade: add a nullable `providerAccountId` with an index on `(provider, providerAccountId)` to the user schema and run `prisma db push` or a migration; with the default adapter, OAuth logins fail until the column exists (credentials logins keep working). Existing Google, GitHub, Discord and Facebook users bind on their next login.
- **Breaking:** a userinfo response without the provider's declared id is refused instead of matched by email. Upgrade: if you override a built-in's `userInfoURL` (for example Facebook `fields`), keep the id field in the response.
- **Breaking:** (custom adapters) a `UserAdapter` without `findByProviderAccountId` keeps email matching and logs a warning once, but an unverified provider email can no longer sign in to an existing unbound account. Upgrade: implement `findByProviderAccountId` and persist `providerAccountId` from `create` and `update`.
- Under `providerAccountStrategy: 'unified'` an account stores only the id of the provider it was created with. Another provider still links to it by verified email and is not bound.

### Security

- **An admin of another Entra tenant can no longer sign in as an existing Microsoft user** by setting Graph `mail` to that user's address on a multi-tenant app (`tenant` `common`, `organizations` or `consumers`). This closes the residual risk ADR 0083 recorded. On such an app an existing Microsoft account signs in only once it is bound to its Microsoft id, and an unverified `mail` can never bind one, so in practice only a single-tenant app supports Microsoft sign-in.
- **The `microsoftProvider` boot warning for multi-tenant `tenant` values now explains** that new Microsoft users are refused and unbound accounts cannot sign in, instead of warning about the takeover.
- **`providerAccountId` never reaches the session or the browser.** Login strips it like the password hash, also when a registered session sanitizer throws. A project that types its session from the user model can leave it out with `Omit<User, 'password' | 'providerAccountId'>`.

## [0.15.0] - 2026-10-19

### Added

- **`invalidatePasswordResetToken(userId)` and `invalidateEmailChangeToken(userId)`** cancel a user's outstanding reset or email-change link. Call them when control of the account changes; the scaffold's password reset, password change and email-change confirmation now do.
- **`FullOAuthProvider.alwaysUseGetEmail` and the `OAuthEmailResult` type.** A provider's `getEmail` can report whether the address is verified (ADR 0083).
- **Optional `SessionAdapter.setRawIfExists(token, value, ttl)`.** The Redis adapter uses `SET … XX`. Custom adapters should implement it atomically; without it the framework re-reads before writing, which makes the race window smaller but does not close it (ADR 0077).

### Changed

- **Breaking:** (types) `FullOAuthProvider.getEmail(accessToken, userData)` may return an `OAuthEmailResult`. Custom providers that return a string keep working. Upgrade: code that calls `getEmail` directly must pass the userinfo record and handle the object form.
- **Breaking:** GitHub sign-in reads the user's verified email list (`/user/emails`). Upgrade: the default `user:email` scope covers it; add that scope back if you removed it.

### Fixed

- **New users whose GitHub profile shows a public email can sign up again.** The email comes from GitHub's verified email list, and a verified public email is preferred, so existing accounts keep matching.
- **Microsoft sign-up works for an app tied to one organisation** (`microsoftProvider({ tenant: '<tenant id or domain>' })`). With `tenant` set to `common` (the default), `organizations` or `consumers`, brand-new Microsoft users are refused on purpose, because any tenant can set any address there; existing users still sign in (ADR 0083).
- **Breaking:** the Microsoft `userPrincipalName` fallback no longer counts as a verified email. Upgrade: with `allowUpnFallback: true`, a new user without `mail` can no longer get an account; existing accounts still sign in.
- **Forgot-password answers an existing account as fast as an unknown one and never reports a send failure.** `sendPasswordResetEmail` sends in the background and logs a failure on the server; `ok: false` now only reports a configuration problem that is the same for every address.
- **`auth.passwordResetPath` is used for the reset link.** It was ignored.
- **Turning off 2FA and regenerating recovery codes count wrong codes toward the per-account 2FA lockout** (10 per 15 minutes).
- **`saveSession(..., { onlyIfExists: true })` never recreates a session that was deleted in the meantime** and never re-adds its token to the active-session set (ADR 0077).
- **Log and error-tracker redaction masks 2FA and recovery codes** (`recoveryCode`, `totp`, `totpCode` in any spelling) once `@luckystack/login` is loaded. A bare `code` key is deliberately left alone.

### Security

- **`microsoftProvider` warns once at boot when `tenant` is `common` (the default), `organizations` or `consumers`.** Existing Microsoft accounts on such an app are still matched by an unverified `mail`, so an admin of any other tenant can sign in as an existing user (nOAuth). Set `tenant` to your organisation's tenant id or domain to close this; binding accounts to the provider's subject id would need a schema change (ADR 0083).

## [0.12.0] - 2026-10-15

### Changed

- Requires Node.js 22.13 or newer (was 20). Node 20 stopped receiving security updates in April 2026, and the scaffold's lint toolchain (ESLint 10) needs 22.13.

## [0.11.0] - 2026-10-14

### Changed

- Type declarations are emitted per source file by TypeScript 7 (`tsc -b`) instead of one bundled `.d.ts` per entry, so the framework build no longer runs package by package. The exported types are unchanged; relative imports inside the declarations carry `.js`, so `moduleResolution: "node16"`/`"nodenext"` projects resolve them as before.
- Package design guidance now ships as `AGENTS.md`, not `CLAUDE.md`. Handwritten docs focus on rationale and safety, retaining a minimal existing-project email-code/2FA adoption checklist including persistence and encryption-key prerequisites.

## [0.10.0] - 2026-09-03

### Changed

- Session fan-out and the single-session kick read the Socket.io server with `getIoInstance({ raw: true })` and carry explicit `luckystack/no-local-socket-enumeration` opt-outs, because they enumerate the per-instance room map by construction (they pre-date the cross-instance fan-out). No behaviour change. **Known limitation surfaced by this audit, reported and NOT fixed here:** a replaced session's sockets on ANOTHER instance are not kicked, and the `updateSession` broadcast is skipped when this session's sockets live on another instance (a per-instance guard in front of a cross-instance emit).

## [0.8.4] - 2026-08-17

### Changed

- Corrected password-reset/session documentation for hash-at-rest tokens, one-active-token-per-user invalidation, atomic shared-token consumption, current route paths, and pluggable session storage.

## [0.8.1] - 2026-07-27

### Fixed

- OAuth provider configuration selects production credentials from `NODE_ENV`, independent of named deploy-topology environments.

## [0.7.4] - 2026-07-22

### Fixed

- Relative `postLoginRedirect` results are now resolved against the trusted
  absolute frontend fallback URL. In split frontend/backend deployments,
  `/dashboard` no longer lands on the OAuth callback's backend origin.
- Concurrent TOTP enrollment confirmation is serialized per user, so at most
  one caller receives the recovery-code set that was actually persisted.

### Security

- TOTP ciphertext now carries a non-secret key id (`enc:v2`) and supports a
  JSON decrypt-only legacy keyring through `TOTP_ENCRYPTION_LEGACY_KEYS`.
  Successful TOTP proofs lazily migrate plaintext, legacy `gcm:` and old-key
  rows to the current primary, enabling rotation without locking users out.
- Email-code issue and verification are now complete Redis Lua transactions.
  A stale verifier can no longer authenticate with the previous generation,
  consume the replacement's attempt budget, or delete a newly reissued code.

## [0.7.3] - 2026-07-20

### Fixed

- **OAuth token exchange follows the actually-bound dev port.** The
  `redirect_uri` sent at token exchange now applies core's `resolveDevCallbackUrl`
  rewrite (same as the authorize step in `@luckystack/server`), so a `localhost`
  callback reaches the live server after a dev auto-increment hop. The two
  `redirect_uri` values stay byte-identical (OAuth requires it) because the rewrite
  reads the process-constant bound port, not the request. No-op in production.

## [0.6.0] - 2026-07-12

### Added

- **Passwordless email-code login** (ADR 0024): `requestEmailLoginCode` /
  `verifyEmailLoginCode` — anti-enumeration request (always "ok"), per-email +
  per-IP throttles, verify completes through the shared login tail. Opt-in via
  `auth.emailCodeLogin` (default false); needs `@luckystack/email`.
- **2FA — TOTP (authenticator apps) + email fallback + recovery codes**
  (ADR 0024): hand-rolled RFC 6238/4226 `totp.ts` (zero deps, pinned to the
  official RFC vectors, timing-safe verify, timestep replay guard);
  `twoFactor.ts` flow layer (pending-login challenge store, enrollment with
  Redis-parked secret until the first valid code, recovery codes hashed at
  rest with fail-closed burn, challenge-bound email fallback, AES-256-GCM
  secret-at-rest via optional `TOTP_ENCRYPTION_KEY`); `emailOtp.ts` numeric
  code store (purpose+identity keyed, atomic attempt counter, single-use).
  Kill switch `auth.twoFactor: 'disabled'` (default).
- `finalizeLogin` — the session-minting tail shared by the password,
  email-code and 2FA-verify paths; `registerTwoFactorGate` DI slot;
  `CredentialsLoginChallenge` result member (`requiresTwoFactor: true`, no
  session minted yet). New optional `UserRecord` fields `twoFactorEnabled` /
  `totpSecret` / `recoveryCodes` (backwards compatible).

### Changed

- `sanitizeUserForSession` (and the fail-closed session-persist fallback) now
  always strips `totpSecret` + `recoveryCodes` alongside `password`.

### Security

- Hardened from a pre-release adversarial review (5 lenses), verified against a
  real Redis: atomic single-use on the TOTP replay guard (per-(user,timestep)
  `SET NX`) and the recovery-code burn (per-user lease + re-read); a cross-IP
  per-account 2FA-verify lockout (10 fails / 15 min); re-enrollment step-up
  (setup/enable refuse while 2FA is enabled — disable first); 80-bit recovery
  codes; email-code request made fire-and-forget to close a timing/reason
  enumeration oracle; TOTP verify pinned to 6 digits on the auth surface;
  `recoveryCodes` added to the log-redaction floor.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
