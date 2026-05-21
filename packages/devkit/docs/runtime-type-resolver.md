# Runtime Type Resolver (`runtimeTypeResolver.ts`)

> Dev-only. Lives in `@luckystack/devkit` and is consumed exclusively by `@luckystack/core/src/runtimeTypeValidation.ts` via a lazy `await import('@luckystack/devkit')` that fires only when `NODE_ENV !== 'production'`. Production servers never load this module — runtime input validation in prod uses the pre-generated Zod schemas in `apiInputSchemas.generated.ts`, not the deep resolver.

The resolver bridges two worlds:

1. **What the loader stored.** When the dev loader (`loader.ts`) imports an API or sync file, it calls `getInputTypeFromFile(filePath)` (a public extractor) and stashes the result on `devApis[routeKey].inputType` along with `inputTypeFilePath`. The stored text is what the extractor produced at import time — usually a fully-expanded inline form, occasionally a named alias that the extractor could not expand standalone.
2. **What the runtime validator needs.** Each incoming request is type-checked against the stored `inputType`. If the stored text still contains identifiers (e.g. `UserInput`, `Partial<RegisterPayload>`, `Pick<Prisma.User, 'id' | 'name'>`), the validator cannot match payload keys to type members until those identifiers are recursively expanded into a structural shape.

The resolver takes the stored text + the original file path, follows imports across the project via the cached `ts.Program`, applies a handful of TypeScript utility types (`Partial`, `Required`, `Pick`, `Omit`, `Record`, `Array`), and returns a self-contained inline type string. The result is cached so a hot request path does not redo work.

---

## Module surface

```typescript
type ResolveResult =
  | { status: 'success'; typeText: string }
  | { status: 'error'; message: string };

export const resolveRuntimeTypeText = ({
  typeText,
  filePath,
}: {
  typeText: string;
  filePath?: string;
}): ResolveResult;

export const clearRuntimeTypeResolverCache = (): void;
export const isUnresolvedTypeMarker = (value: string): boolean;
export const getUnresolvedTypeMessage = (value: string): string;
```

Internal-only:

- `resolveExpression(typeText, filePath, depth, state)` — recursive worker.
- `resolveIdentifier(identifier, filePath)` — TypeChecker-backed identifier lookup, follows local declarations + import statements.
- `applyUtilityType({ utilityName, utilityArgs, filePath, depth, state })` — `Partial`, `Required`, `Pick`, `Omit`, `Record`.
- `parseObjectFields(typeText)` / `serializeObjectFields({ fields, indexSignatures })` — round-trip an object literal type through a typed AST.
- `splitTopLevel(value, '|' | '&' | ',')` — depth-aware splitter (respects `(`, `{`, `[`, `<`).
- `parseLiteralUnionKeys(value)` — extract `'a' | 'b'` into `['a', 'b']` for `Pick` / `Omit` / `Record` key lists.
- Constants: `MAX_DEPTH = 20`, `PRIMITIVE_TYPES`, `SKIP_EXPANSION`, `unresolvedPrefix = '__RUNTIME_UNRESOLVED__::'`.
- Types: `ObjectField`, `ObjectIndexSignature`, `ResolveState`.

---

## `resolveRuntimeTypeText(...)` flow

```typescript
export const resolveRuntimeTypeText = ({ typeText, filePath }) => {
  const cleanType = typeText.trim();
  if (!cleanType || !filePath) {
    return { status: 'success', typeText: cleanType };
  }

  const cacheKey = `${filePath}::${cleanType}`;
  const cached = resolvedTypeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const resolved = resolveExpression(cleanType, filePath, 0, { stack: new Set() });
  const result: ResolveResult = isUnresolvedTypeMarker(resolved)
    ? { status: 'error', message: getUnresolvedTypeMessage(resolved) }
    : { status: 'success', typeText: resolved };

  resolvedTypeCache.set(cacheKey, result);
  return result;
};
```

