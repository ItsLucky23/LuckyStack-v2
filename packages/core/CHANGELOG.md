# Changelog

All notable changes to `@luckystack/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] - 2026-09-03

### Added

- **`resolveSocketAdapterKey(): string`** — the derived adapter key (see Changed below), exported so a consumer that wires its own adapter (or a probe) can join the framework's cluster by construction instead of by copying a string.
- **`getRoomSockets(room, { userId? })`** — the one short path to "who is in this room". Routes the LOGICAL room code through the room-name formatter under the canonical `'broadcast'` purpose and calls `io.in(...).fetchSockets()`, so the result spans every instance behind the Redis adapter; `'all'` returns every socket everywhere; throws when no Socket.io server is registered (a silent `[]` is the failure class it exists to remove). Added because a consumer hand-rolled this three times and got it wrong three times — a per-instance map, the raw name where sockets joined the formatted one, the sender's id for a shared room (DEV-376).
- **`getIoInstance({ raw: true })` + a dev-only guard.** Outside production `getIoInstance()` returns a view of the server that throws `LocalSocketEnumerationError` on `sockets.adapter.rooms`, `sockets.adapter.sids` and on ENUMERATING `sockets.sockets` (`values` / `keys` / `entries` / `forEach` / `size` / `for…of` / spread); `sockets.sockets.get(id)` stays allowed. The lint rule below catches what is written, this catches what is computed. Production always gets the raw server; framework internals and the Redis adapter never see the guard.
- **ESLint rule `luckystack/no-local-socket-enumeration`** (`@luckystack/core/eslint`, on when `@luckystack/core` or `@luckystack/sync` is installed): the same three shapes as a lint error, with the fix named in the message. Opt out per site with `// eslint-disable-next-line luckystack/no-local-socket-enumeration -- <why>`.
- **`PreSyncRecipientPayload.recipientToken`** — the recipient's session token (null for an anonymous socket). The fan-out loop already had it; a per-recipient guard no longer needs a socket lookup plus a session read to learn who it is talking to.

### Fixed

- The `PreSyncRecipientPayload` docs promised a `resolveRecipientUser` option on `registerHookHandler` that never existed. `recipientUserId` is always `null`; resolve the user from `recipientToken` when you need it.

### Changed

- **The Socket.io Redis-adapter key is derived per environment.** `attachSocketRedisAdapter` now passes `key: resolveSocketAdapterKey()` (`<PROJECT_NAME>:<LUCKYSTACK_ENV | NODE_ENV>:socket.io`) to `@socket.io/redis-adapter` unless `adapterOptions.key` is given; before, every LuckyStack server used upstream's fixed default `socket.io`. The key names the adapter's pub/sub channels, so two deployments that merely shared a Redis server (a dev laptop tunnelled into the staging Redis) were one Socket.io cluster: staging's broadcasts reached the developer's sockets and staging's `fetchSockets()` waited on a sleeping laptop until the request timeout. Instances of ONE environment (same `PROJECT_NAME`, same `LUCKYSTACK_ENV`) stay together. **Rollout note:** during a rolling deploy of this version, old-key and new-key instances do not see each other until the rollout completes — invisible on a single replica. Sessions and other Redis keys are still namespaced by `PROJECT_NAME` only; the adapter key isolates the socket cluster, not the data.
- `RoomNameFormatterContext.userId` is documented as CONTEXT ONLY: under `'broadcast'` the framework passes the joiner on join/rejoin, the SENDER on fan-out and the originator on `broadcastStream`, so for a shared room the value differs per call. A formatter must not fold it into a content room's physical name. No behaviour change — the contract was implicit and unwritten.

## [0.8.7] - 2026-08-18

### Added

- `MiddlewareResult` gains a deny-in-place variant: `{ success: false, status: number }`. The contract previously only supported allow and redirect, so a route guard could not say "you are signed in but not allowed here" without sending the user somewhere else — losing the requested URL and explaining nothing. `<Middleware>` now keeps the URL and renders a deny state; pass `denied` (a node, or a function of the status) to supply your own, otherwise a minimal built-in view is used. Deliberately untranslated: `translate()` returns the KEY when it cannot resolve one, so a built-in with i18n keys would print `middleware.forbidden.title` in every project that upgrades without adding them.
- `resolveMiddlewareOutcome(result)` + the `MiddlewareOutcome` type — one interpretation of a middleware result, shared by `<Middleware>` and `useRouter`.

### Fixed

- `Middleware.tsx` no longer carries a stray NUL byte in the `routeKey` template literal (`${location.pathname}\0${location.search}`). Harmless at runtime — the key is only used for change detection — but git classified the source file as BINARY, so `git diff` showed nothing for it and it could not be merged textually. Predates 0.8.3.
- `useRouter` no longer silently does nothing when a guard denies. It branched separately from `<Middleware>` and returned without navigating for any result that was neither allow nor redirect, so a guarded button simply appeared broken. Both now route through `resolveMiddlewareOutcome`, and a `status` deny navigates so the target route can render the deny state at the requested URL.

## [0.8.5] - 2026-08-17

### Added

- `isTestFile` / `isTestDirectory` (+ the `TEST_FILE_PATTERN` / `TEST_DIRECTORY_NAMES` they are built from) — one convention for every framework surface that discovers files on disk and then imports them. See ADR 0047.

## [0.8.4] - 2026-08-17

### Added

- `registerPortOverride(port)` / `getPortOverride()` in the browser-safe
  `@luckystack/core/config` entry provide the typed positional-port bridge used
  by consumer config and server bootstrap.

### Changed

- Removed `SERVER_PORT` from the validated runtime environment and bind-address
  fallback. Backend defaults now come from consumer `config.ports.ts`; per-boot
  overrides use positional argv; generic server boots still default numerically
  to port 80.
- Bind-address registration accepts configured-default metadata so a
  programmatic `options.port` can update OAuth callbacks that still name the
  consumer default without bypassing an explicit local router ingress.

## [0.8.3] - 2026-07-27

### Fixed

- Routed API method selection is regression-tested to prefer the registered generated method map over route-name inference for explicitly declared methods such as an `organization` GET route.

## [0.8.1] - 2026-07-27

### Added

- `resolveRuntimeMode()`, `isProductionRuntime()` and `isTestRuntime()` expose the `NODE_ENV` application mode separately from deploy-topology identity.

### Fixed

- Production security/validation gates no longer treat named `LUCKYSTACK_ENV` values such as `staging` or `dockerSplit` as development.

## [0.8.0] - 2026-07-27

### Added

- `transport.invocation` can opt typed API/sync calls into routed HTTP/SSE while the existing Socket.io connection remains responsible for realtime delivery.
- Browser-safe routed invocation now preserves timeout, cancellation, streaming envelopes, typed GET payloads, bearer auth and origin-scoped CSRF.
- Service topology can declare pure-data `customRoutes` ownership for non-`/api`/`/sync` paths.

### Fixed

- Runtime input validation now recognizes finite numeric TypeScript literals in object fields and unions, including negative and decimal values, instead of rejecting them as unvalidatable before the handler runs.

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
