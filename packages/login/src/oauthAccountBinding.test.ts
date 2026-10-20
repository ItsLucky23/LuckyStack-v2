import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

//? ADR 0086: OAuth accounts are bound to the provider's stable user id. Under a
//? multi-tenant Microsoft app any tenant admin can set Graph `mail` to a
//? victim's address; matching by (email, provider) alone handed them the
//? victim's session. These tests drive the real `loginCallback` with Redis, the
//? session store, the user adapter and `fetch` replaced by in-memory fakes (the
//? same harness as oauthFirstLogin.test.ts).

const { store, configMock, adapterMock, saveSessionMock, logger } = vi.hoisted(() => {
  const backing = new Map<string, string>();
  return {
    store: backing,
    configMock: vi.fn(),
    adapterMock: {
      findByEmail: vi.fn(),
      findByEmailAnyProvider: vi.fn(),
      findByProviderAccountId: vi.fn() as ReturnType<typeof vi.fn> | undefined,
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(async () => null),
    },
    saveSessionMock: vi.fn(async () => ({ ok: true })),
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
    getLogger: () => logger,
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

import { dispatchHook } from '@luckystack/core';
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

const setStrategy = (providerAccountStrategy: 'per-provider' | 'unified'): void => {
  configMock.mockReturnValue({
    auth: { oauthStateTtlSeconds: 600, allowRegistration: true, providerAccountStrategy },
    defaultLanguage: 'en',
    logging: { devLogs: false },
    loginRedirectUrl: '/dashboard',
    http: { cors: { allowLocalhost: false, allowedOrigins: [] } },
  });
};

const warned = (fragment: string): boolean =>
  logger.warn.mock.calls.some((call: unknown[]) => typeof call[0] === 'string' && call[0].includes(fragment));

const hookPayloads = (name: string): unknown[] =>
  (vi.mocked(dispatchHook).mock.calls as unknown[][])
    .filter((call) => call[0] === name)
    .map((call) => call[1]);

const savedSession = (): Record<string, unknown> =>
  ((saveSessionMock.mock.calls as unknown[][])[0]?.[1] ?? {}) as Record<string, unknown>;

const bindCalls = (): unknown[] =>
  adapterMock.update.mock.calls.filter((call: unknown[]) => {
    const patch = call[1];
    return typeof patch === 'object' && patch !== null && 'providerAccountId' in patch;
  });

//? Multi-tenant Microsoft: Graph `mail` is unverified, the object id is not.
const microsoftCommon = () => microsoftProvider(helperInput('microsoft'));
const msUserInfo = (id: string, mail: string) => ({ id, displayName: 'Ms', mail });

const victimRow = (extra: Record<string, unknown> = {}) => ({
  id: 'victim', email: 'victim@contoso.com', provider: 'microsoft', name: 'Victim', ...extra,
});

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  setStrategy('per-provider');
  adapterMock.findByProviderAccountId = vi.fn(async () => null);
  adapterMock.findByEmail.mockResolvedValue(null);
  adapterMock.findByEmailAnyProvider.mockResolvedValue(null);
  adapterMock.create.mockImplementation(async (input: { email: string; provider: string }) => ({
    id: 'new-user',
    name: 'New User',
    ...input,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OAuth account binding: the nOAuth takeover (ADR 0086)', () => {
  it('an unverified email cannot claim an unbound account', async () => {
    const provider = microsoftCommon();
    adapterMock.findByEmail.mockResolvedValue(victimRow());
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: msUserInfo('attacker-oid', 'victim@contoso.com'),
    });
    expect(await runCallback(provider)).toBe(false);
    expect(warned('not bound to a provider id yet')).toBe(true);
    expect(bindCalls()).toHaveLength(0);
  });

  it('an unverified email cannot sign in to an account bound to a different provider id', async () => {
    const provider = microsoftCommon();
    adapterMock.findByEmail.mockResolvedValue(victimRow({ providerAccountId: 'victim-oid' }));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: msUserInfo('attacker-oid', 'victim@contoso.com'),
    });
    expect(await runCallback(provider)).toBe(false);
    expect(warned('bound to a different provider account')).toBe(true);
    expect(adapterMock.findByProviderAccountId).toHaveBeenCalledWith({ provider: 'microsoft', providerAccountId: 'attacker-oid' });
  });

  it('even a verified email cannot sign in to an account bound to a different provider id', async () => {
    const provider = googleProvider(helperInput('google'));
    adapterMock.findByEmail.mockResolvedValue({ id: 'victim', email: 'v@example.com', provider: 'google', providerAccountId: 'sub-victim' });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { sub: 'sub-other', name: 'O', email: 'v@example.com', email_verified: true },
    });
    expect(await runCallback(provider)).toBe(false);
    expect(adapterMock.create).not.toHaveBeenCalled();
  });

  it('a multi-tenant Microsoft account bound to its object id signs in', async () => {
    const provider = microsoftCommon();
    adapterMock.findByProviderAccountId = vi.fn(async () => victimRow({ providerAccountId: 'victim-oid' }));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: msUserInfo('victim-oid', 'victim@contoso.com'),
    });
    const result = await runCallback(provider);
    expect(result && result.userId).toBe('victim');
    expect(adapterMock.findByEmail).not.toHaveBeenCalled();
  });
});

