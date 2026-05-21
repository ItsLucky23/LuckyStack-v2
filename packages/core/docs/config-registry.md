# Config Registry

> Deep specs for project / deploy / services / avatar / paths config slots. Source: `packages/core/src/`. Bijgewerkt: 2026-05-20.

## Overview

The config registries are the single source of truth for runtime project configuration. They follow a uniform pattern:

1. A consumer's boot entry calls `registerXConfig({...})` once before any framework code reads a value.
2. Framework code reads at call time via `getXConfig()` (never at module load) so the registration timing is flexible.
3. Boolean `isXConfigRegistered()` helpers exist for code paths that must fail closed when the consumer forgot to register.

Four independent slots live in this topic:

- **Project config** — runtime tunables (rate limits, session policy, HTTP, auth, sockets, paths). Deep-merged over `DEFAULT_PROJECT_CONFIG` so consumers only supply the keys they want to override.
- **Deploy config** — multi-env topology consumed by `@luckystack/router` (resources, environments, routing, development).
- **Services config** — service + preset definitions consumed by the router / preset loader.
- **Avatar config** — disk formats + cache header for `serveAvatar`.

Path getters (`getSrcDir`, `getGeneratedApiDocsPath`, …) resolve project-relative paths against `ROOT_DIR` (auto-detected workspace root) and read `getProjectConfig().paths.*` at call time.

## API Reference — Project Config

### `registerProjectConfig(config: ProjectConfigInput): void`

**Signature:**
```typescript
export const registerProjectConfig = (config: ProjectConfigInput): void
```

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `config` | `ProjectConfigInput` (deep-partial of `ProjectConfig`) | yes | Only the keys to override. Missing keys fall back to `DEFAULT_PROJECT_CONFIG`. |

**Returns:** `void`

**Behavior:**
- Deep-merges `config` over `DEFAULT_PROJECT_CONFIG` (plain-object branches recurse; primitives + arrays are replaced wholesale).
- Sets the registration flag so `isProjectConfigRegistered()` returns true.
- Replaces (last-write-wins) on repeated calls — the latest call is the active config.

**Errors / Edge cases:**
- `undefined` keys in the override are skipped (treated as "no override").
- Arrays are NOT merged element-wise — passing `cors.allowedOrigins: ['x']` replaces the default `[]` array.
- Calling after framework hot paths already ran is allowed but the values only take effect on subsequent reads (everything reads call-time).

**Example:**
```typescript
import { registerProjectConfig } from '@luckystack/core';

registerProjectConfig({
  defaultLanguage: 'en',
  session: { expiryDays: 30 },
  http: {
    cors: {
      allowedOrigins: ['https://app.example.com'],
      allowLocalhost: false,
    },
  },
});
```

### `getProjectConfig(): ProjectConfig`

**Signature:**
```typescript
export const getProjectConfig = (): ProjectConfig
```

**Returns:** The active fully-merged `ProjectConfig`.

**Behavior:**
- Returns the currently merged config object (reference-stable until the next `registerProjectConfig`).
- Returns `DEFAULT_PROJECT_CONFIG` when nothing was registered yet.

**Example:**
```typescript
import { getProjectConfig } from '@luckystack/core';

const { http, rateLimiting } = getProjectConfig();
const cookieName = http.sessionCookieName;
```

### `getProjectName(): string`

**Signature:**
```typescript
export const getProjectName = (): string
```

**Returns:** The active project namespace (used as Redis key prefix for session, password reset, rate limits, OAuth state, etc.).

**Behavior:** Resolves in this order (first non-empty wins):
1. `projectConfig.session.projectName`
2. `process.env.PROJECT_NAME`
3. literal `'luckystack'`

**Example:**
```typescript
import { getProjectName } from '@luckystack/core';

const key = `${getProjectName()}-session:${token}`;
```

### `isProjectConfigRegistered(): boolean`

**Signature:**
```typescript
export const isProjectConfigRegistered = (): boolean
```

