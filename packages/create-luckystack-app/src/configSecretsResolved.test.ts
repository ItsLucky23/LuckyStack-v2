import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['LUCKYSTACK_ENV', 'NODE_ENV', 'PUBLIC_URL', 'EXTERNAL_ORIGINS', 'SERVER_PORT'] as const;
const saved: Record<string, string | undefined> = {};

const loadCoreThenStub = async (values: Record<string, string>): Promise<void> => {
  await import('@luckystack/core');
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = saved[key];
    if (original === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = original;
  }
});

describe('scaffold config survives late secret resolution', () => {
  it('refreshes public/CORS/OAuth URLs while preserving the complete project policy', async () => {
    await loadCoreThenStub({
      LUCKYSTACK_ENV: 'production',
      PUBLIC_URL: 'PUBLIC_URL_BASE_V1',
      EXTERNAL_ORIGINS: 'ORIGINS_BASE_V1',
      SERVER_PORT: '80',
    });

    await import('../template/config');
    const { getProjectConfig, notifySecretsResolved } = await import('@luckystack/core');

    expect(getProjectConfig().app.publicUrl).toBe('PUBLIC_URL_BASE_V1');

    process.env.PUBLIC_URL = 'https://app.company.com';
    process.env.EXTERNAL_ORIGINS = 'https://external.company.com';
    notifySecretsResolved(['PUBLIC_URL', 'EXTERNAL_ORIGINS']);

    const refreshed = getProjectConfig();
    expect(refreshed.app.publicUrl).toBe('https://app.company.com');
    expect(refreshed.oauthCallbackBase).toBe('https://app.company.com');
    expect(refreshed.http.cors.allowedOrigins).toEqual([
      'https://app.company.com',
      'http://localhost:80',
      'https://external.company.com',
    ]);
    expect(refreshed.http.cors.allowLocalhost).toBe(false);
    expect(refreshed.rateLimiting.store).toBe('redis');
    expect(refreshed.session.perUser).toBe('single');
    expect(refreshed.auth.forgotPassword).toBe('framework');
    expect(refreshed.auth.credentials).toBe(true);
    expect(refreshed.loginRedirectUrl).toBe('/dashboard');
  });
});
