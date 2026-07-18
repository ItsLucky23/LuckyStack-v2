import { describe, expect, it, vi, beforeEach } from 'vitest';

//? SRV-O5 regression: the HTTP /api/* streaming path must NOT commit HTTP 200 +
//? text/event-stream headers (initSseResponse) BEFORE handleHttpApiRequest runs
//? its auth / rate-limit / route / method gates. A gate rejection on a streaming
//? request must surface as a real status code (401/403/404/429) JSON response —
//? the SSE response is opened LAZILY (first stream chunk, or a successful final).
//? We mock handleHttpApiRequest + the SSE helpers so the test pins WHEN the
//? stream is opened relative to the gate outcome.

const seam: {
  useHttpStream: boolean;
  apiResult: Record<string, unknown>;
  emitChunk: boolean;
  throwInHandler: boolean;
} = {
  useHttpStream: false,
  apiResult: { status: 'success', httpStatus: 200, result: { ok: true } },
  emitChunk: false,
  throwInHandler: false,
};

const handleHttpApiRequestMock = vi.fn(async (args: { stream?: (p: unknown) => void; abortSignal?: AbortSignal }) => {
  if (seam.throwInHandler) throw new Error('boom');
  if (seam.emitChunk) args.stream?.({ chunk: 'tok' });
  return seam.apiResult;
});
const initSseResponseMock = vi.fn();
const sendSseEventMock = vi.fn();

