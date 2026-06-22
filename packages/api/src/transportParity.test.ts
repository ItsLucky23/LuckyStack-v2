import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';

//? TRANSPORT-PARITY CONFORMANCE SUITE (core-transport bucket-3).
//?
//? Both API transports — `handleApiRequest` (socket.io) and
//? `handleHttpApiRequest` (raw HTTP) — are documented (packages/api/CLAUDE.md
//? "Pipeline order (authoritative)") to run the SAME pipeline sequence:
//?   parse → readSession → parseRoute → lookup → auth → rate-limit
//?   → (http: method) → validate → preExecute → execute → respond.
//?
//? This table-driven suite drives BOTH handlers through the SAME @luckystack/core
//? seam and asserts that the SHARED-CONTRACT stages behave identically on each
//? transport: the auth gate (401 login-required / 403 forbidden), unknown-route
//? (404), invalid-route-name (400), the per-route `validation: 'relaxed'` skip,
//? the GENERIC `api.invalidInputType` (no raw-validator-message leak), the
//? validation hook ordering, and the `preApiExecute` stop-signal short-circuit.
//?
//? It is a *characterization / conformance* pin, not a refactor: it adds NO
//? behavior. Its job is to make any future drift between the two transports on a
//? shared gate FAIL a test. Where the transports INTENTIONALLY diverge
//? (rate-limit IP keying, success-envelope shape) the divergence is documented
//? in codebase-scan-14-06-MERGED/LOW_ANALYSIS/core-transport.md (S21/S22) and is
//? deliberately NOT asserted equal here.

//? --- shared mutable seam state, reset per case ---
interface SeamState {
  projectConfig: {
    logging: { devLogs: boolean; stream: boolean };
    dev: { warnOnMissingInputType: boolean };
    rateLimiting: { defaultApiLimit: number | false; defaultIpLimit: number | false; windowMs: number; skipLoopbackInDev: boolean };
    http: { trustProxy: boolean };
    api: { requestTimeoutMs: number | false };
  };
  session: { id: string; language?: string } | null;
  apisObject: Record<string, unknown>;
  functionsObject: Record<string, unknown>;
  validateRequestResult: { status: 'success' } | { status: 'error'; errorCode?: string; errorParams?: unknown; httpStatus?: number };
  rateLimitResults: { allowed: boolean; resetIn: number }[];
  inferredMethod: 'GET' | 'POST' | 'PUT' | 'DELETE';
  inputValidation: { status: 'success' } | { status: 'error'; message: string };
  parsedRoute:
    | { status: 'error' }
    | { status: 'success'; normalizedFullName: string; serviceRoute: { normalizedRouteName: string } };
  hookResults: Record<string, { stopped: boolean; signal?: { errorCode: string; httpStatus?: number } }>;
}

const defaultSeam = (): SeamState => ({
  projectConfig: {
    logging: { devLogs: false, stream: false },
    dev: { warnOnMissingInputType: false },
    rateLimiting: { defaultApiLimit: false, defaultIpLimit: false, windowMs: 60_000, skipLoopbackInDev: false },
    http: { trustProxy: false },
    api: { requestTimeoutMs: false },
  },
  session: { id: 'user-1' },
  apisObject: {},
  functionsObject: { ping: () => 'pong' },
  validateRequestResult: { status: 'success' },
  rateLimitResults: [],
  inferredMethod: 'POST',
  inputValidation: { status: 'success' },
  parsedRoute: { status: 'success', normalizedFullName: 'examples/doThing/v1', serviceRoute: { normalizedRouteName: 'examples/doThing' } },
  hookResults: {},
});

let seam: SeamState = defaultSeam();

const dispatchHookMock = vi.fn((name: string, _payload?: unknown) => Promise.resolve(seam.hookResults[name] ?? { stopped: false }));
const checkRateLimitMock = vi.fn((_args?: unknown) => Promise.resolve(seam.rateLimitResults.shift() ?? { allowed: true, resetIn: 0 }));
const validateRequestMock = vi.fn((_args?: unknown) => seam.validateRequestResult);
const inferHttpMethodMock = vi.fn((_name?: string) => seam.inferredMethod);
const validateInputByTypeMock = vi.fn(() => Promise.resolve(seam.inputValidation));
const getSessionMock = vi.fn((_token?: string | null) => Promise.resolve(seam.session));

