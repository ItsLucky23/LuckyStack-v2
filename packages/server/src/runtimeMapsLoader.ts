//? Production runtime-maps loader shipped by the framework so consumers
//? don't have to maintain their own `server/prod/runtimeMaps.ts`. The
//? consumer only supplies a `loadGenerated` callback because dynamic-import
//? path resolution is module-scoped — the framework cannot resolve
//? `./generatedApis.<preset>` on the consumer's behalf.
//?
//? Multiple presets can be loaded into a single process by passing a
//? comma-separated list as the first positional argv (parsed by
//? `@luckystack/server/parseArgv`). All resolved maps are shallow-merged
//? into one runtime view; collisions throw at boot (services own one
//? preset by design, see docs/ARCHITECTURE_PACKAGING.md §10).
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
import { getParsedBundles } from './argv';

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
   * Override the preset(s) to load. Skips the argv lookup. Accepts a single
   * preset name or an array. Useful in tests or when the preset list comes
   * from a non-argv source.
   */
  preset?: string | string[];
}

const resolvePresets = (options: ProdRuntimeMapsLoaderOptions): string[] => {
  const fromOptions = options.preset;
  if (typeof fromOptions === 'string' && fromOptions.length > 0) {
    return [fromOptions];
  }
  if (Array.isArray(fromOptions) && fromOptions.length > 0) {
    return Array.from(new Set(fromOptions));
  }
  const fromArgv = getParsedBundles();
  if (fromArgv.length > 0) {
    return fromArgv;
  }
  return ['default'];
};

const mergeInto = (
  target: RuntimeMapRecord,
  source: RuntimeMapRecord,
  kind: 'api' | 'sync' | 'function',
  fromPreset: string,
  keyOrigin: Map<string, string>,
): void => {
  for (const key of Object.keys(source)) {
    const previousPreset = keyOrigin.get(key);
    if (previousPreset !== undefined && previousPreset !== fromPreset) {
      throw new Error(
        `[luckystack:runtimeMaps] ${kind} key collision: "${key}" present in both ` +
        `preset "${previousPreset}" and preset "${fromPreset}". ` +
        `Services must belong to exactly one preset (see docs/ARCHITECTURE_PACKAGING.md §10).`,
      );
    }
    keyOrigin.set(key, fromPreset);
    target[key] = source[key];
  }
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

  let devkitModulePromise: Promise<DevkitRuntimeMaps> | null = null;
  const getDevkit = async (): Promise<DevkitRuntimeMaps> => {
    devkitModulePromise ??= import('@luckystack/devkit') as Promise<DevkitRuntimeMaps>;
    return await devkitModulePromise;
  };

  const isProduction = (): boolean => process.env.NODE_ENV === 'production';

  const loadProdRuntimeMaps = async (): Promise<LoadedRuntimeMaps> => {
    if (prodMapsPromise) return await prodMapsPromise;

    prodMapsPromise = (async () => {
      const presets = resolvePresets(options);
      const merged: LoadedRuntimeMaps = {
        apisObject: {},
        syncObject: {},
        functionsObject: {},
      };
      const apiOrigin = new Map<string, string>();
      const syncOrigin = new Map<string, string>();
      const functionOrigin = new Map<string, string>();

      const loadedModules = await Promise.all(
        presets.map(async (preset) => ({
          preset,
          mod: await options.loadGenerated(preset).catch(() => null),
        })),
      );

      let loadedAny = false;
      for (const { preset, mod } of loadedModules) {
        if (!mod) {
          console.warn(
            `[luckystack:runtimeMaps] preset "${preset}" failed to load — skipping. ` +
            `Calls owned by that preset will return notFound until the generated module resolves.`,
          );
          continue;
        }
        loadedAny = true;
        const normalized = normalizeGeneratedModule(mod);
        mergeInto(merged.apisObject, normalized.apisObject, 'api', preset, apiOrigin);
        mergeInto(merged.syncObject, normalized.syncObject, 'sync', preset, syncOrigin);
        mergeInto(merged.functionsObject, normalized.functionsObject, 'function', preset, functionOrigin);
      }

      if (!loadedAny) {
        console.warn(
          `[luckystack:runtimeMaps] no presets resolved (tried: ${presets.join(', ')}). ` +
          `Every api/sync request will return notFound until at least one generated module loads.`,
        );
        return emptyRuntimeMaps;
      }

      return merged;
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
