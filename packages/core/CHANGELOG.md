# Changelog

All notable changes to `@luckystack/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.6] - 2026-07-23

### Fixed

- Boot UUIDs can now be renewed without rotating their value, and a missing key
  is recreated after Redis recovery. The non-overlapping, unref'd heartbeat API
  prevents the default one-hour TTL from making healthy servers not-ready.

## [0.7.4] - 2026-07-22

### Added

- `EmailSender.send(message, context?)` now receives a cooperative abort signal
  and optional stable idempotency key. Failed `EmailResult`s can distinguish
  definitive `not-sent` from an `unknown` post-dispatch outcome.
- Deploy routing config now includes `trustedProxyCidrs`, the explicit
  immediate-peer trust boundary used by the HTTP and WebSocket router paths.

### Fixed

- Automatic Redis rebuilds after secret resolution now replace only a
  framework-owned default client. A consumer registered through
  `registerRedisClient(customClient)` keeps precedence across rotation instead
  of being disconnected and downgraded to the host/port default.
- Dev OAuth callback rewriting now distinguishes the intended pre-listen port from
  the actually-bound port. Auto-derived direct loopback callbacks follow a port
  hop (including IPv6 `[::1]`), while an explicitly configured localhost
  router/reverse-proxy ingress is preserved.
- Added `registerBoundAddress(...)` so `getBindAddress()` can expose the real
  `node:http` address without discarding the intended-port baseline.

## [0.7.3] - 2026-07-20

### Added

- **`resolveDevCallbackUrl(callbackUrl)`** — rewrites the port of a `localhost` /
  `127.0.0.1` OAuth callback URL to the port the server ACTUALLY bound
  (`getBindAddress()`), so OAuth targets the live dev server after an
  auto-increment hop. No-op in production and for non-localhost bases. Consumed by
  `@luckystack/server` (authorize) + `@luckystack/login` (token exchange), which
  both call it so the two `redirect_uri` values stay byte-identical.

### Changed

- **`registerBindAddress` is now registered twice** — once with the intended port
  before `listen`, once with the actually-bound port inside the listen callback
  (done by `@luckystack/server`). This makes `getBindAddress()` truthful after a
  dev auto-increment hop, which `checkOrigin`'s same-origin CORS entry (and now
  `resolveDevCallbackUrl`) depend on.

## [0.7.2] - 2026-07-18

### Fixed

- **`tryCatchSync` is now exported from `@luckystack/core/client`.** It was
  already being shipped to the browser (`offlineQueue`'s drop handler and
  `apiRequest` both call it) and is safe there — the module has zero imports and,
  unlike the async `tryCatch`, deliberately does not auto-capture to the error
  tracker. Only the export line was missing, so client code could see it in the
  bundle but not import it. Consumers can drop a local `shared/tryCatchSync.ts`
  shim and `import { tryCatchSync } from '@luckystack/core/client'`.

### Added

- **Barrel-parity guard (`barrelParity.test.ts`).** Fails when a helper that is
  already reachable from the `/client` import graph is exported by the server
  barrel but not by the client barrel — the bug class above. Scoped to modules
  that genuinely ship to the browser (a blanket "must be in both" rule would flag
  60+ deliberately server-only APIs), and matched on the exported NAME so the
  intentional `tryCatch` → `tryCatchClient` split still passes. Deliberate
  omissions live in a documented `DELIBERATELY_SERVER_ONLY` list.

## [0.7.0] - 2026-07-16

### Added

- **`registerSecretsResolvedListener` / `notifySecretsResolved` are now exported from
  the client-safe `@luckystack/core/config` subpath** (they were already on the main
  barrel). A project's `config.ts` — which is client-bundled, so it can only import from
  `/config` — can now re-register env-derived slots the moment the secret manager
  resolves. This closes a real defect (finding C-04): `config.ts` runs at module load,
  *before* `resolveSecretsIfConfigured()`, so any slot derived from a secret-manager
  pointer (`EMAIL_FROM`, `EXTERNAL_ORIGINS`, …) froze as the unresolved pointer —
  measured live, CORS held `["ORIGINS_BASE_V1"]` while `process.env` already had the real
  origin, so it would reject the very host the operator configured. `secretsResolved.ts`
  imports nothing, so the subpath stays free of server deps (`configEntry.test.ts`).

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

- **`@luckystack/core/client` no longer reaches `node:async_hooks` in its built
  chunk graph.** The browser-safe lazy capture path and the server-only
  AsyncLocalStorage identity scope previously shared `errorTrackerRegistry.ts`;
  tsup coalesced that dynamic capture path with the client logger and emitted a
  static Node builtin import in a client-reached chunk. The identity scope now
  lives in a dedicated server module, while capture fan-out remains browser-safe.
  A post-tsup graph check rejects any Node builtin reachable from `dist/client.js`.
- **`Jsonify<T>` now preserves already-JSON-stable recursive values.** Prisma's
  self-referential `JsonValue` previously recursed through the array branch until
  TypeScript rendered `... N more ...`, producing malformed generated route types
  for a Prisma `SessionLayout`. A non-distributive JSON-stability guard keeps the
  value intact while `Date | null` still becomes `string | null`.
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
