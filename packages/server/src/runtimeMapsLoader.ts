//? Production runtime-maps loader shipped by the framework so consumers
//? don't have to maintain their own `server/prod/runtimeMaps.ts`. The
//? consumer only supplies a `loadGenerated` callback because dynamic-import
//? path resolution is module-scoped — the framework cannot resolve
//? `./generatedApis.<preset>` on the consumer's behalf.
//?
//? Dev branch lazy-imports `@luckystack/devkit` to pull the auto-discovered
//? api/sync/function maps. Devkit is excluded from the production bundle, so
//? this dynamic import is never reached when NODE_ENV === 'production'.

import {
  registerRuntimeMapsProvider,
  type RuntimeApiMapsResult,
  type RuntimeMapsProvider,
  type RuntimeSyncMapsResult,
} from '@luckystack/core';

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

export interface ProdRuntimeMapsLoaderOptions {
  /**
   * Dynamic-import callback for the generated maps module of a given preset.
   * Called once per preset per process lifetime; the result is cached.
   *
   * The resolved module must have shape `{ apis, syncs, functions }` (the
   * shape `scripts/generateServerRequests.ts` emits).
   *
   * Pass a function that calls `import()` with a path relative to YOUR
   * server-side module — the framework cannot resolve a relative path on
   * your behalf because dynamic-import resolution is module-scoped.
   *
   * @example
   * loadGenerated: (preset) => import(`./prod/generatedApis.${preset}`)
   */
  loadGenerated: (preset: string) => Promise<unknown>;
  /**
   * Override the env var name that selects the preset. Default
   * `LUCKYSTACK_BUNDLE`. Resolved to `'default'` when the env var is unset.
   */
  presetEnvVar?: string;
  /**
   * Override the literal preset name (skips env lookup). Useful in tests or
   * when the preset is read from a non-env source.
   */
  preset?: string;
  /**
   * Override the env var that determines dev vs prod mode. Default
   * `NODE_ENV`. Anything other than `'production'` uses the devkit branch.
   */
  nodeEnv?: string;
}

const resolvePreset = (options: ProdRuntimeMapsLoaderOptions): string => {
  if (options.preset && options.preset.length > 0) return options.preset;
  const envVar = options.presetEnvVar ?? 'LUCKYSTACK_BUNDLE';
  const fromEnv = process.env[envVar];
  return fromEnv && fromEnv.length > 0 ? fromEnv : 'default';
};

/**
 * Build a `RuntimeMapsProvider` that loads generated maps in production and
 * delegates to `@luckystack/devkit`'s discovery in dev. Same shape consumers
 * used to hand-roll in `server/prod/runtimeMaps.ts`.
 *
 * Call `registerRuntimeMapsProvider(...)` with the result, or use
 * `registerProdRuntimeMapsProvider(...)` (this module) to do both in one
 * step.
 */
export const createProdRuntimeMapsProvider = (
  options: ProdRuntimeMapsLoaderOptions,
): RuntimeMapsProvider => {
  let prodMapsPromise: Promise<LoadedRuntimeMaps> | null = null;
  let warnedAboutMissingGeneratedMaps = false;

  let devkitModulePromise: Promise<DevkitRuntimeMaps> | null = null;
  const getDevkit = async (): Promise<DevkitRuntimeMaps> => {
    devkitModulePromise ??= import('@luckystack/devkit') as Promise<DevkitRuntimeMaps>;
    return await devkitModulePromise;
  };

  const isProduction = (): boolean =>
    (process.env[options.nodeEnv ?? 'NODE_ENV']) === 'production';

  const loadProdRuntimeMaps = async (): Promise<LoadedRuntimeMaps> => {
    if (prodMapsPromise) return await prodMapsPromise;

    prodMapsPromise = (async () => {
      const preset = resolvePreset(options);
      const generatedModule: unknown = await options
        .loadGenerated(preset)
        .catch(() => null);

      if (!generatedModule) {
        if (!warnedAboutMissingGeneratedMaps) {
          warnedAboutMissingGeneratedMaps = true;
          console.warn(
            `[luckystack:runtimeMaps] preset "${preset}" failed to load — falling back to empty production maps. ` +
            `Every api/sync request will return notFound until the generated module resolves.`,
          );
        }
        return emptyRuntimeMaps;
      }

      return normalizeGeneratedModule(generatedModule);
    })();

    return await prodMapsPromise;
  };

  const getRuntimeApiMaps = async (): Promise<RuntimeApiMapsResult> => {
    if (!isProduction()) {
      const { devApis, devFunctions } = await getDevkit();
      return {
        apisObject: isRuntimeMapRecord(devApis) ? devApis : {},
        functionsObject: isRuntimeMapRecord(devFunctions) ? devFunctions : {},
      };
    }
    const { apisObject, functionsObject } = await loadProdRuntimeMaps();
    return { apisObject, functionsObject };
  };

  const getRuntimeSyncMaps = async (): Promise<RuntimeSyncMapsResult> => {
    if (!isProduction()) {
      const { devSyncs, devFunctions } = await getDevkit();
      return {
        syncObject: isRuntimeMapRecord(devSyncs) ? devSyncs : {},
        functionsObject: isRuntimeMapRecord(devFunctions) ? devFunctions : {},
      };
    }
    const { syncObject, functionsObject } = await loadProdRuntimeMaps();
    return { syncObject, functionsObject };
  };

  return { getRuntimeApiMaps, getRuntimeSyncMaps };
};

/**
 * Convenience wrapper around `createProdRuntimeMapsProvider` +
 * `registerRuntimeMapsProvider`. Most consumers want this — pass the
 * loader callback once and the runtime is wired.
 */
export const registerProdRuntimeMapsProvider = (
  options: ProdRuntimeMapsLoaderOptions,
): RuntimeMapsProvider => {
  const provider = createProdRuntimeMapsProvider(options);
  registerRuntimeMapsProvider(provider);
  return provider;
};
