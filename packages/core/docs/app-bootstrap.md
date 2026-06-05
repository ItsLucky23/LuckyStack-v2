# App Bootstrap

> Deep specs for the registries + utilities a project entry wires at boot: bind address, runtime maps, api-method map, prisma/redis clients, notifier, email senders, logger + redacted log keys, locale reloader, boot UUID, synchronized env hashes, plus the cross-cutting helpers `tryCatch`, `sleep`, `getParams`, `serveAvatar`. Source: `packages/core/src/`. Bijgewerkt: 2026-05-20.

## Overview

The core package exposes a uniform "register at boot, read at call time" pattern across many DI slots. A consumer's boot entry calls every relevant `register*` function once, before framework hot paths run. Framework packages then read via `get*` accessors and never reach around the registry.

This doc groups every slot into sections:

- **Bind address** — `createLuckyStackServer` writes the resolved listen address so CORS code reads it from one source.
- **Runtime maps + api method map** — the project's generated route maps are injected via a provider, so the api/sync packages can resolve route handlers without relative imports into the consumer tree.
- **Prisma + Redis clients** — DI slots with lazy defaults; `prisma` and `redis` are proxies that defer resolution to call time.
- **Notifier** — client-side toast slot used by `apiRequest`, `syncRequest`, and the offline-queue flush.
- **Email senders** — multi-adapter registry (`'default'`, `'transactional'`, `'marketing'`, custom) with a legacy single-sender path.
- **Logger + redacted log keys** — pluggable logger (default = console; dev factory available) plus a set of keys masked when printing payloads.
- **Locale reloader** — devkit watcher trigger point.
- **Boot UUID + synchronized env hashes** — router cross-env handshake primitives.
- **Misc utilities** — `tryCatch`, `sleep`, `getParams`, `serveAvatar`.

## API Reference — Bind Address

### `registerBindAddress(address: { ip: string; port: number }): void`

Stores the listen address used by `createLuckyStackServer`. Framework code (e.g. `checkOrigin` building the same-origin allow-list entry) reads from this registry instead of `SERVER_IP`/`SERVER_PORT` env vars so programmatic `createLuckyStackServer({ ip, port })` boots don't drift.

### `getBindAddress(): { ip: string; port: string }`

**Behavior (resolution order):**
1. Registered value (returns `{ ip: registered.ip, port: String(registered.port) }`).
2. `process.env.SERVER_IP` / `process.env.SERVER_PORT`.
3. Fallback to `'127.0.0.1'` / `''`.

## API Reference — Runtime Maps

### Types
```typescript
export interface RuntimeApiMapsResult {
  apisObject: Record<string, unknown>;
  functionsObject: Record<string, unknown>;
}

export interface RuntimeSyncMapsResult {
  syncObject: Record<string, unknown>;
  functionsObject: Record<string, unknown>;
}

export interface RuntimeMapsProvider {
  getRuntimeApiMaps: () => Promise<RuntimeApiMapsResult>;
  getRuntimeSyncMaps: () => Promise<RuntimeSyncMapsResult>;
}
```

### `registerRuntimeMapsProvider(provider: RuntimeMapsProvider): void`

Stores a provider. The project's `server/prod/runtimeMaps.ts` knows how to dynamically import per-preset `generatedApis.<preset>.ts` files and merge devkit overrides — framework packages don't. They ask core for the current maps and core delegates.

### `getRuntimeApiMaps(): Promise<RuntimeApiMapsResult>`
### `getRuntimeSyncMaps(): Promise<RuntimeSyncMapsResult>`

Async accessors. Default (unregistered) returns empty `{ apisObject: {}, functionsObject: {} }` / `{ syncObject: {}, functionsObject: {} }` so framework code can boot in tests without crashing — but every api/sync route silently 404s in that mode.

### `isRuntimeMapsProviderRegistered(): boolean`

Used by `verifyBootstrap` (in `@luckystack/server`) to detect the production fail-mode where no provider got registered — typically because the project forgot to import its `server/prod/runtimeMaps.ts` side-effect.

## API Reference — API Method Map

### Types
```typescript
export type HttpMethodLiteral = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type ApiMethodMap = Record<string, Record<string, Record<string, HttpMethodLiteral>>>;
```

Shape: `apiMethodMap[pagePath][apiName][version] = 'GET' | ...`.

### `registerApiMethodMap(map: ApiMethodMap): void`

Stores the generated method map (typically wired by `apiTypes.generated.ts`).

