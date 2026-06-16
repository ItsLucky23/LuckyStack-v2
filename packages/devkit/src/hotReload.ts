/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
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
import { tryCatch, getProjectConfig, getLocaleReloader } from "@luckystack/core";
import { getRoutingRules } from './routingRules';

// ----------------------------
// Watcher for Hot Reload + Type Generation
// ----------------------------

export const setupWatchers = () => {
  const isDevMode = process.env.NODE_ENV !== 'production';
  if (!isDevMode) return;
  //? Marker path segments resolved once per startup. If a consumer registers
  //? custom marker names, those wire through here automatically.
  const apiMarkerSlash = `/${getRoutingRules().apiMarker}/`;
  const syncMarkerSlash = `/${getRoutingRules().syncMarker}/`;
  const apiMarkerNoLead = `${getRoutingRules().apiMarker}/`;
  const syncMarkerNoLead = `${getRoutingRules().syncMarker}/`;
  //? Path segments derived from configured paths. Consumers with custom
  //? `srcDir`/`sharedDir`/`serverFunctionsDir` get correct watcher behavior.
  const pathsCfg = getProjectConfig().paths;
  const srcSegment = `/${pathsCfg.srcDir.replaceAll('\\', '/')}/`;
  const sharedSegment = `/${pathsCfg.sharedDir.replaceAll('\\', '/')}/`;
  //? Multi-directory function-injection roots. Falls back to the legacy
  //? singular `serverFunctionsDir` for consumer configs that haven't
  //? migrated to the array form.
  const serverFunctionsSegments = (pathsCfg.serverFunctionDirs ?? [pathsCfg.serverFunctionsDir]).map(
    (dir) => `/${dir.replaceAll('\\', '/')}/`,
  );
  const isInServerFunctionsDir = (normalizedPath: string): boolean =>
    serverFunctionsSegments.some((segment) => normalizedPath.includes(segment));
  const localesSegment = `${srcSegment}_locales/`;
  const reloadTimers = new Map<'api' | 'sync' | 'functions' | 'typemap' | 'locales', NodeJS.Timeout>();
  const pendingApiUpserts = new Set<string>();
  const pendingApiDeletes = new Set<string>();
  const pendingSyncUpserts = new Set<string>();
  const pendingSyncDeletes = new Set<string>();
  const normalizeFsPath = (value: string): string => path.resolve(value).replaceAll('\\', '/');

  //? Type-map regeneration is purely a DX artifact (IDE IntelliSense + Zod
  //? schemas on disk). The runtime request path reads from in-memory
  //? `devApis`/`devSyncs`/`devFunctions`, so we deliberately do NOT await
  //? regeneration on the reload critical path. Instead, coalesce concurrent
  //? requests into a single background run scheduled via setImmediate so the
  //? event loop keeps serving Socket.io requests during a burst of saves.
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

  const isRouteDependencyFile = (normalizedPath: string): boolean => {
    if (!normalizedPath.endsWith('.ts') && !normalizedPath.endsWith('.tsx')) {
      return false;
    }

    if (!normalizedPath.includes(srcSegment)) {
      return false;
    }

    if (normalizedPath.includes(apiMarkerSlash) || normalizedPath.includes(syncMarkerSlash)) {
      return false;
    }

    if (isGeneratedPath(normalizedPath)) {
      return false;
    }

    return true;
  };

  const isSharedDependencyFile = (normalizedPath: string): boolean => {
    if (!(normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.tsx'))) return false;
    if (normalizedPath.includes(sharedSegment)) return true;
    return isInServerFunctionsDir(normalizedPath);
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

  const isGeneratedPath = (normalizedPath: string): boolean => {
    return (
      normalizedPath.includes('apiTypes.generated.ts')
      || normalizedPath.includes('apiDocs.generated.json')
    );
  };

  const isTypeMapRelevantFile = (normalizedPath: string): boolean => {
    if (isGeneratedPath(normalizedPath)) return false;
    if (!(normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.tsx'))) return false;
    if (normalizedPath.includes(apiMarkerSlash) || normalizedPath.includes(syncMarkerSlash)) return false;

    return (
      normalizedPath.includes(srcSegment)
      || normalizedPath.endsWith('/config.ts')
      || normalizedPath.includes(sharedSegment)
    );
  };

  const isLocaleFile = (normalizedPath: string): boolean => {
    return normalizedPath.includes(localesSegment) && normalizedPath.endsWith('.json');
  };

  const scheduleReload = (
    key: 'api' | 'sync' | 'functions' | 'typemap' | 'locales',
    task: () => Promise<void> | void,
    delay = getProjectConfig().dev.hotReloadDebounceMs
  ) => {
    const activeTimer = reloadTimers.get(key);
    if (activeTimer) {
      clearTimeout(activeTimer);
    }

    const timer = setTimeout(() => {
      reloadTimers.delete(key);
      void task();
    }, delay);

    reloadTimers.set(key, timer);
  };

  const handleAdd = async (path: string) => {
    const normalizedPath = normalizeFsPath(path);
    invalidateGraphForFile(normalizedPath);

    const routeValidationMessage = getRouteFilenameValidationMessage(normalizedPath);
    if (routeValidationMessage) {
      if (shouldInjectTemplate(path, { isNewFile: true })) {
        const injected = await injectTemplate(path);
        if (injected) {
          return;
        }
      }

      console.log(`[HotReload] ${routeValidationMessage}`, 'yellow');
      return;
    }

    // Check if this is a new empty file that needs a template
    if (shouldInjectTemplate(path, { isNewFile: true })) {
      // Special handling for sync server files when client already exists
      if (isSyncServerFile(normalizedPath)) {
        const clientPath = getPairedSyncFile(normalizedPath);
        if (clientPath && fs.existsSync(clientPath) && !isEmptyFile(clientPath)) {
          // Extract clientInput types from existing client file
          const clientInputTypes = extractClientInputFromFile(clientPath);
          if (clientInputTypes) {
            // Inject server template with pre-filled clientInput from client
            await injectServerTemplateWithClientInput(path, clientInputTypes);
            // Schedule type regeneration in the background; the client file
            // update + sync upserts below don't depend on the artifact.
            requestTypeMapRegeneration();
            // Update client file to use imported types + add serverOutput
            await updateClientFileForPairedServer(clientPath);
            await upsertSyncFromFile(path);
            await upsertSyncFromFile(clientPath);
            return;
          }
        }
      }

      // Default template injection
      const injected = await injectTemplate(path);
      if (injected) {
        // Don't continue processing - the template was just injected
        // The next 'change' event will handle it
        return;
      }
    }

    if (normalizedPath.includes(apiMarkerNoLead)) {
      pendingApiDeletes.delete(normalizedPath);
      pendingApiUpserts.add(normalizedPath);
      scheduleReload('api', async () => {
        await processPendingApiChanges({ regenerateTypeMap: true });
      });
      return;
    }

    if (normalizedPath.includes(syncMarkerNoLead)) {
      pendingSyncDeletes.delete(normalizedPath);
      pendingSyncUpserts.add(normalizedPath);
      scheduleReload('sync', async () => {
        await processPendingSyncChanges({ regenerateTypeMap: true });
      });
      return;
    }

    // Handle normal file additions
    handleChange(path);
  };

  const processPendingApiChanges = async ({ regenerateTypeMap = false }: { regenerateTypeMap?: boolean } = {}) => {
    const deletePaths = [...pendingApiDeletes];
    const upsertPaths = [...pendingApiUpserts];
    pendingApiDeletes.clear();
    pendingApiUpserts.clear();

    if (regenerateTypeMap) {
      console.log(`[HotReload] API routes changed (add/delete), scheduling type map regeneration`, 'blue');
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

  const processPendingSyncChanges = async ({ regenerateTypeMap = false }: { regenerateTypeMap?: boolean } = {}) => {
    const deletePaths = [...pendingSyncDeletes];
    const upsertPaths = [...pendingSyncUpserts];
    pendingSyncDeletes.clear();
    pendingSyncUpserts.clear();

    if (regenerateTypeMap) {
      console.log(`[HotReload] Sync routes changed (add/delete), scheduling type map regeneration`, 'blue');
      requestTypeMapRegeneration();
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

  const handleChange = async (path: string) => {
    const normalizedPath = normalizeFsPath(path);
    invalidateGraphForFile(normalizedPath);

    const routeValidationMessage = getRouteFilenameValidationMessage(normalizedPath);
    if (routeValidationMessage) {
      if (shouldInjectTemplate(path)) {
        const injected = await injectTemplate(path);
        if (injected) {
          return;
        }
      }

      console.log(`[HotReload] ${routeValidationMessage}`, 'yellow');
      return;
    }

    if (shouldInjectTemplate(path)) {
      const injected = await injectTemplate(path);
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
        requestTypeMapRegeneration();
      });
      enqueueAffectedRoutesFromDependency(normalizedPath);
      return;
    }

    if (isTypeMapRelevantFile(normalizedPath)) {
      scheduleReload('typemap', () => {
        console.log(`[HotReload] Route dependency changed, scheduling type map regeneration`, 'blue');
        requestTypeMapRegeneration();
      });
    }

    if (normalizedPath.includes(apiMarkerNoLead)) {
      scheduleReload('typemap', () => {
        console.log(`[HotReload] API changed, scheduling type map regeneration`, 'blue');
        requestTypeMapRegeneration();
      });
      pendingApiDeletes.delete(normalizedPath);
      pendingApiUpserts.add(normalizedPath);
      scheduleReload('api', async () => {
        await processPendingApiChanges();
      });
    } else if (normalizedPath.includes(syncMarkerNoLead)) {
      scheduleReload('typemap', () => {
        console.log(`[HotReload] Sync changed, scheduling type map regeneration`, 'blue');
        requestTypeMapRegeneration();
      });
      pendingSyncDeletes.delete(normalizedPath);
      pendingSyncUpserts.add(normalizedPath);
      scheduleReload('sync', async () => {
        await processPendingSyncChanges();
      });
    }
  };

  const handleFunctionChange = (changedPath: string) => {
    const normalizedPath = normalizeFsPath(changedPath);
    invalidateGraphForFile(normalizedPath);

    scheduleReload('functions', async () => {
      requestTypeMapRegeneration();
      await initializeFunctions();
    });

    if (isSharedDependencyFile(normalizedPath)) {
      enqueueAffectedRoutesFromDependency(normalizedPath);
    }
  };

  const handleDelete = async (path: string) => {
    const normalizedPath = normalizeFsPath(path);
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
        requestTypeMapRegeneration();
      });
      enqueueAffectedRoutesFromDependency(normalizedPath);
      return;
    }

    if (isTypeMapRelevantFile(normalizedPath)) {
      scheduleReload('typemap', () => {
        console.log(`[HotReload] Route dependency deleted, scheduling type map regeneration`, 'blue');
        requestTypeMapRegeneration();
      });
    }

    if (normalizedPath.includes(apiMarkerNoLead)) {
      scheduleReload('typemap', () => {
        console.log(`[HotReload] API deleted, scheduling type map regeneration`, 'blue');
        requestTypeMapRegeneration();
      });
      pendingApiUpserts.delete(normalizedPath);
      pendingApiDeletes.add(normalizedPath);
      scheduleReload('api', async () => {
        await processPendingApiChanges();
      });
    } else if (normalizedPath.includes(syncMarkerNoLead)) {
      scheduleReload('typemap', () => {
        console.log(`[HotReload] Sync deleted, scheduling type map regeneration`, 'blue');
        requestTypeMapRegeneration();
      });
      pendingSyncUpserts.delete(normalizedPath);
      pendingSyncDeletes.add(normalizedPath);
      scheduleReload('sync', async () => {
        // Special handling for sync server file deletion when client exists
        if (isSyncServerFile(normalizedPath)) {
          const clientPath = getPairedSyncFile(normalizedPath);
          if (clientPath && fs.existsSync(clientPath)) {
            // Extract clientInput types from generated types file (server file is already deleted)
            const pagePath = extractSyncPagePath(normalizedPath);
            const syncName = extractSyncName(normalizedPath);
            const clientInputTypes = extractClientInputFromGeneratedTypes(pagePath, syncName);

            if (clientInputTypes) {
              await updateClientFileForDeletedServer(clientPath, clientInputTypes);
            } else {
              // Fallback if types couldn't be extracted
              await updateClientFileForDeletedServer(clientPath, '{\n    // Types were in _server.ts - please add them here\n  }');
            }
          }
        }

        await processPendingSyncChanges();
      });
    }
  };

  const devConfig = getProjectConfig().dev;
  const pathsConfig = getProjectConfig().paths;
  // Watch the main source folders. Paths come from the registered project
  // config so consumers with non-default layouts (e.g. `app/src`) work.
  watch(pathsConfig.srcDir, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: devConfig.watcherStabilityThresholdMs,
      pollInterval: devConfig.watcherPollIntervalMs,
    },
  })
    .on('add', handleAdd)
    .on('change', handleChange)
    .on('unlink', handleDelete);

  // Watch every configured server-function directory (the multi-dir
  // injection roots). Falls back to the legacy singular path for projects
  // that haven't migrated their config yet.
  const serverFunctionDirsToWatch =
    pathsConfig.serverFunctionDirs && pathsConfig.serverFunctionDirs.length > 0
      ? pathsConfig.serverFunctionDirs
      : [pathsConfig.serverFunctionsDir];
  for (const dir of serverFunctionDirsToWatch) {
    watch(dir, { ignoreInitial: true })
      .on('add', handleFunctionChange)
      .on('change', handleFunctionChange)
      .on('unlink', handleFunctionChange);
  }

  // Watch shared modules separately (changes here cascade to dependent
  // routes via the import-dependency graph). NOTE: `shared/` is also one
  // of the default function-injection roots, so the watcher above already
  // covers it — but consumers can override `serverFunctionDirs` without
  // dropping `shared/`, so we keep this explicit watcher for the cascade
  // behavior. Duplicate add/change events are coalesced downstream.
  watch(pathsConfig.sharedDir, { ignoreInitial: true })
    .on('add', handleFunctionChange)
    .on('change', handleFunctionChange)
    .on('unlink', handleFunctionChange);

  //? Generate initial type map on startup — fire-and-forget on the next
  //? event-loop tick so server.listen() happens first. Runtime reads from
  //? the in-memory devApis/devSyncs maps (already populated by
  //? initializeAll() before setupWatchers runs); the on-disk type-map is
  //? purely for IDE IntelliSense + Zod schema files. Deferring drops boot
  //? time ~6-8s on a 54-API project. The hot-reload runner above (regel 70)
  //? uses the same setImmediate + quiet pattern.
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
};