describe('OAuth account binding: lookup order and binding (ADR 0086)', () => {
  it('a bound login whose email changed at the provider lands in the same account, email kept', async () => {
    const provider = googleProvider(helperInput('google'));
    adapterMock.findByProviderAccountId = vi.fn(async () => ({
      id: 'ada', email: 'ada@old.example', provider: 'google', name: 'Ada', providerAccountId: 'sub-ada',
    }));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { sub: 'sub-ada', name: 'Ada', email: 'ada@new.example', email_verified: true },
    });
    const result = await runCallback(provider);
    expect(result && result.userId).toBe('ada');
    expect(result && result.isNewUser).toBe(false);
    expect(adapterMock.findByEmail).not.toHaveBeenCalled();
    expect(adapterMock.create).not.toHaveBeenCalled();
    //? Only `lastLogin` is written; the stored email stays.
    for (const call of adapterMock.update.mock.calls as unknown[][]) {
      expect(Object.keys(call[1] as object)).toEqual(['lastLogin']);
    }
  });

  it('an unbound account with a verified email is bound on this login', async () => {
    const provider = githubProvider(helperInput('github'));
    adapterMock.findByEmail.mockResolvedValue({ id: 'octo', email: 'octo@example.com', provider: 'github', name: 'Octo' });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { id: 583231, login: 'octo' },
      'https://api.github.com/user/emails': [{ email: 'octo@example.com', primary: true, verified: true }],
    });
    const result = await runCallback(provider);
    expect(result && result.userId).toBe('octo');
    expect(adapterMock.update).toHaveBeenCalledWith('octo', { providerAccountId: '583231' });
  });

  it('a failed bind refuses the login instead of signing in unbound', async () => {
    const provider = githubProvider(helperInput('github'));
    adapterMock.findByEmail.mockResolvedValue({ id: 'octo', email: 'octo@example.com', provider: 'github', name: 'Octo' });
    adapterMock.update.mockRejectedValueOnce(new Error('unknown column providerAccountId'));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { id: 583231, login: 'octo' },
      'https://api.github.com/user/emails': [{ email: 'octo@example.com', primary: true, verified: true }],
    });
    expect(await runCallback(provider)).toBe(false);
  });

  it('a userinfo response without the declared id is refused', async () => {
    const provider = googleProvider(helperInput('google'));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { name: 'Ada', email: 'ada@example.com', email_verified: true },
    });
    expect(await runCallback(provider)).toBe(false);
    expect(adapterMock.findByEmail).not.toHaveBeenCalled();
    expect(adapterMock.create).not.toHaveBeenCalled();
  });

  it('a custom provider without accountIdKey keeps email-only matching', async () => {
    const provider: FullOAuthProvider = {
      name: 'okta',
      clientID: 'c',
      clientSecret: 's',
      callbackURL: 'https://app.test/auth/callback/okta',
      authorizationURL: 'https://okta.test/authorize',
      tokenExchangeURL: 'https://okta.test/token',
      tokenExchangeMethod: 'json',
      userInfoURL: 'https://okta.test/userinfo',
      scope: ['openid', 'email'],
      nameKey: 'name',
      emailKey: 'email',
      avatarCodeKey: '',
    };
    adapterMock.findByEmail.mockResolvedValue({ id: 'existing', email: 'a@okta.test', provider: 'okta', name: 'A' });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { name: 'A', email: 'a@okta.test' },
    });
    const result = await runCallback(provider);
    expect(result && result.userId).toBe('existing');
    expect(adapterMock.findByProviderAccountId).not.toHaveBeenCalled();
    expect(bindCalls()).toHaveLength(0);
  });
});

