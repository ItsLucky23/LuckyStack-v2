# Type Map Generation (`generateTypeMapFile` + emitters)

> Dev-only. `generateTypeMapFile()` runs at build time and during hot reload. The generated artifacts (`apiTypes.generated.ts`, `apiInputSchemas.generated.ts`, `apiDocs.generated.json`) ship with the project source; production servers read them as compiled TypeScript / JSON, never re-running the emitter.

The type-map generator is the canonical source of truth for typed `apiRequest` / `syncRequest` calls. It walks every `_api/` and `_sync/` file under `srcDir`, runs the TypeChecker-backed extractors to produce fully-expanded inline types, emits a single typed map plus a Zod schema file plus a docs JSON, and validates that no unresolved type identifiers leaked through.

`generateTypeMapFile(options?)` is the only public entry point; the helpers under `typeMap/` are internal building blocks.

---

## Pipeline order

```typescript
export const generateTypeMapFile = (options: GenerateTypeMapOptions = {}): void => {
  const { quiet = false } = options;

  assertValidRouteNaming({ srcDir: getSrcDir(), context: 'generating API/sync type maps' });
  assertNoDuplicateNormalizedRouteKeys({ srcDir: getSrcDir(), context: 'generating API/sync type maps' });

  invalidateProgramCache();
  namedImports.clear();
  defaultImports.clear();

  // 1. Walk apiFiles, extract per-route input/output/stream/meta
  // 2. Walk sync server/client files, join by `pagePath/syncName/version`
  // 3. Build the Functions interface from the server functions tree
  // 4. Abort on unresolved type symbols
  // 5. Build + write the three artifacts

  // ... (see breakdown below) ...
};
```

`assertValidRouteNaming` and `assertNoDuplicateNormalizedRouteKeys` come first so a typo aborts before the expensive TypeScript Program build. `invalidateProgramCache()` is mandatory at the top — the generator is called both from build scripts (fresh process, no cache anyway) and from hot reload (cache may be warm but a file just changed).

`namedImports` and `defaultImports` are module-level `Map`s that accumulate import statements for the generated file. They are cleared on each run so retries don't leak stale imports.

---

## API extraction loop

```typescript
const apiFiles = findAllApiFiles(getSrcDir());
const typesByPage = new Map<string, Map<string, { input, output, stream, method, rateLimit, auth, version }>>();
const unresolvedTypeAliases = new Set<string>();

for (const filePath of apiFiles) {
  const pagePath = extractPagePath(filePath);
  const apiName = extractApiName(filePath);
  const apiVersion = extractApiVersion(filePath);
  if (!pagePath || !apiName) continue;

  const inputTypeResult = getInputTypeDetailsFromFile(filePath);
  const outputTypeResult = getOutputTypeDetailsFromFile(filePath);
  const streamTypeResult = getApiStreamPayloadTypeDetailsFromFile(filePath);
  const httpMethod = extractHttpMethod(filePath, apiName);
  const rateLimit = extractRateLimit(filePath);
  const auth = extractAuth(filePath);

  for (const symbol of [
    ...inputTypeResult.unresolvedSymbols,
    ...outputTypeResult.unresolvedSymbols,
    ...streamTypeResult.unresolvedSymbols,
  ]) {
    if (!symbol.importPath) {
      unresolvedTypeAliases.add(symbol.name);
      console.error(`[TypeMapGenerator] Unresolved API type (${pagePath}/${apiName}/${apiVersion}): ${symbol.name}`);
      continue;
    }
    getOrInit(namedImports, symbol.importPath, () => new Set<string>()).add(symbol.name);
  }

  getOrInit(typesByPage, pagePath, () => new Map()).set(`${apiName}@${apiVersion}`, {
    input: inputTypeResult.text,
    output: outputTypeResult.text,
    stream: streamTypeResult.text,
    method: httpMethod,
    rateLimit,
    auth,
    version: apiVersion,
  });
}
```

