# Changelog

All notable changes to `@luckystack/test-runner` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.1] - 2026-09-03

### Fixed

- Layer 5: `ctx.callApi(input)` on a `GET` route silently dropped `input`, so the server always saw `data = {}` and any `GET` route with a required field rejected the call with `api.invalidInputType` before `main()` ran. `input` now travels as the `__luckystack_data` query-string value, encoded by the shared `buildRoutedGetUrl` helper from `@luckystack/core` — the same contract the real client sends and the server reads. Non-`GET` routes are unchanged (JSON body).

## [0.8.5] - 2026-08-17

### Changed

- Test-only: the `runAllTests` characterization suite now mocks `@luckystack/login`, so it no longer cold-loads that package (and its dependency graph) on every `authToken` case. This removes a timeout-under-load flake and adds the first assertions for the CSRF-header branch of `buildAuthHeaders`, which previously degraded to a warning on every run. No runtime behaviour change.

## [0.8.4] - 2026-08-17

### Changed

- Documented the fail-closed `/_test/reset` contract accurately: exact development/test mode plus required token, default Redis session namespaces only, and no application-DB or custom-SessionAdapter cleanup.

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
