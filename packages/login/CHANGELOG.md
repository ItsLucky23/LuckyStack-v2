# Changelog

All notable changes to `@luckystack/login` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
