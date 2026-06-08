/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/restrict-template-expressions, @typescript-eslint/prefer-nullish-coalescing */

import type { BaseSessionLayout as SessionLayout, AuthProps, PostApiExecutePayload, ErrorFormatter  } from '@luckystack/core';
import { getProjectConfig, readSession, getRuntimeApiMaps as getRuntimeApiMapsFromSource ,
  validateRequest,
  checkRateLimit,
  inferHttpMethod,
  HttpMethod,
  tryCatch,
  parseTransportRouteName,
  validateInputByType,
  dispatchHook,
  getLogger, defaultHttpStatusForResponse, extractLanguageFromHeader, normalizeErrorResponse, applyErrorFormatter  } from '@luckystack/core';






/**
 * HTTP API Request Handler
 * 
 * Handles API requests coming via HTTP (instead of WebSocket).
 * Reuses existing API handlers but returns results as HTTP response.
 * 
 * Payload format:
 * ```json
 * {
 *   "name": "api/examples/publicApi",
 *   "data": { "message": "hello" }
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // In server.ts
 * if (pathname.startsWith('/api/')) {
 *   const token = extractTokenFromRequest(req);
 *   const body = await parseJsonBody(req);
 *   const result = await handleHttpApiRequest({ name: body.name, data: body.data, token });
 *   res.end(JSON.stringify(result));
 * }
 * ```
 */

interface HttpApiRequestParams {
  name: string;
  data: Record<string, unknown>;
  token: string | null;
  requesterIp?: string;
  xLanguageHeader?: string | string[];
  acceptLanguageHeader?: string | string[];
  /** HTTP method from the request */
  method?: HttpMethod;
  stream?: (payload: ApiHttpStreamEvent) => void;
  /**
   * Optional AbortSignal. The HTTP server (`@luckystack/server`) wires this
   * to `req.on('close', ...)` so a closed SSE/HTTP connection aborts in-flight
   * stream emits. Handlers receive it as `abortSignal` in params.
   */
  abortSignal?: AbortSignal;
}

type ApiNetworkResponse<T = Record<string, unknown>> =
  | ({ status: 'success'; httpStatus: number } & T)
  | {
    status: 'error';
    httpStatus: number;
    message: string;
    errorCode: string;
    errorParams?: {
      key: string;
      value: string | number | boolean;
    }[];
  };

type ApiStreamPayload = Record<string, unknown>;

//? B2 — backpressure helper for HTTP API handlers. SSE has no socket
//? write-buffer, so this is a no-op for HTTP transport — but the shape
//? matches the socket variant so handlers don't branch by transport.
export interface HttpApiFlushPressureOptions {
  thresholdBytes?: number;
}

//? No-op shared at module scope so per-request allocation stays cheap and
//? the consistent-function-scoping lint rule doesn't trip.
const httpApiFlushPressureNoop: HttpApiFlushPressure = async () => {
  /* SSE backpressure is the caller's responsibility (res.write returns bool) */
};
export type HttpApiFlushPressure = (options?: HttpApiFlushPressureOptions) => Promise<void>;

interface RuntimeApiRoute {
  auth: AuthProps;
  main: (params: {
    data: Record<string, unknown>;
    user: SessionLayout | null;
    functions: Record<string, unknown>;
    stream: (payload?: ApiStreamPayload) => void;
    abortSignal: AbortSignal;
    flushPressure: HttpApiFlushPressure;
  }) => Promise<RuntimeApiResult> | RuntimeApiResult;
  inputType?: string;
  inputTypeFilePath?: string;
  rateLimit?: number | false;
  httpMethod?: HttpMethod;
  validation?: 'strict' | 'relaxed' | { input: 'skip' | 'strict' };
  errorFormatter?: ErrorFormatter;
}

type RuntimeApiResult =
  | {
    status: 'success';
    httpStatus?: number;
    message?: string;
    [key: string]: unknown;
  }
  | {
    status: 'error';
    httpStatus?: number;
    errorCode?: string;
    errorParams?: { key: string; value: string | number | boolean }[];
    message?: string;
    [key: string]: unknown;
  };

const isRuntimeApiResult = (value: unknown): value is RuntimeApiResult => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const status = (value as { status?: unknown }).status;
  return status === 'success' || status === 'error';
};

