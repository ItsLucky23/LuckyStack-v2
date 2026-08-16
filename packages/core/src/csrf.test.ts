import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCsrfToken, httpFetch } from './csrf';
import { registerProjectConfig } from './projectConfig';

beforeEach(() => {
  vi.restoreAllMocks();
  clearCsrfToken();
  vi.stubGlobal('window', {});
  vi.stubGlobal('location', { origin: 'http://frontend:5173' });
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn(() => null),
  });
});

describe('httpFetch routed invocation auth', () => {
  it('fetches and caches CSRF on the same routed origin as the write', async () => {
    registerProjectConfig({ session: { basedToken: false } });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === 'http://router:4000/auth/csrf') {
        return new Response(JSON.stringify({ csrfToken: 'csrf-router' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await httpFetch('http://router:4000/api/admin/run/v1', {
      method: 'POST',
      body: '{}',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://router:4000/auth/csrf');
    const requestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(new Headers(requestInit?.headers).get('x-csrf-token')).toBe('csrf-router');
  });

  it('attaches the sessionStorage token as bearer auth in token mode', async () => {
    registerProjectConfig({ session: { basedToken: true } });
    vi.stubGlobal('sessionStorage', { getItem: vi.fn(() => 'session-token') });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await httpFetch('/api/admin/run/v1', { method: 'POST', body: '{}' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(requestInit?.headers).get('authorization')).toBe('Bearer session-token');
  });
});
