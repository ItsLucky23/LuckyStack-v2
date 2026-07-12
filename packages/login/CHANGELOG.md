# Changelog

All notable changes to `@luckystack/login` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
