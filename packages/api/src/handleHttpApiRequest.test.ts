import { describe, it, expect, vi, beforeEach } from 'vitest';

//? Unit tests for the @luckystack/api HTTP transport adapter. The handler is
//? built around DI registry seams in @luckystack/core / @luckystack/login, so
//? we mock those module boundaries and drive the package's OWN pipeline logic
//? (name normalization, request-shape guards, auth -> rate-limit -> method ->
//? validate -> execute -> respond ordering, result-envelope assembly, hook
//? dispatch order, stop signals). No live socket / Redis / Prisma is touched.

//? --- mutable seam state, reset per test ---
interface SeamState {
  projectConfig: {
    logging: { devLogs: boolean; stream: boolean };
    dev: { warnOnMissingInputType: boolean };
    rateLimiting: { defaultApiLimit: number | false; defaultIpLimit: number | false; windowMs: number };
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

const seam: SeamState = {
  projectConfig: {
    logging: { devLogs: false, stream: false },
    dev: { warnOnMissingInputType: false },
    rateLimiting: { defaultApiLimit: false, defaultIpLimit: false, windowMs: 60_000 },
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
};

//? Recording spies so tests can assert ordering / call counts / arguments.
//? Promise-returning seams use Promise.resolve so the handler's `await` still
//? behaves while keeping the factory free of needless async wrappers.
const dispatchHookMock = vi.fn((name: string, _payload?: unknown) => Promise.resolve(seam.hookResults[name] ?? { stopped: false }));
const checkRateLimitMock = vi.fn((_args?: unknown) => Promise.resolve(seam.rateLimitResults.shift() ?? { allowed: true, resetIn: 0 }));
const validateRequestMock = vi.fn((_args?: unknown) => seam.validateRequestResult);
const inferHttpMethodMock = vi.fn((_name?: string) => seam.inferredMethod);
const validateInputByTypeMock = vi.fn(() => Promise.resolve(seam.inputValidation));
const getSessionMock = vi.fn((_token?: string | null) => Promise.resolve(seam.session));

vi.mock('@luckystack/login', () => ({
  getSession: (token: string | null) => getSessionMock(token),
}));

vi.mock('@luckystack/core', () => ({
  getProjectConfig: () => seam.projectConfig,
  getRuntimeApiMaps: () => Promise.resolve({ apisObject: seam.apisObject, functionsObject: seam.functionsObject }),
  validateRequest: (args: unknown) => validateRequestMock(args),
  checkRateLimit: (args: unknown) => checkRateLimitMock(args),
  inferHttpMethod: (name: string) => inferHttpMethodMock(name),
  //? Faithful tuple-shape stand-in for the framework tryCatch: resolves to
  //? [null, result] on success and [error, null] when the handler throws.
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
  //? Minimal but faithful stand-ins for the pure formatters the api package
  //? delegates to. The api package OWNS the decision of WHICH errorCode /
  //? fallback status to feed these; these stand-ins keep that decision
  //? observable in the returned envelope.
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
  //? Identity formatter — pass the envelope through untouched so tests can
  //? assert on the api package's own envelope assembly.
  applyErrorFormatter: ({ response }: { response: unknown }) => response,
}));

//? Imported AFTER the mocks are registered so the handler binds to them.
import { handleHttpApiRequest } from './handleHttpApiRequest';

const baseParams = () => {
  const data: Record<string, unknown> = { foo: 'bar' };
  return { name: 'api/examples/doThing/v1', data, token: 'tok-1' };
};

const registerRoute = (overrides: Record<string, unknown> = {}) => {
  seam.apisObject['examples/doThing/v1'] = {
    auth: { login: false, additional: [] },
    main: vi.fn(() => Promise.resolve({ status: 'success', result: { ok: true } })),
    ...overrides,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  seam.projectConfig = {
    logging: { devLogs: false, stream: false },
    dev: { warnOnMissingInputType: false },
    rateLimiting: { defaultApiLimit: false, defaultIpLimit: false, windowMs: 60_000 },
  };
  seam.session = { id: 'user-1' };
  seam.apisObject = {};
  seam.functionsObject = { ping: () => 'pong' };
  seam.validateRequestResult = { status: 'success' };
  seam.rateLimitResults = [];
  seam.inferredMethod = 'POST';
  seam.inputValidation = { status: 'success' };
  seam.parsedRoute = { status: 'success', normalizedFullName: 'examples/doThing/v1', serviceRoute: { normalizedRouteName: 'examples/doThing' } };
  seam.hookResults = {};
});

describe('handleHttpApiRequest — request-shape guards', () => {
  it('rejects an empty name with api.invalidName / 400 before any route lookup', async () => {
    const result = await handleHttpApiRequest({ ...baseParams(), name: '' });

    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(400);
    if (result.status === 'error') expect(result.errorCode).toBe('api.invalidName');
    //? Guard runs before route resolution, so the route map is never consulted.
    expect(validateInputByTypeMock).not.toHaveBeenCalled();
  });

  //? NOTE: the api.invalidDataObject guard (typeof data !== 'object' / null)
  //? is intentionally NOT unit-tested here. Reaching it requires passing a
  //? non-object as `data`, which the HttpApiRequestParams type forbids — the
  //? only way in would be an `as unknown as Record<string, unknown>` cast,
  //? which the LuckyStack house rules ban. The branch is defensive code for
  //? a TypeScript-impossible shape; left to integration / raw-HTTP coverage.
});

describe('handleHttpApiRequest — name normalization', () => {
  it('passes a bare name to parseTransportRouteName with the api/ prefix added', async () => {
    let seenValue: string | undefined;
    seam.parsedRoute = { status: 'error' };
    //? Capture the value parseTransportRouteName receives by failing parse and
    //? reading the errorParams the api package echoes back.
    const result = await handleHttpApiRequest({ ...baseParams(), name: 'examples/doThing/v1' });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.errorCode).toBe('routing.invalidServiceRouteName');
      const param = result.errorParams?.find((p) => p.key === 'name');
      seenValue = param?.value as string;
    }
    //? Bare name should have been normalized to the api/-prefixed form.
    expect(seenValue).toBe('api/examples/doThing/v1');
  });

  it('does not double-prefix a name that already starts with api/', async () => {
    seam.parsedRoute = { status: 'error' };
    const result = await handleHttpApiRequest({ ...baseParams(), name: 'api/examples/doThing/v1' });

    if (result.status === 'error') {
      const param = result.errorParams?.find((p) => p.key === 'name');
      expect(param?.value).toBe('api/examples/doThing/v1');
    }
  });
});

describe('handleHttpApiRequest — route resolution', () => {
  it('returns api.notFound / 404 when the route is not in the runtime map', async () => {
    //? No route registered.
    const result = await handleHttpApiRequest(baseParams());

    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(404);
    if (result.status === 'error') expect(result.errorCode).toBe('api.notFound');
  });

  it('returns routing.invalidServiceRouteName / 400 when parsing fails', async () => {
    seam.parsedRoute = { status: 'error' };
    const result = await handleHttpApiRequest(baseParams());

    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(400);
    if (result.status === 'error') expect(result.errorCode).toBe('routing.invalidServiceRouteName');
  });
});

describe('handleHttpApiRequest — auth gate', () => {
  it('returns auth.required / 401 when login is required and there is no user', async () => {
    seam.session = null;
    registerRoute({ auth: { login: true, additional: [] } });

    const result = await handleHttpApiRequest(baseParams());

    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(401);
    if (result.status === 'error') expect(result.errorCode).toBe('auth.required');
    //? Auth runs before validateRequest's additional predicates.
    expect(validateRequestMock).not.toHaveBeenCalled();
  });

  it('allows an anonymous call to a public route (login not required) — no bare session gate', async () => {
    //? Regression guard: this handler previously force-rejected EVERY anonymous
    //? request with auth.forbidden, diverging from the socket API handler and
    //? both sync handlers. Public routes must be callable without a session;
    //? validateRequest is the sole authority for `additional` auth predicates.
    seam.session = null;
    registerRoute({ auth: { login: false, additional: [] } });

    const result = await handleHttpApiRequest(baseParams());

    expect(result.status).toBe('success');
    expect(result.httpStatus).toBe(200);
    //? The auth gate delegated to validateRequest instead of short-circuiting.
    expect(validateRequestMock).toHaveBeenCalled();
  });

  it('propagates validateRequest failures with its errorCode and httpStatus', async () => {
    registerRoute();
    seam.validateRequestResult = { status: 'error', errorCode: 'auth.notAdmin', httpStatus: 418 };

    const result = await handleHttpApiRequest(baseParams());

    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(418);
    if (result.status === 'error') expect(result.errorCode).toBe('auth.notAdmin');
  });

  it('falls back to auth.forbidden / 403 when validateRequest errors without codes', async () => {
    registerRoute();
    seam.validateRequestResult = { status: 'error' };

    const result = await handleHttpApiRequest(baseParams());

    expect(result.httpStatus).toBe(403);
    if (result.status === 'error') expect(result.errorCode).toBe('auth.forbidden');
  });
});

describe('handleHttpApiRequest — rate limiting', () => {
  it('rejects with api.rateLimitExceeded / 429 when the per-route bucket is full', async () => {
    registerRoute({ rateLimit: 5 });
    seam.rateLimitResults = [{ allowed: false, resetIn: 30 }];

    const result = await handleHttpApiRequest(baseParams());

    expect(result.httpStatus).toBe(429);
    if (result.status === 'error') {
      expect(result.errorCode).toBe('api.rateLimitExceeded');
      expect(result.errorParams?.find((p) => p.key === 'seconds')?.value).toBe(30);
    }
    //? rateLimitExceeded hook fires with route/user scope.
    expect(dispatchHookMock).toHaveBeenCalledWith('rateLimitExceeded', expect.objectContaining({ scope: 'user' }));
  });

  it('skips the per-route bucket entirely when rateLimit is explicitly false', async () => {
    registerRoute({ rateLimit: false });

    const result = await handleHttpApiRequest(baseParams());

    expect(result.status).toBe('success');
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it('uses the global IP bucket and rejects when it is full', async () => {
    registerRoute({ rateLimit: false });
    seam.projectConfig.rateLimiting.defaultIpLimit = 100;
    seam.rateLimitResults = [{ allowed: false, resetIn: 12 }];

    const result = await handleHttpApiRequest({ ...baseParams(), requesterIp: '1.2.3.4' });

    expect(result.httpStatus).toBe(429);
    expect(dispatchHookMock).toHaveBeenCalledWith('rateLimitExceeded', expect.objectContaining({ scope: 'ip', ip: '1.2.3.4' }));
  });

  it('uses the config defaultApiLimit when the route does not declare rateLimit', async () => {
    registerRoute();
    seam.projectConfig.rateLimiting.defaultApiLimit = 10;

    await handleHttpApiRequest(baseParams());

    //? Per-route bucket consulted because defaultApiLimit > 0 and route omitted rateLimit.
    expect(checkRateLimitMock).toHaveBeenCalled();
  });
});

describe('handleHttpApiRequest — HTTP method check', () => {
  it('returns api.methodNotAllowed / 405 when the request method differs from the inferred method', async () => {
    registerRoute();
    seam.inferredMethod = 'GET';

    const result = await handleHttpApiRequest({ ...baseParams(), method: 'POST' });

    expect(result.httpStatus).toBe(405);
    if (result.status === 'error') {
      expect(result.errorCode).toBe('api.methodNotAllowed');
      expect(result.errorParams?.find((p) => p.key === 'method')?.value).toBe('GET');
    }
  });

  it('prefers a route-declared httpMethod over the inferred method', async () => {
    registerRoute({ httpMethod: 'PUT' });
    seam.inferredMethod = 'GET';

    //? Request matches the DECLARED method, so inferHttpMethod must not be used.
    const result = await handleHttpApiRequest({ ...baseParams(), method: 'PUT' });

    expect(result.status).toBe('success');
    expect(inferHttpMethodMock).not.toHaveBeenCalled();
  });

  it('defaults the request method to POST when none is supplied', async () => {
    registerRoute();
    seam.inferredMethod = 'POST';

    const result = await handleHttpApiRequest(baseParams());

    expect(result.status).toBe('success');
  });
});

describe('handleHttpApiRequest — input validation', () => {
  it('returns api.invalidInputType / 400 when validateInputByType fails', async () => {
    registerRoute();
    seam.inputValidation = { status: 'error', message: 'foo must be a number' };

    const result = await handleHttpApiRequest(baseParams());

    expect(result.httpStatus).toBe(400);
    if (result.status === 'error') {
      expect(result.errorCode).toBe('api.invalidInputType');
      expect(result.errorParams?.find((p) => p.key === 'message')?.value).toBe('foo must be a number');
    }
  });

  it('dispatches preApiValidate before postApiValidate', async () => {
    registerRoute();

    await handleHttpApiRequest(baseParams());

    const order = dispatchHookMock.mock.calls.map((c) => c[0]);
    expect(order.indexOf('preApiValidate')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('preApiValidate')).toBeLessThan(order.indexOf('postApiValidate'));
  });
});

describe('handleHttpApiRequest — execute + response envelope', () => {
  it('returns the success envelope with status 200 and merged result fields', async () => {
    registerRoute({ main: vi.fn(() => Promise.resolve({ status: 'success', result: { id: 7 } })) });

    const result = await handleHttpApiRequest(baseParams());

    expect(result.status).toBe('success');
    expect(result.httpStatus).toBe(200);
    //? Handler result fields are spread onto the envelope.
    if (result.status === 'success') expect(result.result).toEqual({ id: 7 });
  });

  it('honors an explicit httpStatus from a success result', async () => {
    registerRoute({ main: vi.fn(() => Promise.resolve({ status: 'success', httpStatus: 201, result: {} })) });

    const result = await handleHttpApiRequest(baseParams());

    expect(result.httpStatus).toBe(201);
  });

  it('normalizes an error result through the error envelope with its declared status', async () => {
    registerRoute({ main: vi.fn(() => Promise.resolve({ status: 'error', errorCode: 'examples.boom', httpStatus: 422 })) });

    const result = await handleHttpApiRequest(baseParams());

    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(422);
    if (result.status === 'error') expect(result.errorCode).toBe('examples.boom');
  });

  it('returns api.internalServerError / 500 when the handler throws', async () => {
    registerRoute({ main: vi.fn(() => Promise.reject(new Error('kaboom'))) });

    const result = await handleHttpApiRequest(baseParams());

    expect(result.httpStatus).toBe(500);
    if (result.status === 'error') expect(result.errorCode).toBe('api.internalServerError');
  });

  it('returns api.invalidResponseStatus / 500 when the handler returns a non-status object', async () => {
    registerRoute({ main: vi.fn(() => Promise.resolve({ something: 'else' })) });

    const result = await handleHttpApiRequest(baseParams());

    expect(result.httpStatus).toBe(500);
    if (result.status === 'error') expect(result.errorCode).toBe('api.invalidResponseStatus');
  });

  it('returns api.emptyResponse / 500 when the handler returns null', async () => {
    registerRoute({ main: vi.fn(() => Promise.resolve(null)) });

    const result = await handleHttpApiRequest(baseParams());

    expect(result.httpStatus).toBe(500);
    if (result.status === 'error') expect(result.errorCode).toBe('api.emptyResponse');
  });
});

describe('handleHttpApiRequest — pipeline ordering and hooks', () => {
  it('runs the full happy-path hook sequence in the documented order', async () => {
    registerRoute();

    await handleHttpApiRequest(baseParams());

    const order = dispatchHookMock.mock.calls.map((c) => c[0]);
    const idx = (name: string) => order.indexOf(name);
    expect(idx('preApiValidate')).toBeGreaterThanOrEqual(0);
    expect(idx('preApiValidate')).toBeLessThan(idx('postApiValidate'));
    expect(idx('postApiValidate')).toBeLessThan(idx('preApiExecute'));
    expect(idx('preApiExecute')).toBeLessThan(idx('postApiExecute'));
    expect(idx('postApiExecute')).toBeLessThan(idx('preApiRespond'));
    expect(idx('preApiRespond')).toBeLessThan(idx('postApiRespond'));
  });

  it('does NOT dispatch transformApiResponse on the HTTP transport', async () => {
    //? FINDING: the HTTP handler (handleHttpApiRequest) only dispatches
    //? preApiRespond -> postApiRespond. transformApiResponse is dispatched
    //? exclusively by the SOCKET handler (handleApiRequest.emitApiResult).
    //? The package CLAUDE.md claims both transports "execute the same
    //? sequence", but transformApiResponse is socket-only. Reported, not
    //? patched (Report-Without-Auto-Fixing). This test pins the actual
    //? HTTP behavior so a future fix is a deliberate, visible change.
    registerRoute();

    await handleHttpApiRequest(baseParams());

    const dispatched = dispatchHookMock.mock.calls.map((c) => c[0]);
    expect(dispatched).not.toContain('transformApiResponse');
  });

  it('short-circuits with the preApiExecute stop signal and never runs the handler', async () => {
    const main = vi.fn(() => Promise.resolve({ status: 'success', result: {} }));
    registerRoute({ main });
    seam.hookResults.preApiExecute = { stopped: true, signal: { errorCode: 'hook.blocked', httpStatus: 451 } };

    const result = await handleHttpApiRequest(baseParams());

    expect(result.httpStatus).toBe(451);
    if (result.status === 'error') expect(result.errorCode).toBe('hook.blocked');
    expect(main).not.toHaveBeenCalled();
  });

  it('defaults the preApiExecute stop signal to 403 when no httpStatus is given', async () => {
    registerRoute();
    seam.hookResults.preApiExecute = { stopped: true, signal: { errorCode: 'hook.blocked' } };

    const result = await handleHttpApiRequest(baseParams());

    expect(result.httpStatus).toBe(403);
  });

  it('rewrites the response into a localized error when preApiRespond stops', async () => {
    registerRoute();
    seam.hookResults.preApiRespond = { stopped: true, signal: { errorCode: 'respond.blocked', httpStatus: 409 } };

    const result = await handleHttpApiRequest(baseParams());

    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(409);
    if (result.status === 'error') expect(result.errorCode).toBe('respond.blocked');
  });
});

describe('handleHttpApiRequest — locale + identity propagation', () => {
  it('passes the x-language header through to getSession as preferred locale source', async () => {
    registerRoute();

    await handleHttpApiRequest({ ...baseParams(), xLanguageHeader: 'nl' });

    //? getSession is always called with the supplied token.
    expect(getSessionMock).toHaveBeenCalledWith('tok-1');
    //? preApiValidate payload carries the resolved route + user.
    const preValidate = dispatchHookMock.mock.calls.find((c) => c[0] === 'preApiValidate');
    expect(preValidate?.[1]).toMatchObject({ routeName: 'examples/doThing/v1', transport: 'http' });
  });
});
