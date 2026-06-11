import { describe, expect, it, vi, beforeEach } from 'vitest';

import { handleAuthLogoutRoute } from './authLogoutRoute';
import type { HttpRouteContext } from './types';

const deleteSessionMock = vi.fn(() => Promise.resolve());
//? 0.2.0: the route reads the login surface via the capability layer (login optional).
vi.mock('../capabilities', () => ({
  getLogin: () => Promise.resolve({ deleteSession: deleteSessionMock }),
}));

vi.mock('@luckystack/core', () => ({
  getLogger: () => ({ warn: () => undefined }),
  getProjectConfig: () => ({ http: { sessionCookieName: 'token', sessionCookieSameSite: 'Strict', sessionCookiePath: '/' } }),
  //? Mirror the real [error, result] tuple contract — a mock of tryCatch is
  //? the one place a raw try/catch is unavoidable.
  tryCatch: async (fn: () => Promise<unknown>) => {
    try {
      return [null, await fn()];
    } catch (error) {
      return [error, null];
    }
  },
}));

const makeCtx = (
  method: string,
  routePath: string,
  token: string | null = null,
): { ctx: HttpRouteContext; headers: Record<string, string>; ended: () => string | undefined; status: () => number | undefined } => {
  let body: string | undefined;
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => { headers[name] = value; },
    end: (chunk?: string) => { body = chunk; },
    statusCode: undefined as number | undefined,
  };
  const ctx = {
    req: { method },
    res,
    routePath,
    method,
    token,
  } as unknown as HttpRouteContext;
  return { ctx, headers, ended: () => body, status: () => res.statusCode };
};

describe('handleAuthLogoutRoute', () => {
  beforeEach(() => {
    deleteSessionMock.mockClear();
  });

  it('ignores non-matching paths', async () => {
    const { ctx } = makeCtx('POST', '/auth/csrf');
    expect(await handleAuthLogoutRoute(ctx)).toBe(false);
  });

  it('rejects non-POST methods with 405', async () => {
    const { ctx, status, headers } = makeCtx('GET', '/auth/logout');
    expect(await handleAuthLogoutRoute(ctx)).toBe(true);
    expect(status()).toBe(405);
    expect(headers.Allow).toBe('POST');
  });

  it('clears the session cookie with Max-Age=0 even without a token', async () => {
    const { ctx, status, headers, ended } = makeCtx('POST', '/auth/logout');
    expect(await handleAuthLogoutRoute(ctx)).toBe(true);
    expect(status()).toBe(200);
    expect(headers['Set-Cookie']).toContain('Max-Age=0');
    expect(headers['Set-Cookie']).toContain('HttpOnly');
    expect(headers['Set-Cookie']).toMatch(/^token=;/);
    expect(JSON.parse(ended() ?? '{}')).toEqual({ status: 'success', result: true });
    expect(deleteSessionMock).not.toHaveBeenCalled();
  });

  it('deletes the session when a token rides along, then clears the cookie', async () => {
    const { ctx, headers } = makeCtx('POST', '/auth/logout', 'live-token');
    expect(await handleAuthLogoutRoute(ctx)).toBe(true);
    expect(deleteSessionMock).toHaveBeenCalledWith('live-token');
    expect(headers['Set-Cookie']).toContain('Max-Age=0');
  });

  it('still clears the cookie when deleteSession throws', async () => {
    deleteSessionMock.mockRejectedValueOnce(new Error('adapter blip'));
    const { ctx, status, headers } = makeCtx('POST', '/auth/logout', 'live-token');
    expect(await handleAuthLogoutRoute(ctx)).toBe(true);
    expect(status()).toBe(200);
    expect(headers['Set-Cookie']).toContain('Max-Age=0');
  });
});
