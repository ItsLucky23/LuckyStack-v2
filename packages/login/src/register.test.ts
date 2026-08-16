import { afterAll, describe, expect, it, vi } from 'vitest';

const { projectConfig } = vi.hoisted(() => ({
  projectConfig: {
    app: { publicUrl: 'https://generic.example.com' },
    oauthCallbackBase: '',
    auth: { credentials: false },
  },
}));

vi.mock('@luckystack/core', () => ({
  getProjectConfig: () => projectConfig,
  resolveEnvKey: () => 'production',
  tryCatch: vi.fn(),
}));

vi.mock('./userAdapter', () => ({
  isUserAdapterRegistered: () => true,
  registerUserAdapter: vi.fn(),
  defaultPrismaUserAdapter: vi.fn(),
}));

import { getOAuthProviders, isFullOAuthProvider } from './oauthProviders';
import './register';

describe('login env provider registration', () => {
  const savedClientId = process.env.GOOGLE_CLIENT_ID;
  const savedClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  it('falls back to app.publicUrl for a generic consumer without config.ports.ts', () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    projectConfig.oauthCallbackBase = '';

    const google = getOAuthProviders()
      .filter(isFullOAuthProvider)
      .find((provider) => provider.name === 'google');

    expect(google?.callbackURL).toBe('https://generic.example.com/auth/callback/google');
  });

  afterAll(() => {
    if (savedClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = savedClientId;
    if (savedClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = savedClientSecret;
  });
});
