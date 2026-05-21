# TypeScript Program Cache (`typeMap/tsProgram.ts`)

> Dev-only. Internal to `@luckystack/devkit`. The cached `ts.Program` is used by the type-map emitter, the public extractors (`getInputTypeFromFile`, `getSyncClientDataType`), and the runtime type resolver. Production servers never load this module — the type-map emitter runs at build time / dev-time, and the generated `apiTypes.generated.ts` is what production reads.

The cache exists for one reason: building a `ts.Program` from `tsconfig.server.json` is the single most expensive step in type-map generation. A medium-sized LuckyStack project (50+ APIs, 20+ syncs, full Prisma schema) pays multi-second program-build cost. Hot reload must be sub-second, and a full type-map regeneration must reuse the same program across every extractor call within one pass.

---

## Module surface

```typescript
let cachedProgram: ts.Program | null = null;

export const getServerProgram = (): ts.Program;
export const invalidateProgramCache = (): void;

export interface UnresolvedTypeSymbol {
  name: string;
  sourceFile?: string;
  importPath?: string;
}

export interface ExpandedTypeResult {
  text: string;
  unresolvedSymbols: UnresolvedTypeSymbol[];
}

export const expandTypeDetailed = (
  type: ts.Type,
  checker: ts.TypeChecker,
  depth?: number,
  state?: ExpandState,
): ExpandedTypeResult;

export const expandType = (
  type: ts.Type,
  checker: ts.TypeChecker,
  depth?: number,
): string;
```

`cachedProgram` is module-level state. It starts as `null` and is only assigned by `getServerProgram()`. Resetting it to `null` (via `invalidateProgramCache()`) is the only invalidation path; the module never replaces a live program in place.

---

## `getServerProgram()` flow

```typescript
export const getServerProgram = (): ts.Program => {
  if (cachedProgram) return cachedProgram;

  const tsconfigPath = ts.findConfigFile(ROOT_DIR, ts.sys.fileExists, 'tsconfig.server.json');
  if (!tsconfigPath) throw new Error('[TypeProgram] tsconfig.server.json not found');

  const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const { options, fileNames } = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(tsconfigPath),
  );

  cachedProgram = ts.createProgram(fileNames, options);
  return cachedProgram;
};
```

Steps:

1. Return the cached program if present. This is the hot path.
2. Locate `tsconfig.server.json` relative to `ROOT_DIR` (resolved from `@luckystack/core`). The constant is the project's working directory at process start — registered once in `@luckystack/core/src/projectRoot.ts`.
3. Throw a typed error if no tsconfig is found. There is no fallback; the type emitter has no way to resolve cross-file symbols without a tsconfig.
4. Parse the JSON tsconfig (`ts.readConfigFile` + `ts.parseJsonConfigFileContent`) to expand `extends`, `include`, `exclude`, `paths`, etc. into the concrete `options` + `fileNames` arrays the compiler accepts.
5. Build the program with `ts.createProgram(fileNames, options)`. This is the multi-second cost.
6. Memoize and return.

Re-entrancy: this function is synchronous and single-threaded. Two concurrent extractor calls within the same generation pass will each hit step 1 after the first call returns.

---

## `invalidateProgramCache()` rules

```typescript
export const invalidateProgramCache = (): void => {
  cachedProgram = null;
};
```

Setting `cachedProgram = null` forces the next `getServerProgram()` call to rebuild from disk.

Invalidation points in the codebase:

- `loader.ts` `upsertApiFromFile(filePath)` — calls `invalidateProgramCache()` before re-importing the changed file. The next type extraction must see the new file contents.
- `loader.ts` `removeApiFromFile(filePath)` — same; references to the deleted file must be re-resolved.
- `loader.ts` `upsertSyncFromFile(filePath)` and `removeSyncFromFile(filePath)` — same.
- `typeMapGenerator.ts` `generateTypeMapFile(...)` — calls `invalidateProgramCache()` at the start of every full regeneration so a build script picks up files that changed since the previous in-process run.

Deliberate non-invalidation points:

- `loader.ts` `initializeApis()` and `initializeSyncs()` — **do not** invalidate on the boot path. `cachedProgram` is `null` at module load, so the first `getServerProgram()` call builds it from scratch anyway. With `initializeApis` and `initializeSyncs` running in parallel via `Promise.all`, invalidating in both forced a redundant double-build (measured ~3-4 s wasted on a 54-API project). The annotated reason lives in `loader.ts` directly above the call.