const shouldLogDev = () => getProjectConfig().logging.devLogs;
const shouldLogStream = () => getProjectConfig().logging.stream;

const warnedMissingInputType = new Set<string>();
const warnIfInputTypeMissing = (resolvedName: string, inputType: string | undefined): void => {
  if (!getProjectConfig().dev.warnOnMissingInputType) return;
  if (inputType && inputType.trim().length > 0 && inputType.trim() !== 'any') return;
  if (warnedMissingInputType.has(resolvedName)) return;
  warnedMissingInputType.add(resolvedName);
  getLogger().warn(`http-api: route ${resolvedName} has no inputType — runtime input validation is disabled.`);
};

export type ApiHttpStreamEvent = ApiStreamPayload;

export async function handleHttpApiRequest(params: HttpApiRequestParams): Promise<ApiNetworkResponse> {
  const { response, user, preferredLocale, perRouteFormatter } = await runHandleHttpApiRequest(params);

  //? `name` may not parse to a valid route — pass the original raw name as
  //? routeName so hook handlers can still correlate the rejection.
  const routeNameForHook = params.name.startsWith('api/') ? params.name : `api/${params.name}`;

  const preRespond = { routeName: routeNameForHook, user, response: response as { status: 'success' | 'error'; httpStatus?: number; [key: string]: unknown } };
  const preRespondResult = await dispatchHook('preApiRespond', preRespond);

  //? Honor a stop signal from `preApiRespond`: rewrite the envelope into a
  //? localized error response per the signal's errorCode/httpStatus instead
  //? of letting the original through. Same contract as the socket variant.
  const finalResponse = preRespondResult.stopped
    ? normalizeErrorResponse({
        response: { status: 'error', errorCode: preRespondResult.signal.errorCode },
        preferredLocale,
        userLanguage: user?.language,
        fallbackHttpStatus: preRespondResult.signal.httpStatus ?? 403,
      }) as ApiNetworkResponse
    : preRespond.response as ApiNetworkResponse;

  //? Per-route → global → identity error formatter chain. Mirrors the socket
  //? handler so HTTP + WebSocket responses honor the same `errorFormatter`
  //? export on each route. No-op on success envelopes.
  //? `ApiNetworkResponse` is a discriminated union; `applyErrorFormatter`
  //? accepts the wider `Record<string, unknown> & { status?: string }` shape
  //? that union doesn't structurally satisfy. The double-cast is the
  //? documented framework boundary between the union and the formatter input.
  // eslint-disable-next-line no-restricted-syntax -- formatter boundary cast
  const formatterInput = finalResponse as unknown as Record<string, unknown> & { status?: string };
  const formattedResponse = applyErrorFormatter({
    response: formatterInput,
    routeName: routeNameForHook,
    transport: 'http',
    userId: user?.id,
    perRouteFormatter,
  }) as ApiNetworkResponse;

  await dispatchHook('postApiRespond', { routeName: routeNameForHook, user, response: formattedResponse });

  return formattedResponse;
}

interface RunHandleHttpApiRequestResult {
  response: ApiNetworkResponse;
  user: SessionLayout | null;
  preferredLocale: string | null | undefined;
  perRouteFormatter?: ErrorFormatter;
}

async function runHandleHttpApiRequest(params: HttpApiRequestParams): Promise<RunHandleHttpApiRequestResult> {
  const preferredLocale =
    extractLanguageFromHeader(params.xLanguageHeader)
    ?? extractLanguageFromHeader(params.acceptLanguageHeader);
  const user = await readSession(params.token);
  const formatterHolder: { current?: ErrorFormatter } = {};
  const response = await runHandleHttpApiRequestInner(params, user, preferredLocale, formatterHolder);
  return { response, user, preferredLocale, perRouteFormatter: formatterHolder.current };
}

