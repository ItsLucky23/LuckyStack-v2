# Changelog

All notable changes to `@luckystack/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Timestamps in the built-in loggers.** The default `console.*` logger and
  `createDevLogger` now prefix each line with an ISO-8601 UTC timestamp
  (`[2026-07-13T15:20:01.123Z] Connected to Redis`), controlled by a new
  `logging.timestamps` config key (default `true`; set `false` under a log
  aggregator that stamps its own time). Only the message is prefixed — context /
  error args stay separate. A registered custom logger owns its own formatting.
- **Decoupled secrets-resolved hook** (ADR 0026): `notifySecretsResolved(changedKeys?)`
  + `registerSecretsResolvedListener(fn)`. A secret resolver (e.g.
  `@luckystack/secret-manager` via `onApplied: notifySecretsResolved`) fires it after
  overwriting `process.env`; `redis.ts` self-registers a listener that drops the cached
  default client when a `REDIS_` credential changed, so Redis auth via a secret-manager
  POINTER survives boot AND rotation with no hand-wiring. Generic — Prisma pools / SDK
  clients can subscribe too. Also adds an optional structural `secretManager?` field on
  `ProjectConfig` (`SecretManagerConfigRef`) so the server boot can detect a resolver.

### Fixed

- **Redis secret-manager pointer boot** (ADR 0026): the default Redis client no longer
  fails auth with a baked-in `REDIS_PASSWORD_V<n>` pointer when it was built (during an
  early import) before secrets resolved — the decoupled hook above + the server-boot
  reset rebuild it from the resolved env. The `WRONGPASS` diagnostic now points at the
  automatic handling + the `envNames` allowlist requirement.
- **CORE-2** — `tryCatchSync<T, P = void>` now mirrors `tryCatch`'s `P` default,
  so a params-less call can pass only the result type (`tryCatchSync<URL>(() =>
  new URL(raw))`) instead of failing with TS2558.

### Added

- **CORE-1** — `resetDefaultRedisClient()` drops + disconnects the cached lazy
  default Redis client so the next resolve rebuilds it from current env. Call it
  after `initSecretManager(...)` when `REDIS_PASSWORD`/`REDIS_HOST` were
  secret-manager pointers at first import (the early function-injection scan may
  have already built a client with the raw pointer value). The default client's
  error handler also turns the resulting `WRONGPASS` into an actionable message
  when the password still looks like an unresolved pointer.

## [0.6.0] - 2026-07-12

### Added

- `AuthConfig` slots for email-code login + 2FA (ADR 0024, all additive with
  safe defaults): `emailCodeLogin` (false), `emailCodeTtlSeconds` (600),
  `emailCodeLength` (6), `emailCodeMaxAttempts` (5), `twoFactor`
  (`'disabled' | 'optional'`, default disabled), `twoFactorEmailFallback`
  (true), `twoFactorChallengeTtlSeconds` (300), `twoFactorMaxAttempts` (5).

## [0.5.0] - 2026-07-11

### Changed

- **`@prisma/client` is now an OPTIONAL peer dependency** (ADR 0020, the ORM
  choice). npm no longer auto-installs it; scaffolded projects get it via the
  template's direct dependency when `orm: 'prisma'`. Non-scaffolded projects
  that relied on peer auto-install must add `@prisma/client` to their own
  `package.json`. The same demotion applies in `@luckystack/api`, `devkit`,
  `server`, `sync`, and `login`.
- `@prisma/client` left the static-import position in `db.ts`: the default
  resolver now lazy-`require()`s it on first access. When it is absent AND no
  client was registered, DB access throws an actionable error pointing at
  `luckystack/core/clients.ts` instead of a bare `ERR_MODULE_NOT_FOUND` at boot.

### Added

- `isPrismaClientResolvable()` — is a generated `@prisma/client` present?
- `registerDbHealthCheck` / `getDbHealthCheck` / `isDbHealthCheckRegistered` /
  `resetDbHealthCheckForTests` (+ types `DbHealthCheck`, `DbHealthResult`) —
  pluggable `/readyz` database probe; without one the server falls back to the
  built-in Prisma ping when Prisma is present, else reports `'skipped'`.

## [0.1.5]

### Removed

- **`DNS` dropped from the env schema.** It was a reserved/legacy var that
  conflated the backend origin (OAuth callback host) with the public origin
  (where users browse). Projects now derive the backend origin from
  `SERVER_IP`/`SERVER_PORT` and set the public origin via `app.publicUrl` (see the
  scaffold's `config.ts`). Leftover `DNS=` lines in existing `.env` files are
  harmless — the schema is `loose()`, so unknown keys pass through ignored.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
