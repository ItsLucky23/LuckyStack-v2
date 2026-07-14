# Changelog

All notable changes to `@luckystack/server` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Redis secret-manager pointer boot** (ADR 0026): fixes the `WRONGPASS ... REDIS_PASSWORD_V<n>`
  boot failure with no consumer code — the `registerRedisClient(...)` workaround can be removed.
  The rebuild is triggered by `@luckystack/secret-manager` firing core's secrets-resolved channel
  at resolve time (see the `@luckystack/core` changelog). An intermediate 0.6.3/0.6.4 attempt did
  this from `createLuckyStackServer` gated on `config.secretManager.url`, but that gate is always
  falsy (the scaffold doesn't register `secretManager` into `projectConfig`) — that vestigial gate
  is now REMOVED; the channel is the single trigger.

## [0.6.0] - 2026-07-12

### Added

- **Email-code login + 2FA routes** (ADR 0024, `authSecondFactorRoutes.ts`):
  POST `/auth/api/email-code/request|verify`, `/auth/api/2fa` (completes a
  pending challenge through the session-cookie seam), `/auth/api/2fa/email-code`,
  and the authenticated enrollment routes `/auth/api/2fa/setup|enable|disable|
  recovery-codes` (fresh user re-read via the UserAdapter — the session copy is
  sanitized). Registered before the `/auth/api/*` catch-all; per-IP shields.
- `/auth/providers` now advertises `emailCodeLogin` so the login form can show
  the passwordless entry point.

### Changed

- `/auth/api/credentials` relays the 2FA challenge envelope
  (`requiresTwoFactor`, `challengeToken`, `twoFactorMethods` — no session
  transport) when the account has a second factor enrolled.
- CSRF middleware: the login-completing email-code/2FA routes joined the
  auth-bootstrap exemption set; the authed enrollment routes stay enforced.

## [0.5.0] - 2026-07-11

### Added

- `OVERLAY_ORDER` exported (consumed by the consumer's `bundleServer.mjs` at
  build time — kills the hardcoded-copy drift that silently dropped overlay
  slots from prod bundles). New `cron` overlay slot + `@luckystack/cron` in
  `OPTIONAL_PACKAGES` (boot auto-wiring).
- `/readyz` database check is pluggable (core `registerDbHealthCheck`):
  registered probe → built-in Prisma ping (when Prisma is present) →
  `'skipped'` for deliberately DB-less projects. Response gains the
  tri-state `checks.database`; `checks.prisma` kept for compatibility.

### Changed

- Overlay files that fail to import abort boot with an actionable error
  naming the file (was: raw ERR_MODULE_NOT_FOUND).
- Dev SIGINT/SIGTERM dispatches `preServerStop` (2s cap) before exiting so
  subscribers (e.g. the cron leader lease) release cleanly.
- `@prisma/client` peer dependency is now optional (ADR 0020).

## [0.1.5]

### Changed

- **OAuth post-login redirect no longer reads the `DNS` env var.** `authCallbackRoute`
  now redirects to `projectConfig.app.publicUrl` (the public origin where users
  browse) after a callback, instead of `process.env.DNS || app.publicUrl`. The
  callback is handled on the backend origin but must send the browser back to the
  public origin. Set `app.publicUrl` in your `config.ts` (the scaffold does this).

### Fixed

- **CSRF no longer blocks credentials login/register when a session cookie already
  exists.** `POST /auth/api/credentials` is the session bootstrap, so requiring a
  pre-existing session's CSRF token to authenticate is circular and broke
  legitimate same-site re-login/register (403 `auth.csrfMismatch`). That endpoint
  is now exempt from CSRF enforcement. This removes no real protection: the session
  cookie is `SameSite=Strict`, so a cross-site POST never carries it and the guard
  wouldn't have fired anyway. All other `/auth/api/*`, `/api/*`, and `/sync/*`
  state-changing routes remain protected.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