Per-file extractor map (`typeMap/extractors.ts`):

| Function | Returns | Used for |
|---|---|---|
| `getInputTypeDetailsFromFile(filePath)` | `{ text, unresolvedSymbols }` | API `data` parameter type |
| `getOutputTypeDetailsFromFile(filePath)` | `{ text, unresolvedSymbols }` | API return type (the `result` member of `{ status: 'success', result: ... }`) |
| `getApiStreamPayloadTypeDetailsFromFile(filePath)` | `{ text, unresolvedSymbols }` | API stream emitter payload (defaults to `never`) |
| `getSyncClientDataTypeDetailsFromFile(filePath)` | `{ text, unresolvedSymbols }` | sync `clientInput` (the `data` param of `_server_v<n>.ts`, or the client-side type if no server file) |
| `getSyncClientOutputTypeDetailsFromFile(filePath)` | `{ text, unresolvedSymbols }` | sync `clientOutput` returned by `_client_v<n>.ts` |
| `getSyncServerOutputTypeDetailsFromFile(filePath)` | `{ text, unresolvedSymbols }` | sync `serverOutput` returned by `_server_v<n>.ts` |
| `getSyncServerStreamPayloadTypeDetailsFromFile(filePath)` | `{ text, unresolvedSymbols }` | sync server stream emitter payload |
| `getSyncClientStreamPayloadTypeDetailsFromFile(filePath)` | `{ text, unresolvedSymbols }` | sync client stream emitter payload |

Two of these are also exported from the package root for use by the dev loader:

```typescript
export { getInputTypeFromFile, getSyncClientDataType } from './typeMap/extractors';
```

The loader uses them on every `upsertApiFromFile` / `upsertSyncFromFile` to attach an `inputType` string to the live route entry; this string later feeds `runtimeTypeValidation` in `@luckystack/core` via `resolveRuntimeTypeText` (see `runtime-type-resolver.md`).

### Route metadata (`typeMap/routeMeta.ts`)

```typescript
export const extractApiName(filePath: string): string | null;
export const extractApiVersion(filePath: string): string;
export const extractPagePath(filePath: string): string | null;
export const extractSyncName(filePath: string): string | null;
export const extractSyncPagePath(filePath: string): string | null;
export const extractSyncVersion(filePath: string): string;
```

Filename + path segments -> the components that compose route keys. `pagePath === 'root'` (or `''` for syncs) means the route lives at the project root, not under a page directory.

### API meta (`typeMap/apiMeta.ts`)

```typescript
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export const extractHttpMethod = (filePath: string, apiName: string): HttpMethod;
export const extractRateLimit = (filePath: string): number | false | undefined;
export const extractAuth = (filePath: string): { login: boolean; additional?: Record<string, unknown>[] };
```

Each one walks the source file's top-level statements looking for the matching `export const`. If the API doesn't export a value, sensible defaults apply:

- `httpMethod` falls back to `inferHttpMethod(apiName)` (re-exported from `@luckystack/core`) — naming-based inference (e.g. `get*` -> `GET`, `delete*` -> `DELETE`).
- `rateLimit` returns `undefined`, which the emitter omits from the generated entry.
- `auth` returns `{ login: true }` (the safer default).

There is also `extractValidation(filePath)` which returns `'strict' | 'relaxed' | { input: 'skip' | 'strict' } | undefined` — currently surfaced via `apiMetaMap` in the generated file.

---

## Sync pairing + extraction

```typescript
const syncServerFiles = findAllSyncServerFiles(getSrcDir());
const syncClientFiles = findAllSyncClientFiles(getSrcDir());

const allSyncs = new Map<string, {
  pagePath: string;
  syncName: string;
  serverFile?: string;
  clientFile?: string;
}>();

for (const serverFile of syncServerFiles) {
  const key = `${extractSyncPagePath(serverFile)}/${extractSyncName(serverFile)}/${extractSyncVersion(serverFile)}`;
  const existing = allSyncs.get(key) || { pagePath, syncName };
  existing.serverFile = serverFile;
  allSyncs.set(key, existing);
}

for (const clientFile of syncClientFiles) {
  // mirror with `clientFile`
}
```

