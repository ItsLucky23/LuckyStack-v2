# Changelog

All notable changes to `@luckystack/server` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5]

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
