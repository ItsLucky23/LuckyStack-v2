import { afterEach, describe, expect, it, vi } from 'vitest';
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
