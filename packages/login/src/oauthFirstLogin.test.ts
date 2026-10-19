import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

//? Finding 007: the M2 account-creation guard refuses an OAuth sign-up whose
//? email the provider did not positively verify. GitHub's `/user` public email
//? and Microsoft's Graph `mail` carry no verified flag, so new users of those
//? built-ins were refused, while Microsoft's UPN fallback was wrongly trusted.
//? These tests drive the real `loginCallback` (state → token exchange →
//? profile → find-or-create) for every built-in provider, with Redis, the
//? session store, the user adapter and `fetch` replaced by in-memory fakes.

const { store, configMock, adapterMock, saveSessionMock } = vi.hoisted(() => {
  const backing = new Map<string, string>();
  return {
    store: backing,
    configMock: vi.fn(),
    adapterMock: {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(async () => null),
    },
    saveSessionMock: vi.fn(async () => ({ ok: true })),
  };
});

vi.mock('@luckystack/core', () => {
  const tryCatch = async (fn: () => unknown) => {
    try { return [null, await fn()]; } catch (error) { return [error, null]; }
  };
  const tryCatchSync = (fn: () => unknown) => {
    try { return [null, fn()]; } catch (error) { return [error, null]; }
  };
  return {
    tryCatch,
    tryCatchSync,
    redis: {
      set: async (key: string, value: string) => { store.set(key, value); return 'OK'; },
      multi: () => {
        let key = '';
        const chain = {
          get: (k: string) => { key = k; return chain; },
          del: () => chain,
          exec: async () => {
            const value = store.get(key) ?? null;
            store.delete(key);
            return [[null, value], [null, value === null ? 0 : 1]];
          },
        };
        return chain;
      },
    },
    getUploadsDir: () => '/nonexistent-uploads',
    dispatchHook: vi.fn(async () => ({ stopped: false })),
    getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    formatKey: (namespace: string, suffix: string) => `test${namespace}:${suffix}`,
    getProjectConfig: () => configMock(),
    getCookieValue: (header: string | undefined, name: string) => {
      const match = (header ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
      return match ? match.slice(name.length + 1) : null;
    },
    resolveDevCallbackUrl: (url: string) => url,
  };
});

vi.mock('./session', () => ({ saveSession: saveSessionMock }));
vi.mock('./userAdapter', () => ({ getUserAdapter: () => adapterMock }));

import { createOAuthState, loginCallback } from './login';
import {
  discordProvider,
  facebookProvider,
  githubProvider,
  googleProvider,
  microsoftProvider,
  registerOAuthProviders,
  type FullOAuthProvider,
} from './oauthProviders';

const helperInput = (name: string) => ({
  clientId: 'client-id',
  clientSecret: 'client-secret',
  callbackUrl: `https://app.test/auth/callback/${name}`,
});

//? Route every provider request to a canned JSON body by URL prefix.
const stubFetch = (routes: Record<string, unknown>): void => {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const match = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => input.startsWith(prefix));
    if (!match) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(routes[match]), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
};

const runCallback = async (provider: FullOAuthProvider) => {
  registerOAuthProviders([{ name: 'credentials' }, provider]);
  const state = await createOAuthState(provider.name);
  if (!state) throw new Error('state not created');
  const req = new IncomingMessage(new Socket());
  req.url = `/auth/callback/${provider.name}?code=the-code&state=${state.state}`;
  req.headers.cookie = `ls-oauth-state=${state.stateCookie}`;
  return loginCallback(`/auth/callback/${provider.name}`, req, new ServerResponse(req));
};