Invalidation must always be paired with `clearRuntimeTypeResolverCache()` — the runtime resolver caches expanded text keyed by the `(filePath, typeText)` pair, and stale entries can outlive a program rebuild.

---

## `expandTypeDetailed(...)` — recursive expander

`expandTypeDetailed(type, checker, depth, state)` walks a `ts.Type` and produces a fully self-contained inline type string. The result has no named references, no import paths, and can be dropped into `apiTypes.generated.ts` verbatim.

Key behaviors:

- **Cycle protection.** Uses `state.stackTypeIds: Set<number>` keyed by TypeScript's internal type IDs. When the walker re-enters a type already on the stack, it short-circuits with `checker.typeToString(type)` plus `collectTypeSymbolFallback(type)` (so the unresolved-symbol bookkeeping still fires).
- **Depth cap.** `DEPTH_LIMIT = 12`. Above this, the walker stops expanding and returns `checker.typeToString(type)`. Twelve levels is enough for every realistic Prisma model + nested DTO combination encountered in practice; beyond that the cost is exponential and the emitted text becomes unreadable.
- **JSON passthrough.** `JSON_TYPE_NAMES` — `Json`, `JsonValue`, `JsonObject`, `JsonArray`, `InputJsonValue`, `InputJsonObject`, `InputJsonArray` — short-circuit to the literal text `JsonValue`. Prisma's recursive `Json` types blow the depth limit if expanded structurally, and the structural expansion is meaningless anyway (the runtime is "any JSON-shaped value").
- **Opaque containers.** `SKIP_EXPANSION` — `Promise`, `Map`, `WeakMap`, `Set`, `WeakSet`, `Error`, `Date`, `RegExp`, `Buffer`, `ArrayBuffer`, `ReadonlyArray` — are returned as `checker.typeToString(type)` without recursion into internals. Their structural shape is irrelevant to API/sync wire types.
- **Arrays.** `Array<T>` and `ReadonlyArray<T>` are rendered as `T[]`. Union/intersection element types are parenthesized: `(A | B)[]` not `A | B[]`.
- **Tuples.** `[A, B, C]` literal form, recursing into each element.
- **Unions and intersections.** Each constituent is expanded; results are joined with ` | ` or ` & `. Unresolved-symbol lists are merged via `mergeUnresolvedSymbols`.
- **Object types.** `checker.getPropertiesOfType(type)` + `checker.getIndexInfosOfType(type)`. For each property:
  - If the property's declaration is a `PropertyAssignment` / `ShorthandPropertyAssignment` whose initializer is a literal, the literal text is preserved (`'hello'`, `42`, `true`, `null`). This is what lets the emitter render `httpMethod: 'POST'` as a literal type rather than the generic `string`.
  - Otherwise the property type is recursively expanded.
  - Optional flag (`prop.flags & ts.SymbolFlags.Optional`) is rendered as `?:`.
- **Index signatures.** Both the key type and the value type are recursively expanded; rendered as `[key: KeyType]: ValueType`.
- **Primitives.** `string`, `number`, `boolean`, `true`, `false`, `null`, `undefined`, `any`, `unknown`, `never`, `void` are returned via `checker.typeToString(type)` unchanged.
- **String / number literals.** Single-quoted (with escape handling) for strings, numeric text for numbers. Negative number literals are reconstructed from prefix-unary expressions.
- **Indentation.** The walker tracks `depth` and uses `'  '.repeat(depth + 1)` for property indent and `'  '.repeat(depth)` for the closing brace. This keeps the generated `apiTypes.generated.ts` readable.

`expandType(type, checker, depth)` is the convenience wrapper that returns only the `text` field — used when the caller doesn't care about unresolved symbols (the runtime resolver path).

---

## `UnresolvedTypeSymbol` and import collection

```typescript
export interface UnresolvedTypeSymbol {
  name: string;
  sourceFile?: string;
  importPath?: string;
}
```

When the walker reaches the depth limit, hits a cycle, or encounters a type whose properties cannot be expanded (typically an opaque type from a `node_modules` package), it falls back to `checker.typeToString(type)` and records the type's symbol via `collectTypeSymbolFallback`.

