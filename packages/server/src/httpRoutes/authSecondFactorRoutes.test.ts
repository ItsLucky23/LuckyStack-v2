import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

const { getLoginMock, checkRateLimitMock } = vi.hoisted(() => ({
  getLoginMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
}));

vi.mock('../capabilities', () => ({
  getLogin: () => getLoginMock(),
}));

vi.mock('@luckystack/core', () => ({
  getProjectConfig: () => ({
    http: { sessionCookieName: 'session', trustProxy: false, trustedProxyHopCount: 1 },
    session: { basedToken: false },
  }),
  checkRateLimit: (params: unknown) => checkRateLimitMock(params),
  resolveClientIp: () => '9.9.9.9',
}));

import { handleAuthEmailCodeRoute, handleAuthTwoFactorRoute } from './authSecondFactorRoutes';
import type { HttpRouteContext } from './types';

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const makeCtx = (routePath: string, params: object, overrides: Partial<HttpRouteContext> = {}): { ctx: HttpRouteContext; out: FakeRes } => {
  const out: FakeRes = { statusCode: 200, headers: {}, body: '' };
  const res = {
    get statusCode() { return out.statusCode; },
    set statusCode(code: number) { out.statusCode = code; },
    setHeader: (name: string, value: string) => { out.headers[name.toLowerCase()] = value; },
    end: (chunk?: string) => { out.body = chunk ?? ''; },
  } as unknown as ServerResponse;
  const req = { headers: {}, socket: { remoteAddress: '9.9.9.9' } } as unknown as IncomingMessage;
  const ctx: HttpRouteContext = {
    req,
    res,
    options: {} as HttpRouteContext['options'],
    routePath,
    queryString: undefined,
    method: 'POST',
    token: null,
    requestId: 'r1',
    sessionCookieOptions: 'HttpOnly; Path=/',
    params,
    ...overrides,
  };
  return { ctx, out };
};

const parsed = (out: FakeRes): Record<string, unknown> => JSON.parse(out.body) as Record<string, unknown>;

const loginModule = {
  requestEmailLoginCode: vi.fn(),
  verifyEmailLoginCode: vi.fn(),
  verifyTwoFactorChallenge: vi.fn(),
  requestTwoFactorEmailCode: vi.fn(),
  beginTotpEnrollment: vi.fn(),
  confirmTotpEnrollment: vi.fn(),
  disableTwoFactor: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  deleteSession: vi.fn(),
  getSession: vi.fn(),
  getUserAdapter: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  getLoginMock.mockResolvedValue(loginModule);
  checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 5, resetIn: 0 });
});

describe('handleAuthEmailCodeRoute', () => {
  it('passes through on unrelated paths', async () => {
    const { ctx } = makeCtx('/auth/api/credentials', {});
    await expect(handleAuthEmailCodeRoute(ctx)).resolves.toBe(false);
  });

  it('rejects non-POST with 405', async () => {
    const { ctx, out } = makeCtx('/auth/api/email-code/request', {}, { method: 'GET' });
    await expect(handleAuthEmailCodeRoute(ctx)).resolves.toBe(true);
    expect(out.statusCode).toBe(405);
  });

  it('reports the disabled contract when @luckystack/login is absent', async () => {
    getLoginMock.mockResolvedValue(null);
    const { ctx, out } = makeCtx('/auth/api/email-code/request', { email: 'a@b.c' });
    await handleAuthEmailCodeRoute(ctx);
    expect(parsed(out)).toEqual({ status: false, reason: 'auth.disabled' });
  });

  it('request → { status: true } and forwards email + requesterIp', async () => {
    loginModule.requestEmailLoginCode.mockResolvedValue({ ok: true });
    const { ctx, out } = makeCtx('/auth/api/email-code/request', { email: 'sam@example.com' });
    await handleAuthEmailCodeRoute(ctx);
    expect(parsed(out)).toEqual({ status: true });
    expect(loginModule.requestEmailLoginCode).toHaveBeenCalledWith({ email: 'sam@example.com', requesterIp: '9.9.9.9' });
  });

  it('per-IP throttle answers 429 before touching the login package', async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 60 });
    const { ctx, out } = makeCtx('/auth/api/email-code/request', { email: 'sam@example.com' });
    await handleAuthEmailCodeRoute(ctx);
    expect(out.statusCode).toBe(429);
    expect(loginModule.requestEmailLoginCode).not.toHaveBeenCalled();
  });

  it('verify success sets the session COOKIE (cookie mode) + full envelope', async () => {
    loginModule.verifyEmailLoginCode.mockResolvedValue({ status: true, reason: 'login.loggedIn', newToken: 'tok123', session: { id: 'u1' } });
    const { ctx, out } = makeCtx('/auth/api/email-code/verify', { email: 'sam@example.com', code: '123456' });
    await handleAuthEmailCodeRoute(ctx);
    expect(out.headers['set-cookie']).toBe('session=tok123; HttpOnly; Path=/');
    expect(parsed(out)).toMatchObject({ status: true, authenticated: true });
  });

  it('verify success uses the X-Session-Token header in token mode', async () => {
    loginModule.verifyEmailLoginCode.mockResolvedValue({ status: true, reason: 'login.loggedIn', newToken: 'tok123', session: { id: 'u1' } });
    const { ctx, out } = makeCtx('/auth/api/email-code/verify', { email: 'sam@example.com', code: '123456' });
    (ctx.req.headers as Record<string, string>)['x-session-based-token'] = 'true';
    await handleAuthEmailCodeRoute(ctx);
    expect(out.headers['x-session-token']).toBe('tok123');
    expect(out.headers['set-cookie']).toBeUndefined();
  });

  it('verify relaying a 2FA challenge sets NO session transport', async () => {
    loginModule.verifyEmailLoginCode.mockResolvedValue({
      status: true, reason: 'login.twoFactorRequired', requiresTwoFactor: true,
      challengeToken: 'c'.repeat(64), twoFactorMethods: ['totp', 'email-code'],
    });
    const { ctx, out } = makeCtx('/auth/api/email-code/verify', { email: 'sam@example.com', code: '123456' });
    await handleAuthEmailCodeRoute(ctx);
    expect(out.headers['set-cookie']).toBeUndefined();
    expect(out.headers['x-session-token']).toBeUndefined();
    expect(parsed(out)).toMatchObject({ status: true, requiresTwoFactor: true, authenticated: false, twoFactorMethods: ['totp', 'email-code'] });
  });
});

