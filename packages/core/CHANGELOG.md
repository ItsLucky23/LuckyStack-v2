# Changelog

All notable changes to `@luckystack/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-10-19

### Added

- **`resolvePageMiddleware(path)`** on `@luckystack/core/client` finds the per-page guard for a URL by route pattern. It ignores letter case, a trailing slash, the query and the hash, fills `:param` segments and supports a trailing `*`.
- **`registerPageRoute(pattern)`** on `@luckystack/core/client` declares a page route whether or not it has a guard. `resolvePageMiddleware` picks the best-matching route first and returns that route's guard, so a page without a guard (`/about`) never gets the guard of a less specific page that loaded earlier (`/:slug`). The scaffold's `src/main.tsx` registers every page; without it only guarded pages are candidates.
- **`SessionSaveOptions.onlyIfExists`.** A save with this option updates an existing session only: when the session was deleted in the meantime, the provider must not recreate it and returns `{ ok: false, errorCode: 'session.notFound' }`. Custom providers registered with `registerSessionProvider` should honour it (ADR 0077).
- **`hasErrorTrackerIdentityScope()`** tells whether a request identity scope is active, also for an anonymous request. Error-tracker adapters use it to keep anonymous requests anonymous (ADR 0085).

### Changed

- **Breaking:** a real environment variable (shell, Docker, Kubernetes, CI) now beats every env file, including `.env.local` and later `LUCKYSTACK_ENV_FILES` entries, as documented. Before, `.env.local` silently replaced the orchestrator's value. Between files the later file still wins (ADR 0076). Upgrade: if you relied on `.env.local` overriding an exported or container variable, unset that variable or change it at the source.
- **Breaking:** `registerEmailSenders({...})` replaces the whole registry; without a `default` slot there is no default sender any more. Before, the sender `@luckystack/email/register` picked at boot (often the ConsoleSender) stayed as a hidden default, so mail without a hint was written in full to the server log and reported as sent. Upgrade: add a `default` slot if you call `registerEmailSenders` and send mail without `adapter`, or with an `adapterHint` whose slot is not registered.
- **Breaking:** the boot UUID Redis key includes the project name (`luckystack:boot:<project>:<env>`), so projects that share one Redis no longer overwrite each other's boot UUID and health signature. New export `bootUuidKey(envKey)` (ADR 0074). The project part reads `PROJECT_NAME` only (default `luckystack`), never `session.projectName`, because the router CLI does not load `config.ts`. Upgrade: upgrade `@luckystack/router` and every backend together, and give them the same `PROJECT_NAME`.
- The `socket.activityHeartbeatThrottleMs` JSDoc names its actual reader, the client activity tracker; `@luckystack/presence` does not read it.

### Fixed

- **Per-page route guards run for every URL that renders the page:** another letter case (`/ADMIN`), a trailing slash, filled-in dynamic segments (`/orders/123`), percent-encoded segments, and `useRouter().navigate()` targets with a `?query` or `#hash`. Before, these URLs skipped the page guard and fell back to the global handler, which allows by default. A page whose guard should block may now redirect or deny where it used to render.
- **Removing a hook handler during a dispatch no longer makes the dispatch skip the next handler.** Hot reload, a tenant toggle or a handler that removes itself could skip, for example, an authorization hook that should have stopped the request. This applies to async and sync hooks.
- **Route inputs typed as an intersection of object types** (`BaseInput & { extra: string }`) no longer reject every valid payload, in development and production. An intersection inside an object type, or an `&` inside a string literal, no longer causes a false "input nesting exceeds the maximum depth" error.
- **Route inputs with a quote or backslash in a string literal type** (`"it's"`) accept the matching value.
- **Route inputs typed with Prisma JSON types** (`JsonValue`, `InputJsonValue`, `JsonObject`, `JsonArray`) are validated as JSON data instead of being rejected as an unresolved type. Non-JSON values (Dates, `NaN`, class instances) and the keys `__proto__`, `constructor` and `prototype` are rejected, and nesting depth is bounded.
- **Log and error-tracker redaction ignores `-` and `_` in key names** (`api_key`, `x-api-key`, `set_cookie`, `recovery_codes`) and also masks `secretKey`- and `privateKey`-style keys.
- **`sanitizeForLog`, which runs on every error-tracker context, copies an object that appears twice** (`{ actor: user, target: user }`) instead of replacing the second one with `'[circular]'`. Only real loops are marked.
- **The error-tracker scrubber also removes** `Authorization: Bearer …`/`Basic …` values, JSON-style `"password":"…"`, quoted values (`token: 'abc'`) and spaced assignments (`password = x`) from error messages, stacks and captured messages. Before, only `key=value` and `key: value` up to the first space were removed.
- **`extractTokenFromRequest` and `extractTokenFromSocket` read the session cookie under its prefixed name** when `http.sessionCookiePrefix` is set (see `@luckystack/server` 0.15.0).
- **The development guard against per-instance socket enumeration also covers namespaces reached through `io.of(...)`.** Production is unchanged.
- **The development `console.log` replacement** no longer turns objects after a leading string into `[object Object]`, and keeps an error's stack.
- **`useUpdateLanguage()` previews** (such as the settings page's language dropdown) are no longer reverted to the session language within 250 ms. The preview holds until the language source itself changes, for example after saving.
- **The client `preLogin` hook fires only on a real login** (no session → session, or a different user), not on same-user session updates such as a room join or an avatar change. A veto on such an update used to log the UI out while the server session stayed active.
- **With `transport.invocation: 'routed-http'`, repeated identical GET requests keep cancelling the previous one.** A superseded request removed its replacement's abort controller, so from the third call on a stale response could overwrite a newer one.

## [0.14.0] - 2026-10-16

### Added

- **`EmailResult` failures can carry `code`, `status` and `blocksSender`.** `code` is the provider's own error name (Resend `daily_quota_exceeded`, nodemailer `EAUTH`), `status` the HTTP status or SMTP reply code, and `blocksSender: true` says the sender refuses every message until an operator acts. All three are optional; a custom adapter that sets none behaves as before.
- **`dispatchHook` takes an optional `onError`** (third argument, type `DispatchHookOptions`). A throwing handler's error then goes to it instead of the default log line and tracker capture, so a caller can redact it or report many dispatches as one event; `@luckystack/email` uses it to keep addresses out of hook-error reports. Without it nothing changes; an `onError` that throws is ignored, like a failing reporter.

## [0.12.1] - 2026-10-15

### Fixed

- **Email-change confirmation links open the confirm page.** The default `auth.emailChangeConfirmPath` was `/confirm-email-change`, a route no LuckyStack project has: the scaffold and `luckystack add login` put the page at `/settings/confirm-email`. Every confirmation email therefore linked to a missing page unless the project overrode the setting. The default is now `/settings/confirm-email`. A project that set the key itself is unaffected; one that worked around it with a redirect or an extra route at `/confirm-email-change` can remove it. Links in emails sent before the upgrade keep the old path until they expire (one hour by default).

## [0.12.0] - 2026-10-15

### Added

- **ESLint rule `luckystack/no-untranslated-jsx-text`** (`@luckystack/core/eslint`, on as a warning): text in JSX goes through the project translator. It replaces `react/jsx-no-literals` from `eslint-plugin-react`, which stopped at ESLint 9 and was kept for this one rule. Same behaviour as the options the scaffold ran it with: JSX text and string/template literals in a child `{…}` are reported, attribute values are not, and punctuation, digits and units such as `px` are allowed. `allowedStrings` replaces that allow-list. A disable for `react/jsx-no-literals` becomes `luckystack/no-untranslated-jsx-text`.

### Changed

- The optional `eslint` peer accepts ESLint 9 and 10 (`^9.0.0 || ^10.0.0`), so a project already on ESLint 10 installs without a peer conflict. The bundled rules use no API that ESLint 10 removed.
- Requires Node.js 22.13 or newer (was 20). Node 20 stopped receiving security updates in April 2026, and the scaffold's lint toolchain (ESLint 10) needs 22.13.

## [0.11.0] - 2026-10-14

### Changed

- Type declarations are emitted per source file by TypeScript 7 (`tsc -b`) instead of one bundled `.d.ts` per entry, so the framework build no longer runs package by package. The exported types are unchanged; relative imports inside the declarations carry `.js`, so `moduleResolution: "node16"`/`"nodenext"` projects resolve them as before. The `prisma` export carries an explicit `PrismaClient` type, so its declaration references `@prisma/client` instead of Prisma's generated `.prisma/client` folder.
- Package design guidance now ships as `AGENTS.md`, not `CLAUDE.md`. Handwritten docs focus on rationale and safety; exact API contracts remain in installed declarations/source.

## [0.10.2] - 2026-10-09

### Added

- `TEST_RESET_TARGETS`, `TEST_RESET_ONLY_PARAM`, `isTestResetTarget` and the `TestResetTarget` type — the `/_test/reset?only=` selector contract shared by `@luckystack/server` (which clears) and `@luckystack/test-runner` (which asks).

## [0.10.1] - 2026-09-03

### Added

- **`buildRoutedGetUrl(path, data, extraParams?)` + `ROUTED_DATA_QUERY_KEY`** (root and `/client` entry) — the one place that encodes a `GET` payload as the reserved `__luckystack_data` query value. The client's routed-HTTP path already did this inline; it now calls the helper, and `@luckystack/test-runner` 0.10.1 uses the same helper for Layer-5 `ctx.callApi` so the two can no longer drift. No wire-format change.

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