`collectTypeSymbolFallback` resolves the source file via `symbol.declarations?.[0]?.getSourceFile().fileName`. If the source file is outside `node_modules`, it computes a relative import path via `normalizeImportPath(sourceFile)` — relative to `src/_sockets/` (the directory where `apiTypes.generated.ts` lives). Otherwise the symbol is recorded with only its `name`, so the emitter can decide whether to surface it as an unresolved alias or skip it.

The type-map generator collects every unresolved symbol from every extractor call. If any unresolved symbol has no `importPath` (i.e., it cannot be reached by an import statement from the generated file), `generateTypeMapFile` throws an aggregated error listing every offending name. This is a strict gate — there is no `--allow-unresolved` flag.

---

## `expandState` — single recursion context

```typescript
interface ExpandState {
  stackTypeIds: Set<number>;
}
```

Callers do not need to pass `state` explicitly; the walker creates one on the first call. The state is local to one top-level expansion — it does not leak across calls. The `try { ... } finally { stackTypeIds.delete(typeId); }` block in the walker guarantees the stack is unwound even on exception.

---

## Consumer surface

Only the following modules import `tsProgram.ts`:

- `typeMap/extractors.ts` — calls `getServerProgram()` once per extractor invocation.
- `typeMapGenerator.ts` — calls `invalidateProgramCache()` at the start of every regeneration.
- `runtimeTypeResolver.ts` — calls `getServerProgram()` and `expandType` on the lazy expansion path.
- `loader.ts` — calls `invalidateProgramCache()` from hot-reload upsert/remove handlers.

Code outside `@luckystack/devkit` MUST NOT call `getServerProgram()` directly. Use the public extractors `getInputTypeFromFile(filePath)` and `getSyncClientDataType(filePath)` from `@luckystack/devkit`. They wrap program access, expansion, and error handling, and they are the only stable cross-package surface.

---

## Interaction with the runtime type resolver

`runtimeTypeResolver.ts` and `tsProgram.ts` share the cached program. When the resolver expands an identifier via `resolveIdentifier(identifier, filePath)`, it calls `getServerProgram()` to get the same `ts.Program` the type-map emitter uses. This avoids paying the program-build cost twice during dev startup.

The two modules also share an invalidation contract: any code path that calls `invalidateProgramCache()` MUST also call `clearRuntimeTypeResolverCache()`. The hot-reload upsert/remove handlers in `loader.ts` do both. If the resolver's cache outlives a program rebuild, the resolver returns stale expanded text and the runtime validator will reject valid payloads.

---

## Failure modes

- **Missing `tsconfig.server.json`.** `getServerProgram()` throws synchronously. Boot fails loudly; there is no fallback.
- **TypeScript version drift.** `typescript` is a required peer dependency at `~5.7.3`. A consumer with a different `typescript` version may produce different inlined output (`checker.typeToString` formatting drifts across TS versions). Treat this as a hard peer.
- **Depth limit hit.** `expandTypeDetailed` returns `checker.typeToString(type)` and records the type's symbol as unresolved. The emitter logs the offending route (`[TypeMapGenerator] Unresolved API type (page/name/version): SymbolName`) and aborts the whole generation if any unresolved symbol cannot be imported.
- **Cyclic type.** Same as depth-limit hit — short-circuit to the type's string form and record the symbol.
- **Symbol with no source file.** The fallback returns `{ name }` without `sourceFile` or `importPath`. The emitter treats this as a hard unresolved alias and aborts generation.
- **Stale cache after a file change.** If `invalidateProgramCache()` is not called between a file change and the next extraction, the extractor will see the previous file contents. The hot-reload loader handles this; consumers calling extractors directly must invalidate themselves.

---

## Constants

- `DEPTH_LIMIT = 12` — recursion cap for `expandTypeDetailed`.
- `JSON_TYPE_NAMES` — set of seven Prisma-related JSON aliases that short-circuit to `JsonValue`.
- `SKIP_EXPANSION` — set of opaque generic / built-in container names that pass through unexpanded.

These constants are not exported. They are tuning knobs internal to the expander; changing them requires regenerating the type map for every consumer project to verify no previously-expanding type now bottoms out as an unresolved alias.