describe('OAuth account binding: each built-in stores its stable id on a new account (ADR 0086)', () => {
  it.each([
    {
      name: 'google',
      build: () => googleProvider(helperInput('google')),
      routes: (p: FullOAuthProvider) => ({
        [p.userInfoURL]: { sub: '110169484474386276334', name: 'G', email: 'g@example.com', email_verified: true },
      }),
      expected: '110169484474386276334',
    },
    {
      name: 'github',
      build: () => githubProvider(helperInput('github')),
      routes: (p: FullOAuthProvider) => ({
        [p.userInfoURL]: { id: 583231, login: 'octo' },
        'https://api.github.com/user/emails': [{ email: 'octo@example.com', primary: true, verified: true }],
      }),
      expected: '583231',
    },
    {
      name: 'discord',
      build: () => discordProvider(helperInput('discord')),
      routes: (p: FullOAuthProvider) => ({
        [p.userInfoURL]: { id: '80351110224678912', username: 'd', email: 'd@example.com', verified: true },
      }),
      expected: '80351110224678912',
    },
    {
      name: 'facebook',
      build: () => facebookProvider(helperInput('facebook')),
      routes: () => ({ 'https://graph.facebook.com/me': { id: '10158', name: 'F', email: 'f@example.com' } }),
      expected: '10158',
    },
    {
      name: 'microsoft',
      build: () => microsoftProvider({ ...helperInput('microsoft'), tenant: 'contoso.onmicrosoft.com' }),
      routes: (p: FullOAuthProvider) => ({
        [p.userInfoURL]: msUserInfo('7c0b2a3e-0d5b-4c1e-9b51-1f1f1f1f1f1f', 'alice@contoso.com'),
      }),
      expected: '7c0b2a3e-0d5b-4c1e-9b51-1f1f1f1f1f1f',
    },
  ])('$name', async ({ build, routes, expected }) => {
    const provider = build();
    stubFetch({ [provider.tokenExchangeURL]: { access_token: 'at' }, ...routes(provider) });
    const result = await runCallback(provider);
    expect(result && result.isNewUser).toBe(true);
    expect(adapterMock.findByProviderAccountId).toHaveBeenCalledWith({ provider: provider.name, providerAccountId: expected });
    expect(adapterMock.create.mock.calls[0]?.[0]).toMatchObject({ provider: provider.name, providerAccountId: expected });
  });
});