**Returns:** `true` only after `registerProjectConfig` has been called at least once.

**Behavior:**
- Pure boot-time guard — does not throw.
- Framework packages use this for "did the installer forget to register?" warnings without crashing tests/CLI contexts.

### `DEFAULT_PROJECT_CONFIG: ProjectConfig`

Exported so consumers can spread + override structurally:

```typescript
import { DEFAULT_PROJECT_CONFIG, registerProjectConfig } from '@luckystack/core';

registerProjectConfig({
  ...DEFAULT_PROJECT_CONFIG,
  defaultLanguage: 'nl',
});
```

Notable defaults (verbatim from `projectConfig.ts`):

| Key | Default |
|---|---|
| `rateLimiting.enabled` | `true` |
| `rateLimiting.store` | `'memory'` |
| `rateLimiting.defaultApiLimit` | `60` |
| `rateLimiting.defaultIpLimit` | `100` |
| `rateLimiting.windowMs` | `60_000` |
| `session.expiryDays` | `7` |
| `session.perBrowser` | `'single'` |
| `session.perUser` | `'single'` |
| `session.onConflict` | `'revokeOld'` |
| `session.notifyOldDeviceOnRevoke` | `true` |
| `http.sessionCookieName` | `'token'` |
| `http.sessionCookieSameSite` | `'Strict'` |
| `http.requestBodyMaxBytes` | `1048576` |
| `http.healthEndpoint` | `'/_health'` |
| `http.liveEndpoint` | `'/livez'` |
| `http.readyEndpoint` | `'/readyz'` |
| `http.cors.credentials` | `true` |
| `http.cors.allowedOrigins` | `[]` |
| `http.cors.allowLocalhost` | `false` |
| `auth.bcryptRounds` | `10` |
| `auth.providerAccountStrategy` | `'per-provider'` |
| `auth.forgotPassword` | `'disabled'` |
| `auth.passwordResetTtlSeconds` | `3600` |
| `socket.maxHttpBufferSize` | `5 * 1024 * 1024` |
| `socket.pingTimeout` | `20_000` |
| `socket.pingInterval` | `25_000` |
| `sync.fanoutYieldEvery` | `100` |
| `sync.fanoutYieldMs` | `1` |
| `offlineQueue.maxSize` | `200` |
| `offlineQueue.maxAgeMs` | `3_600_000` |
| `offlineQueue.dropPolicy` | `'drop-oldest'` |
| `dev.hotReloadDebounceMs` | `120` |
| `defaultLanguage` | `'en'` |
| `defaultTheme` | `'light'` |

## API Reference — Deploy Config

### `registerDeployConfig(config: DeployConfigShape): DeployConfigShape`

**Signature:**
```typescript
export const registerDeployConfig = (config: DeployConfigShape): DeployConfigShape
```

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `config` | `DeployConfigShape` | yes | Deploy topology object — `{ resources, environments?, routing?, development? }`. |

**Returns:** The stored config (same reference passed in).

**Behavior:**
- Stores the provided config wholesale (no deep-merge, unlike `registerProjectConfig`).
- Sets `isDeployConfigRegistered()` to `true`.

**Example:**
```typescript
import { registerDeployConfig } from '@luckystack/core';

registerDeployConfig({
  resources: {
    redis: { type: 'redis', urlEnvKey: 'REDIS_URL', synchronizedEnvKeys: ['SESSION_SECRET'] },
    mongo: { type: 'mongo', urlEnvKey: 'MONGO_URL' },
  },
  environments: {
    production: { redis: 'redis', mongo: 'mongo', bindings: {} },
  },
  routing: { strictBootHandshake: true },
});
```

### `getDeployConfig(): DeployConfigShape`

Returns the registered deploy config, or `{ resources: {} }` when nothing was registered. Never throws.

### `isDeployConfigRegistered(): boolean`

Non-throwing guard. Used by router / boot probes that need a real registration before behaving differently from the empty default.

## API Reference — Services Config

### `registerServicesConfig(config: ServicesConfigShape): ServicesConfigShape`

