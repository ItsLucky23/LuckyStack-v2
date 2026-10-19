import { watch } from "chokidar";
import fs from "node:fs";
import path from 'node:path';
import {
  initializeFunctions,
  upsertApiFromFile,
  removeApiFromFile,
  upsertSyncFromFile,
  removeSyncFromFile,
} from "./loader";
import {
  shouldInjectTemplate,
  injectTemplate,
  isSyncServerFile,
  getPairedSyncFile,
  getRouteFilenameValidationMessage,
  extractClientInputFromFile,
  extractClientInputFromGeneratedTypes,
  extractSyncPagePath,
  extractSyncName,
  extractSyncVersion,
  injectServerTemplateWithClientInput,
  updateClientFileForPairedServer,
  updateClientFileForDeletedServer,
  isEmptyFile
} from "./templateInjector";
import {
  generateTypeMapFile,
} from "./typeMapGenerator.js";
import { findDependentRouteFiles, invalidateGraphForFile } from "./importDependencyGraph";
import { isPrismaClientMissing, runPrismaGenerate } from "./prismaClientCheck";
import {
  tryCatch,
  getProjectConfig,
  getLocaleReloader,
  isProductionRuntime,
  getGeneratedSocketTypesPath,
  getGeneratedApiSchemasPath,
  getGeneratedApiDocsPath,
} from "@luckystack/core";
import { getRoutingRules } from './routingRules';
import { isRouteSurfaceFile } from './routeNamingValidation';
import { requestDevServerRestart } from './devServerRestart';

// ----------------------------
// Watcher for Hot Reload + Type Generation
// ----------------------------

const normalizeFsPath = (value: string): string => path.resolve(value).replaceAll('\\', '/');

//? The generator's own outputs must not trigger another run. Match the
//? CONFIGURED output paths (a consumer can rename them) plus any
//? `.generated.` file; a fixed filename list missed the Zod schema file, so
//? every input-type change ran the whole generation twice.
const isGeneratedPath = (normalizedPath: string): boolean => {
  if (normalizedPath.includes('.generated.')) return true;
  return [getGeneratedSocketTypesPath(), getGeneratedApiSchemasPath(), getGeneratedApiDocsPath()]
    .some((generatedPath) => normalizeFsPath(generatedPath) === normalizedPath);
};

// ---------------------------------------------------------------------------
// Type-map queue
// ---------------------------------------------------------------------------

/**
 * Creates a self-contained type-map regeneration queue that coalesces
 * concurrent save bursts into a single run via setImmediate.
 */
//? setImmediate only DEFERS the run until the current event finishes; the
//? generation itself is synchronous (the TypeScript API talks to its process
//? through blocking calls), so the dev server answers no request while it
//? runs. Accepted for development; the logged duration makes the pause
//? visible instead of looking like a hung request.
const createTypeMapQueue = () => {
  const queue = { pending: false, running: false };

  const run = () => {
    queue.running = true;
    queue.pending = false;
    setImmediate(() => {
      void (async () => {
        const startedAt = Date.now();
        const [err] = await tryCatch(() => { generateTypeMapFile({ quiet: true }); });
        const durationMs = Date.now() - startedAt;
        if (err) {
          console.log(`[HotReload] type map regeneration failed after ${durationMs}ms: ${String(err)}`, 'red');
        } else {
          console.log(`[HotReload] type map regenerated in ${durationMs}ms (the server answered no requests meanwhile)`, 'green');
        }
        queue.running = false;
        if (queue.pending) {
          run();
        }
      })();
    });
  };

  const request = () => {
    if (queue.running) {
      queue.pending = true;
      return;
    }
    run();
  };

  return { request };
};

// ---------------------------------------------------------------------------
// Pending change sets
// ---------------------------------------------------------------------------

/**
 * Bundles the mutable sets that track pending API/Sync add/delete
 * operations so they travel as a single value rather than separate
 * variables inside the watcher closure.
 */
