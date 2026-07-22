import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  order: [] as string[],
  loadEnvFiles: vi.fn(),
  initSecretManager: vi.fn(),
}));

vi.mock('@luckystack/core', () => ({
  loadEnvFiles: () => {
    state.order.push('env');
    state.loadEnvFiles();
  },
  tryCatch: async <T>(fn: () => Promise<T>): Promise<[Error | null, T | null]> =>
    Promise.resolve()
      .then(fn)
      .then(
        (result): [null, T] => [null, result],
        (error: unknown): [Error, null] => [
          error instanceof Error ? error : new Error(String(error)),
          null,
        ],
      ),
}));

vi.mock('@luckystack/secret-manager', () => ({
  initSecretManager: (config: unknown) => {
    state.order.push('secret');
    state.initSecretManager(config);
    return Promise.resolve();
  },
}));

const { resolveTestEnvironment } = await import('./resolveTestEnvironment');

beforeEach(() => {
  state.order.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveTestEnvironment', () => {
  it('loads env files before loading project config and resolving secrets', async () => {
    await resolveTestEnvironment({
      loadProjectConfig: () => {
        state.order.push('config');
        return {
          secretManager: {
            url: 'http://127.0.0.1:4000',
            token: { fromFile: '.secret-manager-token' },
            envNames: ['DATABASE_URL'],
            source: 'hybrid',
          },
        };
      },
    });

    expect(state.order).toStrictEqual(['env', 'config', 'secret']);
    expect(state.initSecretManager).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:4000',
      token: { fromFile: '.secret-manager-token' },
      envNames: ['DATABASE_URL'],
      source: 'remote',
    });
  });

  it('only loads env files when no secret manager is configured', async () => {
    await resolveTestEnvironment({ loadProjectConfig: () => ({}) });

    expect(state.loadEnvFiles).toHaveBeenCalledTimes(1);
    expect(state.initSecretManager).not.toHaveBeenCalled();
  });

  it('does not contact the secret manager when its URL is empty', async () => {
    await resolveTestEnvironment({
      loadProjectConfig: () => ({
        secretManager: { url: '', token: { fromFile: '.secret-manager-token' } },
      }),
    });

    expect(state.initSecretManager).not.toHaveBeenCalled();
  });

  it('fails before test execution when a configured resolver has no valid token', async () => {
    await expect(resolveTestEnvironment({
      loadProjectConfig: () => ({
        secretManager: { url: 'https://secrets.example.com' },
      }),
    })).rejects.toThrow('config.secretManager.token');

    expect(state.initSecretManager).not.toHaveBeenCalled();
  });
});
