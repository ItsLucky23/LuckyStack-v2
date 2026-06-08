import { describe, it, expect, vi, beforeEach } from 'vitest';

//? `vi.mock` factories are hoisted above module-level consts, so the mutable
//? seams they reference must be created via `vi.hoisted` (also hoisted).
const { caps, mockCookies, dispatchHookMock, sessionRef } = vi.hoisted(() => ({
  caps: { login: true, presence: true, sync: true },
  mockCookies: {} as Record<string, string>,
  dispatchHookMock: vi.fn(),
  sessionRef: { current: null as { id?: string; csrfToken?: string } | null },
}));

vi.mock('../capabilities', () => ({ capabilities: caps }));

vi.mock('@luckystack/core', () => ({
  dispatchHook: (...args: unknown[]) => dispatchHookMock(...args),
  getProjectConfig: () => ({ session: { basedToken: false } }),
  getCsrfConfig: () => ({ cookieName: 'csrf-token', headerName: 'x-csrf-token', tokenLength: 32, cookieOptions: {} }),
  getCookieValue: (_cookie: string | undefined, name: string) => mockCookies[name] ?? null,
  readSession: () => Promise.resolve(sessionRef.current),
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
}): Promise<{ rejected: boolean; res: FakeRes }> => {
  const res: FakeRes = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
  const headers: Record<string, string> = {};
  if (opts.header !== undefined) headers['x-csrf-token'] = opts.header;
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
  sessionRef.current =null;
  for (const k of Object.keys(mockCookies)) delete mockCookies[k];
  dispatchHookMock.mockReset();
});

describe('enforceCsrfOnStateChangingRequest — scope', () => {
  it('does not enforce on GET (not state-changing)', async () => {
    const { rejected } = await run({ method: 'GET' });
    expect(rejected).toBe(false);
  });

  it('does not enforce on non-framework routes', async () => {
    const { rejected } = await run({ routePath: '/custom/webhook' });
    expect(rejected).toBe(false);
  });

  it('does not enforce on the auth bootstrap endpoint', async () => {
    const { rejected } = await run({ routePath: '/auth/api/credentials' });
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