describe('OAuth account binding: an adapter without findByProviderAccountId (ADR 0086)', () => {
  beforeEach(() => {
    adapterMock.findByProviderAccountId = undefined;
  });

  it('a verified email still signs in to an unbound account, without writing a binding', async () => {
    const provider = googleProvider(helperInput('google'));
    adapterMock.findByEmail.mockResolvedValue({ id: 'ada', email: 'ada@example.com', provider: 'google', name: 'Ada' });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { sub: 'sub-ada', name: 'Ada', email: 'ada@example.com', email_verified: true },
    });
    const result = await runCallback(provider);
    expect(result && result.userId).toBe('ada');
    expect(bindCalls()).toHaveLength(0);
  });

  it('an unverified email is refused on an unbound account (fail closed)', async () => {
    const provider = microsoftCommon();
    adapterMock.findByEmail.mockResolvedValue(victimRow());
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: msUserInfo('attacker-oid', 'victim@contoso.com'),
    });
    expect(await runCallback(provider)).toBe(false);
  });

  it('a stored id that differs is still refused', async () => {
    const provider = microsoftCommon();
    adapterMock.findByEmail.mockResolvedValue(victimRow({ providerAccountId: 'victim-oid' }));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: msUserInfo('attacker-oid', 'victim@contoso.com'),
    });
    expect(await runCallback(provider)).toBe(false);
  });

  it('a new account is created without providerAccountId', async () => {
    const provider = googleProvider(helperInput('google'));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { sub: 'sub-new', name: 'N', email: 'n@example.com', email_verified: true },
    });
    const result = await runCallback(provider);
    expect(result && result.isNewUser).toBe(true);
    expect(adapterMock.create.mock.calls[0]?.[0]).not.toHaveProperty('providerAccountId');
  });
});

describe("OAuth account binding under the 'unified' strategy (ADR 0086)", () => {
  beforeEach(() => {
    setStrategy('unified');
  });

  it("a verified sign-in via a second provider links by email and does not overwrite the row's binding", async () => {
    const provider = githubProvider(helperInput('github'));
    adapterMock.findByEmailAnyProvider.mockResolvedValue({
      id: 'ada', email: 'ada@example.com', provider: 'google', name: 'Ada', providerAccountId: 'sub-ada',
    });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { id: 77, login: 'ada' },
      'https://api.github.com/user/emails': [{ email: 'ada@example.com', primary: true, verified: true }],
    });
    const result = await runCallback(provider);
    expect(result && result.userId).toBe('ada');
    expect(bindCalls()).toHaveLength(0);
  });

  it('an unverified email still cannot link across providers', async () => {
    const provider = microsoftCommon();
    adapterMock.findByEmailAnyProvider.mockResolvedValue({ id: 'ada', email: 'ada@example.com', provider: 'google', name: 'Ada' });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: msUserInfo('attacker-oid', 'ada@example.com'),
    });
    expect(await runCallback(provider)).toBe(false);
  });

  it('a same-provider row bound to a different id is refused', async () => {
    const provider = googleProvider(helperInput('google'));
    adapterMock.findByEmailAnyProvider.mockResolvedValue({
      id: 'ada', email: 'ada@example.com', provider: 'google', name: 'Ada', providerAccountId: 'sub-ada',
    });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { sub: 'sub-other', name: 'O', email: 'ada@example.com', email_verified: true },
    });
    expect(await runCallback(provider)).toBe(false);
  });

  it('an unbound same-provider row with a verified email is bound', async () => {
    const provider = googleProvider(helperInput('google'));
    adapterMock.findByEmailAnyProvider.mockResolvedValue({ id: 'ada', email: 'ada@example.com', provider: 'google', name: 'Ada' });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { sub: 'sub-ada', name: 'Ada', email: 'ada@example.com', email_verified: true },
    });
    const result = await runCallback(provider);
    expect(result && result.userId).toBe('ada');
    expect(adapterMock.update).toHaveBeenCalledWith('ada', { providerAccountId: 'sub-ada' });
  });
});

