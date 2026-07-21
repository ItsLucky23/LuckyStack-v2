# Changelog

All notable changes to `@luckystack/test-runner` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `resolveTestBaseUrl({ cwd?, fallbackUrl? })` centralizes live-test target
  resolution: explicit `TEST_BASE_URL`, then the backend's actually-bound dev
  port advertisement (only while its owner PID is alive), then the caller's
  config-derived fallback.

## [0.5.0] - 2026-07-11

### Changed

- `ctx.prisma` (Layer-5 custom tests) resolves lazily — projects without a
  registered database client (orm: `none`/drizzle/mikro-orm) can run DB-free
  custom tests; the eager resolve used to abort the whole custom-test phase.
- `@prisma/client` peer dependency is now optional (ADR 0020).

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
