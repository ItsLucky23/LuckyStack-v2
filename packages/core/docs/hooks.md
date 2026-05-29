# Hooks

> Deep specs for the async + sync hook registries, the canonical core-owned payload shapes, `processUpload`, and the response normalizer family. Source: `packages/core/src/hooks/`, `processUpload.ts`, `responseNormalizer.ts`. Bijgewerkt: 2026-05-20.

## Overview

LuckyStack ships two hook registries:

- **Async hook registry** (`registerHook` / `dispatchHook`) — used by lifecycle events that can tolerate await (`preApiExecute`, `postApiRespond`, `corsRejected`, etc.). Handlers can return a `HookStopSignal` to abort the framework's main flow.
- **Sync mutator registry** (`registerSyncHook` / `dispatchSyncHook`) — used by hot-path mutators that must remain synchronous (`preErrorNormalize`, `postErrorNormalize`). Handlers mutate the payload object in place; there is no stop signal.

Both registries swallow handler exceptions: errors are routed to `getLogger().error` + `captureException` so a misbehaving handler can never crash the framework. Multiple handlers per hook are supported and invoked in registration order.

Feature packages extend `HookPayloads` via TypeScript module augmentation. The augmentation file must be in a tsconfig `include` path AND side-effect imported from the package barrel (`import './hookPayloads';`) so TS merges the declarations.

`processUpload` is included in this topic because it's the public API that ties the `onUploadStart` / `onUploadComplete` hook contract together for consumer upload routes.

## Lifecycle flow (api request)

```
client emits apiRequest
   ├─> preHttpRequest          (async — read-only meta)
   ├─> preApiValidate          (async — can stop)
   ├─> [framework validation]
   ├─> postApiValidate         (async — read-only)
   ├─> preApiExecute           (async — can stop)
   ├─> [handler.main()]
   ├─> postApiExecute          (async — read-only + durationMs)
   ├─> preApiRespond           (async — mutate response in place)
   ├─> transformApiResponse    (async — mutate response in place)
   └─> postApiRespond          (async — read-only, after wire-send)

On error:
   ├─> preErrorNormalize       (sync mutator)
   ├─> [responseNormalizer]
   ├─> postErrorNormalize      (sync mutator)
   └─> apiError                (async — observability)
```

The sync flow has its own analogues (`preSyncAuthorize`, `preSyncFanout`, `postSyncFanout`, `preSyncStream`, `postSyncStream`, `syncError`).

## Types

```typescript
export interface HookSessionShape {
  id: string;
  token: string;
  email?: string | null;
  name?: string | null;
  avatar?: string | null;
  avatarFallback?: string | null;
  admin?: boolean | null;
  language?: string | null;
  roomCodes?: string[];
}

export interface HookStopSignal {
  stop: true;
  errorCode: string;
  httpStatus?: number;
}

export type HookResult = undefined | HookStopSignal;
export type HookHandler<TPayload> = (payload: TPayload) => Promise<HookResult> | HookResult;
export type SyncHookHandler<TPayload> = (payload: TPayload) => void;

export type DispatchResult =
  | { stopped: false }
  | { stopped: true; signal: HookStopSignal };

export type HookName = keyof HookPayloads;
export type SyncHookName = keyof SyncHookPayloads;
```

`HookSessionShape` is defined in core (not imported from login) so the core hook layer stays free of feature-package deps. Any concrete `BaseSessionLayout` / project `SessionLayout` is structurally assignable.

## API Reference — Async Hooks

### `registerHook<TName>(name, handler): void`

**Signature:**
```typescript
export const registerHook = <TName extends HookName>(
  name: TName,
  handler: HookHandler<HookPayloads[TName]>,
): void
```

**Behavior:** Appends the handler to the (string-keyed) list of handlers for `name`. Multiple registrations are allowed; order is preserved.

### `dispatchHook<TName>(name, payload): Promise<DispatchResult>`

**Signature:**
```typescript
export const dispatchHook = async <TName extends HookName>(
  name: TName,
  payload: HookPayloads[TName],
): Promise<DispatchResult>
```

**Behavior (in order):**
1. Reads the handler list for `name` (empty array if none).
2. For each handler:
   - Awaits `handler(payload)` inside a try/catch.
   - On thrown error → logs `hook: handler for "<name>" threw` via `getLogger().error` + `captureException(error, { hook: name })`. Continues with the next handler.
   - On returned `HookStopSignal` (any non-undefined return value) → returns `{ stopped: true, signal: result }` immediately. Remaining handlers do NOT run.