vi.mock('@luckystack/core', () => ({
  getProjectConfig: () => seam.projectConfig,
  runWithErrorTrackerIdentityScope: <T>(fn: () => T): T => fn(),
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- no-op identity seam
  setCurrentErrorTrackerIdentity: () => {},
  readSession: (token: string | null) => getSessionMock(token),
  performLogout: () => Promise.resolve(),
  getRuntimeApiMaps: () => Promise.resolve({ apisObject: seam.apisObject, functionsObject: seam.functionsObject }),
  validateRequest: (args: unknown) => validateRequestMock(args),
  checkRateLimit: (args: unknown) => checkRateLimitMock(args),
  inferHttpMethod: (name: string) => inferHttpMethodMock(name),
  //? Tuple-shape stand-in for the framework tryCatch.
  tryCatch: async (fn: () => Promise<unknown>) => {
    try {
      return [null, await fn()];
    } catch (error) {
      return [error, null];
    }
  },
  parseTransportRouteName: () => seam.parsedRoute,
  validateInputByType: () => validateInputByTypeMock(),
  dispatchHook: (name: string, payload: unknown) => dispatchHookMock(name, payload),
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  //? IP resolution seam the socket handler funnels rate-limit keys through.
  resolveClientIp: () => '127.0.0.1',
  //? Loopback detection used to skip the global IP bucket in dev; always false
  //? so both transports run their full bucket logic in these tests.
  isLoopbackIp: (_ip: string) => false,
  //? Socket lifecycle seams (consumed via _shared/requestLifecycle.ts).
  registerApiAbortController: () => 'abort-key',
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- no-op unregister seam
  unregisterApiAbortController: () => {},
  buildApiStreamEventName: (i: number) => `api-stream-${i}`,
  buildApiResponseEventName: (i: number) => `api-response-${i}`,
  socketEventNames: { disconnect: 'disconnect' },
  defaultHttpStatusForResponse: ({ status, explicitHttpStatus }: { status: 'success' | 'error'; explicitHttpStatus?: number }) =>
    explicitHttpStatus ?? (status === 'success' ? 200 : 500),
  extractLanguageFromHeader: (header?: string | string[]) =>
    typeof header === 'string' ? header : (Array.isArray(header) ? header[0] : undefined),
  normalizeErrorResponse: ({
    response,
    fallbackHttpStatus,
  }: {
    response: { status: 'error'; errorCode?: string; errorParams?: unknown; httpStatus?: number };
    fallbackHttpStatus?: number;
  }) => ({
    status: 'error',
    errorCode: response.errorCode,
    errorParams: response.errorParams,
    message: response.errorCode,
    httpStatus: response.httpStatus ?? fallbackHttpStatus ?? 500,
  }),
  //? Identity formatter — pass the envelope through untouched.
  applyErrorFormatter: ({ response }: { response: unknown }) => response,
}));

//? Imported AFTER the mock registration so both handlers bind to it.
import { handleHttpApiRequest } from './handleHttpApiRequest';
import handleApiRequest from './handleApiRequest';

//? Normalized observable an outcome from EITHER transport collapses to, so a
//? single table can assert both. The socket handler emits onto a fake socket;
//? the HTTP handler returns. We read both back into the same shape.
interface Observed {
  status: 'success' | 'error';
  httpStatus?: number;
  errorCode?: string;
  raw: Record<string, unknown>;
}

const registerRoute = (overrides: Record<string, unknown> = {}): void => {
  seam.apisObject['examples/doThing/v1'] = {
    auth: { login: false, additional: [] },
    main: vi.fn(() => Promise.resolve({ status: 'success', result: { ok: true } })),
    ...overrides,
  };
};

//? Drive the HTTP transport and normalize the returned envelope.
const driveHttp = async (): Promise<Observed> => {
  const res = (await handleHttpApiRequest({
    name: 'api/examples/doThing/v1',
    data: { foo: 'bar' },
    token: 'tok-1',
  })) as Record<string, unknown>;
  return {
    status: res.status as 'success' | 'error',
    httpStatus: res.httpStatus as number | undefined,
    errorCode: res.errorCode as string | undefined,
    raw: res,
  };
};

