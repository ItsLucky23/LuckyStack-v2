# @luckystack/core

> Foundation package for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). Socket-first transport contracts, Redis adapter, project-config registry, hooks registry, response normalization, rate limiting, and shared session types.

Every other `@luckystack/*` package depends on this one.

## Install

```bash
npm install @luckystack/core
```

Peer dependencies you must install separately:

```bash
npm install @prisma/client ioredis socket.io socket.io-client zod
```

## Quickstart

The core package is mostly consumed transitively through `@luckystack/server`, `@luckystack/api`, etc. You typically only touch it directly to register your project config and to call low-level utilities.

```ts
import { registerProjectConfig, getProjectConfig, notify, redis, prisma } from '@luckystack/core';

registerProjectConfig({
  defaultLanguage: 'en',
  session: { expiryDays: 30, basedToken: false, allowMultiple: true },
  auth: {
    emailMaxLength: 254,
    passwordMinLength: 8,
    passwordMaxLength: 128,
    nameMaxLength: 64,
    oauthStateTtlSeconds: 600,
  },
  // ...see ProjectConfig type for the full surface
});

const config = getProjectConfig();
```

## Subpath: `@luckystack/core/client`

Browser-safe surface for the React/Vite bundle. Re-exports the pieces consumed by `@luckystack/sync`'s client transport (`projectConfig`, `notifier`, `socketState`, `offlineQueue`, `responseNormalizer`, `serviceRoute`, `socketEvents`, `socketStatusTypes`, `apiTypeStubs`, `sessionTypes`).

```ts
import { socket, isOnline, enqueueApiRequest } from '@luckystack/core/client';
```

## Public API (server entry)

