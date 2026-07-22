import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  resolveTestEnvironment: vi.fn(async (_input: unknown) => undefined),
}));

vi.mock('./resolveTestEnvironment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./resolveTestEnvironment')>();
  return {
    ...actual,
    resolveTestEnvironment: (input: unknown) => state.resolveTestEnvironment(input),
  };
});

vi.mock('@luckystack/core', () => ({
  getSrcDir: () => 'C:/definitely-not-a-real-luckystack-src',
  getCsrfConfig: () => ({ headerName: 'x-csrf-token' }),
  getPrismaClient: vi.fn(),
  getProjectConfig: () => ({ http: { sessionCookieName: 'session' } }),
  tryCatch: async <T>(fn: () => Promise<T>): Promise<[Error | null, T | null]> => {
    try {
      return [null, await fn()];
    } catch (error) {
      return [error instanceof Error ? error : new Error(String(error)), null];
    }
  },
  tryCatchSync: <T>(fn: () => T): [Error | null, T | null] => {
    try {
      return [null, fn()];
    } catch (error) {
      return [error instanceof Error ? error : new Error(String(error)), null];
    }
  },
}));

const {
  runCustomTests,
  runCustomTestsAfterEnvironmentPrepared,
} = await import('./customTests');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runCustomTests environment bootstrap', () => {
  it('fails closed when a JavaScript caller omits the required config loader', async () => {
    const withoutLoader = { baseUrl: 'http://localhost:80' };

    await expect(Reflect.apply(runCustomTests, undefined, [withoutLoader])).rejects.toThrow(
      'runCustomTests requires a lazy loadProjectConfig callback',
    );
    expect(state.resolveTestEnvironment).not.toHaveBeenCalled();
  });

  it('prepares env/secrets before direct Layer-5 discovery', async () => {
    const loadProjectConfig = vi.fn(() => ({ secretManager: { url: '' } }));

    await expect(runCustomTests({
      baseUrl: 'http://localhost:80',
      loadProjectConfig,
    })).resolves.toMatchObject({ total: 0, passed: 0, failed: 0 });

    expect(state.resolveTestEnvironment).toHaveBeenCalledWith({ loadProjectConfig });
  });

  it('does not reload pointer literals after runAllTests already prepared the process', async () => {
    await runCustomTestsAfterEnvironmentPrepared({
      baseUrl: 'http://localhost:80',
    });

    expect(state.resolveTestEnvironment).not.toHaveBeenCalled();
  });
});
