import { env } from '../bootstrap/env';
import { devApis, devFunctions, devSyncs } from '../dev/loader';

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
    const generatedModule: unknown = await (import('./' + 'generatedApis') as Promise<unknown>).catch(() => null);

    if (!generatedModule) {
      if (!warnedAboutMissingGeneratedMaps) {
        warnedAboutMissingGeneratedMaps = true;
        console.log('[runtimeMaps] server/prod/generatedApis.ts not found, falling back to empty production route maps', 'yellow');
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
    return {
      syncObject: isRuntimeMapRecord(devSyncs) ? devSyncs : {},
      functionsObject: isRuntimeMapRecord(devFunctions) ? devFunctions : {},
    };
  }

  const { syncObject, functionsObject } = await loadProdRuntimeMaps();
  return { syncObject, functionsObject };
};

export const getRuntimeReplMaps = async (): Promise<{
  apiMap: RuntimeMapRecord;
  syncMap: RuntimeMapRecord;
}> => {
  if (env.NODE_ENV !== 'production') {
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