| Group | Exports |
| --- | --- |
| Project config | `registerProjectConfig`, `getProjectConfig`, `getProjectName`, `isProjectConfigRegistered`, `DEFAULT_PROJECT_CONFIG`. Types: `ProjectConfig`, `ProjectConfigInput`, `LoggingConfig`, `RateLimitingConfig`, `SessionConfig`, `SentryConfig`, `SentrySampleRates`, `HttpConfig`, `HttpStreamConfig`, `SecurityHeadersConfig`, `CorsConfig`, `AuthConfig`, `SocketConfig`, `SyncConfig`, `SyncStreamThrottleConfig`, `OfflineQueueConfig`, `DevConfig`, `PathsConfig`, `EmailConfig`, `EmailLoggingConfig`, `EmailEnvVarsConfig`, `EmailDefaultsConfig`. **`getProjectName()`** is the canonical way to read the project's Redis-prefix string — it resolves at call time in this order: (1) `projectConfig.session.projectName` if a consumer set it, (2) `process.env.PROJECT_NAME` (read after `dotenv` has loaded), (3) literal `'luckystack'` as the absolute fallback. Reach for it from any framework or project code that needs the prefix instead of duplicating the env-read pattern. |
| Deploy + services config | `registerDeployConfig`, `getDeployConfig`, `isDeployConfigRegistered`, `registerServicesConfig`, `getServicesConfig`, `isServicesConfigRegistered`. Types: `DeployConfigShape`, `DeployResourceShape`, `DeployEnvironmentShape`, `DeployRoutingShape`, `DeployDevelopmentShape`, `ServicesConfigShape`, `ServiceDefinition`, `PresetDefinition` |
| Runtime maps | `registerRuntimeMapsProvider`, `getRuntimeApiMaps`, `getRuntimeSyncMaps`. Types: `RuntimeMapsProvider`, `RuntimeApiMapsResult`, `RuntimeSyncMapsResult` |
| DI clients | `registerPrismaClient`, `registerRedisClient`, `getPrismaClient`, `getRedisClient`, `isPrismaClientRegistered`, `isRedisClientRegistered` |
| Notifier | `registerNotifier`, `getNotifier`, `notify`. Types: `Notifier`, `NotifyInput`, `NotifyParam` |
| Email registry | `registerEmailSender`, `getEmailSender`, `isEmailSenderRegistered`. Types: `EmailSender`, `EmailMessage`, `EmailResult` (re-exported from `@luckystack/email` for convenience) |
| Logger | `registerLogger`, `getLogger`, `isLoggerRegistered`, `resetLoggerForTests`, `createDevLogger`. Types: `Logger`, `LoggerContext`. Default logger is a thin wrapper over `console.{debug,info,warn,error}` with no color codes — safe in production. Call `registerLogger(createDevLogger())` from a dev-only entry to opt into the colored terminal output (which still depends on `initConsolelog()` to render the trailing color string). Plug in Pino / Winston / Datadog by registering an object that satisfies `Logger`. |
| Redacted log keys | `registerRedactedLogKeys`, `getRedactedLogKeys`, `isRedactedLogKey`, `resetRedactedLogKeysForTests` |
| Avatar / uploads | `registerAvatarConfig`, `getAvatarConfig`, `DEFAULT_AVATAR_CONFIG`, `serveAvatar`, `processUpload`. Types: `AvatarConfig`, `AvatarConfigInput`, `ProcessUploadInput`, `ProcessUploadResult`. **Path-traversal guard:** `serveAvatar` rejects any `fileId` that does not match `/^[A-Za-z0-9_-]{1,128}$/` with a 400 before touching the filesystem — `..`, slashes, and other path-separator characters cannot escape the configured upload directory. **`processUpload`** wraps the project-supplied encode/save callback with the framework's `onUploadStart` (stoppable) and `onUploadComplete` hook contract so consumer upload routes don't need to plumb the hooks themselves. Returns `{ status: 'success', sizeBytes }`, `{ status: 'rejected', errorCode }` (when `onUploadStart` returned a stop signal), or `{ status: 'error', reason, cause? }`. See [`src/settings/_api/updateUser_v1.ts`](../../src/settings/_api/updateUser_v1.ts) for the canonical avatar usage. |
| Bind address | `registerBindAddress({ ip, port })`, `getBindAddress() → { ip, port: string }`. `createLuckyStackServer` registers the resolved listen address at boot so framework code (e.g. `checkOrigin` building the same-origin entry) reads it from the registry instead of `SERVER_IP` / `SERVER_PORT` env vars — no more drift when consumers configure programmatically via `createLuckyStackServer({ ip, port })`. Resolution at call time: (1) `registerBindAddress(...)` value, (2) `process.env.SERVER_IP` / `SERVER_PORT` (legacy), (3) `'127.0.0.1'` / `''` fallback. |
| Locale reloader | `registerLocaleReloader`, `getLocaleReloader`. Type: `LocaleReloader` |
| Hooks (async) | `registerHook`, `dispatchHook`, `clearAllHooks`. Types: `HookName`, `HookHandler`, `HookResult`, `HookStopSignal`, `HookPayloads`, `DispatchResult`, `HookSessionShape`. Canonical payload types: `PreApiValidatePayload`, `PostApiValidatePayload`, `PreApiExecutePayload`, `PostApiExecutePayload`, `PreApiRespondPayload`, `PostApiRespondPayload`, `ApiResponseEnvelope`, `PreSyncFanoutPayload`, `PostSyncFanoutPayload`, `ApiErrorPayload`, `SyncErrorPayload`, `RateLimitExceededPayload`, `CorsRejectedPayload`, `CsrfMismatchPayload`, `PreSessionRefreshPayload`, `PostSessionRefreshPayload`, `OnUploadStartPayload`, `OnUploadCompletePayload`. Feature-package payloads (`Pre/PostLogin`, `Pre/PostRegister`, `Pre/PostLogout`, `Pre/PostSessionCreate`, `Pre/PostSessionDelete`, `Pre/PostEmailSend`, `Pre/PostPresenceUpdate`, socket lifecycle, etc.) augment `HookPayloads` from their owning packages — see those packages' READMEs. |
| Hooks (sync, mutators) | `registerSyncHook`, `dispatchSyncHook`. Types: `SyncHookName`, `SyncHookHandler`, `SyncHookPayloads`, `PreErrorNormalizePayload`, `PostErrorNormalizePayload`. Sync hook handlers must be synchronous (no `async`), mutate the payload object in place, and cannot stop the flow. Use them only for hot-path mutators like error-code remapping. |
| Session types | `BaseSessionLayout`, `SessionLocation`, `AuthProps` |
| Socket | `setIoInstance`, `getIoInstance`, `attachSocketRedisAdapter`, `socket`, `setSocket`, `incrementResponseIndex`, `waitForSocket`. Types: `SOCKETSTATUS`, `statusContent`, `apiMessage`, `syncMessage` |
| Auth helpers | `extractTokenFromSocket`, `extractTokenFromRequest`, `validateRequest`, `isFalsy`, `allowedOrigin`. Types: `ValidationResult` |
| Rate limiting | `checkRateLimit`, `getRateLimitStatus`, `clearRateLimit`, `clearAllRateLimits` |
| Validation | `validateInputByType` (resolves to `@luckystack/devkit` lazily in dev) |
| Persistence + env | `redis`, `prisma`, `db` exports, `env` exports |
| Boot | `writeBootUuid`, `readBootUuid`, `resolveEnvKey`, `collectSynchronizedEnvKeys`, `computeSynchronizedEnvHashes`, `hashSynchronizedValue`, `initConsolelog` |
| Offline queue | `isOnline`, `enqueueApiRequest`, `enqueueSyncRequest`, `removeApiQueueItem`, `removeSyncQueueItem`, `removeApiQueueItemsByKey`, `flushApiQueue`, `flushSyncQueue`, `getApiQueueSize`, `getSyncQueueSize` |
| CSRF | `getCsrfToken`, `clearCsrfToken`, `httpFetch` |
| Cookies + paths | All exports of `./cookies`, `./httpApiUtils`, and `./paths` (`getGeneratedApiDocsPath`, `getApiMethodMapPath`, etc.) |
| Misc | `tryCatch`, `sleep`, `getParams`, response normalizers (`normalizeErrorResponse`, `extractLanguageFromHeader`, …), service-route helpers, socket-event constants |

> Note: `apiRequest` is exported from `@luckystack/core/client`, not from the server entry. The server barrel does not pull React-coupled code.

## Dependencies

- Runtime: `@socket.io/redis-adapter`, `dotenv`
- Peer (canonical ranges, standardized 2026-05-07):
  - `@prisma/client@^6.19.0`
  - `ioredis@^5.10.0`
  - `socket.io@^4.8.0`
  - `socket.io-client@^4.8.0`
  - `zod@^3.25.0`

## License

MIT — see [LICENSE](../../LICENSE).
