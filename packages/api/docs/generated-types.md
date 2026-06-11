# Generated Types

> Last updated: 2026-05-20

## Overview

LuckyStack's API layer is fully type-safe end-to-end. Every `src/{page}/_api/{name}_v{N}.ts` file is read by `@luckystack/devkit` via the TypeScript compiler API, its `ApiParams['data']` and `main` return types are extracted, and three artifacts are emitted: `apiTypes.generated.ts` (the static type map), `apiInputSchemas.generated.ts` (runtime Zod schemas), and `apiDocs.generated.json` (introspection JSON used by `@luckystack/docs-ui`). `@luckystack/api` reads the runtime map at request time and uses the input-type text to drive `validateInputByType`. The client-side `apiRequest` from `@luckystack/core` reads the static type map to infer payload + response shapes from the route-name + version literals you pass it.

This means: any change to an API file's `ApiParams['data']` interface or `main` return type propagates to the client at the next regeneration. The hot-reload watcher (devkit) triggers regeneration on save. The strict typing policy in the repo root contract (`.claude/CLAUDE.md` rule 16) requires this inference chain to remain intact — `unknown` / `any` casts around `apiRequest` defeat the whole pipeline.

This doc covers the generated type surface, the runtime validation flow that consumes it, and the per-route opt-out for cases where strict input typing is impossible (third-party webhooks).

## The two generated files

| Artifact | Default path | Purpose | Consumer |
| --- | --- | --- | --- |
| `apiTypes.generated.ts` | `src/_sockets/apiTypes.generated.ts` | Static TS type map. Declares `ApiTypeMap`, `PagePath`, `ApiName`, `ApiVersion`, `ApiInput`, `ApiOutput`, `ApiStream`, `ApiMethod`, `FullApiPath`, plus `apiMethodMap` / `apiMetaMap` runtime tables. | Client autocomplete + compile-time `apiRequest` typing. Also module-augments `@luckystack/core`'s `ApiTypeMap` interface so framework code resolves the same shapes without deep-relative imports. |
| `apiInputSchemas.generated.ts` | `src/_sockets/apiInputSchemas.generated.ts` | Runtime Zod schemas (one per route + version), keyed by `[pagePath][apiName][version]`. Falls back to `z.any()` with a TODO comment when the input type cannot be converted. | Test runner's input fuzzer. Available for consumers that want pre-handler Zod validation in custom transports. The default runtime validator (`validateInputByType`) uses the type text, not the Zod file. |

Paths are resolved through `@luckystack/core`'s path registry (`getGeneratedSocketTypesPath()`, `getGeneratedApiSchemasPath()`). Override via `projectConfig.paths.*` if you ship the generated files somewhere else.

## Type Map structure

`apiTypes.generated.ts` produces a nested object type, one entry per `<page>` → `<name>` → `<version>`:

```ts
type _ProjectApiTypeMap = {
  'settings': {
    'updateUser': {
      'v1': {
        input: { name: string };
        output: { status: 'success'; ok: true; httpStatus?: number } | { status: 'error'; errorCode: string; httpStatus?: number };
        stream: never;
        method: 'POST';
        rateLimit: 20;
      };
    };
    // ...
  };
  // ...
};

export interface ApiTypeMap extends _ProjectApiTypeMap {}
```

The file also augments `@luckystack/core` so framework code can rely on the same map:

```ts
declare module '@luckystack/core' {
  interface ApiTypeMap extends _ProjectApiTypeMap {}
  interface SyncTypeMap extends _ProjectSyncTypeMap {}
}
```

`@luckystack/core` ships a stub `interface ApiTypeMap {}` in `apiTypeStubs.ts` — the module-augmentation above replaces it with the project's concrete map on any import of the generated file.

## Helper types

All exported from `apiTypes.generated.ts` (and re-exported transitively from `@luckystack/core` for framework use):

| Type | Definition (paraphrased) | Use |
| --- | --- | --- |
| `PagePath` | `keyof ApiTypeMap` | Union of every page path with at least one route. |
| `ApiName<P>` | `keyof ApiTypeMap[P]` | Union of every API name registered under page `P`. |
| `ApiVersion<P, N>` | `keyof ApiTypeMap[P][N]` | Union of every version registered for route `P/N`. |
| `ApiInput<P, N, V>` | `ApiTypeMap[P][N][V]['input']` | Payload shape (`data` parameter of `apiRequest`). |
| `ApiOutput<P, N, V>` | `ApiTypeMap[P][N][V]['output']` | Discriminated success/error union returned by `apiRequest`. |
| `ApiStream<P, N, V>` | `ApiTypeMap[P][N][V]['stream']` | Union of every `stream(...)` payload shape emitted by `main`. `never` when the route does not stream. |
| `ApiMethod<P, N, V>` | `ApiTypeMap[P][N][V]['method']` | HTTP method literal (`'GET' \| 'POST' \| 'PUT' \| 'DELETE'`). |
| `FullApiPath<P, N, V>` | `` `api/${P}/${N}/${V}` `` | Wire-format route string. Used internally — most code uses `name + version` literals. |
| `ApiResponse<T>` | `{ status: 'success'; ...T } \| { status: 'error'; errorCode; errorParams?; httpStatus? }` | Return type for `main(...)`. |
| `ApiStreamEmitter<T>` | `(payload?: T) => void \| Promise<void>` | Type of `stream` parameter passed into `main`. |
| `Functions` | Project-emitted interface | The injected functions registry available to every route (`db`, `redis`, `notify`, ...). |

