/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/restrict-template-expressions, @typescript-eslint/prefer-nullish-coalescing */

import type { BaseSessionLayout as SessionLayout, PostApiExecutePayload, ErrorFormatter  } from '@luckystack/core';
import { getProjectConfig, readSession, getRuntimeApiMaps as getRuntimeApiMapsFromSource ,
  runWithErrorTrackerIdentityScope,
  setCurrentErrorTrackerIdentity,
  validateRequest,
  checkRateLimit,
  inferHttpMethod,
  HttpMethod,
  tryCatch,
  parseTransportRouteName,
  dispatchHook,
  getLogger, extractLanguageFromHeader, normalizeErrorResponse, applyErrorFormatter  } from '@luckystack/core';
import type { ApiStreamPayload, RuntimeApiEntry } from './_shared/apiTypes';
import { shouldLogDev, shouldLogStream } from './_shared/logFlags';
import { normalizeApiResponse } from './_shared/responseEnvelope';
import { httpApiFlushPressureNoop } from './_shared/backpressure';
import { runHttpApiValidation } from './_shared/httpValidationStage';
import { deriveTokenBucketId } from './_shared/rateLimitIdentity';






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

export type ApiHttpStreamEvent = ApiStreamPayload;

//? ET-02 — wrap the whole HTTP request in a per-request error-tracker identity
//? scope (opened before `readSession` in `runHandleHttpApiRequest`, the first
//? interleaving await). The resolved session is written into the scope's ALS box
//? the moment it resolves, so concurrent HTTP requests with different users can't
//? cross-attribute captures. Each request gets its own isolated box.
export async function handleHttpApiRequest(params: HttpApiRequestParams): Promise<ApiNetworkResponse> {
  return runWithErrorTrackerIdentityScope(() => handleHttpApiRequestScoped(params));
}

async function handleHttpApiRequestScoped(params: HttpApiRequestParams): Promise<ApiNetworkResponse> {
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

  //? `transformApiResponse` fires AFTER preApiRespond and BEFORE the wire
  //? response is finalized. Mirrors the socket handler (handleApiRequest)
  //? so BOTH transports run the same hook sequence per CLAUDE.md. Handlers
  //? mutate `payload.response` in place (header injection, body transform,
  //? response signing).
  const transformPayload = { routeName: routeNameForHook, user, response: finalResponse };
  await dispatchHook('transformApiResponse', transformPayload);

  //? Per-route → global → identity error formatter chain. Mirrors the socket
  //? handler so HTTP + WebSocket responses honor the same `errorFormatter`
  //? export on each route. No-op on success envelopes.
  //? `ApiNetworkResponse` is a discriminated union; `applyErrorFormatter`
  //? accepts the wider `Record<string, unknown> & { status?: string }` shape
  //? that union doesn't structurally satisfy. The double-cast is the
  //? documented framework boundary between the union and the formatter input.
  // eslint-disable-next-line no-restricted-syntax -- formatter boundary cast
  const formatterInput = transformPayload.response as unknown as Record<string, unknown> & { status?: string };
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
  //? ET-02 — bind the resolved session into the active per-request ALS identity
  //? box (opened by `handleHttpApiRequest`) so every capture in this request
  //? attributes to this user. The legacy global is still set via the
  //? `preApiValidate` hook subscriber; the ALS read wins at capture time.
  setCurrentErrorTrackerIdentity(user?.id ? { id: user.id, email: user.email ?? undefined, username: user.name ?? undefined } : null);
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

  //? `data` is already guaranteed non-null object by the guard above.
  const requestData = data;

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

  const runtimeApiRoute = apisObject[resolvedName] as RuntimeApiEntry;
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
    const requesterIdentity = token ? deriveTokenBucketId(token) : (requesterIp ?? 'anonymous');
    const keyPrefix = token ? 'token' : 'ip';
    const rateLimitKey = `${keyPrefix}:${requesterIdentity}:api:${resolvedName}`;

    const { allowed, resetIn } = await checkRateLimit({
      key: rateLimitKey,
      limit: effectiveApiLimit,
      windowMs: getProjectConfig().rateLimiting.windowMs
    });

    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        //? The per-route bucket is keyed by the validated user when a token is
        //? present, else by the resolved IP (keyPrefix `ip`). Report the scope
        //? that matches the bucket's actual identity — an anonymous per-route
        //? bucket is IP-keyed, so it is `ip` (with `route` still set to mark it
        //? a per-route bucket vs the global `:api:all` IP bucket), never `route`.
        scope: token ? 'user' : 'ip',
        key: rateLimitKey,
        limit: effectiveApiLimit,
        windowMs: getProjectConfig().rateLimiting.windowMs,
        count: effectiveApiLimit + 1,
        route: resolvedName,
        userId: user?.id,
        ip: token ? undefined : requesterIp,
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

  //? Input-type validation stage (preApiValidate -> validateInputByType ->
  //? postApiValidate). Extracted to `_shared/httpValidationStage.ts` for
  //? symmetry with the socket handler. On failure the caller builds the
  //? GENERIC `api.invalidInputType` (the raw validator message never reaches
  //? the client). Honors the per-route `validation: 'relaxed'` / `{ input:
  //? 'skip' }` escape hatch on BOTH transports — a public webhook route whose
  //? third-party payload can't be modeled in TS is reachable over HTTP, not
  //? just sockets.
  const httpValidation = await runHttpApiValidation({
    resolvedName,
    inputType,
    inputTypeFilePath,
    requestData,
    user,
    validation: runtimeApiRoute.validation,
  });
  if (!httpValidation.ok) {
    return buildNetworkError({
      response: {
        status: 'error',
        errorCode: 'api.invalidInputType',
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

  //? Shared envelope assembly (CC-6) — identical to the socket handler's
  //? `buildApiResponseEnvelope`: localized error shapes for failure / empty /
  //? invalid-status, or a success envelope with inferred default HTTP status.
  //? `normalizeApiResponse` runtime-checks `result.status`, so a handler that
  //? returns a non-status object still maps to `api.invalidResponseStatus`.
  const envelope = normalizeApiResponse({
    resolvedName,
    error: error ?? null,
    result: result ?? undefined,
    preferredLocale,
    user,
  });
  return envelope as ApiNetworkResponse;
}