describe('handleAuthTwoFactorRoute', () => {
  it('completes a challenge through the cookie seam', async () => {
    loginModule.verifyTwoFactorChallenge.mockResolvedValue({ status: true, reason: 'login.loggedIn', newToken: 'tok9', session: { id: 'u1' } });
    const { ctx, out } = makeCtx('/auth/api/2fa', { challengeToken: 'c'.repeat(64), code: '123456', method: 'totp' });
    await handleAuthTwoFactorRoute(ctx);
    expect(loginModule.verifyTwoFactorChallenge).toHaveBeenCalledWith(expect.objectContaining({ method: 'totp' }));
    expect(out.headers['set-cookie']).toContain('session=tok9');
  });

  it('an unknown method string falls back to totp', async () => {
    loginModule.verifyTwoFactorChallenge.mockResolvedValue({ status: false, reason: 'login.twoFactorInvalidCode' });
    const { ctx } = makeCtx('/auth/api/2fa', { challengeToken: 'c'.repeat(64), code: '1', method: '<script>' });
    await handleAuthTwoFactorRoute(ctx);
    expect(loginModule.verifyTwoFactorChallenge).toHaveBeenCalledWith(expect.objectContaining({ method: 'totp' }));
  });

  it('enrollment routes demand a live session (401 without)', async () => {
    const { ctx, out } = makeCtx('/auth/api/2fa/setup', {});
    await handleAuthTwoFactorRoute(ctx);
    expect(out.statusCode).toBe(401);
  });

  it('setup re-reads the FRESH user through the adapter (session copy is sanitized)', async () => {
    const freshUser = { id: 'u1', email: 'sam@example.com' };
    loginModule.getSession.mockResolvedValue({ id: 'u1' });
    loginModule.getUserAdapter.mockReturnValue({ findById: vi.fn(async () => freshUser) });
    loginModule.beginTotpEnrollment.mockResolvedValue({ secret: 'S', otpauthUri: 'otpauth://totp/x' });
    const { ctx, out } = makeCtx('/auth/api/2fa/setup', {}, { token: 'session-token' });
    await handleAuthTwoFactorRoute(ctx);
    expect(loginModule.beginTotpEnrollment).toHaveBeenCalledWith(freshUser);
    expect(parsed(out)).toMatchObject({ status: true, secret: 'S' });
  });

  it('enable relays the raw recovery codes exactly once', async () => {
    loginModule.getSession.mockResolvedValue({ id: 'u1' });
    loginModule.getUserAdapter.mockReturnValue({ findById: vi.fn(async () => ({ id: 'u1' })) });
    loginModule.confirmTotpEnrollment.mockResolvedValue({ ok: true, recoveryCodes: ['aaaaa-bbbbb'] });
    const { ctx, out } = makeCtx('/auth/api/2fa/enable', { code: '123456' }, { token: 't' });
    await handleAuthTwoFactorRoute(ctx);
    expect(parsed(out)).toEqual({ status: true, recoveryCodes: ['aaaaa-bbbbb'] });
  });
});