3. After all handlers complete without a stop → returns `{ stopped: false }`.

**Mutation contract:** Handlers receive the same payload object reference. For payloads that explicitly support mutation (`PreApiRespondPayload.response`, `transformApiResponse`), mutating in place is the documented mechanism to replace the outgoing response without a stop signal.

### `clearAllHooks(): void`

Test-only. Clears both the async and sync hook registries. Never call from production paths — framework-internal hooks (presence cleanup, etc.) would be wiped.

## API Reference — Sync Hooks

### `registerSyncHook<TName>(name, handler): void`

**Behavior:** Same shape as `registerHook` but appends to the sync map.

### `dispatchSyncHook<TName>(name, payload): void`

**Behavior:**
- Invokes every handler synchronously.
- Per-handler try/catch isolates failures (same logger + `captureException` path as async).
- Cannot stop the flow. Handlers mutate `payload` in place.

**When to use sync:** Only when the call site is on a hot path that genuinely cannot afford to `await`. The current usage is `normalizeErrorResponse` because it's invoked from many places in a single request (api error path, sync error path, transport boundaries).

## Core-owned payload shapes

### API lifecycle

| Hook | Payload (key fields) |
|---|---|
| `preHttpRequest` | `method`, `url`, `requestId`, `origin`, `headers` (sanitized — no auth/cookie). |
| `preApiValidate` | `routeName`, `data`, `user`. |
| `postApiValidate` | extends `preApiValidate` + `validation: { status: 'success' } \| { status: 'error', message }`. |
| `preApiExecute` | `routeName`, `data`, `user`. |
| `postApiExecute` | `routeName`, `data`, `user`, `result`, `error`, `durationMs`. |
| `preApiRespond` | `routeName`, `user`, `response: ApiResponseEnvelope` (mutable). |
| `transformApiResponse` | Same shape — separate hook so plugins can compose without ordering with `preApiRespond`. |
| `postApiRespond` | `routeName`, `user`, `response` (immutable after wire-send). |

### Sync lifecycle

| Hook | Payload (key fields) |
|---|---|
| `preSyncAuthorize` | `routeName`, `data` (raw), `user`, `receiver`. |
| `preSyncFanout` | `routeName`, `data`, `user`, `receiver`, `serverOutput`. |
| `postSyncFanout` | extends `preSyncFanout` + `recipientCount`. |
| `preSyncStream` | `routeName`, `chunk`, `recipient`. |
| `postSyncStream` | extends `preSyncStream` + `chunkIndex`. |

### Error / security signals

| Hook | Payload (key fields) |
|---|---|
| `apiError` | `route`, `method?`, `requestId?`, `user?`, `error`. |
| `syncError` | Same shape. |
| `rateLimitExceeded` | `scope`, `key` (sanitized), `limit`, `windowMs`, `count`, `route?`, `ip?`, `userId?`. |
| `corsRejected` | `origin`, `normalizedOrigin`, `allowedOrigins`, `allowLocalhost`, `route?`. |
| `csrfMismatch` | `route`, `method?`, `requestId?`, `userId?`, `providedToken: boolean`. |

### Session refresh

| Hook | Payload (key fields) |
|---|---|
| `preSessionRefresh` | `token`, `userId`, `oldTtl`, `newTtl`. |
| `postSessionRefresh` | extends + `applied: boolean`. |

### Uploads

| Hook | Payload (key fields) |
|---|---|
| `onUploadStart` | `userId`, `contentType`, `sizeBytes`, `uploadKind`. Can return `HookStopSignal` (e.g. content moderation reject). |
| `onUploadComplete` | `userId`, `fileName`, `sizeBytes`, `uploadKind`. Read-only — fires after disk write. |

### Sync mutator hooks

| Hook | Payload (key fields) |
|---|---|
| `preErrorNormalize` | `response: ErrorResponseInput` (mutable), `preferredLocale?`, `userLanguage?`, `fallbackHttpStatus?`. |
| `postErrorNormalize` | `normalized: NormalizedErrorResponse` (mutable), `preferredLocale?`, `userLanguage?`. |

## API Reference — processUpload

### `processUpload(input: ProcessUploadInput): Promise<ProcessUploadResult>`

**Signature:**
```typescript
export interface ProcessUploadInput {
  userId: string;
  contentType: string;
  buffer: Buffer;
  uploadKind?: string;       // default 'avatar'
  fileName: string;
  encodeAndSave: (buffer: Buffer) => Promise<number>;
}

export type ProcessUploadResult =
  | { status: 'success'; sizeBytes: number }
  | { status: 'rejected'; errorCode: string }
  | { status: 'error'; reason: string; cause?: unknown };
```

