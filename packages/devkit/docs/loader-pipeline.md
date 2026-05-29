# Loader Pipeline (`initializeAll`, `initializeApis`, `initializeSyncs`, `initializeFunctions`, upsert/remove)

> Dev-only. `@luckystack/devkit` is published as a `devDependency`. Nothing in this document runs in a production bundle — the prod runtime maps loader in `@luckystack/server` reads from in-memory `devApis`/`devSyncs`/`devFunctions` only when `NODE_ENV !== 'production'`, and from the on-disk generated maps otherwise.

The loader pipeline is the dev-time mirror of the production route registry. It walks the configured `srcDir` (from `getProjectConfig().paths`) and each `serverFunctionDirs` root (legacy singular `serverFunctionsDir` still honored when set), evaluates each route file via dynamic `import()`, and populates three in-memory maps:

| Map | Shape | Mirror of |
|---|---|---|
| `devApis` | `Record<string, { main, auth, rateLimit, httpMethod, schema, inputType, inputTypeFilePath }>` keyed by `api/<page-location\|'system'>/<name>/v<n>` | every `_api/<name>_v<n>.ts` |
| `devSyncs` | `Record<string, { main, auth, inputType, inputTypeFilePath } \| Function>` keyed by `sync/<page-location>/<name>/v<n>_<server\|client>` | every `_sync/<name>_(server\|client)_v<n>.ts` |
| `devFunctions` | nested `Record<string, unknown>` mirror of the on-disk tree, leaves are merged named + default exports per file | every `<root>/**/*.ts` under each `serverFunctionDirs` root (legacy singular `serverFunctionsDir` still honored when set) |