**Signature:**
```typescript
export const registerServicesConfig = (config: ServicesConfigShape): ServicesConfigShape
```

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `config` | `ServicesConfigShape` | yes | `{ services, presets }` — services define folder sources, presets bundle multiple services into one artifact. |

**Returns:** The stored config.

**Behavior:**
- Stores the config (last-write-wins).
- Side-effect pattern: the consumer's `services.config.ts` is expected to call this on module import.

### `getServicesConfig(): ServicesConfigShape`

**Throws** `Error` when no services config has been registered. Message includes guidance to import `services.config.ts` as a side-effect.

### `isServicesConfigRegistered(): boolean`

Non-throwing guard for code that wants to fall back instead of crashing.

## API Reference — Avatar Config

### `registerAvatarConfig(config: AvatarConfigInput): void`

**Signature:**
```typescript
export const registerAvatarConfig = (config: AvatarConfigInput): void
```

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `config.formats` | `{ extension: string; contentType: string }[]` | no | Disk formats checked in order; first existing file wins. |
| `config.cacheControl` | `string` | no | `Cache-Control` header. Default `'public, max-age=86400'`. |

**Behavior:**
- Empty `formats` array is treated as "use default" (keeps the built-in `[{ extension: 'webp', contentType: 'image/webp' }]`).
- Missing `cacheControl` keeps the default.

**Example:**
```typescript
import { registerAvatarConfig } from '@luckystack/core';

registerAvatarConfig({
  formats: [
    { extension: 'webp', contentType: 'image/webp' },
    { extension: 'png',  contentType: 'image/png'  },
  ],
  cacheControl: 'public, max-age=604800',
});
```

### `getAvatarConfig(): AvatarConfig`

Returns the active avatar config (defaults applied).

### `DEFAULT_AVATAR_CONFIG: AvatarConfig`

```typescript
{
  formats: [{ extension: 'webp', contentType: 'image/webp' }],
  cacheControl: 'public, max-age=86400',
}
```

## API Reference — Paths

`paths.ts` exports lazy getters that resolve `projectConfig.paths.*` against `ROOT_DIR`. Read at call time so a late `registerProjectConfig({ paths: {...} })` still wins.

| Function | Returns | Reads from |
|---|---|---|
| `getSrcDir()` | absolute path | `paths.srcDir` |
| `getServerDir()` | absolute path | `paths.serverDir` |
| `getSharedDir()` | absolute path | `paths.sharedDir` |
| `getUploadsDir()` | absolute path | `paths.uploadsDir` |
| `getPublicDir()` | absolute path | `paths.publicDir` |
| `getServerFunctionsDir()` | absolute path | `paths.serverFunctionsDir` |
| `getGeneratedSocketTypesPath()` | absolute path | `paths.generatedSocketTypes` |
| `getGeneratedApiSchemasPath()` | absolute path | `paths.generatedApiSchemas` |
| `getGeneratedApiDocsPath()` | absolute path | `paths.generatedApiDocs` |
| `resolveFromRoot(...segments: string[])` | absolute path | `ROOT_DIR` + joined segments |

`ROOT_DIR` is auto-detected by walking up from `process.cwd()` (then `__dirname`) and stopping at the first directory containing `package.json` plus either `tsconfig.json` or `tsconfig.server.json`. Falls back to `process.cwd()` when no marker is found.

Deprecated module-level constants exist for backwards compatibility (`SRC_DIR`, `SERVER_DIR`, `SHARED_DIR`, `UPLOADS_DIR`, `PUBLIC_DIR`, `SERVER_FUNCTIONS_DIR`, `GENERATED_SOCKET_TYPES_PATH`, `GENERATED_API_SCHEMAS_PATH`, `GENERATED_API_DOCS_PATH`). These resolve at module load and ignore later `registerProjectConfig` overrides — prefer the getters for new code.

## Config keys (top-level `ProjectConfig`)

