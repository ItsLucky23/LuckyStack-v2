# Changelog

All notable changes to `@luckystack/secret-manager` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-07-16

### Added

- **Fires the framework "secrets resolved" channel automatically** (ADR 0026). After
  every resolve that changes `process.env`, the client now notifies every listener
  published on the global-symbol array `Symbol.for('luckystack.secretsResolved.listeners')`
  with the changed env NAMES. This lets `@luckystack/core` rebuild clients that captured a
  now-stale secret at construction (most importantly the default Redis client — ioredis
  bakes the password in at `new Redis(...)` time) with ZERO consumer code and no
  `onApplied` wiring. Decoupled via the global symbol so this package keeps no import of
  core (its "zero required deps" contract is unchanged); best-effort + isolated (a missing
  core or a throwing listener never breaks the resolve path). The consumer `onApplied`
  callback still fires alongside it.

## [0.1.0]

### Added

- Initial release. Rotation-aware secret resolver client: scans `process.env` for pointer-shaped values (`<BASE>_V<n>`), resolves them in one `POST /resolve` request against an external secret-manager server, and overwrites `process.env` with the real values. Supports `local` / `remote` / `hybrid` modes and opt-in dev hot reload (`.env` watch + interval poll). The companion append-only secret-manager server lives in its own repository (see `docs/architecture.md`).