describe('OAuth account binding: stored ids a custom adapter returns (ADR 0086)', () => {
  //? Single-tenant Microsoft trusts Graph `mail`, so a second person in the
  //? tenant can report the same verified email with a different object id.
  const microsoftSingleTenant = () => microsoftProvider({ ...helperInput('microsoft'), tenant: 'contoso.onmicrosoft.com' });

  it('a row without `provider` that holds a different id is refused, even with a verified email', async () => {
    const provider = microsoftSingleTenant();
    adapterMock.findByEmail.mockResolvedValue({ id: 'victim', email: 'victim@contoso.com', name: 'Victim', providerAccountId: 'victim-oid' });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: msUserInfo('other-oid', 'victim@contoso.com'),
    });
    expect(await runCallback(provider)).toBe(false);
    expect(warned('bound to a different provider account')).toBe(true);
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it('a row without `provider` that holds the same id signs in, and an unbound one is not bound', async () => {
    const provider = microsoftSingleTenant();
    adapterMock.findByEmail.mockResolvedValueOnce({ id: 'alice', email: 'alice@contoso.com', name: 'A', providerAccountId: 'alice-oid' });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: msUserInfo('alice-oid', 'alice@contoso.com'),
    });
    const bound = await runCallback(provider);
    expect(bound && bound.userId).toBe('alice');

    adapterMock.findByEmail.mockResolvedValueOnce({ id: 'alice', email: 'alice@contoso.com', name: 'A' });
    const unbound = await runCallback(provider);
    expect(unbound && unbound.userId).toBe('alice');
    expect(bindCalls()).toHaveLength(0);
  });

  it('a numeric stored id counts as bound: the same number signs in without rebinding', async () => {
    const provider = githubProvider(helperInput('github'));
    adapterMock.findByEmail.mockResolvedValue({ id: 'octo', email: 'octo@example.com', provider: 'github', name: 'Octo', providerAccountId: 583231 });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { id: 583231, login: 'octo' },
      'https://api.github.com/user/emails': [{ email: 'octo@example.com', primary: true, verified: true }],
    });
    const result = await runCallback(provider);
    expect(result && result.userId).toBe('octo');
    expect(bindCalls()).toHaveLength(0);
  });

  it('a numeric stored id that differs is refused instead of overwritten', async () => {
    const provider = githubProvider(helperInput('github'));
    adapterMock.findByEmail.mockResolvedValue({ id: 'octo', email: 'octo@example.com', provider: 'github', name: 'Octo', providerAccountId: 1 });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { id: 583231, login: 'octo' },
      'https://api.github.com/user/emails': [{ email: 'octo@example.com', primary: true, verified: true }],
    });
    expect(await runCallback(provider)).toBe(false);
    expect(bindCalls()).toHaveLength(0);
  });
});

describe('OAuth account binding: preLogin sees the account, not the provider email (ADR 0086)', () => {
  const boundAda = () => ({ id: 'ada', email: 'ada@old.example', provider: 'google', name: 'Ada', providerAccountId: 'sub-ada' });
  const changedEmailRoutes = (provider: FullOAuthProvider) => ({
    [provider.tokenExchangeURL]: { access_token: 'at' },
    [provider.userInfoURL]: { sub: 'sub-ada', name: 'Ada', email: 'ada@new.example', email_verified: true },
  });

  it('a bound login passes the stored email and the user id to preLogin', async () => {
    const provider = googleProvider(helperInput('google'));
    adapterMock.findByProviderAccountId = vi.fn(async () => boundAda());
    stubFetch(changedEmailRoutes(provider));
    await runCallback(provider);
    expect(hookPayloads('preLogin')).toEqual([{ email: 'ada@old.example', provider: 'google', userId: 'ada' }]);
  });

  it('a preLogin veto on a bound account refuses the login and reports the account', async () => {
    const provider = googleProvider(helperInput('google'));
    adapterMock.findByProviderAccountId = vi.fn(async () => boundAda());
    vi.mocked(dispatchHook).mockImplementationOnce(async () => ({ stopped: true, signal: { stop: true, errorCode: 'auth.banned' } }));
    stubFetch(changedEmailRoutes(provider));
    expect(await runCallback(provider)).toBe(false);
    expect(saveSessionMock).not.toHaveBeenCalled();
    expect(hookPayloads('loginFailed')).toEqual([
      expect.objectContaining({ userId: 'ada', reason: 'oauth.userResolveFailed', stage: 'oauth' }),
    ]);
  });

  it('a new account passes the provider email without a user id', async () => {
    const provider = googleProvider(helperInput('google'));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { sub: 'sub-new', name: 'N', email: 'n@example.com', email_verified: true },
    });
    await runCallback(provider);
    expect(hookPayloads('preLogin')).toEqual([{ email: 'n@example.com', provider: 'google' }]);
  });
});