1. **No-op short-circuit.** Empty input or missing `filePath` — return as-is. The validator passes an empty string for routes with `{ [key: string]: never }` "no input" syntax that the extractor reduced to nothing; callers expect a success in that case.
2. **Cache hit.** `resolvedTypeCache: Map<string, ResolveResult>` keyed by `${filePath}::${typeText}`. The path is part of the key because `import { Foo } from './a'` and `import { Foo } from './b'` resolve to different `Foo`s.
3. **Recursive resolve.** `resolveExpression(...)` walks the type expression text and returns either a fully expanded form or a string prefixed with `__RUNTIME_UNRESOLVED__::<reason>`.
4. **Result shape.** Unresolved-marker prefix is mapped to `{ status: 'error', message }`; clean text is mapped to `{ status: 'success', typeText }`. Both branches are cached.

---

## `resolveExpression(...)` — the recursive worker

The worker tracks two pieces of state:

- `state.stack: Set<string>` — visited `(filePath, typeText)` pairs in the current resolution. Re-entering one returns `__RUNTIME_UNRESOLVED__::cyclic type reference <type>`.
- `depth: number` — bumped on every recursion. When it exceeds `MAX_DEPTH = 20`, the worker returns `__RUNTIME_UNRESOLVED__::resolution depth exceeded for <type>`.

The decision tree (in order):

1. **Already unresolved.** If `type.startsWith('__RUNTIME_UNRESOLVED__::')`, return it as-is.
2. **Parenthesized group.** `(T)` — strip outer parens, recurse, re-wrap on success.
3. **Top-level union.** `splitTopLevel(type, '|')` returns more than one part — recurse on each, propagate the first unresolved marker found, otherwise join with ` | `.
4. **Top-level intersection.** Same pattern with `&`.
5. **Array suffix.** `T[]` — recurse on `T`, wrap result with `[]`.
6. **Object literal.** Starts with `{` and ends with `}` — parse via `parseObjectFields`, recurse on every field type and every index signature key/value type, serialize back via `serializeObjectFields`.
7. **Generic application.** Matches `^([A-Za-z_][A-Za-z0-9_]*)<(.+)>$` — split args at top-level commas, then:
   - `Array<T>` (single arg) — same as `T[]`.
   - `Partial`, `Required`, `Pick`, `Omit`, `Record` — delegate to `applyUtilityType`.
   - Anything else — recurse on every type argument and re-render as `Name<arg1, arg2>`. The generic name is preserved verbatim; the validator can decide what to do with it.
8. **Bare identifier.** Matches `^[A-Za-z_][A-Za-z0-9_]*$` — delegate to `resolveIdentifier`.
9. **Everything else.** Returned as-is. This covers literal types (`'foo'`, `42`, `true`), already-primitive forms, and anything the regex set above does not classify.

`splitTopLevel(value, splitter)` is the depth-aware splitter used by steps 3, 4, 7. It tracks `(`, `{`, `[`, `<` depth counters and only splits when all four are zero. This is what lets the worker safely split `Pick<User, 'a' | 'b'>` on commas without trimming the inner union.

---

## `resolveIdentifier(identifier, filePath)`

```typescript
const resolveIdentifier = (identifier: string, filePath: string): string => {
  if (PRIMITIVE_TYPES.has(identifier.toLowerCase())) return identifier.toLowerCase();
  if (SKIP_EXPANSION.has(identifier)) return identifier;

  const program = getServerProgram();
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) return toUnresolved(`unresolved type ${identifier}`);

  const checker = program.getTypeChecker();

  for (const stmt of sourceFile.statements) {
    // 1. Local interface / type alias / enum
    if (
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt))
      && stmt.name.text === identifier
    ) {
      const symbol = checker.getSymbolAtLocation(stmt.name);
      if (symbol) {
        return expandType(checker.getDeclaredTypeOfSymbol(symbol), checker);
      }
    }

    // 2. Import declarations — follow aliases
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      // namedBindings: { Foo, Bar } — match Foo or Bar
      // defaultName:   Foo from '...'
      // For matches: getSymbolAtLocation -> getAliasedSymbol -> getDeclaredTypeOfSymbol -> expandType
    }
  }

  return toUnresolved(`unresolved type ${identifier}`);
};
```

Two short-circuit lists:

