# Hot Reload (`setupWatchers`, template injection, dependency graph)

> Dev-only. `setupWatchers()` is a no-op when `process.env.NODE_ENV === 'production'`. Production servers read the generated runtime maps on disk and never run chokidar.

`setupWatchers()` is the single dev-time entry point that turns the project source tree into a live, hot-reloadable route registry. It boots three chokidar watchers (source / server-functions / shared), coalesces file events into a few coarse buckets, and schedules background type-map regeneration without blocking the Socket.io thread.

It must be called AFTER `initializeAll()` so the initial `devApis`/`devSyncs`/`devFunctions` maps are populated before the first hot-reload event has a chance to mutate them.

---

## Marker + path segments

Resolved once per startup so consumers with custom paths or marker names work without forking:

```typescript
const apiMarkerSlash = `/${getRoutingRules().apiMarker}/`;
const syncMarkerSlash = `/${getRoutingRules().syncMarker}/`;
const apiMarkerNoLead = `${getRoutingRules().apiMarker}/`;
const syncMarkerNoLead = `${getRoutingRules().syncMarker}/`;

const pathsCfg = getProjectConfig().paths;
const srcSegment = `/${pathsCfg.srcDir.replaceAll('\\', '/')}/`;
const sharedSegment = `/${pathsCfg.sharedDir.replaceAll('\\', '/')}/`;
const serverFunctionsSegment = `/${pathsCfg.serverFunctionsDir.replaceAll('\\', '/')}/`;
const localesSegment = `${srcSegment}_locales/`;
```

The `*NoLead` variants exist because some event paths arrive without a leading slash (e.g. from chokidar add events) and the `*Slash` variants are used for `.includes()` middle-of-path matches.

---

## Coalescing state

Three buckets of state, all module-local to the closure created by `setupWatchers`:

```typescript
const reloadTimers = new Map<'api' | 'sync' | 'functions' | 'typemap' | 'locales', NodeJS.Timeout>();
const pendingApiUpserts = new Set<string>();
const pendingApiDeletes = new Set<string>();
const pendingSyncUpserts = new Set<string>();
const pendingSyncDeletes = new Set<string>();
```

`reloadTimers` is keyed by reload kind. `scheduleReload(key, task, delay = getProjectConfig().dev.hotReloadDebounceMs)` clears any pending timer for that key and queues a new one. This means a flurry of saves coalesces to a single run; the timer's `task` reads the current pending sets and processes them atomically:

```typescript
const scheduleReload = (
  key: 'api' | 'sync' | 'functions' | 'typemap' | 'locales',
  task: () => Promise<void> | void,
  delay = getProjectConfig().dev.hotReloadDebounceMs
) => {
  const activeTimer = reloadTimers.get(key);
  if (activeTimer) clearTimeout(activeTimer);

  const timer = setTimeout(() => {
    reloadTimers.delete(key);
    void task();
  }, delay);

  reloadTimers.set(key, timer);
};
```

The same path is allowed to appear in both an upsert set and a delete set across consecutive events (rename, delete-then-write); the processing functions drain each set and the loader's `upsert*FromFile` / `remove*FromFile` are idempotent.

---

## Type-map regeneration queue

```typescript
const typeMapQueue = { pending: false, running: false };

const runTypeMapRegeneration = () => {
  typeMapQueue.running = true;
  typeMapQueue.pending = false;
  const startedAt = Date.now();
  setImmediate(() => {
    void (async () => {
      const [err] = await tryCatch(() => { generateTypeMapFile({ quiet: true }); });
      if (err) {
        console.log(`[HotReload] type map regeneration failed: ${String(err)}`, 'red');
      } else {
        console.log(`[HotReload] type map ready in ${Date.now() - startedAt}ms`, 'green');
      }
      typeMapQueue.running = false;
      if (typeMapQueue.pending) {
        runTypeMapRegeneration();
      }
    })();
  });
};

const requestTypeMapRegeneration = () => {
  if (typeMapQueue.running) {
    typeMapQueue.pending = true;
    return;
  }
  runTypeMapRegeneration();
};
```

Two invariants:

1. **Type-map regeneration is a DX artifact.** The runtime request path reads from in-memory `devApis`/`devSyncs`/`devFunctions`, so regeneration is purely for IDE IntelliSense + the Zod schemas on disk. There is no reason to await it on the reload critical path.
2. **Single-flight with one queued follow-up.** If a regeneration is already running, the next request flips `pending = true` and returns. When the running pass finishes it consults `pending` and re-runs. This collapses any number of saves during a long pass into exactly one follow-up.