//? Drive the socket transport and normalize the LAST emitted response envelope.
//? `{} as Socket` (the established fake-socket pattern in this repo, see
//? packages/presence/src/activity/*.test.ts) then assign only the members the
//? API handler + its lifecycle helper touch — avoids the banned `as unknown as`
//? double-cast while not having to satisfy the full socket.io Socket surface.
const driveSocket = async (): Promise<Observed> => {
  let emitted: Record<string, unknown> | undefined;
  //? Established fake-socket pattern in this repo (packages/presence tests):
  //? assert an object literal to Socket at the boundary, supplying only the
  //? members the handler + its lifecycle helper touch. `id` / `handshake` are
  //? read-only on the real Socket type, so they're set here in the literal (not
  //? mutated afterwards). The full socket.io Socket surface can't be satisfied
  //? as a literal, so `consistent-type-assertions` is suppressed at this seam.
  const noopReturnSocket = (): unknown => socket;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- fake-socket boundary
  const socket = {
    id: 'sock-1',
    handshake: { address: '127.0.0.1', headers: {} },
    emit: (_event: string, payload: Record<string, unknown>) => { emitted = payload; return socket; },
    once: noopReturnSocket,
    off: noopReturnSocket,
  } as unknown as Socket;

  await handleApiRequest({
    msg: { name: 'api/examples/doThing/v1', data: { foo: 'bar' }, responseIndex: 0 },
    socket,
    token: 'tok-1',
  });

  const res = emitted ?? {};
  return {
    status: res.status as 'success' | 'error',
    httpStatus: res.httpStatus as number | undefined,
    errorCode: res.errorCode as string | undefined,
    raw: res,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  seam = defaultSeam();
});

//? --- the parity table: each scenario configures the shared seam, then both
//? transports are driven and their shared-contract observable is compared. ---
interface ParityCase {
  title: string;
  arrange: () => void;
  expect: { status: 'success' | 'error'; httpStatus?: number; errorCode?: string };
}

const PARITY_CASES: ParityCase[] = [
  {
    title: 'unknown route → api.notFound / 404',
    arrange: () => { /* no route registered */ },
    expect: { status: 'error', httpStatus: 404, errorCode: 'api.notFound' },
  },
  {
    title: 'invalid route name → routing.invalidServiceRouteName / 400',
    arrange: () => { seam.parsedRoute = { status: 'error' }; },
    expect: { status: 'error', httpStatus: 400, errorCode: 'routing.invalidServiceRouteName' },
  },
  {
    title: 'login required + no session → auth.required / 401',
    arrange: () => {
      seam.session = null;
      registerRoute({ auth: { login: true, additional: [] } });
    },
    expect: { status: 'error', httpStatus: 401, errorCode: 'auth.required' },
  },
  {
    title: 'validateRequest forbids → propagates errorCode + httpStatus',
    arrange: () => {
      registerRoute();
      seam.validateRequestResult = { status: 'error', errorCode: 'auth.notAdmin', httpStatus: 418 };
    },
    expect: { status: 'error', httpStatus: 418, errorCode: 'auth.notAdmin' },
  },
  {
    title: 'validateRequest errors without codes → auth.forbidden / 403',
    arrange: () => {
      registerRoute();
      seam.validateRequestResult = { status: 'error' };
    },
    expect: { status: 'error', httpStatus: 403, errorCode: 'auth.forbidden' },
  },
  {
    title: 'public route + anonymous → success (no bare session gate on either transport)',
    arrange: () => {
      seam.session = null;
      registerRoute({ auth: { login: false, additional: [] } });
    },
    expect: { status: 'success', httpStatus: 200 },
  },
  {
    title: 'strict-mode validation failure → GENERIC api.invalidInputType / 400',
    arrange: () => {
      registerRoute();
      seam.inputValidation = { status: 'error', message: 'foo must be a number' };
    },
    expect: { status: 'error', httpStatus: 400, errorCode: 'api.invalidInputType' },
  },
  {
    title: 'preApiExecute stop signal → short-circuits with signal code + status',
    arrange: () => {
      registerRoute();
      seam.hookResults.preApiExecute = { stopped: true, signal: { errorCode: 'hook.blocked', httpStatus: 451 } };
    },
    expect: { status: 'error', httpStatus: 451, errorCode: 'hook.blocked' },
  },
  {
    title: 'preApiExecute stop signal without httpStatus → defaults to 403',
    arrange: () => {
      registerRoute();
      seam.hookResults.preApiExecute = { stopped: true, signal: { errorCode: 'hook.blocked' } };
    },
    expect: { status: 'error', httpStatus: 403, errorCode: 'hook.blocked' },
  },
  {
    title: 'preApiRespond stop signal → localized error envelope',
    arrange: () => {
      registerRoute();
      seam.hookResults.preApiRespond = { stopped: true, signal: { errorCode: 'respond.blocked', httpStatus: 409 } };
    },
    expect: { status: 'error', httpStatus: 409, errorCode: 'respond.blocked' },
  },
];