- `PRIMITIVE_TYPES` — `string`, `number`, `boolean`, `true`, `false`, `null`, `undefined`, `any`, `unknown`, `void`, `never`. Returned lowercased; covers the case where the extractor emitted `String` instead of `string`.
- `SKIP_EXPANSION` — `Date`, `Promise`, `Array`, `Record`, `Partial`, `Required`, `Pick`, `Omit`, `Function`, `Map`, `Set`, `Buffer`, `Uint8Array`, `Object`, `WeakMap`, `WeakSet`. Structurally opaque; the validator treats them as "any value of this name".

For everything else, the worker walks the file's top-level statements and looks for:

1. A local `interface`, `type`, or `enum` declaration matching the identifier. If found, resolve the symbol, fetch its declared type, and recursively expand via `expandType` from `tsProgram.ts`.
2. An import declaration whose named or default binding matches the identifier. If found, resolve the symbol, hop through `getAliasedSymbol` to reach the original declaration, then expand.

If neither path produces a result, return the unresolved marker. The `try { ... } catch { ... }` wrapper around the body ensures any TypeChecker exception (rare, but possible on partially-typed sources) degrades to `__RUNTIME_UNRESOLVED__::unresolved type <identifier>` rather than crashing the request.

`getServerProgram()` is shared with the type-map emitter. The resolver does not call `invalidateProgramCache()` — that's the loader's job on hot-reload. Resolver-side, `clearRuntimeTypeResolverCache()` is the matching reset.

---

## `applyUtilityType(...)`

Handles five utility types. Each requires its target type to resolve to an object literal first; if the target resolves to a non-object form, the utility returns an unresolved marker.

- **`Partial<T>`** — resolve `T` to an object, mark every field optional via `{ ...field, optional: true }`, preserve index signatures. Pure-additive utility, no field filtering.
- **`Required<T>`** — symmetric; mark every field non-optional.
- **`Pick<T, K>`** — resolve `T` to an object, parse `K` via `parseLiteralUnionKeys` into a string set, drop every field whose key is not in the set. Preserves index signatures.
- **`Omit<T, K>`** — same as `Pick` with inverted membership test.
- **`Record<K, V>`** — resolve `K` and `V` first. If `K` resolves to a literal-string union, materialize each literal as a concrete field with type `V` (renders as a closed object). Otherwise leave as `Record<K, V>` (treated as an opaque container at runtime).

If any argument to a utility resolves to an unresolved marker, that marker is propagated unchanged.

If an argument list does not have the expected arity (e.g. `Partial<A, B>`), the utility returns `__RUNTIME_UNRESOLVED__::unresolved utility <Name><...>`.

---

## Object literal round-trip

`parseObjectFields(typeText)` and `serializeObjectFields({ fields, indexSignatures })` are the small AST-like helpers that let the worker rewrite an object body.

`parseObjectFields(typeText)`:

- Strips outer braces.
- Walks the inner text character by character, tracking nesting depth for `{`, `[`, `(`, `<`.
- Splits on `;` at depth 0.
- For each segment, runs two regexes:
  - Field regex: `^("']?[A-Za-z_][A-Za-z0-9_]*["']?)(\?)?\s*:\s*([\s\S]+)$` — captures key, optional flag, and type. Strips surrounding quotes from the key.
  - Index signature regex: `^\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\]]+)\]\s*:\s*([\s\S]+)$` — captures the key name (e.g. `key`), the key type (e.g. `string`), and the value type.

`serializeObjectFields`:

