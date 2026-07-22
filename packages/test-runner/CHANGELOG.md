# Changelog

All notable changes to `@luckystack/test-runner` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.4] - 2026-07-22

### Added

- `resolveTestEnvironment({ loadProjectConfig? })` and `RunAllTestsInput.loadProjectConfig`
  give the test process the same env prefix as server/ORM boot: load env files,
  lazily read consumer config, then dynamically run optional secret-manager
  resolution before any layer or Layer-5 test-module import.
- `resolveTestBaseUrl({ cwd?, fallbackUrl? })` centralizes live-test target
  resolution: explicit `TEST_BASE_URL`, then the backend's actually-bound dev
  port advertisement (only while its owner PID is alive), then the caller's
  config-derived fallback.

### Fixed

- Layer-5 tests that directly use Prisma/Redis no longer receive unresolved
  values such as `DATABASE_URL_V1` merely because only the separate live-server
  process ran secret-manager bootstrap. A configured resolver that cannot load
  now fails before test execution with an actionable error.
- Direct `runCustomTests(...)` calls now have the same lazy config/env bootstrap
  as `runAllTests`; both public orchestrators require the loader and fail closed
  when an untyped caller omits it. The internal prepared entrypoint prevents a
  second env load from replacing resolved secrets with pointers.

## [0.5.0] - 2026-07-11

### Changed

- `ctx.prisma` (Layer-5 custom tests) resolves lazily — projects without a
  registered database client (orm: `none`/drizzle/mikro-orm) can run DB-free
  custom tests; the eager resolve used to abort the whole custom-test phase.
- `@prisma/client` peer dependency is now optional (ADR 0020).

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