describe('transport parity — shared-contract gates behave identically on socket + HTTP', () => {
  for (const parityCase of PARITY_CASES) {
    it(parityCase.title, async () => {
      //? HTTP transport.
      seam = defaultSeam();
      parityCase.arrange();
      const http = await driveHttp();

      //? Socket transport — fully independent seam reset so neither run leaks.
      seam = defaultSeam();
      parityCase.arrange();
      const socket = await driveSocket();

      //? Both transports must produce the SAME shared-contract outcome.
      expect(http.status).toBe(parityCase.expect.status);
      expect(socket.status).toBe(parityCase.expect.status);
      expect(http.status).toBe(socket.status);

      if (parityCase.expect.httpStatus !== undefined) {
        expect(http.httpStatus).toBe(parityCase.expect.httpStatus);
        expect(socket.httpStatus).toBe(parityCase.expect.httpStatus);
      }
      if (parityCase.expect.errorCode !== undefined) {
        expect(http.errorCode).toBe(parityCase.expect.errorCode);
        expect(socket.errorCode).toBe(parityCase.expect.errorCode);
      }
    });
  }
});

describe('transport parity — security invariant: raw validator message never leaks on either transport', () => {
  it('neither transport echoes the raw validator message to the client', async () => {
    seam = defaultSeam();
    registerRoute();
    seam.inputValidation = { status: 'error', message: 'foo must be a number' };
    const http = await driveHttp();

    seam = defaultSeam();
    registerRoute();
    seam.inputValidation = { status: 'error', message: 'foo must be a number' };
    const socket = await driveSocket();

    expect(JSON.stringify(http.raw)).not.toContain('foo must be a number');
    expect(JSON.stringify(socket.raw)).not.toContain('foo must be a number');
  });

  it('both transports still route the DETAILED message to the postApiValidate hook', async () => {
    seam = defaultSeam();
    registerRoute();
    seam.inputValidation = { status: 'error', message: 'foo must be a number' };
    await driveHttp();
    const httpPost = dispatchHookMock.mock.calls.find((c) => c[0] === 'postApiValidate');
    expect(httpPost?.[1]).toMatchObject({ validation: { status: 'error', message: 'foo must be a number' }, transport: 'http' });

    vi.clearAllMocks();
    seam = defaultSeam();
    registerRoute();
    seam.inputValidation = { status: 'error', message: 'foo must be a number' };
    await driveSocket();
    const socketPost = dispatchHookMock.mock.calls.find((c) => c[0] === 'postApiValidate');
    expect(socketPost?.[1]).toMatchObject({ validation: { status: 'error', message: 'foo must be a number' }, transport: 'socket' });
  });
});

//? Hook-ordering reader shared by both transports. Lifted to module scope so the
//? helper isn't re-created per `describe` (unicorn/consistent-function-scoping).
const validateHookOrder = (): { pre: number; post: number } => {
  const names = dispatchHookMock.mock.calls.map((c) => c[0]);
  return { pre: names.indexOf('preApiValidate'), post: names.indexOf('postApiValidate') };
};

describe('transport parity — validation hook ordering matches on both transports', () => {
  it('preApiValidate precedes postApiValidate on HTTP', async () => {
    seam = defaultSeam();
    registerRoute();
    await driveHttp();
    const { pre, post } = validateHookOrder();
    expect(pre).toBeGreaterThanOrEqual(0);
    expect(pre).toBeLessThan(post);
  });

  it('preApiValidate precedes postApiValidate on socket', async () => {
    seam = defaultSeam();
    registerRoute();
    await driveSocket();
    const { pre, post } = validateHookOrder();
    expect(pre).toBeGreaterThanOrEqual(0);
    expect(pre).toBeLessThan(post);
  });
});

