import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

//? REGRESSION (sweep 062) — against this project's REAL `config.ts`. Dev mode
//? used to come from the DNS map, and any origin missing from that map fell
//? back to the localhost dev entry: a production deployment on an unlisted
//? domain accepted every localhost origin in CORS and sent OAuth callbacks to
//? `http://localhost:<port>`. ADR 0040: dev/prod follows NODE_ENV.

const ENV_KEYS = ['NODE_ENV', 'DNS', 'EXTERNAL_ORIGINS'] as const;
const saved: Record<string, string | undefined> = {};

//? Core's env bootstrap loads `.env` / `.env.local` with override; load it
//? first, then stub (see configSecretsResolved.test.ts for why).
const importConfigWith = async (values: Record<string, string>) => {
  await import('@luckystack/core');
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  const configModule = await import('../config');
  const { getProjectConfig } = await import('@luckystack/core');
  return { configModule, projectConfig: getProjectConfig() };
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

describe('config.ts runtime mode (sweep 062)', () => {
  it('fails closed for a production deployment on an origin missing from the DNS map', async () => {
    const { configModule, projectConfig } = await importConfigWith({
      NODE_ENV: 'production',
      DNS: 'https://myapp.example.com',
      EXTERNAL_ORIGINS: '',
    });

    expect(configModule.dev).toBe(false);
    expect(projectConfig.http.cors.allowLocalhost).toBe(false);
    expect(projectConfig.oauthCallbackBase).toBe('https://myapp.example.com');
    expect(configModule.backendUrl).toBe('https://myapp.example.com');
    expect(projectConfig.session.perUser).toBe('single');
  });

  it('stays in dev mode for an unlisted origin when NODE_ENV is not production', async () => {
    //? e.g. a preview URL in front of a dev server keeps the local settings.
    const { configModule, projectConfig } = await importConfigWith({
      NODE_ENV: 'development',
      DNS: 'https://preview.example.com',
      EXTERNAL_ORIGINS: '',
    });

    expect(configModule.dev).toBe(true);
    expect(projectConfig.http.cors.allowLocalhost).toBe(true);
    expect(projectConfig.oauthCallbackBase).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it('does not treat a listed localhost origin as dev under NODE_ENV=production', async () => {
    const { configModule, projectConfig } = await importConfigWith({
      NODE_ENV: 'production',
      DNS: 'http://localhost:5173',
      EXTERNAL_ORIGINS: '',
    });

    expect(configModule.dev).toBe(false);
    expect(projectConfig.http.cors.allowLocalhost).toBe(false);
  });
});
