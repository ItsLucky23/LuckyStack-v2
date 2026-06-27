import { describe, expect, it, vi, beforeEach } from 'vitest';

//? Parity with apiRoute (SRV-O5/O6): the HTTP /sync/* streaming path must open the
//? SSE response LAZILY (after the method/auth/route gates pass), so a gate
//? rejection surfaces as a real status code instead of 200 + an SSE-wrapped error;
//? and it must wire the handler's abortSignal to client disconnect.

const seam: {
  useHttpStream: boolean;
  syncResult: Record<string, unknown>;
  emitChunk: boolean;
} = {
  useHttpStream: false,
  syncResult: { status: 'success', httpStatus: 200, result: { ok: true } },
  emitChunk: false,
};

const handleHttpSyncRequestMock = vi.fn(async (args: { stream?: (p: unknown) => void; abortSignal?: AbortSignal }) => {
  if (seam.emitChunk) args.stream?.({ chunk: 'tok' });
  return seam.syncResult;
});
const initSseResponseMock = vi.fn();
const sendSseEventMock = vi.fn();

vi.mock('../capabilities', () => ({
  capabilities: { sync: true },
  getSync: () => Promise.resolve({ handleHttpSyncRequest: handleHttpSyncRequestMock }),
}));

vi.mock('../sse', () => ({
  initSseResponse: (res: unknown) => initSseResponseMock(res),
  sendSseEvent: (args: unknown) => sendSseEventMock(args),
  shouldUseHttpStream: () => seam.useHttpStream,
}));

vi.mock('./resolveRequesterIp', () => ({ resolveRequesterIp: () => '127.0.0.1' }));

vi.mock('@luckystack/core', () => ({
  extractTokenFromRequest: () => 'tok-1',
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  captureException: vi.fn(),
  dispatchHook: vi.fn(() => Promise.resolve({ stopped: false })),
  tryCatch: async (fn: () => Promise<unknown>) => {
    try { return [null, await fn()]; } catch (error) { return [error, null]; }
  },
}));

import { handleSyncRoute } from './syncRoute';
import type { HttpRouteHandler } from './types';

interface FakeResCapture {
  writeHeadStatus?: number;
  ended: boolean;
  body?: string;
  headers: Record<string, string>;
}

const makeReqRes = (method = 'POST'): {
  args: Parameters<HttpRouteHandler>[0];
  cap: FakeResCapture;
  fireReq: (event: string) => void;
} => {
  const cap: FakeResCapture = { ended: false, headers: {} };
  const res = {
    get writableEnded() { return cap.ended; },
    setHeader: (k: string, v: string) => { cap.headers[k] = v; },
    writeHead: (code: number) => { cap.writeHeadStatus = code; },
    end: (chunk?: string) => { cap.ended = true; cap.body = chunk; },
    on: () => res,
  };
  const reqListeners: Record<string, (() => void)[]> = {};
  const req = {
    headers: {} as Record<string, unknown>,
    on: (event: string, cb: () => void) => { (reqListeners[event] ??= []).push(cb); return req; },
  };
  const fireReq = (event: string): void => { for (const cb of reqListeners[event] ?? []) cb(); };
  const args = {
    req,
    res,
    routePath: '/sync/chat/send/v1',
    queryString: '',
    method,
    params: { data: { hello: 'world' }, receiver: 'room-1' },
    requestId: 'req-1',
  } as unknown as Parameters<HttpRouteHandler>[0]; // luckystack-allow no-as-any: test fake-req/res boundary — supplies only the members handleSyncRoute touches (mirrors apiRoute.test.ts / healthRoutes.test.ts)
  return { args, cap, fireReq };
};

beforeEach(() => {
  vi.clearAllMocks();
  seam.useHttpStream = false;
  seam.syncResult = { status: 'success', httpStatus: 200, result: { ok: true } };
  seam.emitChunk = false;
});

describe('handleSyncRoute — SSE opens only after the gates pass (#5 parity)', () => {
  it('streaming request + non-POST method → real 405 JSON, SSE never opened', async () => {
    seam.useHttpStream = true;
    const { args, cap } = makeReqRes('GET');
    await handleSyncRoute(args);

    expect(initSseResponseMock).not.toHaveBeenCalled();
    expect(cap.writeHeadStatus).toBe(405);
    expect(JSON.parse(cap.body ?? '{}')).toMatchObject({ status: 'error', errorCode: 'sync.methodNotAllowed' });
  });

  it('streaming request + gate-rejection result → real status JSON, SSE never opened', async () => {
    seam.useHttpStream = true;
    seam.syncResult = { status: 'error', httpStatus: 403, errorCode: 'sync.receiverNotAllowed' };
    const { args, cap } = makeReqRes();
    await handleSyncRoute(args);

    expect(initSseResponseMock).not.toHaveBeenCalled();
    expect(cap.writeHeadStatus).toBe(403);
    expect(JSON.parse(cap.body ?? '{}')).toMatchObject({ status: 'error', errorCode: 'sync.receiverNotAllowed' });
  });

  it('streaming request + success → SSE opened, final event sent', async () => {
    seam.useHttpStream = true;
    const { args, cap } = makeReqRes();
    await handleSyncRoute(args);

    expect(initSseResponseMock).toHaveBeenCalledTimes(1);
    expect(sendSseEventMock).toHaveBeenCalledWith(expect.objectContaining({ event: 'final' }));
    expect(cap.ended).toBe(true);
    expect(cap.writeHeadStatus).toBeUndefined();
  });

  it('streaming request emitting a chunk lazily opens SSE before the final', async () => {
    seam.useHttpStream = true;
    seam.emitChunk = true;
    const { args } = makeReqRes();
    await handleSyncRoute(args);

    expect(initSseResponseMock).toHaveBeenCalledTimes(1);
    const events = sendSseEventMock.mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(events).toContain('stream');
    expect(events).toContain('final');
  });

  it('passes an abortSignal to the handler that aborts on client disconnect (#8)', async () => {
    seam.useHttpStream = false;
    let capturedSignal: AbortSignal | undefined;
    handleHttpSyncRequestMock.mockImplementationOnce(async (args: { abortSignal?: AbortSignal }) => {
      capturedSignal = args.abortSignal;
      return seam.syncResult;
    });
    const { args, fireReq } = makeReqRes();
    await handleSyncRoute(args);

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
    fireReq('close');
    expect(capturedSignal?.aborted).toBe(true);
  });
});