| Key | Type | Default | Description |
|---|---|---|---|
| `app.publicUrl` | `string` | `''` | Absolute origin of the deployment; consumed by OAuth callbacks and transactional email links. |
| `logging.*` | flags | all `false` | Dev-only logging toggles. |
| `rateLimiting.enabled` | `boolean` | `true` | Kill-switch — when `false`, every check short-circuits to allowed. |
| `rateLimiting.store` | `'memory' \| 'redis'` | `'memory'` | Backend for the default strategy. |
| `rateLimiting.windowMs` | `number` | `60000` | Default sliding window. |
| `session.basedToken` | `boolean` | `false` | When `true`, tokens are stored in sessionStorage + handshake auth instead of cookies. |
| `session.expiryDays` | `number` | `7` | Session TTL. |
| `session.perBrowser` | `'single' \| 'multiple'` | `'single'` | Whether a single browser may hold multiple parallel logins. |
| `session.perUser` | `'single' \| 'multiple'` | `'single'` | Whether a single user may be logged in on multiple devices concurrently. |
| `session.maxConcurrentPerUser` | `number \| null` | `null` | Cap when `perUser === 'multiple'`. |
| `session.onConflict` | `'revokeOld' \| 'rejectNew'` | `'revokeOld'` | Policy when the cap is hit. |
| `session.projectName` | `string` | `''` | Explicit Redis prefix; empty means fall back to `PROJECT_NAME` env. |
| `http.sessionCookieName` | `string` | `'token'` | Cookie name read by `extractTokenFromSocket` / `extractTokenFromRequest`. |
| `http.requestBodyMaxBytes` | `number` | `1048576` | Hard cap enforced by `getParams`. |
| `http.healthEndpoint` | `string` | `'/_health'` | Router boot-handshake endpoint. |
| `http.cors.allowedOrigins` | `string[] \| (origin: string) => boolean` | `[]` | Static allowlist or sync resolver. |
| `http.cors.allowLocalhost` | `boolean` | `false` | Convenience flag for dev. |
| `auth.bcryptRounds` | `number` | `10` | Hash cost factor. |
| `auth.passwordPolicy.*` | rules | various | Credentials policy. |
| `auth.forgotPassword` | `'framework' \| 'custom' \| 'disabled'` | `'disabled'` | Reset-flow ownership. |
| `socket.maxHttpBufferSize` | `number` | `5MB` | Per-message ceiling. |
| `sync.fanoutYieldEvery` | `number` | `100` | Recipients between event-loop yields. |
| `offlineQueue.dropPolicy` | `'drop-oldest' \| 'drop-newest' \| 'reject'` | `'drop-oldest'` | Default eviction when full. |
| `dev.hotReloadDebounceMs` | `number` | `120` | File-watcher debounce. |
| `paths.*` | paths | see defaults table | Project filesystem layout. |
| `defaultLanguage` | `string` | `'en'` | Initial language for new sessions. |
| `socketActivityBroadcaster` | `boolean` | `false` | Enable presence broadcasts. |
| `socketStatusIndicator` | `boolean` | `false` | Show the floating socket-status badge. |
| `loginRedirectUrl` | `string` | `'/'` | Post-login destination. |

See `packages/core/src/projectConfig.ts` for the full type definitions of `LoggingConfig`, `RateLimitingConfig`, `SessionConfig`, `HttpConfig`, `CorsConfig`, `SecurityHeadersConfig`, `AuthConfig`, `PasswordPolicyConfig`, `SocketConfig`, `SyncConfig`, `SyncStreamThrottleConfig`, `OfflineQueueConfig`, `DevConfig`, and `PathsConfig`.

## Related

- Function INDEX: `packages/core/AI_INDEX.md`
- Architecture: `docs/ARCHITECTURE_PACKAGING.md`, `docs/ARCHITECTURE_ROUTING.md`
- README: `packages/core/README.md`
- Source: `packages/core/src/projectConfig.ts`, `deployConfigRegistry.ts`, `servicesConfigRegistry.ts`, `avatarConfig.ts`, `paths.ts`