const createPendingChangeSets = () => ({
  apiUpserts: new Set<string>(),
  apiDeletes: new Set<string>(),
  syncUpserts: new Set<string>(),
  syncDeletes: new Set<string>(),
  //? Deleted sync SERVER files whose paired client still needs its types
  //? inlined. A set the sync task drains, not a closure handed to the
  //? scheduler: any later sync event in the debounce window replaces the
  //? scheduled task, and a closure would be dropped with it.
  deletedSyncServers: new Set<string>(),
});

// ---------------------------------------------------------------------------
// Path classifiers
// ---------------------------------------------------------------------------

/**
 * Holds path-segment constants derived from the project config.
 * Computed once per `setupWatchers` call.
 */
interface PathSegments {
  apiMarkerSlash: string;
  syncMarkerSlash: string;
  apiMarkerNoLead: string;
  syncMarkerNoLead: string;
  srcSegment: string;
  sharedSegment: string;
  localesSegment: string;
  serverFunctionsSegments: string[];
}

const buildPathSegments = (): PathSegments => {
  const rules = getRoutingRules();
  const pathsCfg = getProjectConfig().paths;
  const srcSegment = `/${pathsCfg.srcDir.replaceAll('\\', '/')}/`;
  const sharedSegment = `/${pathsCfg.sharedDir.replaceAll('\\', '/')}/`;
  return {
    apiMarkerSlash: `/${rules.apiMarker}/`,
    syncMarkerSlash: `/${rules.syncMarker}/`,
    apiMarkerNoLead: `${rules.apiMarker}/`,
    syncMarkerNoLead: `${rules.syncMarker}/`,
    srcSegment,
    sharedSegment,
    localesSegment: `${srcSegment}_locales/`,
    serverFunctionsSegments: pathsCfg.serverFunctionDirs.map(
      (dir) => `/${dir.replaceAll('\\', '/')}/`,
    ),
  };
};

const makeIsInServerFunctionsDir = (segments: PathSegments) =>
  (normalizedPath: string): boolean =>
    segments.serverFunctionsSegments.some((seg) => normalizedPath.includes(seg));

//? A route file is route surface under a marker. A private helper
//? (`_api/_lib/x.ts`) or a co-located test under the marker is NOT: it is an
//? ordinary dependency, so its edits regenerate types and reload the routes
//? that import it instead of being handled (and ignored) as a route.
const makeIsRouteFile = (segments: PathSegments) =>
  (normalizedPath: string): boolean =>
    (normalizedPath.includes(segments.apiMarkerSlash) || normalizedPath.includes(segments.syncMarkerSlash))
    && isRouteSurfaceFile(normalizedPath);

const makeIsRouteDependencyFile = (segments: PathSegments, isRouteFile: (p: string) => boolean) =>
  (normalizedPath: string): boolean => {
    if (!normalizedPath.endsWith('.ts') && !normalizedPath.endsWith('.tsx')) return false;
    if (!normalizedPath.includes(segments.srcSegment)) return false;
    if (isRouteFile(normalizedPath)) return false;
    if (isGeneratedPath(normalizedPath)) return false;
    return true;
  };

