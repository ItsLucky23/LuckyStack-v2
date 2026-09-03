import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCallApi } from './customTests';

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const emptyState = (): Parameters<typeof buildCallApi>[2] => ({
  token: null,
  userId: null,
  csrfToken: null,
  lastResponse: null,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildCallApi', () => {
  it('sends GET input as the reserved __luckystack_data query value and no body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);

    const callApi = buildCallApi('http://localhost:80/', 'admin/ai/getBehaviorVersion/v1', emptyState(), 'session', 'GET');
    await callApi({ versionId: 'abc', nested: { enabled: true } });

    const [requestedUrl, init] = fetchMock.mock.calls[0] ?? [];
    const parsed = new URL(String(requestedUrl));
    expect(parsed.pathname).toBe('/api/admin/ai/getBehaviorVersion/v1');
    expect(JSON.parse(parsed.searchParams.get('__luckystack_data') ?? 'null')).toEqual({
      versionId: 'abc',
      nested: { enabled: true },
    });
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
  });

  it('keeps sending non-GET input as the JSON body with a bare URL', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);

    const callApi = buildCallApi('http://localhost:80', 'admin/ai/saveThing/v1', emptyState(), 'session', 'POST');
    await callApi({ id: 'abc' });

    const [requestedUrl, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(requestedUrl)).toBe('http://localhost:80/api/admin/ai/saveThing/v1');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ id: 'abc' }));
  });
});
