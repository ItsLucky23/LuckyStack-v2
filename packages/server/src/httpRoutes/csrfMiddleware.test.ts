import { describe, it, expect, vi, beforeEach } from 'vitest';

//? `vi.mock` factories are hoisted above module-level consts, so the mutable
//? seams they reference must be created via `vi.hoisted` (also hoisted).
const { caps, mockCookies, dispatchHookMock, sessionRef, configRef } = vi.hoisted(() => ({
  caps: { login: true, presence: true, sync: true },
  mockCookies: {} as Record<string, string>,
  dispatchHookMock: vi.fn(),
  sessionRef: { current: null as { id?: string; csrfToken?: string } | null },
  configRef: { basedToken: false, acceptBearerInCookieMode: false },
}));

vi.mock('../capabilities', () => ({ capabilities: caps }));

vi.mock('@luckystack/core', () => ({
  dispatchHook: (...args: unknown[]) => dispatchHookMock(...args),
  getProjectConfig: () => ({
    session: { basedToken: configRef.basedToken },
    http: { acceptBearerInCookieMode: configRef.acceptBearerInCookieMode },
  }),
  getCsrfConfig: () => ({ cookieName: 'csrf-token', headerName: 'x-csrf-token', tokenLength: 32, cookieOptions: {} }),
  getCookieValue: (_cookie: string | undefined, name: string) => mockCookies[name] ?? null,
  //? Mirrors the real `hasCookie`: an empty value counts as absent.
  hasCookie: (_cookie: string | undefined, name: string) => Boolean(mockCookies[name]),
  extractBearerToken: (req: { headers: { authorization?: string } }) =>
    req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null,
  readSession: () => Promise.resolve(sessionRef.current),
}));

vi.mock('./sessionCookie', () => ({ resolveSessionCookieName: () => 'token' }));

//? `isOriginExemptPath` comes from a separate module; mock it so tests can
//? control whether a path is treated as an origin-exempt webhook.
const { originExemptPaths } = vi.hoisted(() => ({ originExemptPaths: new Set<string>() }));
vi.mock('../originExemptRegistry', () => ({
  isOriginExemptPath: (path: string) => originExemptPaths.has(path),
}));

import { enforceCsrfOnStateChangingRequest } from './csrfMiddleware';

interface FakeRes {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: string) => void;
}

const run = async (opts: {
  method?: string;
  routePath?: string;
  header?: string;
  token?: string | null;
  bearer?: string;
}): Promise<{ rejected: boolean; res: FakeRes }> => {
  const res: FakeRes = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
  const headers: Record<string, string> = {};
  if (opts.header !== undefined) headers['x-csrf-token'] = opts.header;
  if (opts.bearer !== undefined) headers.authorization = `Bearer ${opts.bearer}`;
  const req = { method: opts.method ?? 'POST', headers } as unknown as Parameters<typeof enforceCsrfOnStateChangingRequest>[0]['req'];
  const rejected = await enforceCsrfOnStateChangingRequest({
    req,
    res: res as unknown as Parameters<typeof enforceCsrfOnStateChangingRequest>[0]['res'],
    routePath: opts.routePath ?? '/api/widgets/get/v1',
    token: opts.token ?? null,
  });
  return { rejected, res };
};

beforeEach(() => {
  caps.login = true;
  configRef.basedToken = false;
  configRef.acceptBearerInCookieMode = false;
  sessionRef.current = null;
  for (const k of Object.keys(mockCookies)) delete mockCookies[k];
  originExemptPaths.clear();
  dispatchHookMock.mockReset();
});

describe('enforceCsrfOnStateChangingRequest — scope', () => {
  it('does not enforce on GET (not state-changing)', async () => {
    const { rejected } = await run({ method: 'GET' });
    expect(rejected).toBe(false);
  });

  it('does not enforce on the auth bootstrap endpoint', async () => {
    const { rejected } = await run({ routePath: '/auth/api/credentials' });
    expect(rejected).toBe(false);
  });

  it('does not enforce on the auth/callback path', async () => {
    const { rejected } = await run({ routePath: '/auth/callback/github' });
    expect(rejected).toBe(false);
  });

  it('does not enforce on static/asset paths', async () => {
    const { rejected } = await run({ routePath: '/assets/app.js' });
    expect(rejected).toBe(false);
  });

  it('enforces on state-changing custom routes (not origin-exempt)', async () => {
    //? Custom POST routes now fall under the CSRF gate to protect session-cookie
    //? consumers whose custom route performs a state mutation.
    sessionRef.current = { id: 'user-1', csrfToken: 'tok' };
    const { rejected } = await run({ routePath: '/custom/action', token: 'sess', header: 'wrong' });
    expect(rejected).toBe(true);
  });

  it('does not enforce on origin-exempt custom routes (HMAC-authenticated webhooks)', async () => {
    //? Webhooks that use HMAC/signature auth are registered as origin-exempt and
    //? must not require a session CSRF token.
    originExemptPaths.add('/webhooks/stripe');
    const { rejected } = await run({ routePath: '/webhooks/stripe' });
    expect(rejected).toBe(false);
  });
});

