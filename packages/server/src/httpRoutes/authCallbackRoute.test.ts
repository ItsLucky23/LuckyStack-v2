import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleAuthCallbackRoute } from './authCallbackRoute';
import type { HttpRouteContext } from './types';

//? SEC-22 — the based-token OAuth callback must hand the session token to the
//? browser via the URL FRAGMENT (`#token=`), never the query string (which leaks
//? via Referer / history / proxy logs). These tests lock that contract.

const projectConfig = {
  http: { sessionCookieName: 'token' } as { sessionCookieName: string; sessionCookiePrefix?: '__Host-' | '__Secure-' },
  logging: { devLogs: false },
  app: { publicUrl: 'https://app.example.com' },
  loginRedirectUrl: '/dashboard',
  session: { basedToken: true },
};

const loginMock = {
  loginCallback: vi.fn(),
  deleteSession: vi.fn(() => Promise.resolve()),
};

vi.mock('@luckystack/core', async () => ({
  applyCookiePrefixConstraints: (await vi.importActual<typeof import('@luckystack/core')>('@luckystack/core')).applyCookiePrefixConstraints,
  getLogger: () => ({ debug: vi.fn() }),
  getProjectConfig: () => projectConfig,
}));

vi.mock('../capabilities', () => ({
  getLogin: () => Promise.resolve(loginMock),
}));

const makeCtx = (): {
  ctx: HttpRouteContext;
  status: () => number | undefined;
  location: () => string | undefined;
  setCookie: () => unknown;
} => {
  let statusCode: number | undefined;
  const headers: Record<string, unknown> = {};
  const res = {
    writeHead: (code: number, hdrs?: Record<string, string>) => {
      statusCode = code;
      if (hdrs) Object.assign(headers, hdrs);
    },
    setHeader: (name: string, value: unknown) => { headers[name] = value; },
    end: vi.fn(),
  };
  const ctx = {
    req: {},
    res,
    routePath: '/auth/callback/google',
    token: null,
    sessionCookieOptions: 'HttpOnly; Path=/;',
  } as unknown as HttpRouteContext;
  return {
    ctx,
    status: () => statusCode,
    location: () => headers.Location as string | undefined,
    setCookie: () => headers['Set-Cookie'],
  };
};

describe('handleAuthCallbackRoute (cookie mode)', () => {
  beforeEach(() => {
    projectConfig.session.basedToken = false;
    loginMock.loginCallback.mockReset();
  });

  it('sets the session cookie under the configured prefix (finding 044)', async () => {
    projectConfig.http.sessionCookiePrefix = '__Host-';
    loginMock.loginCallback.mockResolvedValue({ token: 'TK', redirectUrl: 'https://app.example.com/dashboard' });
    const { ctx, setCookie } = makeCtx();

    await handleAuthCallbackRoute(ctx);
    delete projectConfig.http.sessionCookiePrefix;

    expect(setCookie()).toEqual([expect.stringMatching(/=; Path=\/; HttpOnly; Max-Age=0/), '__Host-token=TK; HttpOnly; Path=/;']);
  });
});

describe('handleAuthCallbackRoute (based-token)', () => {
  beforeEach(() => {
    projectConfig.session.basedToken = true;
    loginMock.loginCallback.mockReset();
    loginMock.deleteSession.mockClear();
  });

  it('delivers the token in the URL fragment, not the query string', async () => {
    loginMock.loginCallback.mockResolvedValue({
      token: 'SESSIONTOKEN',
      redirectUrl: 'https://app.example.com/dashboard',
    });
    const { ctx, status, location } = makeCtx();

    expect(await handleAuthCallbackRoute(ctx)).toBe(true);
    expect(status()).toBe(302);
    expect(location()).toBe('https://app.example.com/dashboard#token=SESSIONTOKEN');
    expect(location()).not.toContain('?token=');
    expect(location()).not.toContain('&token=');
  });

  it('appends the fragment after an existing query string without a separator guess', async () => {
    loginMock.loginCallback.mockResolvedValue({
      token: 'TK',
      redirectUrl: 'https://app.example.com/dashboard?welcome=1',
    });
    const { ctx, location } = makeCtx();

    expect(await handleAuthCallbackRoute(ctx)).toBe(true);
    expect(location()).toBe('https://app.example.com/dashboard?welcome=1#token=TK');
  });

  it('drops a pre-existing fragment on the redirect target to avoid double-#', async () => {
    loginMock.loginCallback.mockResolvedValue({
      token: 'TK',
      redirectUrl: 'https://app.example.com/dashboard#section',
    });
    const { ctx, location } = makeCtx();

    expect(await handleAuthCallbackRoute(ctx)).toBe(true);
    expect(location()).toBe('https://app.example.com/dashboard#token=TK');
  });
});