async function runHandleHttpApiRequestInner(
  {
    name,
    data,
    token,
    requesterIp,
    xLanguageHeader: _xLanguageHeader,
    acceptLanguageHeader: _acceptLanguageHeader,
    method = 'POST',
    stream,
    abortSignal,
  }: HttpApiRequestParams,
  user: SessionLayout | null,
  preferredLocale: string | null | undefined,
  formatterHolder: { current?: ErrorFormatter },
): Promise<ApiNetworkResponse> {
  //? B1 — HTTP/SSE transport. The caller (typically `@luckystack/server`'s
  //? SSE bridge) wires `req.on('close', ...)` to a controller and passes its
  //? signal in. If no signal was provided we synthesize a never-aborting one
  //? so the handler param shape stays consistent.
  const effectiveAbortSignal = abortSignal ?? new AbortController().signal;
  //? SSE has no socket write-buffer to measure — `flushPressure` is a no-op
  //? on HTTP transport. Kept for handler-shape parity with the socket path.
  const flushPressure = httpApiFlushPressureNoop;

  const normalizedName = name.startsWith('api/') ? name : `api/${name}`;
  //? Identity propagation now flows via the `preApiExecute` hook subscriber
  //? registered by `@luckystack/error-tracking`'s `enableErrorTrackingAutoInstrumentation()`.
  //? Direct `setSentryUser` removed from this handler — see migration doc.

  const buildNetworkError = ({
    response,
    fallbackHttpStatus,
  }: {
    response: { status: 'error'; httpStatus?: number; errorCode?: string; errorParams?: { key: string; value: string | number | boolean; }[] };
    fallbackHttpStatus?: number;
  }): ApiNetworkResponse => {
    return normalizeErrorResponse({
      response,
      preferredLocale,
      userLanguage: user?.language,
      fallbackHttpStatus,
    }) as ApiNetworkResponse;
  };

  // Validate request format
  if (!name || typeof name !== 'string') {
    return buildNetworkError({
      response: { status: 'error', errorCode: 'api.invalidName' },
      fallbackHttpStatus: 400,
    });
  }

  if (typeof data !== 'object' || data === null) {
    return buildNetworkError({
      response: { status: 'error', errorCode: 'api.invalidDataObject' },
      fallbackHttpStatus: 400,
    });
  }

  const requestData = data ?? {};

  const parsedRoute = parseTransportRouteName({ value: normalizedName, prefix: 'api' });
  if (parsedRoute.status === 'error') {
    return buildNetworkError({
      response: {
        status: 'error',
        errorCode: 'routing.invalidServiceRouteName',
        errorParams: [{ key: 'name', value: normalizedName }],
      },
      fallbackHttpStatus: 400,
    });
  }

  const resolvedName = parsedRoute.normalizedFullName;

  if (shouldLogDev()) {
    getLogger().debug(`http api: ${resolvedName} called`);
  }

  const { apisObject, functionsObject } = await getRuntimeApiMapsFromSource();

  // Check if API exists
  if (!apisObject[resolvedName]) {
    return buildNetworkError({
      response: {
        status: 'error',
        errorCode: 'api.notFound',
        errorParams: [{ key: 'name', value: resolvedName }],
      },
      fallbackHttpStatus: 404,
    });
  }

  const runtimeApiRoute = apisObject[resolvedName] as RuntimeApiRoute;
  formatterHolder.current = runtimeApiRoute.errorFormatter;
  const { auth, main, httpMethod: declaredMethod } = runtimeApiRoute;
  const inputType = runtimeApiRoute.inputType;
  const inputTypeFilePath = runtimeApiRoute.inputTypeFilePath;

  //? Pipeline order: auth → rate-limit → method → validate → execute → respond.
  //? Auth runs first so unauthenticated probes can't enumerate routes or
  //? learn input shape from `inputValidation.message` / method-mismatch params.

  // Auth validation: check login requirement
  if (auth.login && !user?.id) {
      if (shouldLogDev()) {
        getLogger().warn(`http-api: ${name} requires login`, { route: name, transport: 'http' });
      }
      return buildNetworkError({
        response: { status: 'error', errorCode: 'auth.required' },
        fallbackHttpStatus: 401,
      });
    }

  //? NO bare `if (!user) -> auth.forbidden` here. Public routes
  //? (auth.login: false) must be callable without a session — exactly like the
  //? socket API handler (handleApiRequest) and both sync handlers.
  //? `validateRequest` is the single source of truth for `additional` auth
  //? predicates. (This handler previously forbade ALL anonymous HTTP calls,
  //? diverging from the other three transports and making public routes
  //? unreachable over HTTP — e.g. the test-runner contract/rate-limit sweeps.)
  //? `user` may be null on a public route; validateRequest tolerates it (and
  //? only the login/additional predicates read it). Same `user!` shape the
  //? socket API handler and both sync handlers use.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const authResult = validateRequest({ auth, user: user! });
  if (authResult.status === 'error') {
    if (shouldLogDev()) {
      getLogger().warn(`http-api: auth failed for ${name}`, { route: name, errorCode: authResult.errorCode, transport: 'http' });
    }
    return buildNetworkError({
      response: {
        status: 'error',
        errorCode: authResult.errorCode ?? 'auth.forbidden',
        errorParams: authResult.errorParams,
        httpStatus: authResult.httpStatus,
      },
      fallbackHttpStatus: authResult.httpStatus ?? 403,
    });
  }

  // Rate limiting check: per-API bucket (custom rateLimit or defaultApiLimit fallback)
  const apiRateLimit = runtimeApiRoute.rateLimit;
  const effectiveApiLimit = apiRateLimit === undefined
    ? getProjectConfig().rateLimiting.defaultApiLimit
    : apiRateLimit;

  if (effectiveApiLimit !== false && effectiveApiLimit > 0) {
    const requesterIdentity = token ?? requesterIp ?? 'anonymous';
    const keyPrefix = token ? 'token' : 'ip';
    const rateLimitKey = `${keyPrefix}:${requesterIdentity}:api:${resolvedName}`;

    const { allowed, resetIn } = await checkRateLimit({
      key: rateLimitKey,
      limit: effectiveApiLimit,
      windowMs: getProjectConfig().rateLimiting.windowMs
    });

    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        scope: token ? 'user' : 'route',
        key: rateLimitKey,
        limit: effectiveApiLimit,
        windowMs: getProjectConfig().rateLimiting.windowMs,
        count: effectiveApiLimit + 1,
        route: resolvedName,
        userId: user?.id,
      });
      if (shouldLogDev()) {
        getLogger().warn(`http api: rate limit exceeded for ${resolvedName}`);
      }
      return buildNetworkError({
        response: {
          status: 'error',
          errorCode: 'api.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
        },
        fallbackHttpStatus: 429,
      });
    }
  }

  // Global per-IP bucket across all APIs
  const defaultIpLimit = getProjectConfig().rateLimiting.defaultIpLimit;
  //? Skip the global per-IP ABUSE limit for loopback traffic in non-production.
  //? A developer (and the test suite) hammering localhost should not rate-limit
  //? itself — this keeps the test runner scalable to any number of cases. Note
  //? this only skips the cross-route `:api:all` bucket; PER-ROUTE limits still
  //? apply, and production (NODE_ENV=production) is unaffected.
  const requesterIsLoopback = process.env.NODE_ENV !== 'production'
    && (requesterIp === '127.0.0.1' || requesterIp === '::1' || requesterIp === '::ffff:127.0.0.1'
      || (typeof requesterIp === 'string' && requesterIp.startsWith('127.')));
  if (!requesterIsLoopback && defaultIpLimit !== false && defaultIpLimit > 0) {
    const ipBucket = requesterIp ?? 'unknown';
    const { allowed, resetIn } = await checkRateLimit({
      key: `ip:${ipBucket}:api:all`,
      limit: defaultIpLimit,
      windowMs: getProjectConfig().rateLimiting.windowMs
    });

    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        scope: 'ip',
        key: `ip:${ipBucket}:api:all`,
        limit: defaultIpLimit,
        windowMs: getProjectConfig().rateLimiting.windowMs,
        count: defaultIpLimit + 1,
        ip: ipBucket,
      });
      if (shouldLogDev()) {
        getLogger().warn(`http api: global IP rate limit exceeded`, { ip: ipBucket });
      }
      return buildNetworkError({
        response: {
          status: 'error',
          errorCode: 'api.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
        },
        fallbackHttpStatus: 429,
      });
    }
  }

  // HTTP method validation (post-auth so unauthenticated probes don't learn the route exists)
  const expectedMethod = declaredMethod ?? inferHttpMethod(resolvedName);
  if (method !== expectedMethod) {
    if (shouldLogDev()) {
      getLogger().warn(`http api: method mismatch for ${resolvedName}`, { expected: expectedMethod, got: method });
    }
    return buildNetworkError({
      response: {
        status: 'error',
        errorCode: 'api.methodNotAllowed',
        errorParams: [{ key: 'method', value: expectedMethod }],
      },
      fallbackHttpStatus: 405,
    });
  }

  // Input-type validation (post-auth so unauthenticated probes don't get input-shape leaks)
  warnIfInputTypeMissing(resolvedName, inputType);
  await dispatchHook('preApiValidate', { routeName: resolvedName, data: requestData, user, transport: 'http' });

  const inputValidation = await validateInputByType({
    typeText: inputType,
    value: requestData,
    rootKey: 'data',
    filePath: inputTypeFilePath,
  });

  await dispatchHook('postApiValidate', {
    routeName: resolvedName,
    data: requestData,
    user,
    validation: inputValidation,
    transport: 'http',
  });

  if (inputValidation.status === 'error') {
    return buildNetworkError({
      response: {
        status: 'error',
        errorCode: 'api.invalidInputType',
        errorParams: [{ key: 'message', value: inputValidation.message }],
      },
      fallbackHttpStatus: 400,
    });
  }

  // Execute the API handler
  const emitApiStream = (payload: ApiStreamPayload = {}) => {
    if (!stream) {
      return;
    }
    if (effectiveAbortSignal.aborted) {
      if (shouldLogStream()) {
        getLogger().debug(`http api: ${resolvedName} stream skipped — request aborted`);
      }
      return;
    }

    if (shouldLogStream()) {
      getLogger().debug(`http api: ${resolvedName} stream`, { payload });
    }

    stream(payload);
  };

  //? Single payload reference reused by pre/post — auto-instrumentation
  //? subscribers in `@luckystack/error-tracking` pin spans via WeakMap on
  //? this object. Mutating `result/error/durationMs` is safe because
  //? handlers observe by-name (not by snapshot).
  const executePayload: PostApiExecutePayload = {
    routeName: resolvedName,
    data: requestData,
    user,
    transport: 'http',
    result: undefined,
    error: null,
    durationMs: 0,
  };
  const preExecuteResult = await dispatchHook('preApiExecute', executePayload);
  if (preExecuteResult.stopped) {
    return buildNetworkError({
      response: { status: 'error', errorCode: preExecuteResult.signal.errorCode },
      fallbackHttpStatus: preExecuteResult.signal.httpStatus ?? 403,
    });
  }

  const executeStart = Date.now();
  const [error, result] = await tryCatch(
    async () => await main({
      data: requestData,
      user,
      functions: functionsObject,
      stream: emitApiStream,
      abortSignal: effectiveAbortSignal,
      flushPressure,
    }),
    undefined,
    {
      handler: 'handleHttpApiRequest',
      api: resolvedName,
      userId: user?.id,
      transport: 'http',
    },
  );

  executePayload.result = result;
  executePayload.error = error ?? null;
  executePayload.durationMs = Date.now() - executeStart;
  await dispatchHook('postApiExecute', executePayload);

  if (error) {
    if (shouldLogDev()) {
      getLogger().error(`http-api: error in ${resolvedName}`, error, { route: resolvedName, transport: 'http' });
    }
    return buildNetworkError({
      response: { status: 'error', errorCode: 'api.internalServerError' },
      fallbackHttpStatus: 500,
    });
  }

  if (result !== undefined && result !== null) {
    if (shouldLogDev()) {
      getLogger().debug(`http api: ${resolvedName} completed`);
    }

    // Check if result is already formatted as ApiResponse
    if (isRuntimeApiResult(result)) {
      if (result.status === 'error') {
        return buildNetworkError({
          response: result,
          fallbackHttpStatus: defaultHttpStatusForResponse({
            status: 'error',
            explicitHttpStatus: typeof result.httpStatus === 'number' ? result.httpStatus : undefined,
          }),
        });
      }

      const successEnvelope: ApiNetworkResponse = {
        ...result,
        status: 'success',
        httpStatus: defaultHttpStatusForResponse({
          status: 'success',
          explicitHttpStatus: typeof result.httpStatus === 'number' ? result.httpStatus : undefined,
        }),
      };
      return successEnvelope;
    }

    return buildNetworkError({
      response: { status: 'error', errorCode: 'api.invalidResponseStatus' },
      fallbackHttpStatus: 500,
    });
  }

  if (shouldLogDev()) {
    getLogger().warn(`http api: ${resolvedName} returned nothing`);
  }
  return buildNetworkError({
    response: { status: 'error', errorCode: 'api.emptyResponse' },
    fallbackHttpStatus: 500,
  });
}
