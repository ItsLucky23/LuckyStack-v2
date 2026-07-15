# Changelog

All notable changes to `@luckystack/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Bun env auto-load guard.** Bun auto-loads `.env` files before any user code
  runs; Node does not. That silently breaks two guarantees of `loadEnvFiles`:
  `LUCKYSTACK_ENV_FILES` stops being an ambient-only override (a value set INSIDE
  `.env` — exactly what `.env_template` shows commented — hijacks the file list),
  and `.env.<mode>` / `.env.<mode>.local`, which the framework never loads, come
  to outrank `.env` (verified under Bun 1.3.14: a key in `.env.development` beat
  `.env`). Both failures were 100% silent. `loadEnvFiles` now detects the symptom
  at boot — an env file already applied to `process.env` byte-for-byte before we
  load it — and warns with the fix. It warns rather than throws: `bun install`
  ignores `env = false` (oven-sh/bun#31450), so a postinstall boot would
  otherwise be unfixably fatal. Node is never affected and never warns.
- **`bunfig.toml` with `env = false`** at the repo root and in the
  `create-luckystack-app` template, disabling Bun's `.env` auto-load (requires
  Bun >= 1.3.3) so `bun` and `node` load byte-identical values. The "a real
  ambient env var wins over `.env`" contract (Docker/K8s/CI) is unchanged — that
  is LuckyStack's own loader, not Bun's.
- **Timestamps in the built-in loggers.** The default `console.*` logger and
  `createDevLogger` now prefix each line with an ISO-8601 UTC timestamp
  (`[2026-07-13T15:20:01.123Z] Connected to Redis`), controlled by a new
  `logging.timestamps` config key (default `true`; set `false` under a log
  aggregator that stamps its own time). Only the message is prefixed — context /
  error args stay separate. A registered custom logger owns its own formatting.
- **Decoupled secrets-resolved hook** (ADR 0026): `notifySecretsResolved(changedKeys?)`
  + `registerSecretsResolvedListener(fn)`. A secret resolver (e.g.
  `@luckystack/secret-manager` via `onApplied: notifySecretsResolved`) fires it after
  overwriting `process.env`; `redis.ts` self-registers a listener that EAGERLY REBUILDS +
  registers the default client when a `REDIS_` credential changed, so Redis auth via a
  secret-manager POINTER survives boot AND rotation with no hand-wiring. Generic — Prisma
  pools / SDK clients can subscribe too. Also adds `rebuildDefaultRedisClient()` and an
  optional structural `secretManager?` field on `ProjectConfig` (`SecretManagerConfigRef`)
  so the server boot can detect a resolver.

### Fixed

- **Redis secret-manager pointer boot** (ADR 0026): the default Redis client no longer
  fails auth with a baked-in `REDIS_PASSWORD_V<n>` pointer when it was built (during an
  early import) before secrets resolved. The framework EAGERLY REBUILDS + registers a
  fresh client from the resolved env (`rebuildDefaultRedisClient()`), so the boot-UUID
  write authenticates with the real password — no consumer code. **Correction over
  0.6.3/0.6.4:** the rebuild logic was right but never TRIGGERED for a normal project (the
  server-boot gate `getProjectConfig().secretManager?.url` is falsy — the scaffold doesn't
  register `secretManager` into `projectConfig` — and bare `initSecretManager` wires no
  `onApplied`). Core now publishes `notifySecretsResolved` onto a decoupled global-symbol
  ARRAY (`Symbol.for('luckystack.secretsResolved.listeners')`) at module load, which
  `@luckystack/secret-manager` fires automatically after every resolve — so the rebuild
  happens at resolve time with zero consumer code, in prod and dev, and even survives a
  dual `@luckystack/core` instance. (A short-lived 0.6.3/0.6.4 server-boot gate + a
  `ProjectConfig.secretManager` field were vestigial once the channel existed and are
  removed — the channel is the single trigger.)
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