All three maps are mutated in place. Consumers (the dev server boot path, the prod runtime maps loader's dev branch) hold a stable reference to the exported objects and read them on every request.

---

## `initializeAll()`

```typescript
export const initializeAll = async () => {
  assertValidRouteNaming({
    srcDir: getSrcDir(),
    context: 'starting dev server (npm run server)',
  });

  await Promise.all([initializeApis(), initializeSyncs(), initializeFunctions()]);
};
```

Order matters:

1. **Route naming validation first.** `assertValidRouteNaming` walks the file tree once and throws if any `_api/` or `_sync/` file doesn't match the version regex (e.g. `_v1.ts`, `_server_v2.ts`). Aborting before any file evaluates means a typo can't produce half-loaded state.
2. **Three initializers in parallel** via `Promise.all`. They share the TypeScript program cache (see `ts-program-cache.md`) — running them sequentially would not be faster, since the cache only gets built on first access from inside the extractors.

After `initializeAll()` returns, the dev server should call `setupWatchers()` exactly once (see `hot-reload.md`) so subsequent file changes incrementally mutate the same maps.

---

## `initializeApis()`

```typescript
export const initializeApis = async () => {
  for (const key of Object.keys(devApis)) delete devApis[key];
  //? No invalidateProgramCache() here — cachedProgram starts as null on
  //? module-load (tsProgram.ts), so the first getServerProgram() call
  //? builds it from scratch. With initializeApis + initializeSyncs running
  //? in parallel via Promise.all, invalidating here forced a redundant
  //? double-build (~3-4s waste). Hot-reload paths (upsertApiFromFile,
  //? removeApiFromFile etc.) DO invalidate — that's where it's needed.
  clearRuntimeTypeResolverCache();
  const srcFolder = fs.readdirSync(getSrcDir());

  for (const file of srcFolder) {
    await scanApiFolder(file);
  }
};
```

Flow:

1. Empty `devApis` by deleting every key. The exported reference stays stable.
2. **Deliberately skip `invalidateProgramCache()`.** Module-load init in `tsProgram.ts` starts with `cachedProgram = null`, so the first `getServerProgram()` call from inside the extractors will build it from scratch. Calling `invalidateProgramCache()` here used to force a redundant ~3-4s double-build because `initializeApis` and `initializeSyncs` run concurrently and would each invalidate after the other had warmed the cache. The hot-reload upsert/remove paths DO invalidate, because there the cache really is stale.
3. Clear the runtime type resolver cache (`clearRuntimeTypeResolverCache()`) so any string-based identifier resolution starts fresh.
4. Recurse the project's `srcDir` via `scanApiFolder`. The walker descends through every directory looking for one whose lowercase name ends in `api` (the resolved `apiMarker` from `getRoutingRules()` — default `_api`).
5. For each `<name>_v<n>.ts` inside that folder, parse the version with `apiVersionRegex`, import the file, extract `main` / `auth` / `rateLimit` / `httpMethod` / `schema`, derive the inline `inputType` text via `getInputTypeFromFile()`, and store the entry under `api/<pageLocation>/<name>/v<n>`. `pageLocation` is `''` when the API lives at `src/_api/` and is mapped to `'system'` by `mapApiPageLocation()`; otherwise it's the slash-joined path segments above the marker.

`auth` is normalized at load time:

```typescript
auth: {
  login: auth.login || false,
  additional: auth.additional || [],
}
```

Missing `main` (or non-function `main`) silently skips the file — the entry is removed and the route key is absent from `devApis`. Filename parse failures log in red to `[loader][api]` and continue.

---

## `initializeSyncs()`

Same shape as `initializeApis()`, keyed on folders whose lowercase name ends in `sync` (the resolved `syncMarker`). Each `_sync/<name>_(server|client)_v<n>.ts` is matched by `syncVersionRegex`, yielding the `kind` (`server` or `client`) and version. The route base key is:

- `sync/<pageLocation>/<syncName>/v<n>` (when `pageLocation` is non-empty)
- `sync/<syncName>/v<n>` (root-level sync)

Final entry key appends `_server` or `_client`. Storage differs by kind:

- **Server kind** stores a record:
  ```typescript
  devSyncs[`${routeBaseKey}_server`] = {
    main: resolvedSyncModule.main,
    auth: resolvedSyncModule.auth || {},
    inputType,             // derived via getSyncClientDataType()
    inputTypeFilePath: filePath,
  };
  ```
- **Client kind** stores the bare `main` callback (the request dispatcher calls it directly with `{ clientOutput, serverOutput }`):
  ```typescript
  devSyncs[`${routeBaseKey}_client`] = resolvedSyncModule.main;
  ```

Like `initializeApis()`, the boot path skips `invalidateProgramCache()` and only clears the runtime type resolver cache.

---

## `initializeFunctions()`

```typescript
export const initializeFunctions = async () => {
  for (const key of Object.keys(devFunctions)) delete devFunctions[key];

  for (const serverFunctionsDir of getServerFunctionDirs()) {
    if (fs.existsSync(serverFunctionsDir)) {
      await scanFunctionsFolder(serverFunctionsDir);
    }
  }
};
```

> `getServerFunctionDirs()` returns the array from `projectConfig.paths.serverFunctionDirs`. The legacy singular `serverFunctionsDir` form is still honored — when set it is merged into the array at config load.

Walks every configured root recursively. Per `.ts` file:

1. Import via `importFile()` (see below).
2. Run `resolveFunctionModule(module, fileName)`:
   - Module with only named exports -> the named exports object (default merged in only if it's the sole export).
   - Module with no named exports but a default export -> `{ [fileName]: defaultExport }`. This lets `import functionName from './function'` show up at `devFunctions[folder]?.[functionName]?.[functionName]`.
   - Module that is itself a function -> returned as-is so it can be merged.
3. Walk into the `devFunctions` tree along the `basePath` segments, creating nested `Record<string, unknown>` subtrees on demand. Each level is structurally a record but typed as `unknown` after one level of indexing — `resolveFunctionModule` re-narrows before descent.
4. If a previous scan left a node at the same leaf path, `Object.assign(resolvedFunctionModule, existingAtFileName)` merges them. This is what lets two files in the same folder contribute to the same logical bag of helpers.

Failure modes are logged with `[loader][function]` and the file is skipped.

---

## Per-file import strategy

```typescript
const importFile = async (absolutePath: string) => {
  const url = `${pathToFileURL(absolutePath).href}?v=${Date.now()}`;
  return import(url);
};
```

- `pathToFileURL` converts Windows-style paths and special characters into a proper `file://` URL.
- The `?v=<timestamp>` query is a cachebust that forces the ESM loader to return a fresh evaluation each call. Without it, `import()` is memoized and a saved file would not re-evaluate.
- Switching from CommonJS `require()` to dynamic `import()` also stops module evaluation from blocking the event loop. With CJS, evaluating a single ~50 ms file held the Socket.io thread; with ESM the evaluation yields and Socket.io stays responsive during a save burst.

The `tryCatch` wrapper from `@luckystack/core` captures evaluation errors:

```typescript
const [err, module] = await tryCatch(async () => importFile(routeMeta.absolutePath));
if (err) {
  console.log(`[loader][api] failed to import ${routeMeta.routeKey} from ${routeMeta.absolutePath}:`, err, 'red');
  return;
}
```

A failed import leaves the existing `devApis` / `devSyncs` entry untouched (no partial replacement).

---

## Route key shape

API key:

```
api/<pageLocation|'system'>/<apiName>/v<n>
```

`pageLocation` is the slash-joined path segments BEFORE the `_api` marker. `system` is used when the API sits at the project root (e.g. `src/_api/healthCheck_v1.ts` -> `api/system/healthCheck/v1`).

Sync key:

```
sync/<pageLocation>/<syncName>/v<n>_<server|client>
```

If the sync lives at the project root (no page above the `_sync` marker), the key drops the page segment: `sync/<syncName>/v<n>_<server|client>`.

These shapes match the route keys produced by the production runtime maps loader in `@luckystack/server`. Switching between dev and prod is a matter of which map the request dispatcher reads from.

---

## Filename validation regexes

```typescript
export const API_VERSION_TOKEN_REGEX = /_v(\d+)$/;
export const SYNC_VERSION_TOKEN_REGEX = /_(server|client)_v(\d+)$/;
```

Re-exported from `routeConventions.ts` for consumers (e.g. the docs UI) that need to parse filenames.

`assertValidRouteNaming({ srcDir, context })` walks the tree and throws an `Error` whose message includes:

- The `context` string passed in (e.g. `'starting dev server (npm run server)'` or `'generating API/sync type maps'`).
- Every offending file path with the expected pattern.

`assertNoDuplicateNormalizedRouteKeys({ srcDir, context })` is called only by the type-map generator. It catches the case where two differently-cased files (`getSettings_v1.ts` vs `getsettings_v1.ts`) normalize to the same route key on case-insensitive filesystems.

---

## Routing rules registry

```typescript
export interface RoutingRules {
  apiMarker: string;       // default '_api'
  syncMarker: string;      // default '_sync'
  apiVersionRegex: RegExp; // default API_VERSION_TOKEN_REGEX
  syncVersionRegex: RegExp;// default SYNC_VERSION_TOKEN_REGEX
}

export const registerRoutingRules = (rules: Partial<RoutingRules>): void;
export const getRoutingRules = (): RoutingRules;
```

Defaults are exported from `routingRules.ts` and consumed by every walker (`scanApiFolder`, `scanSyncFolder`, `resolveApiRouteMetaFromPath`, `resolveSyncRouteMetaFromPath`, the watcher) plus the filename predicates:

```typescript
export const apiMarkerSegment = (): string;
export const syncMarkerSegment = (): string;
export const isApiFileName = (name: string): boolean;
export const isSyncFileName = (name: string): boolean;
export const isSyncServerFileName = (name: string): boolean;
export const isSyncClientFileName = (name: string): boolean;
```

A consumer registering custom markers (`{ apiMarker: 'api', syncMarker: 'live' }`) sees them flow through to the watcher segment computation in `setupWatchers()` (see `hot-reload.md`) and the loader scans, so non-default layouts work without forking the package.

---

## Hot-reload single-file paths

All four hot-reload functions follow the same shape:

```typescript
export const upsertApiFromFile = async (filePath: string): Promise<void> => {
  const routeMeta = resolveApiRouteMetaFromPath(filePath);
  if (!routeMeta) {
    // log + return — filename rejection
    return;
  }

  invalidateProgramCache();
  clearRuntimeTypeResolverCache();

  const [err, module] = await tryCatch(async () => importFile(routeMeta.absolutePath));
  if (err) { /* log + return */ return; }

  const resolvedModule = module?.default ? { ...module.default, ...module } : module;
  const { auth = {}, main, rateLimit, httpMethod, schema } = resolvedModule;

  if (!main || typeof main !== 'function') {
    delete devApis[routeMeta.routeKey];
    return;
  }

  const inputType = getInputTypeFromFile(routeMeta.absolutePath);

  devApis[routeMeta.routeKey] = { main, auth: { ... }, rateLimit, httpMethod, schema, inputType, inputTypeFilePath: routeMeta.absolutePath };
};
```

Key differences from the boot initializers:

| Step | Boot (`initializeApis`/`initializeSyncs`) | Hot reload (`upsert*`/`remove*`) |
|---|---|---|
| `invalidateProgramCache()` | Skipped — cache is null on module load | Always called — file content changed |
| `clearRuntimeTypeResolverCache()` | Called | Called |
| Resolve filename via marker walk | Recursive tree scan | `resolveApiRouteMetaFromPath` / `resolveSyncRouteMetaFromPath` on the single path |
| Missing `main` | Silently skip | Explicit `delete devApis[key]` to keep table in sync with file state |

`removeApiFromFile` / `removeSyncFromFile` follow the same skeleton minus the import: they invalidate caches and `delete` the matching entry. If the file path doesn't normalize to a route key (wrong marker segment, wrong extension), the call is a no-op — the watcher fan-out from `enqueueAffectedRoutesFromDependency` may enqueue paths that aren't routes, and silently dropping them is the right behavior.

Sync kind handling in `upsertSyncFromFile`:

- `kind === 'server'`: store `{ main, auth, inputType, inputTypeFilePath }` if `main` is a function, otherwise delete the entry.
- `kind === 'client'`: store the bare `main` callback if it's a function, otherwise delete the entry.

---

## Consumer contract

Dev server boot:

```typescript
import { initializeAll, setupWatchers } from '@luckystack/devkit';

await initializeAll();
setupWatchers();
// then start HTTP server / Socket.io
```

Production runtime maps loader (`packages/server/src/runtimeMapsLoader.ts`):

```typescript
if (process.env.NODE_ENV !== 'production') {
  const devkit = await import('@luckystack/devkit');
  return {
    apis: devkit.devApis,
    syncs: devkit.devSyncs,
    functions: devkit.devFunctions,
  };
}

// prod: read from generated maps on disk
```

The dev loader is never invoked under `NODE_ENV=production`; the generated `apiTypes.generated.ts` / `apiInputSchemas.generated.ts` (see `type-map-generation.md`) drive the prod path instead.

---

## Failure modes (summary)

| Symptom | Cause | What happens |
|---|---|---|
| `[loader][api] invalid filename: ...` | filename doesn't match `apiVersionRegex` | file skipped, route key absent from `devApis` |
| `[loader][sync] invalid filename: ...` | filename doesn't match `syncVersionRegex` | file skipped, route key absent from `devSyncs` |
| `[loader][api] failed to import ...` | runtime error during `import()` | previous entry left untouched, error logged |
| `[loader][function] failed to import ...` | runtime error in a server-functions file | previous nested node left untouched |
| `assertValidRouteNaming` throw at startup | any `_api/`/`_sync/` file fails the regex | dev server boot aborts before any file evaluates |
| Missing `main` after a save | consumer removed the export | `delete devApis[key]` (or `devSyncs[key]`) keeps the table consistent with disk state |
| Hot reload picks up a typo, then the next save fixes it | `upsertApiFromFile` runs twice | second run replaces the entry; no orphans |
