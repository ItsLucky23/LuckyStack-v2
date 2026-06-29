import type { BaseSessionLayout as SessionLayout, PostApiExecutePayload, ErrorFormatter  } from '@luckystack/core';
import { getProjectConfig, readSession, getRuntimeApiMaps as getRuntimeApiMapsFromSource ,
  runWithErrorTrackerIdentityScope,
  setCurrentErrorTrackerIdentity,
  validateRequest,
  inferHttpMethod,
  HttpMethod,
  tryCatch,
  parseTransportRouteName,
  dispatchHook,
  getLogger, extractLanguageFromHeader, normalizeErrorResponse, applyErrorFormatter,
  isLoopbackIp, resolveClientIp } from '@luckystack/core';
import type { ApiStreamPayload, RuntimeApiEntry } from './_shared/apiTypes';
import { shouldLogDev, shouldLogStream } from './_shared/logFlags';
import { normalizeApiResponse } from './_shared/responseEnvelope';
import { httpApiFlushPressureNoop } from './_shared/backpressure';
import { runHttpApiValidation } from './_shared/httpValidationStage';
import { applyApiRateLimits } from './_shared/applyApiRateLimits';






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
  // luckystack-allow no-as-unknown: formatter boundary — ApiNetworkResponse union does not structurally satisfy applyErrorFormatter input; fix requires @luckystack/core type alignment
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

// ---------------------------------------------------------------------------
// Private staged helpers for runHandleHttpApiRequestInner
// ---------------------------------------------------------------------------

/** Shared context threaded through each pipeline stage. */
interface HttpApiPipelineContext {
  buildNetworkError: (args: {
    response: { status: 'error'; httpStatus?: number; errorCode?: string; errorParams?: { key: string; value: string | number | boolean }[] };
    fallbackHttpStatus?: number;
  }) => ApiNetworkResponse;
  user: SessionLayout | null;
  preferredLocale: string | null | undefined;
}

/**
 * Validates the raw request shape (name string, data object, route-name
 * parsing) and resolves the normalised route name + runtime maps.
 * Returns an error response when any guard fails, otherwise the resolved
 * artefacts needed by later stages.
 */
async function validateHttpApiRequestShape(
  name: string,
  data: Record<string, unknown>,
  ctx: HttpApiPipelineContext,
): Promise<
  | ApiNetworkResponse
  | {
      resolvedName: string;
      requestData: Record<string, unknown>;
      apisObject: Record<string, unknown>;
      functionsObject: Record<string, unknown>;
    }
> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime defense: caller may pass non-string despite types
  if (!name || typeof name !== 'string') {
    return ctx.buildNetworkError({
      response: { status: 'error', errorCode: 'api.invalidName' },
      fallbackHttpStatus: 400,
    });
  }

  //? API-O5 — mirror the socket guard: `typeof [] === 'object'`, so an array
  //? payload would pass the original check and hit a `{...}`-destructuring
  //? handler, causing a 500 instead of the correct 400.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime defense against malformed HTTP payloads despite types
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return ctx.buildNetworkError({
      response: { status: 'error', errorCode: 'api.invalidDataObject' },
      fallbackHttpStatus: 400,
    });
  }

  const normalizedName = name.startsWith('api/') ? name : `api/${name}`;
  const parsedRoute = parseTransportRouteName({ value: normalizedName, prefix: 'api' });
  if (parsedRoute.status === 'error') {
    return ctx.buildNetworkError({
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

  if (!apisObject[resolvedName]) {
    return ctx.buildNetworkError({
      response: {
        status: 'error',
        errorCode: 'api.notFound',
        errorParams: [{ key: 'name', value: resolvedName }],
      },
      fallbackHttpStatus: 404,
    });
  }

  return { resolvedName, requestData: data, apisObject, functionsObject };
}

/**
 * Runs the login-required guard and the `validateRequest` additional-predicate
 * check. Returns an error response on failure, or `null` to signal success.
 *
 * Pipeline order: auth → rate-limit → method → validate → execute.
 * Auth runs first so unauthenticated probes can't enumerate routes or
 * learn input shape from `inputValidation.message` / method-mismatch params.
 * API-O7 — failed-auth requests do NOT consume a rate-limit bucket here.
 * Brute-force lockout is the responsibility of `@luckystack/login`
 * (per-account lockout counter via `authLockout.ts`); the `apiAuthRejected`
 * hook lets consumers add additional throttles. Consuming a per-IP bucket on
 * auth-fail would let an attacker DoS a victim's IP with bad credentials.
 */
function runHttpApiAuth(
  {
    name,
    resolvedName,
    requesterIp,
    auth,
  }: {
    name: string;
    resolvedName: string;
    requesterIp: string | undefined;
    auth: RuntimeApiEntry['auth'];
  },
  ctx: HttpApiPipelineContext,
): ApiNetworkResponse | null {
  if (auth.login && !ctx.user?.id) {
    if (shouldLogDev()) {
      getLogger().warn(`http-api: ${name} requires login`, { route: name, transport: 'http' });
    }
    void dispatchHook('apiAuthRejected', {
      routeName: resolvedName,
      reason: 'login-required',
      userId: null,
      transport: 'http',
      ip: requesterIp,
    });
    return ctx.buildNetworkError({
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
  const authResult = validateRequest({ auth, user: ctx.user! });
  if (authResult.status === 'error') {
    if (shouldLogDev()) {
      getLogger().warn(`http-api: auth failed for ${name}`, { route: name, errorCode: authResult.errorCode, transport: 'http' });
    }
    void dispatchHook('apiAuthRejected', {
      routeName: resolvedName,
      reason: authResult.errorCode === 'auth.invalidCondition' ? 'invalid-condition' : 'additional-failed',
      userId: ctx.user?.id ?? null,
      transport: 'http',
      ip: requesterIp,
      failedKey: authResult.errorCode,
    });
    return ctx.buildNetworkError({
      response: {
        status: 'error',
        errorCode: authResult.errorCode ?? 'auth.forbidden',
        errorParams: authResult.errorParams,
        httpStatus: authResult.httpStatus,
      },
      fallbackHttpStatus: authResult.httpStatus ?? 403,
    });
  }

  return null;
}

/**
 * Resolves the effective client IP, computes the loopback-skip flag, and
 * delegates to the shared `applyApiRateLimits` helper.
 * Returns an error response when any bucket is exceeded, `null` otherwise.
 */
async function applyHttpApiRateLimits(
  {
    requesterIp,
    token,
    resolvedName,
    rateLimit,
  }: {
    requesterIp: string | undefined;
    token: string | null;
    resolvedName: string;
    rateLimit: number | false | undefined;
  },
  ctx: HttpApiPipelineContext,
): Promise<ApiNetworkResponse | null> {
  //? API-O8 / API-O9 — resolve effective IP once for both rate-limit buckets.
  //? When the caller did not supply `requesterIp` we fall back to the shared
  //? `UNKNOWN_CLIENT_IP` sentinel so all unresolvable callers collapse into ONE
  //? deterministic bucket instead of mixing `'unknown'` and `'anonymous'`.
  const effectiveIp = requesterIp
    ?? resolveClientIp({ rawAddress: undefined, headers: {} });

  //? API-O2 — skip the global per-IP ABUSE limit for loopback traffic when the
  //? consumer explicitly opts in via `rateLimiting.skipLoopbackInDev` (default
  //? false). Only the cross-route `:api:all` bucket is skipped; per-route limits
  //? still apply. Pass the raw `requesterIp` (undefined → '') so only real
  //? loopback addresses qualify — avoids skipping for every unresolvable caller.
  const skipGlobalIpForLoopback = getProjectConfig().rateLimiting.skipLoopbackInDev
    && process.env.NODE_ENV !== 'production'
    && isLoopbackIp(requesterIp ?? '');

  const rateLimitResult = await applyApiRateLimits({
    resolvedIp: effectiveIp,
    token,
    user: ctx.user,
    resolvedName,
    rateLimit,
    transport: 'http',
    skipGlobalIpBucket: skipGlobalIpForLoopback,
  });

  if (!rateLimitResult.allowed) {
    return ctx.buildNetworkError({
      response: {
        status: 'error',
        errorCode: rateLimitResult.errorCode ?? 'api.rateLimitExceeded',
        errorParams: [{ key: 'seconds', value: rateLimitResult.resetIn ?? 0 }],
      },
      fallbackHttpStatus: 429,
    });
  }

  return null;
}

/**
 * Enforces the HTTP method constraint (declared or inferred).
 * Runs post-auth so unauthenticated probes don't learn that the route exists.
 * Returns an error response on mismatch, `null` otherwise.
 */
function checkHttpApiMethod(
  {
    method,
    resolvedName,
    declaredMethod,
  }: {
    method: HttpMethod;
    resolvedName: string;
    declaredMethod: HttpMethod | undefined;
  },
  ctx: HttpApiPipelineContext,
): ApiNetworkResponse | null {
  const expectedMethod = declaredMethod ?? inferHttpMethod(resolvedName);
  if (method !== expectedMethod) {
    if (shouldLogDev()) {
      getLogger().warn(`http api: method mismatch for ${resolvedName}`, { expected: expectedMethod, got: method });
    }
    return ctx.buildNetworkError({
      response: {
        status: 'error',
        errorCode: 'api.methodNotAllowed',
        errorParams: [{ key: 'method', value: expectedMethod }],
      },
      fallbackHttpStatus: 405,
    });
  }

  return null;
}

/**
 * Runs the handler execution stage: emitter setup, pre/post-execute hooks,
 * server-side timeout race, `main()` invocation, and response-envelope
 * assembly.
 */
async function runHttpApiExecution(
  {
    resolvedName,
    requestData,
    functionsObject,
    runtimeApiRoute,
    effectiveAbortSignal,
    stream,
  }: {
    resolvedName: string;
    requestData: Record<string, unknown>;
    functionsObject: Record<string, unknown>;
    runtimeApiRoute: RuntimeApiEntry;
    effectiveAbortSignal: AbortSignal;
    stream: HttpApiRequestParams['stream'];
  },
  ctx: HttpApiPipelineContext,
): Promise<ApiNetworkResponse> {
  //? SSE has no socket write-buffer to measure — `flushPressure` is a no-op
  //? on HTTP transport. Kept for handler-shape parity with the socket path.
  const flushPressure = httpApiFlushPressureNoop;

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
    user: ctx.user,
    transport: 'http',
    result: undefined,
    error: null,
    durationMs: 0,
  };
  const preExecuteResult = await dispatchHook('preApiExecute', executePayload);
  if (preExecuteResult.stopped) {
    return ctx.buildNetworkError({
      response: { status: 'error', errorCode: preExecuteResult.signal.errorCode },
      fallbackHttpStatus: preExecuteResult.signal.httpStatus ?? 403,
    });
  }

  //? API-O10 — race `main()` against a server-side timeout derived from
  //? `api.requestTimeoutMs`. When the timeout fires first we abort the
  //? effectiveAbortSignal chain and return a localized 504 envelope.
  //? A combined AbortController merges the caller's close signal and the
  //? timeout so the handler sees one unified abort.
  //? Streaming requests are EXEMPT from the wall-clock timeout even when one is
  //? configured: an SSE/stream endpoint is long-lived by design (live LLM tokens,
  //? progress) and a total-duration race would truncate it mid-stream. The
  //? abortSignal (wired to client disconnect) still tears it down when the caller
  //? leaves. Non-streaming requests honor `api.requestTimeoutMs` (default false).
  const timeoutMs = stream ? false : getProjectConfig().api.requestTimeoutMs;
  const combinedController = new AbortController();
  //? Forward the caller's abort (connection close) into the combined signal.
  if (effectiveAbortSignal.aborted) {
    combinedController.abort();
  } else {
    effectiveAbortSignal.addEventListener('abort', () => { combinedController.abort(); }, { once: true });
  }

  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = timeoutMs === false
    ? null
    : new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          combinedController.abort();
          resolve();
        }, timeoutMs);
      });

  const executeStart = Date.now();
  const handlerPromise = tryCatch(
    async () => await runtimeApiRoute.main({
      data: requestData,
      user: ctx.user,
      functions: functionsObject,
      stream: emitApiStream,
      abortSignal: combinedController.signal,
      flushPressure,
    }),
    undefined,
    {
      handler: 'handleHttpApiRequest',
      api: resolvedName,
      userId: ctx.user?.id,
      transport: 'http',
    },
  );

  if (timeoutPromise) {
    await Promise.race([handlerPromise, timeoutPromise]);
  }
  clearTimeout(timeoutHandle);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- timedOut is mutated by the async timeout callback via Promise.race
  if (timedOut) {
    return ctx.buildNetworkError({
      response: { status: 'error', errorCode: 'api.timeout' },
      fallbackHttpStatus: 504,
    });
  }

  const [error, result] = await handlerPromise;
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
    preferredLocale: ctx.preferredLocale,
    user: ctx.user,
  });
  return envelope as ApiNetworkResponse;
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

  //? Identity propagation now flows via the `preApiExecute` hook subscriber
  //? registered by `@luckystack/error-tracking`'s `enableErrorTrackingAutoInstrumentation()`.
  //? Direct `setSentryUser` removed from this handler — see migration doc.
  const ctx: HttpApiPipelineContext = { buildNetworkError, user, preferredLocale };

  // Stage 1: validate request shape, parse route, resolve runtime maps
  const shapeResult = await validateHttpApiRequestShape(name, data, ctx);
  if ('status' in shapeResult) {
    return shapeResult;
  }
  const { resolvedName, requestData, apisObject, functionsObject } = shapeResult;

  const runtimeApiRoute = apisObject[resolvedName] as RuntimeApiEntry;
  formatterHolder.current = runtimeApiRoute.errorFormatter;

  // Stage 2: auth (login-required + additional predicates)
  //? Pipeline order: auth → rate-limit → method → validate → execute → respond.
  const authError = runHttpApiAuth({ name, resolvedName, requesterIp, auth: runtimeApiRoute.auth }, ctx);
  if (authError) {
    return authError;
  }

  // Stage 3: rate limiting (per-route + global-IP)
  const rateLimitError = await applyHttpApiRateLimits(
    { requesterIp, token, resolvedName, rateLimit: runtimeApiRoute.rateLimit },
    ctx,
  );
  if (rateLimitError) {
    return rateLimitError;
  }

  // Stage 4: HTTP method check (post-auth so unauthenticated probes don't learn the route exists)
  const methodError = checkHttpApiMethod(
    { method, resolvedName, declaredMethod: runtimeApiRoute.httpMethod },
    ctx,
  );
  if (methodError) {
    return methodError;
  }

  // Stage 5: input-type validation
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
    inputType: runtimeApiRoute.inputType,
    inputTypeFilePath: runtimeApiRoute.inputTypeFilePath,
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

  // Stage 6: execute the API handler and assemble the response envelope
  return runHttpApiExecution(
    { resolvedName, requestData, functionsObject, runtimeApiRoute, effectiveAbortSignal, stream },
    ctx,
  );
}
