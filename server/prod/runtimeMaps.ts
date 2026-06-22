//? Thin REPL-only helper. The full RuntimeMapsProvider (dev vs prod
//? branching, devkit lookup, caching) now ships from `@luckystack/server`
//? and is wired automatically when `server.ts` passes `loadGeneratedMaps`
//? to `bootstrapLuckyStack`. This file only survives because the REPL
//? (`server/utils/repl.ts`) reads dev/prod maps directly to print
//? `/api/*` / `/sync/*` listings — the framework's provider hides those
//? behind `getRuntimeApiMaps` / `getRuntimeSyncMaps`, which is the wrong
//? shape for the REPL inspection helpers.

import { env } from '../bootstrap/env';
import { getParsedBundles } from '@luckystack/server';

type RuntimeMapRecord = Record<string, unknown>;

interface LoadedRuntimeMaps {
  apisObject: RuntimeMapRecord;
  syncObject: RuntimeMapRecord;
  functionsObject: RuntimeMapRecord;
}

interface DevkitRuntimeMaps {
  devApis: RuntimeMapRecord;
  devSyncs: RuntimeMapRecord;
  devFunctions: RuntimeMapRecord;
}

const isRuntimeMapRecord = (value: unknown): value is RuntimeMapRecord =>
  Boolean(value) && typeof value === 'object';

let devkitModulePromise: Promise<DevkitRuntimeMaps> | null = null;
const getDevkit = async (): Promise<DevkitRuntimeMaps> => {
  devkitModulePromise ??= import('@luckystack/devkit') as Promise<DevkitRuntimeMaps>;
  return await devkitModulePromise;
};

let prodMapsPromise: Promise<LoadedRuntimeMaps> | null = null;
const loadProdMaps = async (): Promise<LoadedRuntimeMaps> => {
  if (prodMapsPromise) return await prodMapsPromise;
  prodMapsPromise = (async () => {
    const presets = getParsedBundles().length > 0 ? getParsedBundles() : ['default'];
    const merged: LoadedRuntimeMaps = { apisObject: {}, syncObject: {}, functionsObject: {} };
    for (const bundle of presets) {
      const target = `./generatedApis.${bundle}`;
      const mod: unknown = await (import(target) as Promise<unknown>).catch((error: unknown) => {
        //? Warn in dev so a missing generatedApis.*.ts is visible in the REPL.
        //? In prod, failing to load a bundle means routes simply won't appear —
        //? the server already validates maps at boot, so this is a diagnostic aid.
        console.warn(`[runtimeMaps] Failed to load bundle "${bundle}":`, error);
        return null;
      });
      if (!mod) continue;
      const moduleRecord = typeof mod === 'object' ? (mod as Record<string, unknown>) : {};
      if (isRuntimeMapRecord(moduleRecord.apis)) Object.assign(merged.apisObject, moduleRecord.apis);
      if (isRuntimeMapRecord(moduleRecord.syncs)) Object.assign(merged.syncObject, moduleRecord.syncs);
      if (isRuntimeMapRecord(moduleRecord.functions)) Object.assign(merged.functionsObject, moduleRecord.functions);
    }
    return merged;
  })();
  return await prodMapsPromise;
};

export const getRuntimeReplMaps = async (): Promise<{
  apiMap: RuntimeMapRecord;
  syncMap: RuntimeMapRecord;
}> => {
  if (env.NODE_ENV !== 'production') {
    const { devApis, devSyncs } = await getDevkit();
    return {
      apiMap: isRuntimeMapRecord(devApis) ? devApis : {},
      syncMap: isRuntimeMapRecord(devSyncs) ? devSyncs : {},
    };
  }

  const { apisObject, syncObject } = await loadProdMaps();
  return { apiMap: apisObject, syncMap: syncObject };
};
