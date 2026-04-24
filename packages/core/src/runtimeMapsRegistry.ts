//? DI surface for generated runtime route maps. The project's
//? `server/prod/runtimeMaps.ts` knows how to dynamically import per-preset
//? `generatedApis.<preset>.ts` files and merge devkit overrides — framework
//? packages don't. They ask core for the current maps at request time, and
//? core delegates to whichever provider was registered on boot.
//?
//? Registration is a side effect of the project importing its own runtimeMaps
//? module. Default (unregistered) returns empty maps so framework code can
//? boot in tests without crashing.

type RuntimeMapRecord = Record<string, unknown>;

export interface RuntimeApiMapsResult {
  apisObject: RuntimeMapRecord;
  functionsObject: RuntimeMapRecord;
}

export interface RuntimeSyncMapsResult {
  syncObject: RuntimeMapRecord;
  functionsObject: RuntimeMapRecord;
}

export interface RuntimeMapsProvider {
  getRuntimeApiMaps: () => Promise<RuntimeApiMapsResult>;
  getRuntimeSyncMaps: () => Promise<RuntimeSyncMapsResult>;
}

const emptyApi: RuntimeApiMapsResult = { apisObject: {}, functionsObject: {} };
const emptySync: RuntimeSyncMapsResult = { syncObject: {}, functionsObject: {} };

let activeProvider: RuntimeMapsProvider = {
  getRuntimeApiMaps: async () => emptyApi,
  getRuntimeSyncMaps: async () => emptySync,
};

export const registerRuntimeMapsProvider = (provider: RuntimeMapsProvider): void => {
  activeProvider = provider;
};

export const getRuntimeApiMaps = async (): Promise<RuntimeApiMapsResult> =>
  activeProvider.getRuntimeApiMaps();

export const getRuntimeSyncMaps = async (): Promise<RuntimeSyncMapsResult> =>
  activeProvider.getRuntimeSyncMaps();