`ApiInput` / `ApiOutput` / `ApiStream` are what `apiRequest` uses to type its arguments and return value:

```ts
import { apiRequest } from '@luckystack/core/client';

const result = await apiRequest({
  name: 'settings/updateUser',   // ApiName<'settings'>
  version: 'v1',                 // ApiVersion<'settings', 'updateUser'>
  data: { name: 'Alice' },       // ApiInput<'settings', 'updateUser', 'v1'>
});

if (result.status === 'success') {
  // result is narrowed to ApiOutput<'settings', 'updateUser', 'v1'> success branch
}
```

The discriminated `status` field on `ApiOutput` lets TypeScript narrow success / error branches without `as` casts. Branch-specific literal properties (`submitted: true` vs `submitted: false`) stay discriminated in the union.

## Runtime input validation

At request time, the API handler reads two fields from the runtime map:

```ts
interface RuntimeApiEntry {
  // ...
  inputType?: string;          // The text form of the `data` interface ("{ name: string }")
  inputTypeFilePath?: string;  // The source file path, for cross-file type resolution
  // ...
}
```

`validateInputByType` (re-exported from `@luckystack/core`) is called with:

```ts
const inputValidation = await validateInputByType({
  typeText: apiEntry.inputType,
  value: normalizedData,
  rootKey: 'data',
  filePath: apiEntry.inputTypeFilePath,
});
```

| Field | Type | Purpose |
| --- | --- | --- |
| `typeText` | `string \| undefined` | The TypeScript type text captured at generation time. May reference imports — `filePath` lets the resolver expand them. |
| `value` | `unknown` | The wire-level payload. |
| `rootKey` | `string` | Label used in error messages (`data` for API, `clientInput` for sync). |
| `filePath` | `string \| undefined` | Source file path. The dev-mode resolver lazy-loads `@luckystack/devkit` to re-walk imports / re-exports. |

**Return shape**: `{ status: 'success' } | { status: 'error'; message: string }`. On error the handler responds with the generic `api.invalidInputType` + `400`. The validator's `message` is NOT surfaced to the client (echoing it would let unauthenticated callers enumerate the input schema); it is routed to the `postApiValidate` hook payload (`validation.message`) and the dev logs instead.

`validateInputByType` lazy-loads `@luckystack/devkit`'s deep resolver in development so types defined across files (re-exported aliases, utility wrappers like `Partial`/`Pick`/`Omit`/`Record`) expand correctly. In production it relies on the resolver's last-known cache — regenerate before shipping.

## Missing `inputType`

When a route's input cannot be extracted (the type erased to `any`, the generator hit an unresolvable symbol), `inputType` is empty or `'any'`. Strict-mode generation will throw at devkit time — but if you have it disabled or are running on a stale build, runtime validation is effectively a no-op.

The dev-only `warnIfInputTypeMissing(resolvedName, inputType)` helper emits a one-shot warning per route:

```
api: route settings/updateUser/v1 has no inputType — runtime input validation is disabled. Regenerate types or set the inputType on the handler.
```

Gated by `projectConfig.dev.warnOnMissingInputType`. Each route warns once per process; the module-level `warnedMissingInputType: Set<string>` prevents log spam.

## `validation: 'relaxed'` / `{ input: 'skip' }`

Some endpoints receive payloads that cannot reasonably be modeled in TypeScript — public webhooks (Stripe, Slack, GitHub), legacy clients in a migration window, or untyped third-party integrations. For these, the route file can opt out:

```ts
// src/integrations/_api/stripeWebhook_v1.ts
export const validation = 'relaxed' as const;
// or
export const validation = { input: 'skip' } as const;
```

When set, the socket transport skips `validateInputByType` entirely:

- `warnIfInputTypeMissing` is **not** called.
- `preApiValidate` still fires (handlers can inspect raw `data`).
- `validateInputByType` is **not** called.
- `postApiValidate` fires with `{ status: 'success' }` so audit handlers see the skip.

The HTTP transport does **not** honor the flag — relax-mode endpoints typically live on the socket transport (where webhook payloads still parse as `Record<string, unknown>`). If you need relax-mode on HTTP, structure the input as `Record<string, unknown>` and validate inside `main(...)`.