- Renders each field as `${name}${optional ? '?' : ''}: ${type}` and each index signature as `[${keyName}: ${keyType}]: ${type}`.
- Joins with `; ` and wraps with `{ ... }`. Returns `{ }` for an empty body (matches the extractor's "no input" form).

---

## Unresolved-marker protocol

```typescript
const unresolvedPrefix = '__RUNTIME_UNRESOLVED__::';

const toUnresolved = (message: string): string => `${unresolvedPrefix}${message}`;
export const isUnresolvedTypeMarker = (value: string): boolean => value.startsWith(unresolvedPrefix);
export const getUnresolvedTypeMessage = (value: string): string => value.slice(unresolvedPrefix.length).trim();
```

The worker uses marker strings — not exceptions — to propagate failure. The reason:

- One unresolved leaf inside a deep object should not abort the whole resolve; the validator wants to know which symbol failed.
- Throw-based propagation forces every call site to wrap in try/catch; marker-based propagation lets the worker fall through identical code paths for success and failure (the worker only needs to check the result of each recursion).

Callers (`@luckystack/core/src/runtimeTypeValidation.ts`) inspect `result.status`. On `'error'`, they log the `message` and degrade to a soft-pass for the request rather than refusing it — the deep resolver is informational, not a hard gate.

---

## Cache lifecycle

```typescript
const resolvedTypeCache = new Map<string, ResolveResult>();

export const clearRuntimeTypeResolverCache = () => {
  resolvedTypeCache.clear();
};
```

The cache is keyed by `${filePath}::${typeText}`. It survives across requests but must be cleared whenever the underlying source files change.

Invalidation points (all in `loader.ts`):

- `initializeApis()` and `initializeSyncs()` — `clearRuntimeTypeResolverCache()` is called before re-scanning the source tree.
- `upsertApiFromFile(filePath)`, `removeApiFromFile(filePath)`, `upsertSyncFromFile(filePath)`, `removeSyncFromFile(filePath)` — every per-file mutation clears the whole cache (not just the entry for the changed file). Selective invalidation would require tracking transitive imports; whole-cache flush is the simpler, safer choice and the resolver is not on the hot path of a steady-state running app.

The cache must always be flushed alongside `invalidateProgramCache()` from `tsProgram.ts`. The two are paired in every invalidation site.

---

## Consumer contract

- **Only `@luckystack/core` may import this module.** The lazy import lives in `@luckystack/core/src/runtimeTypeValidation.ts` and fires only when `process.env.NODE_ENV !== 'production'`. Consumers must not introduce any additional callers.
- **Do not call from production code paths.** The resolver depends on `getServerProgram()`, which needs `tsconfig.server.json` and the consumer's source tree on disk. Production tarballs have neither.
- **Treat results as ephemeral.** A cached success may turn into an error after the next hot reload (or vice versa). Always re-call `resolveRuntimeTypeText({ typeText, filePath })` rather than memoizing on the consumer side.
- **Markers are strings, not exceptions.** Callers must check `status` before assuming success.

---

## Failure modes

- **Cycle detected.** Returns `{ status: 'error', message: 'cyclic type reference <type>' }`. Happens for self-referential aliases that the type-map emitter could not flatten (e.g. recursive tree types whose Prisma client form was elided).
- **Depth exceeded.** Returns `{ status: 'error', message: 'resolution depth exceeded for <type>' }`. `MAX_DEPTH = 20` is well above the depth limit in `tsProgram.ts` (`DEPTH_LIMIT = 12`), so this only fires when a type chains many import hops in addition to deep nesting.
- **Identifier not found.** Returns `{ status: 'error', message: 'unresolved type <name>' }`. The file in question may not exist in the cached `ts.Program` (recently deleted, or outside the `tsconfig.server.json` `include` glob).
- **Utility-arity mismatch.** Returns `{ status: 'error', message: 'unresolved utility <Name><...>' }`. The validator falls back to a soft-pass.
- **Program rebuild during a resolve.** A concurrent hot-reload event could call `invalidateProgramCache()` mid-resolution. The next `getServerProgram()` call inside `resolveIdentifier` rebuilds; results from before and after the rebuild may differ. This is a tolerated race — the next steady-state request will see consistent state.

---

## Constants

- `MAX_DEPTH = 20` — recursion cap for `resolveExpression`. Distinct from `DEPTH_LIMIT = 12` in `tsProgram.ts`; the resolver allows deeper recursion because each step crosses at most one file boundary.
- `PRIMITIVE_TYPES` — 11 entries, lowercased on return.
- `SKIP_EXPANSION` — 17 entries; passes through opaque containers and utility names that are themselves the subject of recursion elsewhere.
- `unresolvedPrefix = '__RUNTIME_UNRESOLVED__::'` — sentinel string used by `toUnresolved` / `isUnresolvedTypeMarker` / `getUnresolvedTypeMessage`.
