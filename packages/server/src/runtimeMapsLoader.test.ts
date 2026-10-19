import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerLogger, resetLoggerForTests } from '@luckystack/core';
import { createProdRuntimeMapsProvider } from './runtimeMapsLoader';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createProdRuntimeMapsProvider composed presets', () => {
  it('merges disjoint routes when generated presets repeat the equivalent function registry', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const sharedFunction = vi.fn();
    const modules = {
      system: {
        apis: { 'api/system/session/v1': { main: vi.fn() } },
        syncs: {},
        functions: { session: { getSession: sharedFunction } },
      },
      admin: {
        apis: { 'api/admin/users/v1': { main: vi.fn() } },
        syncs: {},
        functions: { session: { getSession: sharedFunction } },
      },
    };
    const provider = createProdRuntimeMapsProvider({
      preset: ['system', 'admin'],
      loadGenerated: async (preset) => modules[preset as keyof typeof modules],
    });

    const result = await provider.getRuntimeApiMaps();

    expect(Object.keys(result.apisObject)).toEqual([
      'api/system/session/v1',
      'api/admin/users/v1',
    ]);
    expect(result.functionsObject.session).toEqual({ getSession: sharedFunction });
  });

  it('rejects a duplicated function key when the generated implementations differ', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const provider = createProdRuntimeMapsProvider({
      preset: ['system', 'admin'],
      loadGenerated: async (preset) => ({
        apis: {},
        syncs: {},
        functions: { session: { getSession: preset === 'system' ? vi.fn() : vi.fn() } },
      }),
    });

    await expect(provider.getRuntimeApiMaps()).rejects.toThrow(
      'function key collision: "session" present in both preset "system" and preset "admin"',
    );
  });

  it('merges a repeated NESTED function namespace across presets', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const engineFunction = vi.fn();
    //? `shared/rbac/engine.ts` lands under an `rbac` namespace. Each generated
    //? preset builds its own fresh wrapper objects around the same ESM exports,
    //? so equivalence must be checked structurally all the way down — a shallow
    //? per-key `Object.is` sees two different `rbac` objects and fails the boot.
    const generatedFor = () => ({
      apis: {},
      syncs: {},
      functions: { rbac: { engine: { evaluate: engineFunction } } },
    });
    const provider = createProdRuntimeMapsProvider({
      preset: ['system', 'admin'],
      loadGenerated: async () => generatedFor(),
    });

    const result = await provider.getRuntimeApiMaps();

    expect(result.functionsObject.rbac).toEqual({ engine: { evaluate: engineFunction } });
  });

  it('still rejects a nested function namespace whose leaf implementation differs', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const provider = createProdRuntimeMapsProvider({
      preset: ['system', 'admin'],
      loadGenerated: async () => ({
        apis: {},
        syncs: {},
        functions: { rbac: { engine: { evaluate: vi.fn() } } },
      }),
    });

    await expect(provider.getRuntimeApiMaps()).rejects.toThrow(
      'function key collision: "rbac" present in both preset "system" and preset "admin"',
    );
  });

  it('continues to reject duplicated route ownership across presets', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const provider = createProdRuntimeMapsProvider({
      preset: ['system', 'admin'],
      loadGenerated: async () => ({
        apis: { 'api/system/session/v1': { main: vi.fn() } },
        syncs: {},
        functions: {},
      }),
    });

    await expect(provider.getRuntimeApiMaps()).rejects.toThrow(
      'api key collision: "api/system/session/v1" present in both preset "system" and preset "admin"',
    );
  });
});

describe('createProdRuntimeMapsProvider failed preset load (finding 085)', () => {
  afterEach(() => {
    resetLoggerForTests();
  });

  it('logs the real cause once and retries the load on the next request', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    registerLogger(logger);
    const cause = new Error('Cannot find module ./generated/billing');
    const loadGenerated = vi.fn()
      .mockRejectedValueOnce(cause)
      .mockRejectedValueOnce(cause)
      .mockResolvedValue({ apis: { 'api/billing/pay/v1': { main: vi.fn() } }, syncs: {}, functions: {} });
    const provider = createProdRuntimeMapsProvider({ preset: ['billing'], loadGenerated });

    expect(Object.keys((await provider.getRuntimeApiMaps()).apisObject)).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('preset "billing" failed to load'), cause);

    //? Second request retries (not cached) and does not repeat the error log.
    expect(Object.keys((await provider.getRuntimeApiMaps()).apisObject)).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);

    //? Third request: the module now resolves and its routes are served.
    expect(Object.keys((await provider.getRuntimeApiMaps()).apisObject)).toEqual(['api/billing/pay/v1']);
    expect(loadGenerated).toHaveBeenCalledTimes(3);

    //? A fully successful load is cached.
    await provider.getRuntimeApiMaps();
    expect(loadGenerated).toHaveBeenCalledTimes(3);
  });
});