## Strict typing policy

Repository rule (root `.claude/CLAUDE.md` §16): **NEVER** cast typed API/sync payloads to `unknown`, `any`, or `unsafe*` wrappers when calling `apiRequest`, `syncRequest`, or `upsertSyncEventCallback`.

```ts
// Bad — defeats the entire generated-types pipeline
const unsafeApi = async (name: string, version: string, data: unknown) =>
  apiRequest({ name: name as any, version: version as any, data: data as any });

// Good — direct typed call with literal route + version
const response = await apiRequest({
  name: 'organization/settings/sendInvite',
  version: 'v1',
  data: { email: 'a@b.com' },
});
```

The AI workflow allows temporary casts during generator-lag windows (after a save, before types refresh), but they must be local, minimal, and removed once regeneration completes.

## Regenerating types

| Trigger | What happens |
| --- | --- |
| Save an `_api/` file in dev | `setupWatchers` (devkit) coalesces a hot-reload + type-map regeneration. The route is re-imported into `devApis`; the type map writes if its content changed. |
| `npm run build` | The build script invokes `generateTypeMapFile()` once before bundling. |
| Manual: `npm run ai:index` (or the project's equivalent) | Forces a full regeneration. |
| `postinstall` (in this repo) | Regenerates `apiInputSchemas.generated.ts` so fresh clones never miss the runtime Zod schemas. |

If the generator throws `[TypeMapGenerator] Generated type map has unresolved type identifiers: <symbols>`, an `ApiParams['data']` or `main` return type references a symbol the resolver could not expand. Common causes: a renamed file, a barrel re-export missing the type, an import cycle. Fix the typing source — do not add casts.

## API Reference

### `validateInputByType` (re-exported from `@luckystack/core`)

**Signature**

```ts
async function validateInputByType(params: {
  typeText: string | undefined;
  value: unknown;
  rootKey: string;
  filePath?: string;
}): Promise<{ status: 'success' } | { status: 'error'; message: string }>;
```

**Behavior**

- Returns `{ status: 'success' }` when `typeText` is falsy (validation effectively disabled).
- In dev, lazy-loads `@luckystack/devkit`'s `resolveRuntimeTypeText` to expand cross-file aliases.
- Walks the type AST recursively. Records the first mismatch and returns a path-level message (`data.users[0].email: expected string, got number`).
- Caches resolved types per `filePath`; cache is invalidated by devkit on hot reload.

### `warnIfInputTypeMissing` (internal to both handlers)

**Signature**

```ts
const warnIfInputTypeMissing = (resolvedName: string, inputType: string | undefined): void;
```

**Behavior**

- No-op when `projectConfig.dev.warnOnMissingInputType` is `false`.
- No-op when `inputType` is non-empty and not `'any'`.
- Otherwise, logs once per route via `getLogger().warn(...)` and adds the route to a module-level `Set` so subsequent requests stay quiet.

### `RuntimeApiEntry` (internal type)

The shape `getRuntimeApiMaps()` returns for each route:

```ts
interface RuntimeApiEntry {
  auth: AuthProps;
  main: (params: { data, user, functions, stream }) => Promise<RuntimeApiResponse>;
  inputType?: string;
  inputTypeFilePath?: string;
  rateLimit?: number | false;
  httpMethod?: HttpMethod;
  validation?: 'strict' | 'relaxed' | { input: 'skip' | 'strict' };
}
```

Devkit emits these. The handler reads them.

## Hooks dispatched

This package does not own hooks specific to type generation. The runtime validation step fires `preApiValidate` / `postApiValidate` — see [`./api-request-lifecycle.md`](./api-request-lifecycle.md).

## Config keys

| Key | Effect |
| --- | --- |
| `dev.warnOnMissingInputType` | Toggle the dev-only `warnIfInputTypeMissing` log. |
| `paths.generatedSocketTypes` | Output path for `apiTypes.generated.ts`. |
| `paths.generatedApiSchemas` | Output path for `apiInputSchemas.generated.ts`. |
| `paths.generatedApiDocs` | Output path for `apiDocs.generated.json`. |

## Related

- API request lifecycle: [`./api-request-lifecycle.md`](./api-request-lifecycle.md)
- Routing conventions: [`./routing-conventions.md`](./routing-conventions.md)
- Error handling: [`./error-handling.md`](./error-handling.md)
- Architecture: [`/docs/ARCHITECTURE_ROUTING.md`](../../../docs/ARCHITECTURE_ROUTING.md) (see "Generated maps")
- Devkit type-map generation: `@luckystack/devkit/docs/type-map-generation.md`
- Root rule on casts: [`/.claude/CLAUDE.md`](../../../.claude/CLAUDE.md) §16
