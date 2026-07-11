# Changelog

All notable changes to `@luckystack/server` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