**Behavior (in order):**
1. Resolves `uploadKind` (defaults to `'avatar'`).
2. Dispatches `onUploadStart` with `{ userId, contentType, sizeBytes: buffer.byteLength, uploadKind }`. If a handler returned a stop signal → returns `{ status: 'rejected', errorCode: signal.errorCode }`.
3. Runs `input.encodeAndSave(buffer)` inside `tryCatch`. On error → returns `{ status: 'error', reason: error.message || 'encode-failed', cause: error }`.
4. Dispatches `onUploadComplete` with `{ userId, fileName, sizeBytes: finalSize ?? buffer.byteLength, uploadKind }`.
5. Returns `{ status: 'success', sizeBytes }`.

**Why a callback (not built-in encoder):** core stays free of heavy native deps (sharp, ffmpeg, S3 SDKs). The consumer plugs in whichever encoder it needs and core only brackets the call with the hook contract.

**Example:** see `src/settings/_api/updateUser_v1.ts` for the canonical avatar usage.

## API Reference — Response normalizer family

### Types
```typescript
export interface ErrorParam {
  key: string;
  value: string | number | boolean;
}

export interface ErrorResponseInput {
  status?: unknown;
  errorCode?: unknown;
  errorParams?: unknown;
  httpStatus?: unknown;
}

export interface NormalizedErrorResponse {
  status: 'error';
  message: string;
  errorCode: string;
  errorParams?: ErrorParam[];
  httpStatus?: number;
}

export const INVALID_ERROR_RESPONSE_CODE = 'error.invalidResponse';
```

### `isErrorParamArray(value: unknown): value is ErrorParam[]`

Type guard. Returns `true` when `value` is an array and every element has a string `key` plus a `string | number | boolean` `value`.

### `normalizeErrorResponseCore({ response, fallbackHttpStatus?, fallbackErrorCode?, resolveMessage? })`

**Behavior:**
- Extracts `errorParams` (defaults to `undefined` when not an `ErrorParam[]`).
- Reads `errorCode` (trimmed string). Falls back to `fallbackErrorCode` then `INVALID_ERROR_RESPONSE_CODE`.
- Reads `httpStatus` only when `typeof === 'number'`; otherwise uses `fallbackHttpStatus`.
- Calls `resolveMessage?.({ errorCode, errorParams })` when provided; otherwise uses the raw `errorCode` as `message`.
- Returns `{ status: 'error', message, errorCode, errorParams?, httpStatus? }`.

### `defaultHttpStatusForResponse({ status, explicitHttpStatus?, fallbackErrorStatus = 400 })`

Returns `explicitHttpStatus` when numeric, else `200` for `'success'` and `fallbackErrorStatus` for `'error'`.

The localized `normalizeErrorResponse` wrapper (in `localizedNormalizer.ts`) layers i18n + the `preErrorNormalize` / `postErrorNormalize` sync hooks on top of `normalizeErrorResponseCore` — see source for the full surface.

## Extending HookPayloads (feature packages)

```typescript
// packages/<feature>/src/hookPayloads.ts
import type { HookSessionShape } from '@luckystack/core';

declare module '@luckystack/core' {
  interface HookPayloads {
    myFeatureHook: { userId: string; data: { foo: number } };
  }
}

export {};
```

Then side-effect import from the package barrel so the augmentation is reachable:

```typescript
// packages/<feature>/src/index.ts
import './hookPayloads';
export { /* ... */ };
```

## Edge cases

- A handler that returns `undefined` continues the chain; ANY non-`undefined` return value is treated as a stop signal (the type is `undefined | HookStopSignal`, so returning a plain string would be a type error in TS but a stop in JS — keep the typed signature).
- `clearAllHooks` clears BOTH registries; if you only need to drop async handlers, register fresh sync ones afterwards.
- `dispatchSyncHook` ignores handler return values entirely — mutate `payload` in place.

## Related

- Function INDEX: `packages/core/CLAUDE.md`
- Architecture: `docs/ARCHITECTURE_EXTENSION_POINTS.md`, `docs/ARCHITECTURE_API.md`, `docs/ARCHITECTURE_SYNC.md`
- README: `packages/core/README.md`
- Source: `packages/core/src/hooks/registry.ts`, `hooks/types.ts`, `processUpload.ts`, `responseNormalizer.ts`
