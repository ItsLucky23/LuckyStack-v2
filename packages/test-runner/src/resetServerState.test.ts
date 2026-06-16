import { describe, it, expect, vi, afterEach } from 'vitest';

import { resetServerState } from './resetServerState';

//? `resetServerState` POSTs to `/_test/reset` and returns the boolean `response.ok`.
//? The only infra dependency is global `fetch`, which is stubbed per-case. These
//? tests pin the contract that matters to the rate-limit sweep: ok=true→true,
//? non-ok/throw→false, AND that a server which accepts the connection but never
//? responds is bounded by the AbortController timeout (returns false, not a hang).

const originalFetch = globalThis.fetch;

const okResponse = (ok: boolean): Response => new Response(null, { status: ok ? 204 : 500 });

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('resetServerState', () => {
  it('returns true when the reset endpoint responds ok', async () => {
    globalThis.fetch = vi.fn((): Promise<Response> => Promise.resolve(okResponse(true)));
    expect(await resetServerState({ baseUrl: 'http://localhost:3000' })).toBe(true);
  });

  it('returns false when the reset endpoint responds non-ok', async () => {
    globalThis.fetch = vi.fn((): Promise<Response> => Promise.resolve(okResponse(false)));
    expect(await resetServerState({ baseUrl: 'http://localhost:3000' })).toBe(false);
  });

  it('returns false when fetch rejects', async () => {
    globalThis.fetch = vi.fn((): Promise<Response> => Promise.reject(new Error('ECONNREFUSED')));
    expect(await resetServerState({ baseUrl: 'http://localhost:3000' })).toBe(false);
  });

  it('strips a trailing slash and posts the token header when provided', async () => {
    const fetchMock = vi.fn((_url: URL | RequestInfo, _init?: RequestInit): Promise<Response> => Promise.resolve(okResponse(true)));
    globalThis.fetch = fetchMock;
    await resetServerState({ baseUrl: 'http://localhost:3000/', token: 'secret' });
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('http://localhost:3000/_test/reset');
    expect((call?.[1]?.headers as Record<string, string>)['X-Test-Reset-Token']).toBe('secret');
  });

  it('returns false (does not hang) when the server never responds, via the abort timeout', async () => {
    //? Simulate a connection that is accepted but never answers: fetch only
    //? rejects once its AbortSignal fires. A short requestTimeoutMs keeps the
    //? test fast while exercising the same controller.abort() path.
    globalThis.fetch = vi.fn((_url: URL | RequestInfo, init?: RequestInit): Promise<Response> => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')); });
    }));
    expect(await resetServerState({ baseUrl: 'http://localhost:3000', requestTimeoutMs: 10 })).toBe(false);
  });
});
