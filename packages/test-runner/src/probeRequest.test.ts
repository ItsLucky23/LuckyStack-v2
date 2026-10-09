import { describe, it, expect, vi, afterEach } from 'vitest';
import { ROUTED_DATA_QUERY_KEY } from '@luckystack/core';

import { createHttpProbeTransport, sendProbe } from './probeRequest';
import type { EndpointDescriptor } from './types';

//? The probe owns the wire: these pin the two encodings the sweeps used to get
//? wrong or never had — a GET payload rides the query string (it used to be
//? dropped, so every GET route with a required field failed validation), and a
//? sync probe over HTTP is wrapped in the `{ data, receiver }` envelope.

const originalFetch = globalThis.fetch;

const fetchMock = (): ReturnType<typeof vi.fn<(url: URL | RequestInfo, init?: RequestInit) => Promise<Response>>> => {
  const mock = vi.fn((_url: URL | RequestInfo, _init?: RequestInit): Promise<Response> =>
    Promise.resolve(new Response(JSON.stringify({ status: 'success' }), { status: 200 })));
  globalThis.fetch = mock;
  return mock;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const endpoint = (overrides: Partial<EndpointDescriptor>): EndpointDescriptor => ({
  page: 'billing',
  name: 'getInvoice',
  version: 'v1',
  method: 'GET',
  fullPath: 'api/billing/getInvoice/v1',
  ...overrides,
});

describe('sendProbe', () => {
  it('encodes a GET payload into the query string and sends no body', async () => {
    const mock = fetchMock();
    await sendProbe({ url: 'http://h/api/billing/getInvoice/v1', method: 'GET', baseUrl: 'http://h', body: { id: 'x1' }, requestTimeoutMs: 1000 });
    const [url, init] = mock.mock.calls[0] ?? [];
    const parsed = new URL(String(url));
    expect(JSON.parse(parsed.searchParams.get(ROUTED_DATA_QUERY_KEY) ?? 'null')).toStrictEqual({ id: 'x1' });
    expect(init?.body).toBeUndefined();
  });

  it('sends a POST payload as the JSON body, URL untouched', async () => {
    const mock = fetchMock();
    await sendProbe({ url: 'http://h/api/billing/pay/v1', method: 'POST', baseUrl: 'http://h', body: { amount: 3 }, requestTimeoutMs: 1000 });
    const [url, init] = mock.mock.calls[0] ?? [];
    expect(url).toBe('http://h/api/billing/pay/v1');
    expect(init?.body).toBe(JSON.stringify({ amount: 3 }));
  });

  it('returns the HTTP status and parsed envelope', async () => {
    fetchMock();
    const response = await sendProbe({ url: 'http://h/x', method: 'POST', baseUrl: 'http://h', body: {}, requestTimeoutMs: 1000 });
    expect(response).toStrictEqual({ httpStatus: 200, parsed: { status: 'success' } });
  });
});

describe('createHttpProbeTransport', () => {
  it('wraps a sync probe in { data, receiver } and posts it to /sync/...', async () => {
    const mock = fetchMock();
    const transport = createHttpProbeTransport({ syncReceiver: 'lstest-room-1' });
    await transport.send({
      endpoint: endpoint({ name: 'send', method: 'POST', fullPath: 'sync/chat/send/v1', page: 'chat', kind: 'sync' }),
      baseUrl: 'http://h/',
      body: { message: 'hi' },
      requestTimeoutMs: 1000,
    });
    const [url, init] = mock.mock.calls[0] ?? [];
    expect(url).toBe('http://h/sync/chat/send/v1');
    expect(JSON.parse(String(init?.body))).toStrictEqual({ data: { message: 'hi' }, receiver: 'lstest-room-1' });
  });

  it('sends an API probe payload unwrapped', async () => {
    const mock = fetchMock();
    await createHttpProbeTransport().send({
      endpoint: endpoint({ name: 'pay', method: 'POST', fullPath: 'api/billing/pay/v1' }),
      baseUrl: 'http://h',
      body: { amount: 1 },
      requestTimeoutMs: 1000,
    });
    expect(JSON.parse(String(mock.mock.calls[0]?.[1]?.body))).toStrictEqual({ amount: 1 });
  });
});