describe('enforceCsrfOnStateChangingRequest — login ABSENT (double-submit)', () => {
  beforeEach(() => { caps.login = false; });

  it('passes when the csrf cookie matches the header', async () => {
    mockCookies['csrf-token'] = 'abc123';
    const { rejected } = await run({ header: 'abc123' });
    expect(rejected).toBe(false);
  });

  it('rejects when the header is missing', async () => {
    mockCookies['csrf-token'] = 'abc123';
    const { rejected, res } = await run({});
    expect(rejected).toBe(true);
    expect(res.statusCode).toBe(403);
  });

  it('rejects when cookie and header do not match (cross-site forge)', async () => {
    mockCookies['csrf-token'] = 'real-value';
    const { rejected, res } = await run({ header: 'attacker-guess' });
    expect(rejected).toBe(true);
    expect(res.statusCode).toBe(403);
  });

  it('rejects when there is no csrf cookie at all', async () => {
    const { rejected } = await run({ header: 'anything' });
    expect(rejected).toBe(true);
  });
});

describe('enforceCsrfOnStateChangingRequest — login PRESENT (session-bound)', () => {
  it('does not enforce without a session token (nothing to protect)', async () => {
    const { rejected } = await run({ token: null, header: 'x' });
    expect(rejected).toBe(false);
  });

  it('passes when the header matches the session csrfToken', async () => {
    sessionRef.current ={ id: 'user-1', csrfToken: 'session-tok' };
    const { rejected } = await run({ token: 'sess', header: 'session-tok' });
    expect(rejected).toBe(false);
  });

  it('rejects when the header does not match the session csrfToken', async () => {
    sessionRef.current ={ id: 'user-1', csrfToken: 'session-tok' };
    const { rejected, res } = await run({ token: 'sess', header: 'wrong' });
    expect(rejected).toBe(true);
    expect(res.statusCode).toBe(403);
  });
});

//? ADR 0091: in cookie mode with `acceptBearerInCookieMode`, only a request with
//? a bearer header and no session cookie skips CSRF. `token` mirrors what
//? `extractTokenFromRequest` returns (cookie first, then bearer).
describe('enforceCsrfOnStateChangingRequest — bearer in cookie mode', () => {
  beforeEach(() => {
    sessionRef.current = { id: 'user-1', csrfToken: 'session-tok' };
  });

  it('setting off: a bearer-only POST without a CSRF header is rejected', async () => {
    const { rejected, res } = await run({ token: 'sess', bearer: 'sess' });
    expect(rejected).toBe(true);
    expect(res.statusCode).toBe(403);
  });

  it('setting on: a bearer-only POST without a CSRF header is allowed', async () => {
    configRef.acceptBearerInCookieMode = true;
    const { rejected } = await run({ token: 'sess', bearer: 'sess' });
    expect(rejected).toBe(false);
  });

  it('setting on: a session-cookie POST without a CSRF header is rejected', async () => {
    configRef.acceptBearerInCookieMode = true;
    mockCookies.token = 'sess';
    const { rejected, res } = await run({ token: 'sess' });
    expect(rejected).toBe(true);
    expect(res.statusCode).toBe(403);
  });

  it('setting on: a POST with session cookie AND bearer without a CSRF header is rejected', async () => {
    configRef.acceptBearerInCookieMode = true;
    mockCookies.token = 'sess';
    const { rejected, res } = await run({ token: 'sess', bearer: 'other' });
    expect(rejected).toBe(true);
    expect(res.statusCode).toBe(403);
  });

  it('setting on: an empty session cookie carries no session, so a bearer request is allowed', async () => {
    //? The real `getCookieValue` returns null for `token=`; the token then comes
    //? from the bearer, which a cross-site page cannot add.
    configRef.acceptBearerInCookieMode = true;
    mockCookies.token = '';
    const { rejected } = await run({ token: 'sess', bearer: 'sess' });
    expect(rejected).toBe(false);
  });

  it('setting on, login absent: a bearer does not skip the double-submit check', async () => {
    configRef.acceptBearerInCookieMode = true;
    caps.login = false;
    const { rejected, res } = await run({ bearer: 'sess' });
    expect(rejected).toBe(true);
    expect(res.statusCode).toBe(403);
  });

  it('token mode: CSRF is skipped, with or without the setting', async () => {
    configRef.basedToken = true;
    mockCookies.token = 'sess';
    expect((await run({ token: 'sess' })).rejected).toBe(false);
    configRef.acceptBearerInCookieMode = true;
    expect((await run({ token: 'sess', bearer: 'sess' })).rejected).toBe(false);
  });
});