After both walks, `allSyncs` has one entry per logical sync route, populated with whichever of `serverFile` / `clientFile` exists. Three cases:

1. **Server + client** — `clientInput` from the server's `data` param; `serverOutput` from server's return; `clientOutput` from client's return.
2. **Server-only** — `clientInput` from server; `serverOutput` from server; `clientOutput` defaults to `{ }`.
3. **Client-only** — `clientInput` from the client file (the framework still needs to know the type the caller sends); `serverOutput` defaults to `{ }`; `clientOutput` from client.

```typescript
const clientInputTypeResult = serverFile
  ? getSyncClientDataTypeDetailsFromFile(serverFile)
  : (clientFile
    ? getSyncClientDataTypeDetailsFromFile(clientFile)
    : { text: '{ }', unresolvedSymbols: [] });
```

Each `*TypeDetailsFromFile` returns `{ text, unresolvedSymbols }`; the symbols are merged into `unresolvedTypeAliases` / `namedImports` exactly the same way as in the API loop.

---

## Functions interface (`generateServerFunctions`)

```typescript
const functionsInterface = generateServerFunctions({ namedImports, defaultImports });
```

`generateServerFunctions` walks every configured `serverFunctionDirs` root recursively (legacy singular `serverFunctionsDir` still honored when set) and emits a nested-interface block representing every exported function or value. Per file:

1. Parse the source via the TypeScript Program (reuses the same cached `ts.Program` — see `ts-program-cache.md`).
2. For every `export const <name> = (...)` arrow or function expression, extract a signature string with `extractSignatureFromNode`. Default values are stripped from parameters; generic clauses are preserved; `Promise<unknown>` is the return-type fallback for async functions without annotations.
3. For every `export const <name>: <Type> = ...` without a function initializer, run `inferValueTypeForExport` — uses `declaration.type` when annotated, falls back to `checker.typeToString` on the inferred type, then runs `simplifyInferredType` to map common framework types (`PrismaClient`, `Redis`) onto bare identifiers.
4. For re-exports (`export { a } from 'module'`), emit `typeof import('<rel-spec>')['a']`. Relative specifiers are rewritten via `relativizeModuleSpecifier` so they resolve from the generated file's directory (`src/_sockets/apiTypes.generated.ts`).
5. Defaults are merged into the file-named bucket so `import myFn from './myFn'` shows up at `Functions.<folder>.myFn.myFn` (matching `devFunctions`).

The output is one big block of nested `'<folder>': { <file>: { <export>: <signature>; }; };` entries. It is embedded verbatim into `apiTypes.generated.ts` inside `export interface Functions { ... }`.

`namedImports` / `defaultImports` from this walk feed the same import-statement builder as the API/sync walks — anything the `Functions` interface references that isn't an inline type is imported at the top of the generated file.

---

## Unresolved symbol handling

```typescript
if (unresolvedTypeAliases.size > 0) {
  const unresolvedList = [...unresolvedTypeAliases].sort().join(', ');
  throw new Error(`[TypeMapGenerator] Aborting generation because unresolved type symbols were found: ${unresolvedList}`);
}
```

A "symbol" with no `importPath` means the TypeChecker found a referenced identifier (e.g. `User`, `Settings`) but couldn't trace its declaration back to a source file. The most common cause is a name collision (two files declare a `User` type) or a missing `import`. Generation aborts so the symptom doesn't surface as broken IntelliSense.

Symbols with an `importPath` are added to `namedImports` and become real `import { Symbol } from "<path>";` statements in the generated file.

---

## Artifact build + write

```typescript
const { content, docsData, schemasContent } = buildTypeMapArtifacts({
  typesByPage,
  syncTypesByPage,
  namedImports,
  defaultImports,
  functionsInterface,
});

writeTypeMapArtifacts({ content, docsData, schemasContent });
```

