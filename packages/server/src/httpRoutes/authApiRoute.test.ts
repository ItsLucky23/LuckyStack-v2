import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

const { loginModule, httpConfig } = vi.hoisted(() => ({
  loginModule: {
    getOAuthProviders: vi.fn(() => [{ name: 'credentials' }]),
    isFullOAuthProvider: vi.fn(() => false),
    loginWithCredentials: vi.fn(),
    deleteSession: vi.fn(),
  },
  httpConfig: {
    sessionCookieName: 'token',
    sessionCookieSameSite: 'Strict',
    sessionCookiePath: '/',
    trustProxy: false,
    trustedProxyHopCount: 1,
  } as Record<string, unknown>,
}));

vi.mock('../capabilities', () => ({ getLogin: () => Promise.resolve(loginModule) }));

vi.mock('@luckystack/core', async () => {
  const actual = await vi.importActual<typeof import('@luckystack/core')>('@luckystack/core');
  return {
    applyCookiePrefixConstraints: actual.applyCookiePrefixConstraints,
    checkRateLimit: vi.fn(() => Promise.resolve({ allowed: true, remaining: 5, resetIn: 0 })),
    dispatchHook: vi.fn(),
    getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    getProjectConfig: () => ({
      http: httpConfig,
      session: { basedToken: false },
      logging: { devLogs: false },
      rateLimiting: { defaultApiLimit: false, windowMs: 60_000, auth: { enabled: false, maxAttempts: 0, windowMs: 60_000 } },
    }),
    isProductionRuntime: () => false,
    resolveClientIp: () => '9.9.9.9',
    resolveDevCallbackUrl: (url: string) => url,
  };
});

import { handleAuthApiRoute } from './authApiRoute';
import type { HttpRouteContext } from './types';

const makeCtx = (method: HttpRouteContext['method'], params: object) => {
  const out = { statusCode: 200, headers: {} as Record<string, string>, body: '' };
  const res = {
    get statusCode() { return out.statusCode; },
    set statusCode(code: number) { out.statusCode = code; },
    setHeader: (name: string, value: string) => { out.headers[name.toLowerCase()] = value; },
    end: (chunk?: string) => { out.body = chunk ?? ''; },
  } as unknown as ServerResponse;
  const req = { headers: {}, socket: { remoteAddress: '9.9.9.9' }, url: '/auth/api/credentials' } as unknown as IncomingMessage;
  const ctx: HttpRouteContext = {
    req,
    res,
    options: {} as HttpRouteContext['options'],
    routePath: '/auth/api/credentials',
    queryString: undefined,
    method,
    token: null,
    requestId: 'r1',
    sessionCookieOptions: 'HttpOnly; SameSite=Strict; Path=/; Max-Age=60; ',
    params,
  };
  return { ctx, out };
};

beforeEach(() => {
  vi.clearAllMocks();
  delete httpConfig.sessionCookiePrefix;
  loginModule.loginWithCredentials.mockResolvedValue({
    status: true,
    reason: 'login.loggedIn',
    newToken: 'tok123',
    session: { id: 'u1', name: 'Sam', token: 'tok123', csrfToken: 'csrf123' },
  });
});

describe('handleAuthApiRoute — credentials', () => {
  it('rejects GET with 405 and never runs the login (finding 040)', async () => {
    const { ctx, out } = makeCtx('GET', { email: 'attacker@x', password: 'pw' });
    await expect(handleAuthApiRoute(ctx)).resolves.toBe(true);
    expect(out.statusCode).toBe(405);
    expect(out.headers.allow).toBe('POST');
    expect(out.headers['set-cookie']).toBeUndefined();
    expect(loginModule.loginWithCredentials).not.toHaveBeenCalled();
  });

  it('POST logs in, sets the cookie and keeps token/csrfToken out of the body (finding 037)', async () => {
    const { ctx, out } = makeCtx('POST', { email: 'sam@example.com', password: 'pw' });
    await handleAuthApiRoute(ctx);
    expect(out.headers['set-cookie']).toBe('token=tok123; HttpOnly; SameSite=Strict; Path=/; Max-Age=60; ');
    const body = JSON.parse(out.body) as { session: Record<string, unknown> };
    expect(body).toMatchObject({ status: true, authenticated: true, session: { id: 'u1', name: 'Sam' } });
    expect(body.session).not.toHaveProperty('token');
    expect(body.session).not.toHaveProperty('csrfToken');
    expect(out.body).not.toContain('tok123');
  });

  it('sets the session cookie under the configured prefix (finding 044)', async () => {
    httpConfig.sessionCookiePrefix = '__Host-';
    const { ctx, out } = makeCtx('POST', { email: 'sam@example.com', password: 'pw' });
    await handleAuthApiRoute(ctx);
    expect(out.headers['set-cookie']).toMatch(/^__Host-token=tok123; /);
  });
});