describe('OAuth account binding: loginFailed reasons (ADR 0086)', () => {
  it('a response without the declared id reports oauth.accountIdMissing', async () => {
    const provider = googleProvider(helperInput('google'));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { name: 'Ada', email: 'ada@example.com', email_verified: true },
    });
    await runCallback(provider);
    expect(hookPayloads('loginFailed')).toEqual([
      expect.objectContaining({ provider: 'google', reason: 'oauth.accountIdMissing', stage: 'oauth' }),
    ]);
  });

  it('an account bound to another id reports oauth.accountBoundElsewhere with its user id', async () => {
    const provider = microsoftCommon();
    adapterMock.findByEmail.mockResolvedValue(victimRow({ providerAccountId: 'victim-oid' }));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: msUserInfo('attacker-oid', 'victim@contoso.com'),
    });
    await runCallback(provider);
    expect(hookPayloads('loginFailed')).toEqual([
      expect.objectContaining({ userId: 'victim', reason: 'oauth.accountBoundElsewhere', stage: 'oauth' }),
    ]);
  });

  it('an unverified email on an unbound account reports oauth.emailUnverified with its user id', async () => {
    const provider = microsoftCommon();
    adapterMock.findByEmail.mockResolvedValue(victimRow());
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: msUserInfo('attacker-oid', 'victim@contoso.com'),
    });
    await runCallback(provider);
    expect(hookPayloads('loginFailed')).toEqual([
      expect.objectContaining({ userId: 'victim', reason: 'oauth.emailUnverified', stage: 'oauth' }),
    ]);
  });
});

describe('OAuth account binding: the provider id stays out of the session (ADR 0086)', () => {
  it('a bound sign-in does not put providerAccountId in the session', async () => {
    const provider = googleProvider(helperInput('google'));
    adapterMock.findByProviderAccountId = vi.fn(async () => ({
      id: 'ada', email: 'ada@example.com', provider: 'google', name: 'Ada', providerAccountId: 'sub-ada',
    }));
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { sub: 'sub-ada', name: 'Ada', email: 'ada@example.com', email_verified: true },
    });
    await runCallback(provider);
    expect(savedSession().id).toBe('ada');
    expect(savedSession()).not.toHaveProperty('providerAccountId');
  });

  it('a first-time bind and a new account do not put providerAccountId in the session', async () => {
    const provider = googleProvider(helperInput('google'));
    adapterMock.findByEmail.mockResolvedValueOnce({ id: 'ada', email: 'ada@example.com', provider: 'google', name: 'Ada' });
    stubFetch({
      [provider.tokenExchangeURL]: { access_token: 'at' },
      [provider.userInfoURL]: { sub: 'sub-ada', name: 'Ada', email: 'ada@example.com', email_verified: true },
    });
    await runCallback(provider);
    expect(adapterMock.update).toHaveBeenCalledWith('ada', { providerAccountId: 'sub-ada' });
    expect(savedSession()).not.toHaveProperty('providerAccountId');

    saveSessionMock.mockClear();
    await runCallback(provider);
    expect(adapterMock.create.mock.calls[0]?.[0]).toMatchObject({ providerAccountId: 'sub-ada' });
    expect(savedSession().id).toBe('new-user');
    expect(savedSession()).not.toHaveProperty('providerAccountId');
  });
});
