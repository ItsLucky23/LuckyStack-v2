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
import { tryCatch, getProjectConfig, getLocaleReloader } from "@luckystack/core";
import { getRoutingRules } from './routingRules';

// ----------------------------
// Watcher for Hot Reload + Type Generation
// ----------------------------

const normalizeFsPath = (value: string): string => path.resolve(value).replaceAll('\\', '/');

const isGeneratedPath = (normalizedPath: string): boolean => {
  return (
    normalizedPath.includes('apiTypes.generated.ts')
    || normalizedPath.includes('apiDocs.generated.json')
  );
};

// ---------------------------------------------------------------------------
// Type-map queue
// ---------------------------------------------------------------------------

/**
 * Creates a self-contained type-map regeneration queue that coalesces
 * concurrent save bursts into a single background run via setImmediate.
 */
const createTypeMapQueue = () => {
  const queue = { pending: false, running: false };

  const run = () => {
    queue.running = true;
    queue.pending = false;
    const startedAt = Date.now();
    setImmediate(() => {
      void (async () => {
        const [err] = await tryCatch(() => { generateTypeMapFile({ quiet: true }); });
        if (err) {
          console.log(`[HotReload] type map regeneration failed: ${String(err)}`, 'red');
        } else {
          console.log(`[HotReload] type map ready in ${Date.now() - startedAt}ms`, 'green');
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
 * Bundles the four mutable sets that track pending API/Sync add/delete
 * operations so they travel as a single value rather than four separate
 * variables inside the watcher closure.
 */
const createPendingChangeSets = () => ({
  apiUpserts: new Set<string>(),
  apiDeletes: new Set<string>(),
  syncUpserts: new Set<string>(),
  syncDeletes: new Set<string>(),
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

const makeIsRouteDependencyFile = (segments: PathSegments) =>
  (normalizedPath: string): boolean => {
    if (!normalizedPath.endsWith('.ts') && !normalizedPath.endsWith('.tsx')) return false;
    if (!normalizedPath.includes(segments.srcSegment)) return false;
    if (normalizedPath.includes(segments.apiMarkerSlash) || normalizedPath.includes(segments.syncMarkerSlash)) return false;
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

const makeIsTypeMapRelevantFile = (segments: PathSegments) =>
  (normalizedPath: string): boolean => {
    if (isGeneratedPath(normalizedPath)) return false;
    if (!(normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.tsx'))) return false;
    if (normalizedPath.includes(segments.apiMarkerSlash) || normalizedPath.includes(segments.syncMarkerSlash)) return false;
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
  const isDevMode = process.env.NODE_ENV !== 'production';
  if (!isDevMode) return;

  const segments = buildPathSegments();
  const isInServerFunctionsDir = makeIsInServerFunctionsDir(segments);
  const isRouteDependencyFile = makeIsRouteDependencyFile(segments);
  const isSharedDependencyFile = makeIsSharedDependencyFile(segments, isInServerFunctionsDir);
  const isTypeMapRelevantFile = makeIsTypeMapRelevantFile(segments);
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

    for (const upsertPath of upsertPaths) {
      await upsertApiFromFile(upsertPath);
      console.log(`[HotReload] API reloaded: ${upsertPath}`, 'green');
    }
  };

  const processPendingSyncChanges = async ({ regenerateTypeMap = false }: { regenerateTypeMap?: boolean } = {}) => {
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
      await upsertSyncFromFile(upsertPath);
      console.log(`[HotReload] Sync reloaded: ${upsertPath}`, 'green');
    }
  };

  const enqueueAffectedRoutesFromDependency = (changedPath: string) => {
    const affectedRoutes = findDependentRouteFiles(changedPath);

    if (affectedRoutes.size === 0) {
      console.log(`[HotReload] No API/Sync routes depend on: ${changedPath}`, 'yellow');
      return;
    }

    //? With dynamic `import()` + per-load `?v=` cachebust in loader.ts there is
    //? nothing to invalidate on the main thread; the next upsert will fetch a
    //? fresh module instance.

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

    if (normalizedPath.includes(segments.apiMarkerNoLead)) {
      pending.apiDeletes.delete(normalizedPath);
      pending.apiUpserts.add(normalizedPath);
      scheduleReload('api', async () => {
        await processPendingApiChanges({ regenerateTypeMap: true });
      });
      return;
    }

    if (normalizedPath.includes(segments.syncMarkerNoLead)) {
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
      scheduleReload('typemap', () => {
        console.log(`[HotReload] Route dependency changed, scheduling type map regeneration`, 'blue');
        typeMap.request();
      });
      enqueueAffectedRoutesFromDependency(normalizedPath);
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

    scheduleReload('functions', async () => {
      typeMap.request();
      await initializeFunctions();
    });

    if (isSharedDependencyFile(normalizedPath)) {
      enqueueAffectedRoutesFromDependency(normalizedPath);
    }
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
      scheduleReload('typemap', () => {
        console.log(`[HotReload] Route dependency deleted, scheduling type map regeneration`, 'blue');
        typeMap.request();
      });
      enqueueAffectedRoutesFromDependency(normalizedPath);
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
      scheduleReload('sync', async () => {
        // Special handling for sync server file deletion when client exists
        if (isSyncServerFile(normalizedPath)) {
          const clientPath = getPairedSyncFile(normalizedPath);
          if (clientPath && fs.existsSync(clientPath)) {
            // Extract clientInput types from generated types file (server file is already deleted)
            const pagePath = extractSyncPagePath(normalizedPath);
            const syncName = extractSyncName(normalizedPath);
            const clientInputTypes = extractClientInputFromGeneratedTypes(pagePath, syncName);

            // Fall back to a placeholder block when types couldn't be extracted from generated file.
            await updateClientFileForDeletedServer(
              clientPath,
              clientInputTypes ?? '{\n    // Types were in _server.ts - please add them here\n  }',
            );
          }
        }

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
        //? Append an actionable hint only when the Prisma-client-missing signal
        //? is still true — never spam it when the real cause is unrelated.
        const hint = isPrismaClientMissing()
          ? '\n  → This usually means @prisma/client is not generated. Run `npm run prisma:generate` and restart.'
          : '';
        console.log(`[HotReload] initial type map generation failed: ${String(err)}${hint}`, 'red');
      } else {
        console.log(`[HotReload] type map ready in background`, 'green');
      }
    })();
  });
};
