//? Thin REPL-only helper. The full RuntimeMapsProvider (dev vs prod
//? branching, devkit lookup, caching) now ships from `@luckystack/server`
//? and is wired automatically when `server.ts` passes `loadGeneratedMaps`
//? to `bootstrapLuckyStack`. This file only survives because the REPL
//? (`server/utils/repl.ts`) reads dev/prod maps directly to print
//? `/api/*` / `/sync/*` listings — the framework's provider hides those
//? behind `getRuntimeApiMaps` / `getRuntimeSyncMaps`, which is the wrong
//? shape for the REPL inspection helpers.

import { env } from '../bootstrap/env';

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

const emptyRuntimeMaps: LoadedRuntimeMaps = {
  apisObject: {},
  syncObject: {},
  functionsObject: {},
};

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
    const bundle = process.env.LUCKYSTACK_BUNDLE ?? 'default';
    const target = `./generatedApis.${bundle}`;
    const mod: unknown = await (import(target) as Promise<unknown>).catch(() => null);
    if (!mod) return emptyRuntimeMaps;
    const moduleRecord = mod && typeof mod === 'object' ? (mod as Record<string, unknown>) : {};
    return {
      apisObject: isRuntimeMapRecord(moduleRecord.apis) ? moduleRecord.apis : {},
      syncObject: isRuntimeMapRecord(moduleRecord.syncs) ? moduleRecord.syncs : {},
      functionsObject: isRuntimeMapRecord(moduleRecord.functions) ? moduleRecord.functions : {},
    };
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
