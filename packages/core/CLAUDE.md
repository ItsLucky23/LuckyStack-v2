# @luckystack/core

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

Foundation package for LuckyStack. Owns the socket-first transport contracts (`apiMessage`, `syncMessage`, io-instance slot), the registries that every other framework package reads from (project config, deploy/services config, runtime maps, prisma/redis clients, notifier, email senders, error trackers, logger), and the cross-cutting primitives (rate limiter, CORS check, validateRequest, hook bus, response normalizer, offline queue, CSRF, cookies). Every other `@luckystack/*` package depends on this one and never reaches around it.

## When to USE

- Reading the active runtime config (`getProjectConfig()`, `getProjectName()`, `getBindAddress()`).
- Registering DI slots from the project's boot entry (`registerProjectConfig`, `registerPrismaClient`, `registerRedisClient`, `registerLogger`, `registerNotifier`, `registerEmailSender(s)`, `registerErrorTracker(s)`, `registerRuntimeMapsProvider`, `registerApiMethodMap`, `registerAvatarConfig`, `registerBindAddress`, `registerRateLimitStrategy`).
- Subscribing to lifecycle/transport events via `registerHook(...)` / `registerSyncHook(...)`.
- Calling the cross-cutting primitives directly when a feature package would be overkill (`tryCatch`, `notify`, `checkRateLimit`, `allowedOrigin`, `validateRequest`, `extractTokenFromSocket`, `extractTokenFromRequest`, the offline queue API).
- Reading shared transport types (`BaseSessionLayout`, `AuthProps`, `apiMessage`, `syncMessage`, `SOCKETSTATUS`).

## When NOT to suggest yet

- Building a feature endpoint: import `@luckystack/api` / `@luckystack/sync` instead — they wrap core's hooks and validation in the file-based routing contract.
- Sending email: use `@luckystack/email`'s `sendEmail(...)` (it routes through `getEmailSenderByName`).
- Booting an HTTP server: use `createLuckyStackServer` from `@luckystack/server` — it wires `registerBindAddress`, `setIoInstance`, `attachSocketRedisAdapter`, security headers, etc. for you.
- Replacing Sentry: register an adapter via `@luckystack/error-tracking` (which calls `registerErrorTracker(s)` here). Do not call `initSharedSentry` in new code.
- Anything React-coupled: import from `@luckystack/core/client` (browser-safe subpath) or from the consuming feature package's `/client` entry. The server barrel intentionally does NOT export `apiRequest`.
- Defining project session types: extend `BaseSessionLayout` in your project's own `config.ts` — do not edit the core type.

## Function Index