describe('transport parity — per-route validation:relaxed skips Zod on BOTH transports', () => {
  it('HTTP: relaxed route never calls validateInputByType and still succeeds', async () => {
    seam = defaultSeam();
    registerRoute({ validation: 'relaxed' });
    const http = await driveHttp();
    expect(http.status).toBe('success');
    expect(validateInputByTypeMock).not.toHaveBeenCalled();
  });

  it('socket: relaxed route never calls validateInputByType and still succeeds', async () => {
    seam = defaultSeam();
    registerRoute({ validation: 'relaxed' });
    const socket = await driveSocket();
    expect(socket.status).toBe('success');
    expect(validateInputByTypeMock).not.toHaveBeenCalled();
  });
});

//? --- socket-only paths not present on HTTP transport ---

describe('socket-only paths', () => {
  it('silently drops a message with no responseIndex instead of emitting a response', async () => {
    //? API-O18 — the socket handler returns early (no emit) when `responseIndex`
    //? is not a number. There is no HTTP equivalent; the HTTP route always has
    //? a response channel. Pin the silent-drop so regressions are caught.
    seam = defaultSeam();
    registerRoute();
    let emitted: Record<string, unknown> | undefined;
    const noopReturnSocket = (): unknown => socket;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- fake-socket boundary
    const socket = {
      id: 'sock-1',
      handshake: { address: '127.0.0.1', headers: {} },
      emit: (_event: string, payload: Record<string, unknown>) => { emitted = payload; return socket; },
      once: noopReturnSocket,
      off: noopReturnSocket,
    } as unknown as Socket;

    await handleApiRequest({
      msg: { name: 'api/examples/doThing/v1', data: { foo: 'bar' } } as Parameters<typeof handleApiRequest>[0]['msg'],
      socket,
      token: 'tok-1',
    });

    //? No response emitted — the handler drops the message silently.
    expect(emitted).toBeUndefined();
  });

  it('preSocketMessage stop signal rejects before route resolution', async () => {
    //? API-O18 — `preSocketMessage` is socket-only (no HTTP equivalent).
    //? A stop signal must short-circuit before readSession / route lookup.
    seam = defaultSeam();
    seam.hookResults.preSocketMessage = { stopped: true, signal: { errorCode: 'socket.gated', httpStatus: 403 } };
    let emitted: Record<string, unknown> | undefined;
    const noopReturnSocket = (): unknown => socket;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- fake-socket boundary
    const socket = {
      id: 'sock-1',
      handshake: { address: '127.0.0.1', headers: {} },
      emit: (_event: string, payload: Record<string, unknown>) => { emitted = payload; return socket; },
      once: noopReturnSocket,
      off: noopReturnSocket,
    } as unknown as Socket;

    await handleApiRequest({
      msg: { name: 'api/examples/doThing/v1', data: { foo: 'bar' }, responseIndex: 0 },
      socket,
      token: 'tok-1',
    });

    expect(emitted?.status).toBe('error');
    expect(emitted?.errorCode).toBe('socket.gated');
    //? Route lookup must NOT have happened — the stop fires before readSession.
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it('system/logout shortcut routes through emitApiResult so respond hooks fire', async () => {
    //? API-O6 — logout routes through `emitApiResult`, which dispatches
    //? `preApiRespond` / `transformApiResponse` / `postApiRespond`. Pin the
    //? hook sequence so a future refactor can't silently regress it.
    seam = defaultSeam();
    seam.parsedRoute = {
      status: 'success',
      normalizedFullName: 'system/logout/v1',
      serviceRoute: { normalizedRouteName: 'system/logout' },
    };
    let emitted: Record<string, unknown> | undefined;
    const noopReturnSocket = (): unknown => socket;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- fake-socket boundary
    const socket = {
      id: 'sock-1',
      handshake: { address: '127.0.0.1', headers: {} },
      emit: (_event: string, payload: Record<string, unknown>) => { emitted = payload; return socket; },
      once: noopReturnSocket,
      off: noopReturnSocket,
    } as unknown as Socket;

    await handleApiRequest({
      msg: { name: 'system/logout', data: {}, responseIndex: 0 },
      socket,
      token: 'tok-1',
    });

    expect(emitted?.status).toBe('success');
    //? Respond-phase hooks must have fired.
    const hookNames = dispatchHookMock.mock.calls.map((c) => c[0] as string);
    expect(hookNames).toContain('preApiRespond');
    expect(hookNames).toContain('postApiRespond');
  });
});