const makeIsSharedDependencyFile = (
  segments: PathSegments,
  isInServerFunctionsDir: (p: string) => boolean,
) =>
  (normalizedPath: string): boolean => {
    if (!(normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.tsx'))) return false;
    if (normalizedPath.includes(segments.sharedSegment)) return true;
    return isInServerFunctionsDir(normalizedPath);
  };

const makeIsTypeMapRelevantFile = (segments: PathSegments, isRouteFile: (p: string) => boolean) =>
  (normalizedPath: string): boolean => {
    if (isGeneratedPath(normalizedPath)) return false;
    if (!(normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.tsx'))) return false;
    if (isRouteFile(normalizedPath)) return false;
    return (
      normalizedPath.includes(segments.srcSegment)
      || normalizedPath.endsWith('/config.ts')
      || normalizedPath.includes(segments.sharedSegment)
    );
  };

const makeIsLocaleFile = (segments: PathSegments) =>
  (normalizedPath: string): boolean =>
    normalizedPath.includes(segments.localesSegment) && normalizedPath.endsWith('.json');

// ---------------------------------------------------------------------------
// Reload scheduler
// ---------------------------------------------------------------------------

type ReloadKey = 'api' | 'sync' | 'functions' | 'typemap' | 'locales';

/**
 * Creates a debounced task scheduler keyed by reload category.
 * Multiple requests for the same key within the debounce window collapse
 * into a single execution.
 */
const createReloadScheduler = (debounceMs: () => number) => {
  const timers = new Map<ReloadKey, NodeJS.Timeout>();

  return (
    key: ReloadKey,
    task: () => Promise<void> | void,
    delay = debounceMs(),
  ) => {
    const active = timers.get(key);
    if (active) clearTimeout(active);

    const timer = setTimeout(() => {
      timers.delete(key);
      // Errors in async tasks must be caught here — an unhandled rejection
      // from a chokidar-triggered async callback crashes the dev server.
      Promise.resolve(task()).catch((error: unknown) => {
        console.log(`[HotReload] Scheduled task threw an error: ${String(error)}`, 'red');
      });
    }, delay);

    timers.set(key, timer);
  };
};

// ---------------------------------------------------------------------------
// Watcher mounting
// ---------------------------------------------------------------------------

/**
 * Attaches chokidar watchers to all configured source and function directories.
 * Kept separate from the event-handler setup so the two concerns don't collapse
 * into a single function body.
 */
const mountWatchers = (
  onAdd: (p: string) => void,
  onChange: (p: string) => void,
  onDelete: (p: string) => void,
  onFunctionChange: (p: string) => void,
) => {
  const devConfig = getProjectConfig().dev;
  const pathsConfig = getProjectConfig().paths;

  watch(pathsConfig.srcDir, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: devConfig.watcherStabilityThresholdMs,
      pollInterval: devConfig.watcherPollIntervalMs,
    },
  })
    .on('add', onAdd)
    .on('change', onChange)
    .on('unlink', onDelete);

  // Watch every configured server-function directory (the multi-dir injection roots).
  for (const dir of pathsConfig.serverFunctionDirs) {
    watch(dir, { ignoreInitial: true })
      .on('add', onFunctionChange)
      .on('change', onFunctionChange)
      .on('unlink', onFunctionChange);
  }

  // Watch shared modules separately (changes here cascade to dependent
  // routes via the import-dependency graph). NOTE: `shared/` is also one
  // of the default function-injection roots, so the watcher above already
  // covers it — but consumers can override `serverFunctionDirs` without
  // dropping `shared/`, so we keep this explicit watcher for the cascade
  // behavior. Duplicate add/change events are coalesced downstream.
  watch(pathsConfig.sharedDir, { ignoreInitial: true })
    .on('add', onFunctionChange)
    .on('change', onFunctionChange)
    .on('unlink', onFunctionChange);
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export const setupWatchers = () => {
  const isDevMode = !isProductionRuntime();
  if (!isDevMode) return;

  const segments = buildPathSegments();
  const isInServerFunctionsDir = makeIsInServerFunctionsDir(segments);
  const isRouteFile = makeIsRouteFile(segments);
  const isRouteDependencyFile = makeIsRouteDependencyFile(segments, isRouteFile);
  const isSharedDependencyFile = makeIsSharedDependencyFile(segments, isInServerFunctionsDir);
  const isTypeMapRelevantFile = makeIsTypeMapRelevantFile(segments, isRouteFile);
  const isLocaleFile = makeIsLocaleFile(segments);

  const typeMap = createTypeMapQueue();
  const pending = createPendingChangeSets();
  const scheduleReload = createReloadScheduler(() => getProjectConfig().dev.hotReloadDebounceMs);

  const processPendingApiChanges = async ({ regenerateTypeMap = false }: { regenerateTypeMap?: boolean } = {}) => {
    const deletePaths = [...pending.apiDeletes];
    const upsertPaths = [...pending.apiUpserts];
    pending.apiDeletes.clear();
    pending.apiUpserts.clear();

    if (regenerateTypeMap) {
      console.log(`[HotReload] API routes changed (add/delete), scheduling type map regeneration`, 'blue');
      typeMap.request();
    }

    for (const deletePath of deletePaths) {
      removeApiFromFile(deletePath);
      console.log(`[HotReload] API removed: ${deletePath}`, 'yellow');
    }

    //? A reload also rebuilds the TypeScript Program to read the input type,
    //? which blocks like type-map generation does — hence the duration.
    for (const upsertPath of upsertPaths) {
      const startedAt = Date.now();
      await upsertApiFromFile(upsertPath);
      console.log(`[HotReload] API reloaded in ${Date.now() - startedAt}ms: ${upsertPath}`, 'green');
    }
  };

  //? Inline the last generated `clientInput` into the client of each deleted
  //? sync server, before the type map is regenerated without that route.
  const migrateClientsOfDeletedSyncServers = async () => {
    const serverPaths = [...pending.deletedSyncServers];
    pending.deletedSyncServers.clear();

    for (const serverPath of serverPaths) {
      //? Restored within the debounce window (rename back, checkout): the
      //? client still has its server, so it keeps the generated types.
      if (fs.existsSync(serverPath)) continue;
      const clientPath = getPairedSyncFile(serverPath);
      if (!clientPath || !fs.existsSync(clientPath)) continue;

      // Extract clientInput types from generated types file (server file is already deleted)
      const clientInputTypes = extractClientInputFromGeneratedTypes(
        extractSyncPagePath(serverPath),
        extractSyncName(serverPath),
        extractSyncVersion(serverPath),
      );

      // Fall back to a placeholder block when types couldn't be extracted from generated file.
      await updateClientFileForDeletedServer(
        clientPath,
        clientInputTypes ?? '{\n    // Types were in _server.ts - please add them here\n  }',
      );
    }
  };

  const processPendingSyncChanges = async ({ regenerateTypeMap = false }: { regenerateTypeMap?: boolean } = {}) => {
    await migrateClientsOfDeletedSyncServers();

    const deletePaths = [...pending.syncDeletes];
    const upsertPaths = [...pending.syncUpserts];
    pending.syncDeletes.clear();
    pending.syncUpserts.clear();

    if (regenerateTypeMap) {
      console.log(`[HotReload] Sync routes changed (add/delete), scheduling type map regeneration`, 'blue');
      typeMap.request();
    }

    for (const deletePath of deletePaths) {
      removeSyncFromFile(deletePath);
      console.log(`[HotReload] Sync removed: ${deletePath}`, 'yellow');
    }

    for (const upsertPath of upsertPaths) {
      const startedAt = Date.now();
      await upsertSyncFromFile(upsertPath);
      console.log(`[HotReload] Sync reloaded in ${Date.now() - startedAt}ms: ${upsertPath}`, 'green');
    }
  };

  /** Returns true when the dev server is about to restart instead. */
  const enqueueAffectedRoutesFromDependency = (changedPath: string): boolean => {
    const affectedRoutes = findDependentRouteFiles(changedPath);

    if (affectedRoutes.size === 0) {
      console.log(`[HotReload] No API/Sync routes depend on: ${changedPath}`, 'yellow');
      return false;
    }

    //? Re-importing a route with the loader's `?v=` query does NOT re-evaluate
    //? the modules the route imports: the ESM loader caches those by their
    //? plain URL, so the route would keep running the OLD code of this file.
    //? Only a new process runs the new code, so ask the supervisor to restart.
    if (requestDevServerRestart(changedPath)) {
      console.log(
        `[HotReload] Dependency changed: ${changedPath} -> restarting the dev server (${affectedRoutes.size} route(s) import it)`,
        'blue'
      );
      return true;
    }

    //? Not supervised: reloading still refreshes the routes' input types (the
    //? Program is rebuilt), but their handlers keep the old dependency code.
    console.log(
      `[HotReload] ${changedPath} changed, but routes that import it keep running its old code until you restart the dev server (the supervised \`npm run server\` restarts automatically)`,
      'yellow'
    );

    let queuedApiCount = 0;
    let queuedSyncCount = 0;

    for (const routePath of affectedRoutes) {
      if (routePath.includes(segments.apiMarkerSlash)) {
        pending.apiDeletes.delete(routePath);
        pending.apiUpserts.add(routePath);
        queuedApiCount += 1;
      } else if (routePath.includes(segments.syncMarkerSlash)) {
        pending.syncDeletes.delete(routePath);
        pending.syncUpserts.add(routePath);
        queuedSyncCount += 1;
      }
    }

    console.log(
      `[HotReload] Dependency changed: ${changedPath} -> queued ${queuedApiCount} API and ${queuedSyncCount} Sync route reloads`,
      'blue'
    );

    if (queuedApiCount > 0) {
      scheduleReload('api', async () => {
        await processPendingApiChanges();
      });
    }

    if (queuedSyncCount > 0) {
      scheduleReload('sync', async () => {
        await processPendingSyncChanges();
      });
    }

    return false;
  };

  const handleAdd = async (filePath: string) => {
    const normalizedPath = normalizeFsPath(filePath);
    invalidateGraphForFile(normalizedPath);

    const routeValidationMessage = getRouteFilenameValidationMessage(normalizedPath);
    if (routeValidationMessage) {
      if (shouldInjectTemplate(filePath, { isNewFile: true })) {
        const injected = await injectTemplate(filePath);
        if (injected) {
          return;
        }
      }

      console.log(`[HotReload] ${routeValidationMessage}`, 'yellow');
      return;
    }

    // Check if this is a new empty file that needs a template
    if (shouldInjectTemplate(filePath, { isNewFile: true })) {
      // Special handling for sync server files when client already exists
      if (isSyncServerFile(normalizedPath)) {
        const clientPath = getPairedSyncFile(normalizedPath);
        if (clientPath && fs.existsSync(clientPath) && !isEmptyFile(clientPath)) {
          // Extract clientInput types from existing client file
          const clientInputTypes = extractClientInputFromFile(clientPath);
          if (clientInputTypes) {
            // Inject server template with pre-filled clientInput from client
            await injectServerTemplateWithClientInput(filePath, clientInputTypes);
            // Schedule type regeneration in the background; the client file
            // update + sync upserts below don't depend on the artifact.
            typeMap.request();
            // Update client file to use imported types + add serverOutput.
            // If the rewrite fails (returns false) skip upserts — the client
            // still has the old type shape and registering it now would give
            // the server a mis-matched handler contract.
            const clientRewritten = await updateClientFileForPairedServer(clientPath);
            if (!clientRewritten) {
              console.log(`[HotReload] Paired client rewrite failed, skipping upsert for: ${clientPath}`, 'yellow');
              return;
            }
            await upsertSyncFromFile(filePath);
            await upsertSyncFromFile(clientPath);
            return;
          }
        }
      }

      // Default template injection
      const injected = await injectTemplate(filePath);
      if (injected) {
        // Don't continue processing - the template was just injected
        // The next 'change' event will handle it
        return;
      }
    }

    //? Only route files take the route path; a new helper or test under a
    //? marker falls through to `handleChange` as an ordinary dependency.
    const isRoute = isRouteFile(normalizedPath);

    if (isRoute && normalizedPath.includes(segments.apiMarkerNoLead)) {
      pending.apiDeletes.delete(normalizedPath);
      pending.apiUpserts.add(normalizedPath);
      scheduleReload('api', async () => {
        await processPendingApiChanges({ regenerateTypeMap: true });
      });
      return;
    }

    if (isRoute && normalizedPath.includes(segments.syncMarkerNoLead)) {
      pending.syncDeletes.delete(normalizedPath);
      pending.syncUpserts.add(normalizedPath);
      scheduleReload('sync', async () => {
        await processPendingSyncChanges({ regenerateTypeMap: true });
      });
      return;
    }

    // Handle normal file additions
    handleChange(filePath).catch((error: unknown) => {
      console.log(`[HotReload] handleChange threw an error: ${String(error)}`, 'red');
    });
  };

  const handleChange = async (filePath: string) => {
    const normalizedPath = normalizeFsPath(filePath);
    invalidateGraphForFile(normalizedPath);

    const routeValidationMessage = getRouteFilenameValidationMessage(normalizedPath);
    if (routeValidationMessage) {
      if (shouldInjectTemplate(filePath)) {
        const injected = await injectTemplate(filePath);
        if (injected) {
          return;
        }
      }

      console.log(`[HotReload] ${routeValidationMessage}`, 'yellow');
      return;
    }

    if (shouldInjectTemplate(filePath)) {
      const injected = await injectTemplate(filePath);
      if (injected) {
        return;
      }
    }

    if (isGeneratedPath(normalizedPath)) {
      return;
    }

    if (isLocaleFile(normalizedPath)) {
      scheduleReload('locales', async () => {
        await getLocaleReloader()?.();
      });
      return;
    }

    if (isRouteDependencyFile(normalizedPath)) {
      //? A restarting server regenerates on boot; generating here as well would
      //? only hold up the restart.
      if (enqueueAffectedRoutesFromDependency(normalizedPath)) return;
      scheduleReload('typemap', () => {
        console.log(`[HotReload] Route dependency changed, scheduling type map regeneration`, 'blue');
        typeMap.request();
      });
      return;
    }

    if (isTypeMapRelevantFile(normalizedPath)) {
      scheduleReload('typemap', () => {
        console.log(`[HotReload] Route dependency changed, scheduling type map regeneration`, 'blue');
        typeMap.request();
      });
    }

    if (normalizedPath.includes(segments.apiMarkerNoLead)) {
      scheduleReload('typemap', () => {
        console.log(`[HotReload] API changed, scheduling type map regeneration`, 'blue');
        typeMap.request();
      });
      pending.apiDeletes.delete(normalizedPath);
      pending.apiUpserts.add(normalizedPath);
      scheduleReload('api', async () => {
        await processPendingApiChanges();
      });
    } else if (normalizedPath.includes(segments.syncMarkerNoLead)) {
      scheduleReload('typemap', () => {
        console.log(`[HotReload] Sync changed, scheduling type map regeneration`, 'blue');
        typeMap.request();
      });
      pending.syncDeletes.delete(normalizedPath);
      pending.syncUpserts.add(normalizedPath);
      scheduleReload('sync', async () => {
        await processPendingSyncChanges();
      });
    }
  };

  const handleFunctionChange = (changedPath: string) => {
    const normalizedPath = normalizeFsPath(changedPath);
    invalidateGraphForFile(normalizedPath);

    if (isSharedDependencyFile(normalizedPath) && enqueueAffectedRoutesFromDependency(normalizedPath)) {
      return; //? the restarted server loads functions and types fresh
    }

    scheduleReload('functions', async () => {
      typeMap.request();
      await initializeFunctions();
    });
  };

  const handleDelete = (filePath: string) => {
    const normalizedPath = normalizeFsPath(filePath);
    invalidateGraphForFile(normalizedPath);

    if (isGeneratedPath(normalizedPath)) {
      return;
    }

    if (isLocaleFile(normalizedPath)) {
      scheduleReload('locales', async () => {
        await getLocaleReloader()?.();
      });
      return;
    }

    if (isRouteDependencyFile(normalizedPath)) {
      if (enqueueAffectedRoutesFromDependency(normalizedPath)) return;
      scheduleReload('typemap', () => {
        console.log(`[HotReload] Route dependency deleted, scheduling type map regeneration`, 'blue');
        typeMap.request();
      });
      return;
    }

    if (isTypeMapRelevantFile(normalizedPath)) {
      scheduleReload('typemap', () => {
        console.log(`[HotReload] Route dependency deleted, scheduling type map regeneration`, 'blue');
        typeMap.request();
      });
    }

    if (normalizedPath.includes(segments.apiMarkerNoLead)) {
      scheduleReload('typemap', () => {
        console.log(`[HotReload] API deleted, scheduling type map regeneration`, 'blue');
        typeMap.request();
      });
      pending.apiUpserts.delete(normalizedPath);
      pending.apiDeletes.add(normalizedPath);
      scheduleReload('api', async () => {
        await processPendingApiChanges();
      });
    } else if (normalizedPath.includes(segments.syncMarkerNoLead)) {
      scheduleReload('typemap', () => {
        console.log(`[HotReload] Sync deleted, scheduling type map regeneration`, 'blue');
        typeMap.request();
      });
      pending.syncUpserts.delete(normalizedPath);
      pending.syncDeletes.add(normalizedPath);
      // Special handling for sync server file deletion when client exists
      if (isSyncServerFile(normalizedPath)) {
        pending.deletedSyncServers.add(normalizedPath);
      }
      scheduleReload('sync', async () => {
        await processPendingSyncChanges();
      });
    }
  };

  // Chokidar silently discards the promise returned by async listeners.
  // Wrap each handler so a thrown error is caught instead of becoming an
  // unhandled rejection that would crash the dev server.
  const safeHandleAdd = (p: string): void => { void handleAdd(p).catch((error: unknown) => { console.log(`[HotReload] handleAdd threw an error: ${String(error)}`, 'red'); }); };
  const safeHandleChange = (p: string): void => { void handleChange(p).catch((error: unknown) => { console.log(`[HotReload] handleChange threw an error: ${String(error)}`, 'red'); }); };
  // handleDelete is sync; errors surface inside the scheduleReload callbacks, not at call-site.
  const safeHandleDelete = (p: string): void => { handleDelete(p); };

  mountWatchers(safeHandleAdd, safeHandleChange, safeHandleDelete, handleFunctionChange);

  //? Generate initial type map on startup — fire-and-forget on the next
  //? event-loop tick so server.listen() happens first. Runtime reads from
  //? the in-memory devApis/devSyncs maps (already populated by
  //? initializeAll() before setupWatchers runs); the on-disk type-map is
  //? purely for IDE IntelliSense + Zod schema files. Deferring drops boot
  //? time ~6-8s on a 54-API project.
  setImmediate(() => {
    void (async () => {
      //? A scaffolded project whose consumer hasn't run `prisma generate` yet
      //? has a schema on disk but no generated `@prisma/client`. The type-map
      //? generator then throws on unresolved model identifiers (e.g. `User`).
      //? Auto-generate ONCE on boot — `prisma generate` only reads the schema,
      //? so it needs no DB credentials and is safe to run unattended.
      if (isPrismaClientMissing()) {
        console.log(`[HotReload] @prisma/client not generated yet — running prisma generate (no DB needed)…`, 'blue');
        const [generateErr, exitCode] = await runPrismaGenerate();
        if (generateErr || exitCode !== 0) {
          console.log(`[HotReload] prisma generate failed${generateErr ? `: ${String(generateErr)}` : ` (exit code ${String(exitCode)})`} — run \`npm run prisma:generate\` manually and restart`, 'red');
        } else {
          console.log(`[HotReload] prisma generate complete`, 'green');
        }
      }

      const [err] = await tryCatch(() => { generateTypeMapFile({ quiet: true }); });
      if (err) {
        //? Gate the hint on the actual failure CLASS, not the client-dir probe: an
        //? "unresolved type identifiers" error is almost always an un-generated
        //? @prisma/client (missing model types). Tying it to the error text means
        //? the hint always shows when it's relevant, even if the dir-probe is
        //? fooled by a stub, while staying quiet for unrelated failures.
        const hint = /unresolved type identifiers/i.test(String(err))
          ? '\n  → This usually means @prisma/client is not generated. Run `npm run prisma:generate` (no database needed) and restart.'
          : '';
        console.log(`[HotReload] initial type map generation failed: ${String(err)}${hint}`, 'red');
      } else {
        console.log(`[HotReload] type map ready in background`, 'green');
      }
    })();
  });
};