vi.mock('@luckystack/api', () => ({
  handleHttpApiRequest: (args: unknown) => handleHttpApiRequestMock(args as { stream?: (p: unknown) => void; abortSignal?: AbortSignal }),
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

import { handleApiRoute } from './apiRoute';
import { markDevToolsInitFailed, clearDevToolsInitError } from '../devToolsStatus';
import type { HttpRouteHandler } from './types';

interface FakeResCapture {
  writeHeadStatus?: number;
  ended: boolean;
  body?: string;
  headers: Record<string, string>;
}

const makeReqRes = (): {
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
  //? Capture req listeners so a test can simulate a client disconnect ('close').
  const reqListeners: Record<string, (() => void)[]> = {};
  const req = {
    headers: {} as Record<string, unknown>,
    on: (event: string, cb: () => void) => { (reqListeners[event] ??= []).push(cb); return req; },
  };
  const fireReq = (event: string): void => { for (const cb of reqListeners[event] ?? []) cb(); };
  const args = {
    req,
    res,
    routePath: '/api/examples/doThing/v1',
    queryString: '',
    method: 'POST',
    params: {},
    requestId: 'req-1',
  // luckystack-allow no-as-any: test fake-req/res boundary — supplies only the members handleApiRoute touches, not the full IncomingMessage/ServerResponse surface (mirrors healthRoutes.test.ts)
  } as unknown as Parameters<HttpRouteHandler>[0];
  return { args, cap, fireReq };
};

beforeEach(() => {
  vi.clearAllMocks();
  seam.useHttpStream = false;
  seam.apiResult = { status: 'success', httpStatus: 200, result: { ok: true } };
  seam.emitChunk = false;
  seam.throwInHandler = false;
  //? Module-level status — reset so a leaked failure from one test can't turn
  //? every other test's route into a 503.
  clearDevToolsInitError();
});

describe('handleApiRoute — dev-tools init failure surfaces the real reason', () => {
  it('returns a 503 naming the cause instead of routing into an empty registry', async () => {
    markDevToolsInitFailed(new Error('route naming validation failed: badFile.ts'));

    const { args, cap } = makeReqRes();
    const result = await handleApiRoute(args);

    expect(result).toBe(true);
    expect(cap.writeHeadStatus).toBe(503);
    //? The handler must short-circuit BEFORE delegating to the (empty) route map.
    expect(handleHttpApiRequestMock).not.toHaveBeenCalled();
    const body = JSON.parse(cap.body ?? '{}');
    expect(body).toMatchObject({ status: 'error', errorCode: 'api.devToolsUnavailable' });
    //? WHY + how to recover must be in the response, not just the log.
    expect(body.detail).toContain('route naming validation failed: badFile.ts');
    expect(body.detail).toContain('RESTART');
  });

  it('does not interfere once the failure is cleared (healthy dev)', async () => {
    const { args, cap } = makeReqRes();
    await handleApiRoute(args);

    expect(handleHttpApiRequestMock).toHaveBeenCalledTimes(1);
    expect(cap.writeHeadStatus).toBe(200);
  });
});

describe('handleApiRoute — SSE opens only after the gates pass (#5)', () => {
  it('streaming request + gate rejection → real status JSON, SSE never opened', async () => {
    seam.useHttpStream = true;
    seam.apiResult = { status: 'error', httpStatus: 401, errorCode: 'auth.required' };

    const { args, cap } = makeReqRes();
    await handleApiRoute(args);

    //? The gate failure must NOT have committed a 200 + event-stream response.
    expect(initSseResponseMock).not.toHaveBeenCalled();
    expect(sendSseEventMock).not.toHaveBeenCalled();
    expect(cap.writeHeadStatus).toBe(401);
    expect(cap.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(cap.body ?? '{}')).toMatchObject({ status: 'error', errorCode: 'auth.required' });
  });

  it('streaming request + success → SSE opened, final event sent', async () => {
    seam.useHttpStream = true;
    seam.apiResult = { status: 'success', httpStatus: 200, result: { ok: true } };

    const { args, cap } = makeReqRes();
    await handleApiRoute(args);

    expect(initSseResponseMock).toHaveBeenCalledTimes(1);
    expect(sendSseEventMock).toHaveBeenCalledWith(expect.objectContaining({ event: 'final' }));
    expect(cap.ended).toBe(true);
    //? No JSON status write on the success-stream path.
    expect(cap.writeHeadStatus).toBeUndefined();
  });

  it('streaming request emitting a chunk lazily opens SSE before the final', async () => {
    seam.useHttpStream = true;
    seam.emitChunk = true;

    const { args } = makeReqRes();
    await handleApiRoute(args);

    expect(initSseResponseMock).toHaveBeenCalledTimes(1);
    const events = sendSseEventMock.mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(events).toContain('stream');
    expect(events).toContain('final');
  });

  it('non-streaming request + gate rejection → status JSON (unchanged behaviour)', async () => {
    seam.useHttpStream = false;
    seam.apiResult = { status: 'error', httpStatus: 429, errorCode: 'api.rateLimitExceeded' };

    const { args, cap } = makeReqRes();
    await handleApiRoute(args);

    expect(initSseResponseMock).not.toHaveBeenCalled();
    expect(cap.writeHeadStatus).toBe(429);
    expect(JSON.parse(cap.body ?? '{}')).toMatchObject({ status: 'error', errorCode: 'api.rateLimitExceeded' });
  });

  it('passes an abortSignal to the handler that aborts on client disconnect (#7)', async () => {
    seam.useHttpStream = false;
    let capturedSignal: AbortSignal | undefined;
    handleHttpApiRequestMock.mockImplementationOnce(async (args: { abortSignal?: AbortSignal }) => {
      capturedSignal = args.abortSignal;
      return seam.apiResult;
    });

    const { args, fireReq } = makeReqRes();
    await handleApiRoute(args);

    //? The route must supply a real AbortSignal (was previously unwired → handlers
    //? kept running after the client left).
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
    //? A client disconnect ('close') aborts it.
    fireReq('close');
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('streaming request whose handler throws BEFORE any chunk → real 500 JSON, not an SSE error', async () => {
    seam.useHttpStream = true;
    seam.throwInHandler = true;

    const { args, cap } = makeReqRes();
    await handleApiRoute(args);

    //? Stream never opened (no chunk) → headers unwritten → emit a real 500 status.
    expect(initSseResponseMock).not.toHaveBeenCalled();
    expect(cap.writeHeadStatus).toBe(500);
    expect(JSON.parse(cap.body ?? '{}')).toMatchObject({ status: 'error' });
  });
});
