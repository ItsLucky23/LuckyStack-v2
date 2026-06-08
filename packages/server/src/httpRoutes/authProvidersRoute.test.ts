import { describe, expect, it, vi } from 'vitest';

import { handleAuthProvidersRoute } from './authProvidersRoute';
import type { HttpRouteContext } from './types';

const providersList: { name: string }[] = [{ name: 'credentials' }];
//? 0.2.0: the route reads providers via the capability layer (login optional).
vi.mock('../capabilities', () => ({
  getLogin: () => Promise.resolve({ getOAuthProviders: () => providersList }),
}));

const makeCtx = (method: string, routePath: string): { ctx: HttpRouteContext; ended: () => string | undefined } => {
  let body: string | undefined;
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => { headers[name] = value; },
    end: (chunk?: string) => { body = chunk; },
  };
  const ctx = {
    req: { method },
    res,
    routePath,
  } as unknown as HttpRouteContext;
  return { ctx, ended: () => body };
};

describe('handleAuthProvidersRoute', () => {
  it('ignores non-matching paths', async () => {
    const { ctx } = makeCtx('GET', '/auth/api/credentials');
    expect(await handleAuthProvidersRoute(ctx)).toBe(false);
  });

  it('ignores non-GET methods on /auth/providers', async () => {
    const { ctx } = makeCtx('POST', '/auth/providers');
    expect(await handleAuthProvidersRoute(ctx)).toBe(false);
  });

  it('returns the registered provider names as JSON on GET /auth/providers', async () => {
    providersList.length = 0;
    providersList.push({ name: 'credentials' }, { name: 'google' }, { name: 'github' });
    const { ctx, ended } = makeCtx('GET', '/auth/providers');

    expect(await handleAuthProvidersRoute(ctx)).toBe(true);
    expect(JSON.parse(ended() ?? '{}')).toEqual({ providers: ['credentials', 'google', 'github'] });
  });
});
