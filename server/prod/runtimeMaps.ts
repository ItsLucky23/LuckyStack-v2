import { env } from '../bootstrap/env';
import { registerRuntimeMapsProvider } from '@luckystack/core';

type RuntimeMapRecord = Record<string, unknown>;

interface LoadedRuntimeMaps {
  apisObject: RuntimeMapRecord;
  syncObject: RuntimeMapRecord;
  functionsObject: RuntimeMapRecord;
}

const emptyRuntimeMaps: LoadedRuntimeMaps = {
  apisObject: {},
  syncObject: {},
  functionsObject: {},
};

let prodRuntimeMapsPromise: Promise<LoadedRuntimeMaps> | null = null;
let warnedAboutMissingGeneratedMaps = false;

// Cache the devkit module so we only pay the dynamic-import resolution once.
// Lazy: devkit is deliberately excluded from the production esbuild bundle
// (see scripts/bundleServer.mjs `external` list). In production the dev
// branch below is never entered, so this import never runs and the bundle
// does not need devkit at all.
interface DevkitRuntimeMaps {
  devApis: RuntimeMapRecord;
  devSyncs: RuntimeMapRecord;
  devFunctions: RuntimeMapRecord;
}

let devkitModulePromise: Promise<DevkitRuntimeMaps> | null = null;

const getDevkit = async (): Promise<DevkitRuntimeMaps> => {
  devkitModulePromise ??= import('@luckystack/devkit') as Promise<DevkitRuntimeMaps>;
  return await devkitModulePromise;
};

const isRuntimeMapRecord = (value: unknown): value is RuntimeMapRecord => {
  return Boolean(value) && typeof value === 'object';
};

const normalizeGeneratedModule = (moduleValue: unknown): LoadedRuntimeMaps => {
  const moduleRecord = moduleValue && typeof moduleValue === 'object'
    ? (moduleValue as Record<string, unknown>)
    : {};

  const apiCandidate = moduleRecord.apis;
  const syncCandidate = moduleRecord.syncs;
  const functionCandidate = moduleRecord.functions;

  return {
    apisObject: isRuntimeMapRecord(apiCandidate) ? apiCandidate : {},
    syncObject: isRuntimeMapRecord(syncCandidate) ? syncCandidate : {},
    functionsObject: isRuntimeMapRecord(functionCandidate) ? functionCandidate : {},
  };
};

const loadProdRuntimeMaps = async (): Promise<LoadedRuntimeMaps> => {
  if (prodRuntimeMapsPromise) {
    return await prodRuntimeMapsPromise;
  }

  prodRuntimeMapsPromise = (async () => {
    const bundle = process.env.LUCKYSTACK_BUNDLE;
    const targetMap = bundle ? `./generatedApis.${bundle}` : `./generatedApis.default`;

    const generatedModule: unknown = await (import(targetMap) as Promise<unknown>).catch(() => null);

    if (!generatedModule) {
      if (!warnedAboutMissingGeneratedMaps) {
        warnedAboutMissingGeneratedMaps = true;
        console.log(`[runtimeMaps] target ${targetMap} not found, falling back to empty production route maps`, 'yellow');
      }

      return emptyRuntimeMaps;
    }

    return normalizeGeneratedModule(generatedModule);
  })();

  return await prodRuntimeMapsPromise;
};

export const getRuntimeApiMaps = async (): Promise<{
  apisObject: RuntimeMapRecord;
  functionsObject: RuntimeMapRecord;
}> => {
  if (env.NODE_ENV !== 'production') {
    const { devApis, devFunctions } = await getDevkit();
    return {
      apisObject: isRuntimeMapRecord(devApis) ? devApis : {},
      functionsObject: isRuntimeMapRecord(devFunctions) ? devFunctions : {},
    };
  }

  const { apisObject, functionsObject } = await loadProdRuntimeMaps();
  return { apisObject, functionsObject };
};

export const getRuntimeSyncMaps = async (): Promise<{
  syncObject: RuntimeMapRecord;
  functionsObject: RuntimeMapRecord;
}> => {
  if (env.NODE_ENV !== 'production') {
    const { devSyncs, devFunctions } = await getDevkit();
    return {
      syncObject: isRuntimeMapRecord(devSyncs) ? devSyncs : {},
      functionsObject: isRuntimeMapRecord(devFunctions) ? devFunctions : {},
    };
  }

  const { syncObject, functionsObject } = await loadProdRuntimeMaps();
  return { syncObject, functionsObject };
};

//? Register with the framework DI surface so @luckystack/api and
//? @luckystack/sync resolve runtime maps through core instead of deep-relative
//? imports. Side-effect on module load — the project's server.ts imports
//? this file (directly or transitively via handleHttpApiRequest) at startup.
registerRuntimeMapsProvider({ getRuntimeApiMaps, getRuntimeSyncMaps });

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

  const { apisObject, syncObject } = await loadProdRuntimeMaps();
  return {
    apiMap: apisObject,
    syncMap: syncObject,
  };
};