const createdEmail = (): string | undefined => {
  const call = adapterMock.create.mock.calls[0] as [{ email: string }] | undefined;
  return call?.[0].email;
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  configMock.mockReturnValue({
    auth: { oauthStateTtlSeconds: 600, allowRegistration: true, providerAccountStrategy: 'per-provider' },
    defaultLanguage: 'en',
    logging: { devLogs: false },
    loginRedirectUrl: '/dashboard',
    http: { cors: { allowLocalhost: false, allowedOrigins: [] } },
  });
  adapterMock.findByEmail.mockResolvedValue(null);
  adapterMock.create.mockImplementation(async (input: { email: string; provider: string }) => ({
    id: 'new-user',
    name: 'New User',
    ...input,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OAuth first-login account creation per built-in provider (007)', () => {
  it('google: a verified email creates the account', async () => {
    const provider = googleProvider(helperInput('google'));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { name: 'Ada', email: 'Ada@Example.com', email_verified: true },
    });
    const result = await runCallback(provider);
    expect(result && result.isNewUser).toBe(true);
    expect(createdEmail()).toBe('ada@example.com');
  });

  it('github: a user WITH a public profile email is created (resolved through /user/emails)', async () => {
    const provider = githubProvider(helperInput('github'));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { login: 'octo', email: 'public@octo.dev' },
      'https://api.github.com/user/emails': [
        { email: 'primary@octo.dev', primary: true, verified: true },
        { email: 'public@octo.dev', primary: false, verified: true },
      ],
    });
    const result = await runCallback(provider);
    expect(result && result.isNewUser).toBe(true);
    //? The verified public email wins so accounts keyed on it keep matching.
    expect(createdEmail()).toBe('public@octo.dev');
  });

  it('github: a public email that is not in the verified list is ignored for the verified primary', async () => {
    const provider = githubProvider(helperInput('github'));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { login: 'octo', email: 'victim@corp.test' },
      'https://api.github.com/user/emails': [
        { email: 'victim@corp.test', primary: false, verified: false },
        { email: 'primary@octo.dev', primary: true, verified: true },
      ],
    });
    const result = await runCallback(provider);
    expect(result && result.isNewUser).toBe(true);
    expect(createdEmail()).toBe('primary@octo.dev');
  });

  it('github: a user without a public email is created from the verified primary', async () => {
    const provider = githubProvider(helperInput('github'));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { login: 'octo', email: null },
      'https://api.github.com/user/emails': [{ email: 'primary@octo.dev', primary: true, verified: true }],
    });
    const result = await runCallback(provider);
    expect(result && result.isNewUser).toBe(true);
    expect(createdEmail()).toBe('primary@octo.dev');
  });

  it('discord: a verified email creates the account', async () => {
    const provider = discordProvider(helperInput('discord'));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { id: '1', username: 'disc', email: 'disc@example.com', verified: true },
    });
    const result = await runCallback(provider);
    expect(result && result.isNewUser).toBe(true);
    expect(createdEmail()).toBe('disc@example.com');
  });

  it('facebook: a returned (confirmed) email creates the account', async () => {
    const provider = facebookProvider(helperInput('facebook'));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      'https://graph.facebook.com/me': { id: '1', name: 'Fb', email: 'fb@example.com' },
    });
    const result = await runCallback(provider);
    expect(result && result.isNewUser).toBe(true);
    expect(createdEmail()).toBe('fb@example.com');
  });

  it('microsoft (single tenant): the Graph mail creates the account', async () => {
    const provider = microsoftProvider({ ...helperInput('microsoft'), tenant: '11111111-2222-3333-4444-555555555555' });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { id: 'ms-1', displayName: 'Ms', mail: 'alice@contoso.com' },
    });
    const result = await runCallback(provider);
    expect(result && result.isNewUser).toBe(true);
    expect(createdEmail()).toBe('alice@contoso.com');
  });

  it('microsoft (common tenant): a new user is refused on purpose (any tenant can assert any mail)', async () => {
    const provider = microsoftProvider(helperInput('microsoft'));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { id: 'ms-1', displayName: 'Ms', mail: 'alice@contoso.com' },
    });
    expect(await runCallback(provider)).toBe(false);
    expect(adapterMock.create).not.toHaveBeenCalled();
  });

  it('microsoft (common tenant): an EXISTING Microsoft account still signs in', async () => {
    const provider = microsoftProvider(helperInput('microsoft'));
    adapterMock.findByEmail.mockResolvedValue({ id: 'existing', email: 'alice@contoso.com', provider: 'microsoft', name: 'Alice' });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { id: 'ms-1', displayName: 'Ms', mail: 'alice@contoso.com' },
    });
    const result = await runCallback(provider);
    expect(result && result.isNewUser).toBe(false);
    expect(result && result.userId).toBe('existing');
  });

  it('microsoft: the userPrincipalName fallback never creates an account, even single-tenant', async () => {
    const provider = microsoftProvider({
      ...helperInput('microsoft'),
      tenant: 'contoso.onmicrosoft.com',
      allowUpnFallback: true,
    });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { id: 'ms-1', displayName: 'Ms', mail: null, userPrincipalName: 'alice@contoso.onmicrosoft.com' },
    });
    expect(await runCallback(provider)).toBe(false);
    expect(adapterMock.create).not.toHaveBeenCalled();
  });
});