### `getRegisteredApiMethod(pagePath, apiName, version): HttpMethodLiteral | undefined`

Returns the registered method or `undefined`. `isGetMethod` (in `apiRequest.ts`) falls back to the `inferHttpMethod` prefix heuristic when undefined.

### `isApiMethodMapRegistered(): boolean`

Detects whether the prefix-heuristic fallback is active.

## API Reference — Prisma + Redis Clients

### `registerPrismaClient(client: PrismaClient): PrismaClient`
### `registerRedisClient(client: RedisClient): RedisClient`

Stores a custom client and returns it for chaining. Replaces (last-write-wins).

### `getPrismaClient(): PrismaClient`
### `getRedisClient(): RedisClient`

**Behavior (resolution order):**
1. Registered client.
2. Default resolver (set by `db.ts` / `redis.ts` at module load with the lazy factory).
3. Throws when neither exists ("No Prisma/Redis client available...").

### `isPrismaClientRegistered(): boolean`
### `isRedisClientRegistered(): boolean`

Boot guards.

### `setDefaultPrismaResolver(resolver)` / `setDefaultRedisResolver(resolver)`

Internal — wired by `db.ts` / `redis.ts`. Splits registration from default construction so this file doesn't depend on `@prisma/client` / `ioredis` types directly.

## API Reference — Notifier

### Types
```typescript
export interface NotifyParam { key: string; value: string | number | boolean }
export interface NotifyInput { key: string; params?: NotifyParam[] }
export interface Notifier {
  success: (input: NotifyInput) => void;
  error: (input: NotifyInput) => void;
  info: (input: NotifyInput) => void;
  warning: (input: NotifyInput) => void;
}
```

### `registerNotifier(notifier: Notifier): void`

Replaces the active notifier. Default is a no-op (safe for SSR / tests).

### `getNotifier(): Notifier`

Returns the active notifier.

### `notify: Notifier`

A delegating wrapper used by framework hot paths so framework code can do `notify.error({ key: 'api.failed' })` without dereferencing on every call.

## API Reference — Email Senders

### Types
```typescript
export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
}

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; cause?: unknown };

export interface EmailSender {
  name: string;
  send: (message: EmailMessage) => Promise<EmailResult>;
}

export type EmailSenderRegistry = Record<string, EmailSender>;
```

### `registerEmailSender(sender: EmailSender): void`

Legacy single-sender. Mirrors the sender into `registry.default` so `getEmailSenderByName('default')` finds it.

### `registerEmailSenders(senders: EmailSenderRegistry): void`

Multi-adapter. Replaces the entire registry (last-write-wins). If `senders.default` exists, also updates the legacy slot.

Reserved slot conventions:
- `'default'` — fallback when no specific slot matches.
- `'transactional'` — login password-reset, account-confirmation, security-critical mail.
- `'marketing'` — newsletters, bulk sends.
- `'diagnostics'` — diagnostic endpoints (e.g. playground).

Custom slots ('billing', 'support') are allowed and resolved explicitly via `sendEmail({ adapter: 'billing', ... })` in `@luckystack/email`.

### `getEmailSender(): EmailSender | null`

Returns the legacy sender, falling back to `registry.default`. `null` when neither is set.

### `getEmailSenderByName(name: string): EmailSender | null`

**Behavior:**
- Returns `registry[name]` when present.
- Falls back to the legacy single sender when `name === 'default'`.
- Returns `null` otherwise.

### `listEmailSenderNames(): string[]`

Returns the registry keys (excludes the legacy single-sender slot).

### `isEmailSenderRegistered(): boolean`

True when either the legacy slot or the registry is populated.

## API Reference — Logger

### Types
```typescript
export interface LoggerContext { [key: string]: unknown }

export interface Logger {
  debug: (message: string, context?: LoggerContext) => void;
  info: (message: string, context?: LoggerContext) => void;
  warn: (message: string, context?: LoggerContext) => void;
  error: (message: string, error?: unknown, context?: LoggerContext) => void;
}
```

### `registerLogger(logger: Logger): void`

Replaces the active logger and sets the registered flag.

### `getLogger(): Logger`

Returns the active logger. Default is a thin wrapper over `console.{debug,info,warn,error}` with no color codes — safe for production.

### `isLoggerRegistered(): boolean`

Boot guard.

### `createDevLogger(): Logger`

Returns a logger that calls `console.log(message[, context], '<color>')`. The trailing color string is only meaningful after `initConsolelog()` installed the console monkey-patch — without it the codes print as literal text.

### `resetLoggerForTests(): void`