| Function / Export | 1-line | Deep doc |
| --- | --- | --- |
| `registerProjectConfig(config: ProjectConfigInput): void` | Deep-merge installer config over `DEFAULT_PROJECT_CONFIG`; call once at boot before any framework code runs. | -> docs/config-registry.md |
| `getProjectConfig(): ProjectConfig` | Read the active config at call time (never at module load). | -> docs/config-registry.md |
| `getProjectName(): string` | Resolve the Redis-prefix project name (config -> `PROJECT_NAME` env -> `'luckystack'`). | -> docs/config-registry.md |
| `isProjectConfigRegistered(): boolean` | Boot-time guard for code paths that must run after registration. | -> docs/config-registry.md |
| `DEFAULT_PROJECT_CONFIG: ProjectConfig` | Built-in defaults exported so consumers can spread + override structurally. | -> docs/config-registry.md |
| `registerDeployConfig(config: DeployConfigShape): DeployConfigShape` | Register the project's deploy topology (resources, environments, routing, development). | -> docs/config-registry.md |
| `getDeployConfig(): DeployConfigShape` | Read deploy topology (defaults to `{ resources: {} }`). | -> docs/config-registry.md |
| `isDeployConfigRegistered(): boolean` | Guard for router/boot probes that need a registered deploy config. | -> docs/config-registry.md |
| `registerServicesConfig(config: ServicesConfigShape): ServicesConfigShape` | Register services + presets topology (consumed by router/presetLoader). | -> docs/config-registry.md |
| `getServicesConfig(): ServicesConfigShape` | Throws when no services config has been registered. | -> docs/config-registry.md |
| `isServicesConfigRegistered(): boolean` | Non-throwing guard. | -> docs/config-registry.md |
| `registerAvatarConfig(config: AvatarConfigInput): void` | Override avatar disk format(s) + Cache-Control header. | -> docs/config-registry.md |
| `getAvatarConfig(): AvatarConfig` | Read active avatar config. | -> docs/config-registry.md |
| `DEFAULT_AVATAR_CONFIG: AvatarConfig` | Default formats `[{ extension: 'webp', contentType: 'image/webp' }]` + 24h cache. | -> docs/config-registry.md |
| `registerBindAddress(address: { ip: string; port: number }): void` | `createLuckyStackServer` writes the resolved listen address here at boot. | -> docs/app-bootstrap.md |
| `getBindAddress(): { ip: string; port: string }` | Resolve at call time (registry -> `SERVER_IP`/`SERVER_PORT` -> `'127.0.0.1'`/`''`). | -> docs/app-bootstrap.md |
| `registerRuntimeMapsProvider(provider: RuntimeMapsProvider): void` | DI slot for generated api/sync maps; called by project `server/prod/runtimeMaps.ts`. | -> docs/app-bootstrap.md |
| `getRuntimeApiMaps(): Promise<RuntimeApiMapsResult>` | Async accessor for `{ apisObject, functionsObject }`. | -> docs/app-bootstrap.md |
| `getRuntimeSyncMaps(): Promise<RuntimeSyncMapsResult>` | Async accessor for `{ syncObject, functionsObject }`. | -> docs/app-bootstrap.md |
| `isRuntimeMapsProviderRegistered(): boolean` | Boot-fail-mode detector for `verifyBootstrap`. | -> docs/app-bootstrap.md |
| `registerApiMethodMap(map: ApiMethodMap): void` | Register generated `apiMethodMap` so `apiRequest` can look up real HTTP methods. | -> docs/app-bootstrap.md |
| `getRegisteredApiMethod(pagePath: string, apiName: string, version: string): HttpMethodLiteral \| undefined` | Lookup helper used by `isGetMethod`. | -> docs/app-bootstrap.md |
| `isApiMethodMapRegistered(): boolean` | Detect whether the prefix-heuristic fallback is active. | -> docs/app-bootstrap.md |
| `registerPrismaClient(client: PrismaClient): PrismaClient` | Swap the framework's default Prisma client (TLS, Accelerate, logger, ...). | -> docs/app-bootstrap.md |
| `registerRedisClient(client: RedisClient): RedisClient` | Swap the framework's default ioredis client. | -> docs/app-bootstrap.md |
| `getPrismaClient(): PrismaClient` | Read registered client or fall back to the lazy default resolver. | -> docs/app-bootstrap.md |
| `getRedisClient(): RedisClient` | Read registered client or fall back to the lazy default resolver. | -> docs/app-bootstrap.md |
| `isPrismaClientRegistered(): boolean` | Boot guard. | -> docs/app-bootstrap.md |
| `isRedisClientRegistered(): boolean` | Boot guard. | -> docs/app-bootstrap.md |
| `redis` | Proxy that forwards every call to the currently registered ioredis client. | -> docs/redis-adapter.md |
| `getRedisConnectionOptions(): RedisConnectionOptions` | Single source of truth for `{ host, port, username?, password? }` (router reuses for cross-env probes). | -> docs/redis-adapter.md |
| `attachSocketRedisAdapter(io: SocketIOServer): void` | Wire `@socket.io/redis-adapter` with duplicated pub/sub clients so room broadcasts span instances. | -> docs/redis-adapter.md |
| `setIoInstance(io: SocketIOServer \| null): void` | Module-level slot for the running Socket.io server. | -> docs/socket-bootstrap.md |
| `getIoInstance(): SocketIOServer \| null` | Read the slot from framework code that needs to broadcast. | -> docs/socket-bootstrap.md |
| `socket`, `setSocket`, `incrementResponseIndex`, `waitForSocket` | Client-side socket singleton + response-index counter. | -> docs/socket-bootstrap.md |
| `extractTokenFromSocket(socket): string \| null` | Read session token from Socket.io handshake (cookie + header). | -> docs/socket-bootstrap.md |
| `extractTokenFromRequest(request): string \| null` | Read session token from a Node IncomingMessage (cookie + `Authorization: Bearer`). | -> docs/socket-bootstrap.md |
| `allowedOrigin(origin: string): boolean` | Same-origin + project-configured allow-list CORS check; dispatches `corsRejected` hook on miss. | -> docs/socket-bootstrap.md |
| `validateRequest({ data, user, auth }): ValidationResult` | Auth gate driven by `AuthProps`; checks login + `additional[]` predicates. | -> docs/session-types.md |
| `isFalsy(value): boolean` | Helper used inside `validateRequest`. | -> docs/session-types.md |
| `validateInputByType(value, type)` | Runtime input validation; lazy-loads `@luckystack/devkit` in dev. | -> docs/session-types.md |
| `registerNotifier(notifier: Notifier): void` | DI for client-side toast notifier (success/error/info/warning). | -> docs/app-bootstrap.md |
| `getNotifier(): Notifier` | Read active notifier (no-op default). | -> docs/app-bootstrap.md |
| `notify: Notifier` | Delegating wrapper used by framework hot paths. | -> docs/app-bootstrap.md |
| `registerEmailSender(sender: EmailSender): void` | Legacy single-sender registration; mirrors into `default` slot. | -> docs/app-bootstrap.md |
| `registerEmailSenders(senders: EmailSenderRegistry): void` | Multi-adapter registration (`'default'`, `'transactional'`, `'marketing'`, custom). | -> docs/app-bootstrap.md |
| `getEmailSender(): EmailSender \| null` | Read legacy/`default` sender. | -> docs/app-bootstrap.md |
| `getEmailSenderByName(name: string): EmailSender \| null` | Read a specific slot (falls back to legacy sender for `'default'`). | -> docs/app-bootstrap.md |
| `listEmailSenderNames(): string[]` | Diagnostic helper. | -> docs/app-bootstrap.md |
| `isEmailSenderRegistered(): boolean` | Boot guard. | -> docs/app-bootstrap.md |
| `registerLogger(logger: Logger): void` | Plug in Pino/Winston/Datadog (or `createDevLogger()` for colored dev output). | -> docs/app-bootstrap.md |
| `getLogger(): Logger` | Read at call time (default = console.{debug,info,warn,error}). | -> docs/app-bootstrap.md |
| `isLoggerRegistered(): boolean` | Boot guard. | -> docs/app-bootstrap.md |
| `createDevLogger(): Logger` | Factory for the dev-mode colored logger (depends on `initConsolelog()`). | -> docs/app-bootstrap.md |
| `resetLoggerForTests(): void` | Test-only — restore default logger. | -> docs/app-bootstrap.md |
| `registerRedactedLogKeys(keys: Iterable<string>): void` | Add keys that the framework will redact from log payloads. | -> docs/app-bootstrap.md |
| `getRedactedLogKeys(): Set<string>` | Read current redacted-keys set. | -> docs/app-bootstrap.md |
| `isRedactedLogKey(key: string): boolean` | Hot-path lookup used inside the framework. | -> docs/app-bootstrap.md |
| `resetRedactedLogKeysForTests(): void` | Test-only reset. | -> docs/app-bootstrap.md |
| `initConsolelog(): void` | Monkey-patch `console.*` to render trailing color string (dev only). | -> docs/app-bootstrap.md |
| `registerLocaleReloader(reloader: LocaleReloader): void` | DI for the dev-only i18n hot-reload trigger. | -> docs/app-bootstrap.md |
| `getLocaleReloader(): LocaleReloader \| null` | Read active reloader (returns null when no project supplied one). | -> docs/app-bootstrap.md |
| `registerErrorTracker(tracker: ErrorTracker): void` | Single-tracker registration (replaces previous). | -> docs/error-tracker-registry.md |
| `registerErrorTrackers(trackers: ErrorTracker[]): void` | Multi-tracker registration (replaces the list). | -> docs/error-tracker-registry.md |
| `getActiveErrorTrackers(): ErrorTracker[]` | Read active trackers. | -> docs/error-tracker-registry.md |
| `captureExceptionAcrossTrackers(error, context?): void` | Fan-out exception capture; per-tracker errors are swallowed. | -> docs/error-tracker-registry.md |
| `captureMessageAcrossTrackers(message, level, context?): void` | Fan-out message capture. | -> docs/error-tracker-registry.md |
| `setErrorTrackerUser(user: ErrorTrackerUser \| null): void` | Fan-out user identification. | -> docs/error-tracker-registry.md |
| `recordMetricAcrossTrackers(name, value, tags?): void` | Optional metric fan-out (skips trackers without `recordMetric`). | -> docs/error-tracker-registry.md |
| `startSpanAcrossTrackers<T>(name, op, fn): T` | First tracker that supports spans wins; falls back to direct `fn()`. | -> docs/error-tracker-registry.md |
| `initSharedSentry(instance)` | Legacy Sentry slot (kept for backwards compatibility). | -> docs/error-tracker-registry.md |
| `captureException(error, context?): void` | Legacy fan-out: Sentry slot + adapter list. | -> docs/error-tracker-registry.md |
| `captureMessage(message, level?, context?): void` | Legacy fan-out: Sentry slot + adapter list. | -> docs/error-tracker-registry.md |
| `setSentryUser(user): void` | Legacy fan-out: Sentry slot + adapter list. | -> docs/error-tracker-registry.md |
| `startSpan(name, op): unknown` | Legacy span helper. | -> docs/error-tracker-registry.md |
| `checkRateLimit(params: CheckRateLimitParams): Promise<RateLimitResult>` | Delegates to the active strategy's `check()`. | -> docs/rate-limit-strategy.md |
| `getRateLimitStatus(key, limit): Promise<RateLimitResult>` | Read-only status (does not increment). | -> docs/rate-limit-strategy.md |
| `clearRateLimit(key): Promise<void>` | Reset a single key. | -> docs/rate-limit-strategy.md |
| `clearAllRateLimits(): Promise<void>` | Reset every key under the active strategy's namespace. | -> docs/rate-limit-strategy.md |
| `registerRateLimitStrategy(strategy: RateLimitStrategy): void` | Swap the backend (token-bucket, edge-KV, per-tier, no-op). | -> docs/rate-limit-strategy.md |
| `getRateLimitStrategy(): RateLimitStrategy` | Read the currently active strategy. | -> docs/rate-limit-strategy.md |
| `defaultRateLimitStrategy: RateLimitStrategy` | Built-in memory-or-redis backend. | -> docs/rate-limit-strategy.md |
| `registerHook<TName>(name, handler): void` | Subscribe an async handler to a lifecycle event. | -> docs/hooks.md |
| `registerMiddlewareHandler(handler: MiddlewareHandler): void` | Register the GLOBAL route-guard fallback. Called by `<Middleware>` / `useRouter` only when no per-page middleware is registered for the visited route. Optional — framework default allows by-default. | -> docs/hooks.md |
| `getMiddlewareHandler(): MiddlewareHandler` | Read the active global handler. | -> docs/hooks.md |
| `registerPageMiddleware(path: string, fn: PageMiddleware): void` | Register a per-page route guard. Auto-called by `src/main.tsx`'s `getRoutes()` for every page that exports `middleware`. Per-page takes precedence over the global handler. | -> docs/hooks.md |
| `getPageMiddleware(path: string): PageMiddleware \| undefined` | Lookup the per-page guard for a given route. Framework-internal. | -> docs/hooks.md |
| `hasPageMiddleware(path: string): boolean` | Existence check. | -> docs/hooks.md |
| `MiddlewareInput`, `MiddlewareResult`, `MiddlewareHandler`, `PageMiddleware` (types) | Route-guard contract types. Both handler shapes share the same signature. | -> docs/hooks.md |
| `validatePagePath(srcRelativePath, rules?): PagePathValidationResult` | Pure validator for the invisible-parent folder convention used by `src/main.tsx`'s page auto-discovery AND the `scaffold:page` CLI. Returns `{ valid, route?, reason? }`. | -> docs/hooks.md |
| `DEFAULT_PAGE_ROUTE_RULES: PageRouteRules` | Default config (private-folder prefix `'_'` + reserved framework folders). | -> docs/hooks.md |
| `dispatchHook<TName>(name, payload): Promise<DispatchResult>` | Internal: framework code invokes registered handlers in order; first stop signal aborts. | -> docs/hooks.md |
| `clearAllHooks(): void` | Test-only — drop every registered handler (sync + async). | -> docs/hooks.md |
| `registerSyncHook<TName>(name, handler): void` | Subscribe a synchronous mutator to a hot-path hook (e.g. error normalization). | -> docs/hooks.md |
| `dispatchSyncHook<TName>(name, payload): void` | Internal: framework code invokes sync handlers; payload is mutated in place. | -> docs/hooks.md |
| `BaseSessionLayout`, `SessionLocation`, `AuthProps` (types) | Foundational session-shape types; project `SessionLayout` extends `BaseSessionLayout`. | -> docs/session-types.md |
| `HookSessionShape`, `HookName`, `HookHandler`, `HookResult`, `HookStopSignal`, `HookPayloads` (types) | Hook contract types (augmentable via TS module augmentation). | -> docs/hooks.md |
| `isOnline()` / `enqueueApiRequest` / `enqueueSyncRequest` / `removeApiQueueItem` / `removeSyncQueueItem` / `removeApiQueueItemsByKey` / `flushApiQueue` / `flushSyncQueue` / `getApiQueueSize` / `getSyncQueueSize` | Client-side offline queue with per-item `dropPolicy` and global max-size/max-age caps. | -> docs/socket-bootstrap.md |
| `getCsrfToken()`, `clearCsrfToken()`, `httpFetch(...)` | CSRF-aware fetch wrapper used by the client transport. | -> docs/socket-bootstrap.md |
| `registerCsrfConfig(input: Partial<CsrfConfig>): void` | Override the CSRF cookie name, header name, token length, or cookie options. | -> docs/csrf-config.md |
| `getCsrfConfig(): CsrfConfig` | Read the active CSRF config at call time (defaults to `DEFAULT_CSRF_CONFIG`). | -> docs/csrf-config.md |
| `DEFAULT_CSRF_CONFIG: CsrfConfig` | Built-in defaults (`csrf-token` cookie, `x-csrf-token` header, 32-byte token). | -> docs/csrf-config.md |
| `resetCsrfConfigForTests(): void` | Test-only — restore CSRF defaults between scenarios. | -> docs/csrf-config.md |
| `registerSocketMiddleware(mw: SocketMiddleware): void` | Wedge an `io.use(...)` middleware into the framework's socket bootstrap; runs before any `connect` handler. | -> docs/socket-bootstrap.md |
| `getSocketMiddlewares(): readonly SocketMiddleware[]` | Read the registered middleware list. | -> docs/socket-bootstrap.md |
| `clearSocketMiddlewares(): void` | Drop every registered middleware (test/hot-reload helper). | -> docs/socket-bootstrap.md |
| `applySocketMiddlewares(io: SocketIOServer): void` | Wire every registered middleware into the running Socket.io server (called from `@luckystack/server`'s `loadSocket`). | -> docs/socket-bootstrap.md |
| `writeBootUuid(envKey?): Promise<string>` | Write a fresh UUID to `luckystack:boot:<envKey>` with the configured TTL. | -> docs/app-bootstrap.md |
| `readBootUuid(envKey?): Promise<string \| null>` | Read the boot UUID (router cross-checks against `/_health`). | -> docs/app-bootstrap.md |
| `resolveEnvKey(): string` | `LUCKYSTACK_ENV` -> `NODE_ENV` -> `'development'`. | -> docs/app-bootstrap.md |
| `BOOT_KEY_PREFIX: 'luckystack:boot:'` | Constant — single source of truth so router can't drift. | -> docs/app-bootstrap.md |
| `collectSynchronizedEnvKeys()` / `computeSynchronizedEnvHashes()` / `hashSynchronizedValue()` | Cross-env drift detection helpers for the router boot handshake. | -> docs/app-bootstrap.md |
| `tryCatch<T>(fn): Promise<[Error \| null, T \| null]>` | Tuple-style async error handling used everywhere in the framework. | -> docs/app-bootstrap.md |
| `sleep(ms): Promise<void>` | `setTimeout`-based delay. | -> docs/app-bootstrap.md |
| `getParams(request)` | Parse URL params from a Node request. | -> docs/app-bootstrap.md |
| `serveAvatar(...)` | HTTP handler for `/avatars/:fileId`; rejects path-traversal, applies `AvatarConfig`. | -> docs/app-bootstrap.md |
| `processUpload(input: ProcessUploadInput): Promise<ProcessUploadResult>` | Wraps a project encode/save callback with the `onUploadStart`/`onUploadComplete` hook contract. | -> docs/hooks.md |
| Response normalizers (`normalizeErrorResponse`, `extractLanguageFromHeader`, ...) | Shared error-shape + i18n helpers; dispatches `preErrorNormalize` / `postErrorNormalize` sync hooks. | -> docs/hooks.md |
| `serviceRoute` exports | Helpers to build router-routable URLs across services. | -> docs/socket-bootstrap.md |
| `socketEvents` exports | Wire-protocol constants for socket events. | -> docs/socket-bootstrap.md |
| `paths` exports (`getGeneratedApiDocsPath`, `getApiMethodMapPath`, ...) | Paths resolved through `projectConfig.paths`. | -> docs/config-registry.md |
| `cookies` exports | Cookie parse/serialise helpers used by the HTTP layer. | -> docs/socket-bootstrap.md |
| `httpApiUtils` exports | Shared HTTP helpers (status codes, header writers). | -> docs/socket-bootstrap.md |

## Config keys

Env vars read directly by core (via `env.ts` and call-time helpers):

| Env var | Default | Consumer |
| --- | --- | --- |
| `NODE_ENV` | `'development'` | Zod-validated, mirrored to `process.env`. |
| `SERVER_IP` | `'127.0.0.1'` | `getBindAddress()` fallback. |
| `SERVER_PORT` | `'80'` | `getBindAddress()` fallback. |
| `SECURE` | `'false'` | `allowedOrigin` scheme selection. |
| `DNS` | `''` | Reserved for downstream packages. |
| `REDIS_HOST` | `'127.0.0.1'` | `redis.ts` default client + `getRedisConnectionOptions`. |
| `REDIS_PORT` | `'6379'` | Same. |
| `REDIS_USERNAME` | (unset) | Optional ioredis auth. |
| `REDIS_PASSWORD` | (unset) | Optional ioredis auth. |
| `PROJECT_NAME` | `'luckystack'` | Redis-prefix fallback in `getProjectName()`. |
| `LUCKYSTACK_ENV` | (unset) | `resolveEnvKey()` first preference (boot UUID, router handshake). |

`registerProjectConfig` slots (see `ProjectConfig` for full surface): `app.publicUrl`, `logging.*`, `rateLimiting.{enabled, store, redisKeyPrefix, defaultApiLimit, defaultIpLimit, windowMs, cleanupIntervalMs}`, `session.{basedToken, expiryDays, perBrowser, perUser, maxConcurrentPerUser, onConflict, notifyOldDeviceOnRevoke, projectName}`, `http.{sessionCookie*, requestBodyMaxBytes, healthEndpoint, liveEndpoint, readyEndpoint, testResetEndpoint, stream, securityHeaders, cors}`, `auth.{passwordPolicy, emailMaxLength, nameMaxLength, bcryptRounds, providerAccountStrategy, forgotPassword, passwordResetTtlSeconds, passwordResetBrand}`, `socket.{maxHttpBufferSize, pingTimeout, pingInterval}`, `sync.{streamThrottle, fanoutYieldEvery, fanoutYieldMs}`, `offlineQueue.{maxSize, maxAgeMs, dropPolicy}`, `dev.{hotReloadDebounceMs, watcherStabilityThresholdMs, watcherPollIntervalMs, warnOnMissingInputType}`, `paths.*`, `defaultLanguage`, `defaultTheme`, `socketActivityBroadcaster`, `socketStatusIndicator`, `locationProviderEnabled`, `loginRedirectUrl`.

Other registries: `registerDeployConfig(DeployConfigShape)`, `registerServicesConfig(ServicesConfigShape)`, `registerAvatarConfig(AvatarConfigInput)`, `registerBindAddress({ ip, port })`.

## Peer dependencies

Required:

- `@prisma/client@^6.19.0` — DB client proxied through `getPrismaClient()`.
- `ioredis@^5.10.0` — Redis client proxied through `getRedisClient()`; backs the rate limiter, session store, boot-UUID, and offline-queue.
- `socket.io@^4.8.0` — server-side `SocketIOServer` consumed by `setIoInstance` and `attachSocketRedisAdapter`.
- `socket.io-client@^4.8.0` — client-side socket types used by the offline queue.
- `zod@^3.25.0` — `env.ts` schema parsing.

Optional (mark in `peerDependenciesMeta`):

- `react@^19.0.0`, `react-dom@^19.0.0`, `react-router-dom@^7.0.0` — only consumed by `@luckystack/core/client` and the `react/*` subpath helpers. Pure server boots can skip these.
- `sonner@^2.0.0` — only needed if you wire the default sonner-backed notifier from the project's React entry; the core notifier slot itself is library-agnostic.

Runtime (bundled): `@socket.io/redis-adapter`, `dotenv`.

## Related

- README: `packages/core/README.md`
- Architecture deep-dives: `docs/ARCHITECTURE_EXTENSION_POINTS.md`, `docs/ARCHITECTURE_PACKAGING.md`, `docs/ARCHITECTURE_SOCKET.md`, `docs/ARCHITECTURE_API.md`, `docs/ARCHITECTURE_SYNC.md`, `docs/ARCHITECTURE_SESSION.md`, `docs/ARCHITECTURE_AUTH.md`, `docs/ARCHITECTURE_ROUTING.md`
- Project-side glue: `config.ts`, `server/server.ts`, `server/prod/runtimeMaps.ts`, `src/_sockets/socketInitializer.ts`