`buildTypeMapArtifacts` in `typeMap/emitterArtifacts.ts` renders three strings:

### `content` -> `apiTypes.generated.ts`

Single file emitted at `getGeneratedSocketTypesPath()` (default `<repo>/src/_sockets/apiTypes.generated.ts`, overridable via `@luckystack/core` path helpers). Layout:

```
/* eslint-disable ... */

<importStatements>

export interface Functions { ... };

export type JsonPrimitive = ...;
export type JsonValue = ...;
// ... shared scalar helpers ...

export type StreamPayload = { [key: string]: unknown };
export type ApiStreamEmitter<T extends StreamPayload = StreamPayload> = ...;
export type SyncServerStreamEmitter<T extends StreamPayload = StreamPayload> = ...;
export type SyncClientStreamEmitter<T extends StreamPayload = StreamPayload> = ...;
export type SyncBroadcastStreamEmitter<...> = ...;
export type SyncStreamToEmitter<...> = ...;

export type ApiResponse<T = unknown> = ...;
export type ApiNetworkResponse<T = unknown> = ...;

type _ProjectApiTypeMap = { ... per-route input/output/stream/method/rateLimit ... };
export interface ApiTypeMap extends _ProjectApiTypeMap {}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type PagePath = ...;
export type ApiName<P> = ...;
export type ApiVersion<P, N> = ...;
export type ApiInput<P, N, V = ApiVersion<P, N>> = ...;
export type ApiOutput<P, N, V = ApiVersion<P, N>> = ...;
export type ApiStream<P, N, V = ApiVersion<P, N>> = ...;
export type ApiMethod<P, N, V = ApiVersion<P, N>> = ...;
export type FullApiPath<P, N, V> = `api/${P}/${N & string}/${V & string}`;

export const apiMethodMap: Record<string, Record<string, Record<string, HttpMethod>>> = { ... };
export const getApiMethod = (...): HttpMethod | undefined => ...;

export interface ApiMetaEntry { method, auth: { login, additional? }, rateLimit? };
export const apiMetaMap: Record<...> = { ... };
export const getApiMeta = (...): ApiMetaEntry | undefined => ...;

export type SyncServerResponse<T = unknown> = ...;
export type SyncClientResponse<T = unknown> = ...;

type _ProjectSyncTypeMap = { ... per-sync clientInput/serverOutput/clientOutput/serverStream/clientStream ... };
export interface SyncTypeMap extends _ProjectSyncTypeMap {}

export type SyncPagePath = ...;
export type SyncName<P> = ...;
export type SyncVersion<P, N> = ...;
export type SyncClientInput<P, N, V = SyncVersion<P, N>> = ...;
export type SyncServerOutput<P, N, V = SyncVersion<P, N>> = ...;
export type SyncClientOutput<P, N, V = SyncVersion<P, N>> = ...;
export type SyncServerStream<P, N, V = SyncVersion<P, N>> = ...;
export type SyncClientStream<P, N, V = SyncVersion<P, N>> = ...;
export type FullSyncPath<P, N, V> = `sync/${P}/${N & string}/${V & string}`;

// Module augmentation merges the project's concrete maps into @luckystack/core
// stub interfaces so framework code (apiRequest / syncRequest) gets the same
// shapes without deep-relative imports.
declare module '@luckystack/core' {
  interface ApiTypeMap extends _ProjectApiTypeMap {}
  interface SyncTypeMap extends _ProjectSyncTypeMap {}
}
```

Before writing, `validateGeneratedTypeIdentifiers(content)` parses the content with `ts.createSourceFile` and asserts every referenced type identifier is either declared in the file or imported. Anything else (built-ins like `Record`, `Promise`, etc., plus a curated allow-list) throws and aborts the run.

### `schemasContent` -> `apiInputSchemas.generated.ts`