`setImmediate` is critical: it yields to the event loop so the Socket.io accept path keeps serving during a burst of saves. Without it, a single `generateTypeMapFile()` could hold the thread for hundreds of milliseconds during heavy type expansion. The same pattern is used for the initial type-map generation on boot (see "Boot-time behavior" below).

`quiet: true` silences the per-API/per-sync logs from the emitter during hot reload — only the final "type map ready in Xms" line prints. The first run on boot also runs quiet to keep startup output readable.

---

## File-kind classifiers

```typescript
const isGeneratedPath = (n: string): boolean =>
  n.includes('apiTypes.generated.ts') || n.includes('apiDocs.generated.json');

const isRouteDependencyFile = (n: string): boolean => {
  // .ts / .tsx, inside srcDir, NOT inside an _api or _sync folder, NOT a generated artifact
};

const isSharedDependencyFile = (n: string): boolean => {
  // .ts / .tsx inside sharedDir OR serverFunctionsDir
};

const isTypeMapRelevantFile = (n: string): boolean => {
  // .ts / .tsx, in srcDir / sharedDir / or root config.ts, NOT generated, NOT _api/_sync
};

const isLocaleFile = (n: string): boolean =>
  n.includes(localesSegment) && n.endsWith('.json');
```

These predicates classify each event into one of the buckets handled by the event handlers. Order matters in the handlers: route files go through the API/Sync path; shared/route-dependency files trigger a fan-out through the import dependency graph; locales trigger a translator reload; generated files are dropped entirely (otherwise the type-map regeneration would feed itself).

---

## Event handlers

Three chokidar watchers all route into a small set of handlers:

```typescript
watch(pathsConfig.srcDir, { ignoreInitial: true, awaitWriteFinish: { ... } })
  .on('add', handleAdd)
  .on('change', handleChange)
  .on('unlink', handleDelete);

watch(pathsConfig.serverFunctionsDir, { ignoreInitial: true })
  .on('add', handleFunctionChange)
  .on('change', handleFunctionChange)
  .on('unlink', handleFunctionChange);

watch(pathsConfig.sharedDir, { ignoreInitial: true })
  .on('add', handleFunctionChange)
  .on('change', handleFunctionChange)
  .on('unlink', handleFunctionChange);
```

`awaitWriteFinish` is tuned via `projectConfig.dev`:

```typescript
awaitWriteFinish: {
  stabilityThreshold: devConfig.watcherStabilityThresholdMs,
  pollInterval: devConfig.watcherPollIntervalMs,
}
```

This is what stops chokidar from firing on a partially-written file (e.g. a save-in-progress from VSCode).

### `handleAdd(path)`

1. Normalize the path.
2. `invalidateGraphForFile(normalizedPath)` — drop any stale dependency-graph nodes pointing at the old version of this file (see `importDependencyGraph.ts`).
3. Route filename validation via `getRouteFilenameValidationMessage`. If the filename is invalid AND `shouldInjectTemplate(path)` says it's an empty file, try `injectTemplate(path)` — this is how `touch _api/foo.ts` ends up with starter content. If a template was injected, return (the change event from writing the template will flow back through).
4. Empty-file template injection for a valid-named file:
   - Sync server file with an existing client: extract the `clientInput` type from the client file, inject the paired server template with that type pre-filled, schedule type-map regeneration in the background, update the client to import the type, then upsert both files.
   - Otherwise inject the standalone template.
5. If the path is inside the API marker folder: add to `pendingApiUpserts`, schedule the `api` reload. The schedule's task calls `processPendingApiChanges({ regenerateTypeMap: true })` — `true` because an add changes the route set, not just one route's types.
6. If inside the sync marker folder: mirror the same with `pendingSyncUpserts`.
7. Otherwise delegate to `handleChange(path)` so dependency-graph / type-map relevance logic runs for the new file.

### `handleChange(path)`

The hot path for "I just saved this file". Sequence after `invalidateGraphForFile`:

