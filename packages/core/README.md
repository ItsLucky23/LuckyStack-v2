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
    oauthStateProjectNameFallback: 'my-app',
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
| Project config | `registerProjectConfig`, `getProjectConfig`, `isProjectConfigRegistered`, `DEFAULT_PROJECT_CONFIG`, types: `ProjectConfig`, `ProjectConfigInput`, `LoggingConfig`, `RateLimitingConfig`, `SessionConfig`, `SentryConfig`, `HttpConfig`, `HttpStreamConfig`, `SecurityHeadersConfig`, `CorsConfig`, `AuthConfig`, `SocketConfig`, `DevConfig` |
| Deploy config | `registerDeployConfig`, `getDeployConfig`, `isDeployConfigRegistered`, types: `DeployConfigShape`, `DeployResourceShape` |
| Runtime maps | `registerRuntimeMapsProvider`, `getRuntimeApiMaps`, `getRuntimeSyncMaps` |
| Notifier | `registerNotifier`, `getNotifier`, `notify` |
| Hooks | `registerHook`, `dispatchHook`, types: `HookName`, `HookHandler`, `HookResult`, `HookStopSignal`, `HookPayloads`, `PreApiExecutePayload`, `PostApiExecutePayload`, `PreSyncFanoutPayload`, `PostSyncFanoutPayload` |
| Session types | `BaseSessionLayout`, `SessionLocation`, `AuthProps` |
| Socket | `setIoInstance`, `getIoInstance`, `attachSocketRedisAdapter`, `socket`, `setSocket`, `incrementResponseIndex`, `waitForSocket` |
| Persistence | `redis`, `prisma`, `db` exports, `extractTokenFromSocket`, `extractTokenFromRequest`, `validateRequest`, `checkRateLimit` and friends |
| Boot | `writeBootUuid`, `readBootUuid`, `resolveEnvKey`, `collectSynchronizedEnvKeys`, `computeSynchronizedEnvHashes`, `initConsolelog` |
| Offline queue | `isOnline`, `enqueueApiRequest`, `enqueueSyncRequest`, `flushApiQueue`, `flushSyncQueue` |
| Misc | `tryCatch`, `sleep`, `getParams`, `allowedOrigin`, `serveAvatar`, `validateInputByType`, response normalizers, service-route helpers |

## Dependencies

- Runtime: `@socket.io/redis-adapter`, `dotenv`
- Peer: `@prisma/client`, `ioredis`, `socket.io`, `socket.io-client`, `zod`

## License

MIT — see [LICENSE](../../LICENSE).