Built by `buildSchemasContent({ typesByPage })`. Loops over the API map again, runs each input type through `typeTextToZodSource` (from `typeMap/zodEmitter.ts`), and emits:

```typescript
import { z } from 'zod';

export const apiInputSchemas: Record<string, Record<string, Record<string, z.ZodTypeAny>>> = {
  '<pagePath>': {
    '<apiName>': {
      '<version>': <z.object(...)>,
    },
  },
};

export const getApiInputSchema = (pagePath, apiName, version): z.ZodTypeAny | undefined =>
  apiInputSchemas[pagePath]?.[apiName]?.[version];
```

`typeTextToZodSource` walks the TS-AST of the inline type literal and emits Zod source. Unsupported shapes fall back to `z.any() /* unparseable input type */` with a TODO. Sync types are NOT in this file — only API inputs (runtime input validation is API-only).

### `docsData` -> `apiDocs.generated.json`

Pure JSON dump of every API and sync entry. Used by `@luckystack/docs-ui` to render an OpenAPI-like browser:

```json
{
  "apis": {
    "<pagePath>": [
      { "page", "name", "version", "method", "input", "output", "stream", "rateLimit", "auth", "path" }
    ]
  },
  "syncs": {
    "<pagePath>": [
      { "page", "name", "version", "clientInput", "serverOutput", "clientOutput", "serverStream", "clientStream", "path" }
    ]
  }
}
```

Where each file is written:

- `apiTypes.generated.ts` -> `getGeneratedSocketTypesPath()` (configurable via `@luckystack/core`).
- `apiInputSchemas.generated.ts` -> `getGeneratedApiSchemasPath()`.
- `apiDocs.generated.json` -> `getGeneratedApiDocsPath()`.

`writeTypeMapArtifacts` only rewrites a file when its content changed (`writeFileIfChanged`). This avoids spurious file-modified events on the runner during hot reload (which would otherwise feed back into the watcher and trigger another regeneration).

---

## `quiet` option

```typescript
generateTypeMapFile({ quiet: true });
```

Used by `setupWatchers()` for both the initial-boot regeneration and every subsequent hot-reload regeneration (see `hot-reload.md`). Suppresses:

- The two banner lines (`═══════…`).
- The `[TypeMapGenerator] Found N API files` / `Sync server/client files` headers.
- Per-API and per-sync logs.

The final per-file write logs (`Generated apiTypes.generated.ts`, etc.) still fire, but only when content changed.

---

## Public extractor surface

Re-exported from `@luckystack/devkit`:

```typescript
export { getInputTypeFromFile, getSyncClientDataType } from './typeMap/extractors';
```

Both are thin wrappers over the `*Details` variants — they discard `unresolvedSymbols` and return only `text`. Used by the dev loader to attach inline type text to live route entries (consumed downstream by `runtimeTypeValidation` in `@luckystack/core`).

---

## Failure modes

| Symptom | Cause |
|---|---|
| `[TypeProgram] tsconfig.server.json not found` | Project doesn't have a `tsconfig.server.json` next to `package.json`. See `ts-program-cache.md`. |
| `assertValidRouteNaming` throw | A `_api/`/`_sync/` file fails the version regex. Fix the filename. |
| `assertNoDuplicateNormalizedRouteKeys` throw | Two files (often case-differing) normalize to the same route key. Rename one. |
| `[TypeMapGenerator] Aborting generation because unresolved type symbols were found: X, Y, Z` | TypeChecker couldn't trace identifier(s) back to a source file. Usually a missing import or a naming collision. |
| `[TypeMapGenerator] Generated type map has unresolved type identifiers: ...` | Post-emission validation: a generated symbol wasn't declared or imported. Bug in an extractor or in `generateServerFunctions`. |
| `[TypeMapGenerator] Error writing type map or docs: ...` | Filesystem error during write. Caught and logged, generator returns normally so hot reload doesn't crash the server. |
| Stale generated types after a hot reload | `invalidateProgramCache()` not called (shouldn't happen — the generator always invalidates at the top). |
