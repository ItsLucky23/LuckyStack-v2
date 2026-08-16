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
