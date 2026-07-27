import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerProjectConfig } from './projectConfig';
import { invokeRoutedHttp } from './routedHttpInvocation';

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  vi.restoreAllMocks();
  registerProjectConfig({ session: { basedToken: true } });
});

describe('invokeRoutedHttp', () => {
  it('encodes typed GET data losslessly in the reserved routed query value', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ status: 'success', value: 3 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await invokeRoutedHttp<{ status: 'success'; value: number }>({
      path: '/api/admin/getThing/v1',
      method: 'GET',
      data: { count: 3, nested: { enabled: true } },
    });

    expect(result).toEqual({
      kind: 'response',
      response: { status: 'success', value: 3 },
      httpStatus: 200,
    });
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    const parsed = new URL(requestedUrl, 'http://localhost');
    expect(JSON.parse(parsed.searchParams.get('__luckystack_data') ?? '{}')).toEqual({
      count: 3,
      nested: { enabled: true },
    });
  });

  it('parses fragmented SSE stream events and returns the final envelope', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': connected\n\nevent: stream\ndata: {"chunk":"a"}\n'));
        controller.enqueue(encoder.encode('\nevent: final\ndata: {"status":"success","result":{"done":true}}\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })));
    const onStream = vi.fn();

    const result = await invokeRoutedHttp<{ status: 'success'; result: { done: boolean } }, { chunk: string }>({
      path: '/sync/admin/run/v1',
      method: 'POST',
      data: { data: {}, receiver: 'room-1' },
      stream: onStream,
    });

    expect(onStream).toHaveBeenCalledWith({ chunk: 'a' });
    expect(result).toMatchObject({
      kind: 'response',
      response: { status: 'success', result: { done: true } },
    });
  });

  it('rejects a JSON response that is not a framework envelope object', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('not-an-envelope')));

    const result = await invokeRoutedHttp({
      path: '/api/admin/run/v1',
      method: 'POST',
      data: {},
    });

    expect(result).toEqual({ kind: 'invalid-response' });
  });

  it('does not start a request when a caller signal is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    const result = await invokeRoutedHttp({
      path: '/api/admin/run/v1',
      method: 'POST',
      data: {},
      signals: [controller.signal],
    });

    expect(result).toEqual({ kind: 'aborted' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('distinguishes an invocation timeout from caller cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })));

    const result = await invokeRoutedHttp({
      path: '/api/admin/run/v1',
      method: 'POST',
      data: {},
      timeoutMs: 5,
    });

    expect(result).toEqual({ kind: 'timeout' });
  });
});