Test-only — restores the default logger and clears the registered flag.

### `initConsolelog(): void`

Monkey-patches `console.log` to:
- Capture the caller's frame from the stack (skipping `consoleLog.ts` and `loggerRegistry.ts` frames).
- Strip the platform-specific path prefix and column suffix from the frame, yielding a `<file>:<line>` label.
- Find any color keyword in the args (`black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `reset`), remove it, and apply the ANSI color around the file label.
- If the first arg is an object, print the label first then the args on a new line; otherwise concatenate with `' -- '` separator.

Dev-only. Never install in production — stack-trace per log is expensive.

## API Reference — Redacted Log Keys

Default seed set: `password`, `confirmpassword`, `token`, `newtoken`, `authorization`, `cookie`, `set-cookie`. Stored lowercased.

### `registerRedactedLogKeys(keys: readonly string[]): void`

Additive — adds each lowercased key to the set. Idempotent on duplicates.

### `getRedactedLogKeys(): readonly string[]`

Returns a fresh array of the current set (lowercased).

### `isRedactedLogKey(key: string): boolean`

Case-insensitive lookup used inside framework log-redaction.

### `resetRedactedLogKeysForTests(): void`

Test-only — clears and re-seeds with the default set.

## API Reference — Locale Reloader

### `registerLocaleReloader(reloader: LocaleReloader): LocaleReloader`

Stores a `() => void | Promise<void>` callback and returns it. The consumer's i18n loader registers it; `@luckystack/devkit`'s file watcher calls it when `_locales/*.json` changes.

### `getLocaleReloader(): LocaleReloader | null`

Returns the registered reloader, or `null` when none was supplied (watcher no-ops in that case).

## API Reference — Boot UUID + Env Sync

### Constants

| Name | Value |
|---|---|
| `BOOT_KEY_PREFIX` | `'luckystack:boot:'` |
| (internal) `DEFAULT_BOOT_KEY_TTL_SECONDS` | `3600` |

`BOOT_KEY_PREFIX` is exported as the single source of truth so `@luckystack/router`'s `bootHandshake.ts` cannot drift.

### `resolveEnvKey(): string`

Returns `process.env.LUCKYSTACK_ENV` ?? `process.env.NODE_ENV` ?? `'development'`.

### `writeBootUuid(envKey?: string): Promise<string>`

**Behavior:** Generates a fresh `randomUUID()` and writes it to `luckystack:boot:<envKey>` in Redis with `EX <deployConfig.routing.bootKeyTtlSeconds ?? 3600>`. Returns the UUID.

### `readBootUuid(envKey?: string): Promise<string | null>`

Reads the UUID for the given env key (defaults via `resolveEnvKey()`).

### `collectSynchronizedEnvKeys(): string[]`

Walks `deployConfig.resources` and collects every `synchronizedEnvKeys[]` entry into a sorted unique list.

### `computeSynchronizedEnvHashes(): Record<string, string | null>`

For each key from `collectSynchronizedEnvKeys`, returns a SHA-256 hex hash of `process.env[key]` (or `null` when the var is unset). Used by `/_health` so the router can compare hashes across environments without leaking secrets.

### `hashSynchronizedValue(value: string): string`

Router-side helper — hash a single value with the same algorithm. Kept separate so the router can import it without loading the core barrel (which opens a Redis connection).

## API Reference — Utilities

### `tryCatch<T, P>(fn, params?, context?): Promise<[Error | null, T | null]>`

**Signature:**
```typescript
export default async function tryCatch<T, P>(
  func: (values: P) => Promise<T> | T,
  params?: P,
  context?: Record<string, unknown>,
): Promise<[Error | null, T | null]>
```

**Behavior:**
- Calls `func(params)`, awaits the result.
- On success → returns `[null, response]`.
- On throw → calls `captureException(error, context)` (legacy + multi-adapter fan-out) and returns `[error as Error, null]`.

**Usage convention:** check the first tuple element; if truthy, an error occurred.

```typescript
import { tryCatch } from '@luckystack/core';

const [error, result] = await tryCatch(async () => db.user.findUnique({ where: { id } }));
if (error) return { status: 'error', errorCode: 'db.failed' };
const user = result;
```

### `sleep(ms: number): Promise<void>`

Resolves after `setTimeout(ms)`. Used in fanout-yield loops and dev-mode hot reload debouncing.

### `getParams({ method, req, res, queryString? }): Promise<Record<string, unknown> | null>`

**Behavior:**
- `GET` → returns `Object.fromEntries(new URLSearchParams(queryString))`.
- `POST` / `PUT` / `DELETE`:
  - Checks the declared `Content-Length` against `projectConfig.http.requestBodyMaxBytes`. If exceeded → writes a 413 JSON error response with `errorCode: 'api.payloadTooLarge'` and resolves `null`.
  - Streams `req.on('data')`; aborts with the same 413 if running body size exceeds the cap.
  - Parses `application/x-www-form-urlencoded` via `URLSearchParams`.
  - Parses `application/json` via `JSON.parse(body || '{}')`. Rejects array / scalar / null bodies — only plain objects pass.
  - Unknown / missing content-type → 415 with `errorCode: 'api.unsupportedMediaType'`.
  - Malformed JSON / form → 400 with `errorCode: 'api.invalidRequestFormat'`.

**Returns:** Parsed object, or `null` when the framework already wrote an error response.

### `serveAvatar({ routePath, res }): Promise<void>`

**Behavior:**
1. Resolves `uploadsFolder = getUploadsDir()`.
2. Strips the extension from `routePath` → `fileId`.
3. Rejects when `!fileId` or `fileId` does not match `/^[A-Za-z0-9_-]{1,128}$/` → 404 plaintext. Belt-and-suspenders against path traversal even though `path.basename` already strips separators.
4. Reads `getAvatarConfig()` and walks `formats` in order:
   - For each `{ extension, contentType }`, checks `access(<uploadsFolder>/<fileId>.<extension>)` via `tryCatch`. First existing file wins.
   - Writes 200 with `Content-Type` + `Cache-Control` from the avatar config and pipes the file stream to `res`.
5. If no format matches → logs `avatar: file not found` at debug and writes 404 plaintext.

## Environment variables read by core

| Var | Default | Where |
|---|---|---|
| `NODE_ENV` | `'development'` | `env.ts` (Zod-validated). |
| `SERVER_IP` | `'127.0.0.1'` | `getBindAddress` fallback. |
| `SERVER_PORT` | `'80'` | `getBindAddress` fallback. |
| `SECURE` | `'false'` | `allowedOrigin` scheme selection. |
| `DNS` | `''` | Reserved. |
| `REDIS_HOST` | `'127.0.0.1'` | Default redis client. |
| `REDIS_PORT` | `'6379'` | Same. |
| `REDIS_USER` | (unset) | Optional ioredis auth. |
| `REDIS_PASSWORD` | (unset) | Optional ioredis auth. |
| `PROJECT_NAME` | `'luckystack'` | `getProjectName` fallback. |
| `LUCKYSTACK_ENV` | (unset) | `resolveEnvKey` first preference. |

## Example — minimal project boot

```typescript
import {
  registerProjectConfig,
  registerPrismaClient,
  registerRedisClient,
  registerLogger,
  registerNotifier,
  registerRuntimeMapsProvider,
  registerApiMethodMap,
  registerBindAddress,
} from '@luckystack/core';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

registerProjectConfig({ defaultLanguage: 'en' });
registerPrismaClient(new PrismaClient({ log: ['warn', 'error'] }));
registerRedisClient(new Redis(process.env.REDIS_URL!));
registerLogger({
  debug: (...a) => pino.debug(a),
  info:  (...a) => pino.info(a),
  warn:  (...a) => pino.warn(a),
  error: (...a) => pino.error(a),
});
registerNotifier(toastNotifier);
registerRuntimeMapsProvider(prodRuntimeMaps);
registerApiMethodMap(generatedApiMethodMap);
registerBindAddress({ ip: '0.0.0.0', port: 8080 });
```

## Related

- Function INDEX: `packages/core/CLAUDE.md`
- Architecture: `docs/ARCHITECTURE_PACKAGING.md`, `docs/ARCHITECTURE_ROUTING.md`, `docs/HOSTING.md`, `docs/ARCHITECTURE_EXTENSION_POINTS.md`
- README: `packages/core/README.md`
- Source: `packages/core/src/bindAddress.ts`, `runtimeMapsRegistry.ts`, `apiMethodMapRegistry.ts`, `clients.ts`, `db.ts`, `redis.ts`, `notifier.ts`, `emailRegistry.ts`, `loggerRegistry.ts`, `redactedLogKeys.ts`, `consoleLog.ts`, `localeReloader.ts`, `bootUuid.ts`, `synchronizedEnvHashes.ts`, `tryCatch.ts`, `sleep.ts`, `getParams.ts`, `serveAvatars.ts`