1. If the filename is route-shaped but invalid, log and bail (after attempting template injection if the file is empty).
2. If `shouldInjectTemplate(path)` (the file became empty) — inject and return.
3. Drop generated paths.
4. Locale `.json` — schedule the `locales` task which calls `await getLocaleReloader()?.()` (the function `@luckystack/core`'s i18n module registers).
5. **Route dependency file (a `.ts`/`.tsx` inside `srcDir` that is NOT an API or sync):**
   - Schedule a `typemap` task that requests background regeneration.
   - Call `enqueueAffectedRoutesFromDependency(normalizedPath)` to fan out reloads through the import dependency graph (next section).
6. **Type-map-relevant file** that wasn't already a route dependency (e.g. `config.ts`, shared lib files): schedule a `typemap` regeneration only.
7. API/sync file change: schedule both `typemap` regeneration AND a reload pass that processes the upsert/delete sets.

### `handleDelete(path)`

Same skeleton as `handleChange`. The two notable extras:

- Generated paths and locale deletes are handled the same way as in `handleChange`.
- Sync server file deletion: the watcher reads the just-deleted server file's `clientInput` type FROM THE GENERATED TYPE MAP (the server file is already gone on disk) via `extractClientInputFromGeneratedTypes(pagePath, syncName)`, then rewrites the client file via `updateClientFileForDeletedServer(clientPath, clientInputTypes)`. If extraction fails, a fallback string is written with a TODO comment. This is the only place the watcher reaches into the generated type-map to read a type.

### `handleFunctionChange(changedPath)`

Triggered by both the server-functions watcher and the shared watcher.

- Invalidate the dependency graph for the changed file.
- Schedule the `functions` reload: re-run `initializeFunctions()` AND request a type-map regeneration (server functions are part of the generated `Functions` interface).
- If the file is a shared-dependency file, ALSO call `enqueueAffectedRoutesFromDependency` so routes that import from `<sharedDir>` or `<serverFunctionsDir>` reload.

---

## Dependency graph fan-out

Defined in `importDependencyGraph.ts`. Two functions:

```typescript
findDependentRouteFiles(changedPath: string): Set<string>
invalidateGraphForFile(changedPath: string): void
```

`findDependentRouteFiles` returns every `_api/`/`_sync/` route file that (transitively) imports `changedPath`. `enqueueAffectedRoutesFromDependency` walks the result and routes each entry into the right pending set:

```typescript
for (const routePath of affectedRoutes) {
  if (routePath.includes(apiMarkerSlash)) {
    pendingApiDeletes.delete(routePath);
    pendingApiUpserts.add(routePath);
    queuedApiCount += 1;
  } else if (routePath.includes(syncMarkerSlash)) {
    pendingSyncDeletes.delete(routePath);
    pendingSyncUpserts.add(routePath);
    queuedSyncCount += 1;
  }
}
```

With dynamic `import()` + per-load `?v=` cachebust in the loader, there is nothing to invalidate on the main thread; the next upsert fetches a fresh module instance, and the import dependency graph itself is invalidated synchronously by `invalidateGraphForFile`.

If no routes depend on the changed file, the function logs in yellow and returns without scheduling work — saving an unrelated `_components/Foo.tsx` doesn't fan out to every route.

---

## Pending change processors

```typescript
const processPendingApiChanges = async ({ regenerateTypeMap = false }: { regenerateTypeMap?: boolean } = {}) => {
  const deletePaths = [...pendingApiDeletes];
  const upsertPaths = [...pendingApiUpserts];
  pendingApiDeletes.clear();
  pendingApiUpserts.clear();

  if (regenerateTypeMap) {
    requestTypeMapRegeneration();
  }

  for (const deletePath of deletePaths) {
    removeApiFromFile(deletePath);
    console.log(`[HotReload] API removed: ${deletePath}`, 'yellow');
  }

  for (const upsertPath of upsertPaths) {
    await upsertApiFromFile(upsertPath);
    console.log(`[HotReload] API reloaded: ${upsertPath}`, 'green');
  }
};
```

The sync variant mirrors this and adds the sync-server-delete-with-living-client repair step (see `handleDelete`). Both processors:

1. Snapshot the pending sets.
2. Clear the sets so concurrent file events can populate them again.
3. Optionally request a background type-map regeneration.
4. Run deletes before upserts so a delete followed by an immediate re-add resolves correctly.
5. Use the loader's `upsertApiFromFile` / `removeApiFromFile` (and `upsertSyncFromFile` / `removeSyncFromFile`), each of which invalidates the TS program cache and the runtime type resolver cache. See `loader-pipeline.md`.

---

## Template injection

Helpers from `templateInjector.ts` and `templates/*.ts`:

| Helper | What |
|---|---|
| `shouldInjectTemplate(path)` | File exists, is `.ts`, and is empty (`isEmptyFile`) AND is API- or sync-shaped. |
| `injectTemplate(path)` | Writes the right template based on the filename: API, sync server, or sync client. Returns `true` if injected. |
| `isSyncServerFile(normalizedPath)` | Filename matches `_server_v<n>.ts`. |
| `getPairedSyncFile(normalizedPath)` | Returns the sibling `_client_v<n>.ts` (or `_server_v<n>.ts`) path. |
| `getRouteFilenameValidationMessage(normalizedPath)` | Returns a human-readable error string if the filename is route-shaped but invalid; `null` otherwise. |
| `extractClientInputFromFile(clientPath)` | Reads the client file with the TS Program and returns the `data` type literal text. |
| `extractClientInputFromGeneratedTypes(pagePath, syncName)` | Reads `apiTypes.generated.ts` and returns the `clientInput` member for the sync. Used when the server file has just been deleted. |
| `extractSyncPagePath(path)` / `extractSyncName(path)` | Filename -> generated-types lookup keys. |
| `injectServerTemplateWithClientInput(serverPath, clientInput)` | Writes the sync server template with the `data` type pre-filled. |
| `updateClientFileForPairedServer(clientPath)` | Rewrites the client to import `clientInput` / `serverOutput` from the generated types file. |
| `updateClientFileForDeletedServer(clientPath, clientInput)` | Rewrites the client to redeclare `clientInput` inline (since the server is gone). |
| `isEmptyFile(filePath)` | True if file size is 0 or content is whitespace-only. |

The pairing flow (sync server added with an existing client) is the most interesting case — without it, the writer would have to manually copy the `data` type into both files. With it, the AI / IDE sees consistent types across server + client immediately after `touch foo_server_v1.ts`.

---

## Locale reload integration

```typescript
if (isLocaleFile(normalizedPath)) {
  scheduleReload('locales', async () => {
    await getLocaleReloader()?.();
  });
  return;
}
```

`getLocaleReloader()` returns the function `@luckystack/core` registered via `registerLocaleReloader(...)` during boot. The locale module owns its own cache; devkit just signals "your files changed, reload yourself".

If no locale reloader is registered, the optional chain is a no-op and the save is silently dropped.

---

## Boot-time behavior

```typescript
setImmediate(() => {
  void (async () => {
    const [err] = await tryCatch(() => { generateTypeMapFile({ quiet: true }); });
    if (err) {
      console.log(`[HotReload] initial type map generation failed: ${String(err)}`, 'red');
    } else {
      console.log(`[HotReload] type map ready in background`, 'green');
    }
  })();
});
```

At the bottom of `setupWatchers()`. Generates the initial type map on the next event-loop tick so:

1. `server.listen()` happens before the heavy TypeScript Program build.
2. The runtime reads from the in-memory `devApis`/`devSyncs` maps (already populated by `initializeAll()` before `setupWatchers` runs); the on-disk type map is purely for IDE IntelliSense + Zod schema files.
3. Deferring drops boot time ~6–8 seconds on a 54-API project.

The same `setImmediate` + `quiet` + tryCatch pattern is reused by `runTypeMapRegeneration` for every subsequent run.

---

## Failure modes

| Symptom | Cause | What happens |
|---|---|---|
| `[HotReload] type map regeneration failed: ...` | `generateTypeMapFile()` threw (unresolved symbols, missing `tsconfig.server.json`, etc.) | Logged in red, server keeps running, runtime maps unchanged |
| `[HotReload] <route validation message>` | Filename is route-shaped but invalid (no `_v<n>`, etc.) | File not loaded; route key absent |
| `[HotReload] No API/Sync routes depend on: ...` | A shared/dep file changed but no route imports it | Type-map regeneration still scheduled; no upserts |
| Server file deletion without existing client | `getPairedSyncFile` returns null or client doesn't exist | Sync entry removed, no client repair attempted |
| Two saves in <`hotReloadDebounceMs`> ms | `scheduleReload` coalesces | One run reads the final pending sets |
| Save during regeneration | `requestTypeMapRegeneration` flips `pending = true` | One follow-up run after the current one finishes |
| Empty file written by `touch` | `shouldInjectTemplate` returns true | Template is injected; the resulting change event flows through normally |
| Locale `.json` typo | `getLocaleReloader()` errors | No special handling; error surfaces from the registered reloader |
