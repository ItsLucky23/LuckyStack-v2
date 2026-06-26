import type { apiMessage, PostApiExecutePayload, BaseSessionLayout as SessionLayout, ErrorFormatter } from '@luckystack/core';
import {
  readSession,
  performLogout,
  runWithErrorTrackerIdentityScope,
  setCurrentErrorTrackerIdentity,
  getProjectConfig,
  getRuntimeApiMaps,
  validateRequest,
  checkRateLimit,
  tryCatch,
  parseTransportRouteName,
  buildApiResponseEventName,
  dispatchHook,
  getLogger,
  resolveClientIp,
  extractLanguageFromHeader,
  normalizeErrorResponse,
  applyErrorFormatter,
} from '@luckystack/core';
//? checkRateLimit and resolveClientIp are still used directly for the logout
//? global-IP bucket (which doesn't go through the shared applyApiRateLimits helper
//? because the logout shortcut bypasses the per-route bucket entirely).
import { Socket } from 'socket.io';
import type { ApiStreamPayload, ApiFlushPressure, RuntimeApiResponse, RuntimeApiEntry } from './_shared/apiTypes';
import { shouldLogDev } from './_shared/logFlags';
import { normalizeApiResponse } from './_shared/responseEnvelope';
import { createApiRequestLifecycle } from './_shared/requestLifecycle';
import { runSocketApiValidation } from './_shared/socketValidationStage';
import { applyApiRateLimits } from './_shared/applyApiRateLimits';

interface handleApiRequestType {
  msg: apiMessage,
  socket: Socket,
  token: string | null,
}

interface ApiErrorResponse {
  status: 'error';
  httpStatus?: number;
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean; }[];
}

type EmitApiError = (args: { response: ApiErrorResponse; fallbackHttpStatus?: number; }) => Promise<void>;

const validateApiMessage = async ({ msg, emitApiError }: {
  msg: apiMessage;
  emitApiError: EmitApiError;
}): Promise<{ name: string; data: Record<string, unknown> } | null> => {
  const { name, data, responseIndex } = msg;

  //? Drop a message with no usable response channel. Written as a single
  //? `typeof` test (equivalent to the former `!responseIndex && typeof !==
  //? 'number'` double-negative) so a `responseIndex: 0` is correctly KEPT — a
  //? future "simplify" to `!responseIndex` would silently drop every index-0
  //? request.
  if (typeof responseIndex !== 'number') {
    if (shouldLogDev()) {
      getLogger().warn('api: no response index given');
    }
    return null;
  }

  //? Positive plain-object guard (parity with the sync handler). `!data`
  //? excludes `null`; `Array.isArray` rejects an ARRAY payload that
  //? `typeof === 'object'` would otherwise admit to a handler expecting an
  //? object.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime defense: msg arrives from an untyped socket frame
  if (!name || !data || typeof name != 'string' || typeof data != 'object' || Array.isArray(data)) {
    await emitApiError({
      response: { status: 'error', errorCode: 'api.invalidRequest' },
      fallbackHttpStatus: 400,
    });
    return null;
  }

  return { name, data: data as Record<string, unknown> };
};

const checkApiAuth = async ({ apiEntry, user, name, emitApiError }: {
  apiEntry: RuntimeApiEntry;
  user: SessionLayout | null;
  name: string;
  emitApiError: EmitApiError;
}): Promise<boolean> => {
  if (apiEntry.auth.login && !user?.id) {
    if (shouldLogDev()) {
      getLogger().warn(`api: ${name} requires login`, { route: name });
    }
    void dispatchHook('apiAuthRejected', {
      routeName: name,
      reason: 'login-required',
      userId: null,
      transport: 'socket',
    });
    await emitApiError({
      response: { status: 'error', errorCode: 'auth.required' },
      fallbackHttpStatus: 401,
    });
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const authResult = validateRequest({ auth: apiEntry.auth, user: user! });
  if (authResult.status === 'error') {
    if (shouldLogDev()) {
      getLogger().warn(`api: auth failed for ${name}`, { route: name, errorCode: authResult.errorCode });
    }
    void dispatchHook('apiAuthRejected', {
      routeName: name,
      reason: authResult.errorCode === 'auth.invalidCondition' ? 'invalid-condition' : 'additional-failed',
      userId: user?.id ?? null,
      transport: 'socket',
      failedKey: authResult.errorCode,
    });
    await emitApiError({
      response: {
        status: 'error',
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string errorCode must still fall back
        errorCode: authResult.errorCode || 'auth.forbidden',
        errorParams: authResult.errorParams,
        httpStatus: authResult.httpStatus,
      },
      fallbackHttpStatus: authResult.httpStatus ?? 403,
    });
    return false;
  }

  return true;
};

//? API-O8 — rate-limit logic extracted to `_shared/applyApiRateLimits.ts` so
//? both transports share one implementation. The socket transport resolves the
//? effective IP here (once, from socket internals) before delegating to the helper.
const runSocketRateLimits = async ({ apiEntry, resolvedName, token, socket, user, emitApiError }: {
  apiEntry: RuntimeApiEntry;
  resolvedName: string;
  token: string | null;
  socket: Socket;
  user: SessionLayout | null;
  emitApiError: EmitApiError;
}): Promise<boolean> => {
  //? Resolve the real client IP once. With the default `http.trustProxy: false`
  //? this returns `socket.handshake.address` verbatim (only IPv4-mapped IPv6 is
  //? canonicalized). When a trusted proxy is configured it honors XFF / X-Real-IP.
  const resolvedIp = resolveClientIp({
    rawAddress: socket.handshake.address,
    headers: socket.handshake.headers,
    trustProxy: getProjectConfig().http.trustProxy,
    trustedProxyHopCount: getProjectConfig().http.trustedProxyHopCount,
  });

  const result = await applyApiRateLimits({
    resolvedIp,
    token,
    user,
    resolvedName,
    rateLimit: apiEntry.rateLimit,
    transport: 'socket',
  });

  if (!result.allowed) {
    await emitApiError({
      response: {
        status: 'error',
        errorCode: result.errorCode ?? 'api.rateLimitExceeded',
        errorParams: [{ key: 'seconds', value: result.resetIn ?? 0 }],
      },
      fallbackHttpStatus: 429,
    });
    return false;
  }

  return true;
};

const executeApiHandler = async ({ apiEntry, normalizedData, user, functionsObject, resolvedName, emitStream, abortSignal, abortController, flushPressure }: {
  apiEntry: RuntimeApiEntry;
  normalizedData: Record<string, unknown>;
  user: SessionLayout | null;
  functionsObject: Record<string, unknown>;
  resolvedName: string;
  emitStream: (payload?: ApiStreamPayload) => void;
  abortSignal: AbortSignal;
  abortController: AbortController;
  flushPressure: ApiFlushPressure;
}): Promise<{ error: Error | null; result: RuntimeApiResponse | undefined; durationMs: number; timedOut?: boolean }> => {
  //? Span open/close + identity propagation moved to hook subscribers in
  //? `@luckystack/error-tracking` (preApiExecute / postApiExecute). This
  //? handler is now transport-agnostic instrumentation-wise.
  const executeStart = Date.now();

  //? API-O10 — race `main()` against a server-side timeout derived from
  //? `api.requestTimeoutMs`. When the timeout fires first we abort the
  //? AbortController (propagates to the handler's `abortSignal`) and resolve
  //? a sentinel so the orchestrator can emit a localized 504 envelope.
  const timeoutMs = getProjectConfig().api.requestTimeoutMs;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutPromise = timeoutMs === false
    ? null
    : new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          abortController.abort();
          resolve();
        }, timeoutMs);
      });

  const handlerPromise = tryCatch(
    async () => await apiEntry.main({ data: normalizedData, user, functions: functionsObject, stream: emitStream, abortSignal, flushPressure }),
    undefined,
    {
      handler: 'handleApiRequest',
      api: resolvedName,
      userId: user?.id,
      transport: 'socket',
    },
  );

  if (timeoutPromise) {
    await Promise.race([handlerPromise, timeoutPromise]);
  }
  clearTimeout(timeoutHandle);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- timedOut is mutated by the async timeout callback via Promise.race
  if (timedOut) {
    return { error: null, result: undefined, durationMs: Date.now() - executeStart, timedOut: true };
  }

  const [error, result] = await handlerPromise;
  return { error: error ?? null, result: result ?? undefined, durationMs: Date.now() - executeStart };
};

//? Execution stage: `preApiExecute` hook (stop-signal short-circuit) ->
//? `executeApiHandler` (tryCatch-wrapped) -> `postApiExecute` hook. Extracted
//? from the orchestrator per the `api` package audit. Returns either a stop
//? signal (the orchestrator builds the localized error envelope from it) or the
//? `(error, result)` pair to feed `emitApiResult`. The shared `executePayload`
//? reference is created here and threaded through both hooks so the
//? error-tracking auto-instrumentation can pin spans via WeakMap on it.
type SocketApiExecutionOutcome =
  | { stopped: true; errorCode: string; httpStatus?: number }
  | { stopped: false; error: Error | null; result: RuntimeApiResponse | undefined };

const runSocketApiExecution = async ({
  apiEntry,
  resolvedName,
  normalizedData,
  user,
  functionsObject,
  emitStream,
  abortSignal,
  abortController,
  flushPressure,
}: {
  apiEntry: RuntimeApiEntry;
  resolvedName: string;
  normalizedData: Record<string, unknown>;
  user: SessionLayout | null;
  functionsObject: Record<string, unknown>;
  emitStream: (payload?: ApiStreamPayload) => void;
  abortSignal: AbortSignal;
  abortController: AbortController;
  flushPressure: ApiFlushPressure;
}): Promise<SocketApiExecutionOutcome> => {
  //? Single payload reference reused by pre/post — auto-instrumentation
  //? subscribers in `@luckystack/error-tracking` pin spans via WeakMap on
  //? this object. Mutating `result/error/durationMs` is safe because
  //? handlers observe by-name (not by snapshot).
  const executePayload: PostApiExecutePayload = {
    routeName: resolvedName,
    data: normalizedData,
    user,
    transport: 'socket',
    result: undefined,
    error: null,
    durationMs: 0,
  };
  const preExecuteResult = await dispatchHook('preApiExecute', executePayload);
  if (preExecuteResult.stopped) {
    return { stopped: true, errorCode: preExecuteResult.signal.errorCode, httpStatus: preExecuteResult.signal.httpStatus };
  }

  const { error, result, durationMs, timedOut } = await executeApiHandler({
    apiEntry,
    normalizedData,
    user,
    functionsObject,
    resolvedName,
    emitStream,
    abortSignal,
    abortController,
    flushPressure,
  });

  //? API-O10 — a server-side timeout aborted the handler. Skip postApiExecute
  //? (no meaningful result to report) and surface a 504 to the client.
  if (timedOut) {
    return { stopped: true, errorCode: 'api.timeout', httpStatus: 504 };
  }

  executePayload.result = result;
  executePayload.error = error ?? null;
  executePayload.durationMs = durationMs;
  await dispatchHook('postApiExecute', executePayload);

  return { stopped: false, error, result };
};

const emitApiResult = async ({
  socket,
  responseIndex,
  resolvedName,
  error,
  result,
  preferredLocale,
  user,
  perRouteFormatter,
}: {
  socket: Socket;
  responseIndex: number;
  resolvedName: string;
  error: Error | null;
  result: RuntimeApiResponse | undefined;
  preferredLocale: string | undefined;
  user: SessionLayout | null;
  perRouteFormatter?: ErrorFormatter;
}): Promise<void> => {
  const envelope = normalizeApiResponse({ resolvedName, error, result, preferredLocale, user });

  //? `preApiRespond` handlers may mutate `payload.response` to swap or rewrite
  //? the outgoing envelope (PII redaction, response signing, schema injection).
  //? A handler may also return a stop signal — when that happens we build a
  //? fresh error envelope from the signal's `errorCode` / `httpStatus` and
  //? emit that instead of the original.
  const preRespond = { routeName: resolvedName, user, response: envelope };
  const preRespondResult = await dispatchHook('preApiRespond', preRespond);

  const finalResponse = preRespondResult.stopped
    ? { ...normalizeErrorResponse({
        response: { status: 'error', errorCode: preRespondResult.signal.errorCode },
        preferredLocale,
        userLanguage: user?.language,
        fallbackHttpStatus: preRespondResult.signal.httpStatus ?? 403,
      }) }
    : preRespond.response;

  //? `transformApiResponse` fires AFTER preApiRespond and BEFORE socket emit.
  //? Designed for response mutation — header injection, body transformation,
  //? response signing — that's awkward inside preApiRespond. Handlers mutate
  //? `payload.response` in place (same shape as preApiRespond.response).
  const transformPayload = { routeName: resolvedName, user, response: finalResponse };
  await dispatchHook('transformApiResponse', transformPayload);

  //? Per-route → global → identity error formatter chain. No-op when status
  //? is success. Runs AFTER transformApiResponse so consumer hooks can still
  //? mutate the envelope before the final shape lands.
  const formattedResponse = applyErrorFormatter({
    response: transformPayload.response,
    routeName: resolvedName,
    transport: 'socket',
    userId: user?.id,
    perRouteFormatter,
  });

  socket.emit(buildApiResponseEventName(responseIndex), formattedResponse);

  //? `postApiRespond` is observation-only — the response is already on the
  //? wire. Use it for audit logging, metrics, dual-write replication.
  await dispatchHook('postApiRespond', { routeName: resolvedName, user, response: formattedResponse });
};

//? ET-02 — open a per-request error-tracker identity scope around the ENTIRE
//? handler before any await that could interleave with another concurrent
//? request. `readSession` (the first await below) is itself such a boundary, so
//? the scope must wrap it. The session is written into the scope via
//? `setCurrentErrorTrackerIdentity(...)` the moment it resolves; from then on
//? every error-tracker capture during this request (handler throw, hook
//? subscriber, fanout) reads THIS request's identity from the AsyncLocalStorage
//? box, never another concurrent request's. Each request gets its own box.
export default async function handleApiRequest(args: handleApiRequestType): Promise<void> {
  //? handleApiRequestInner runs un-.catch()'d from loadSocket (a bare `void`
  //? call), so ANY throw from an unguarded dependency (readSession, the rate-limit
  //? Redis calls, getRuntimeApiMaps, the session store) would surface as a fatal
  //? unhandledRejection → worker crash on modern Node. Wrap the whole run (mirrors
  //? the sync handler's top-level tryCatch) and emit a generic error envelope on
  //? the response channel so the request fails cleanly instead of killing the worker.
  const [error] = await tryCatch(() => runWithErrorTrackerIdentityScope(() => handleApiRequestInner(args)));
  if (error) {
    getLogger().error('api: unhandled error in socket request handler', { error: error.message });
    const msg = args.msg as apiMessage | null;
    const responseIndex = msg?.responseIndex;
    if (typeof responseIndex === 'number') {
      args.socket.emit(buildApiResponseEventName(responseIndex), {
        status: 'error',
        errorCode: 'api.serverExecutionFailed',
        httpStatus: 500,
      });
    }
  }
}

async function handleApiRequestInner({ msg, socket, token }: handleApiRequestType) {
  //? This event gets triggered when the client uses the apiRequest function.
  //? Validate the message, check auth, then execute the registered handler.

  //? `msg` is TYPED as apiMessage but the socket transport can deliver ANYTHING at
  //? runtime (null / array / primitive), so view it as `unknown` for the guard.
  //? `typeof null === 'object'` and arrays are objects, so the bare object check
  //? would let null/array through to `const { responseIndex } = msg` below —
  //? throwing before any handler. That throw, running un-.catch()'d from loadSocket,
  //? becomes a fatal unhandledRejection → worker crash; a connected socket could
  //? trigger it pre-auth via `socket.emit('api', null)` (remote DoS). Mirrors the
  //? sync handler's validateSyncMessage guard.
  const rawMsg: unknown = msg;
  if (typeof rawMsg !== 'object' || rawMsg === null || Array.isArray(rawMsg)) {
    if (shouldLogDev()) {
      getLogger().warn('api: socket message was not a json object');
    }
    return;
  }

  const { responseIndex } = msg;

  //? EXT-02 — per-message socket interception seam (counterpart to preHttpRequest
  //? in the HTTP pipeline and preSocketMessage in the sync handler). Fires before
  //? session lookup / route resolution / auth so a consumer can gate, throttle, or
  //? audit individual api messages. A stop signal rejects the message.
  const preMsgResult = await dispatchHook('preSocketMessage', {
    channel: 'api',
    socketId: socket.id,
    ip: socket.handshake.address,
    authenticated: Boolean(token),
    routeName: typeof msg.name === 'string' ? msg.name : undefined,
  });
  if (preMsgResult.stopped) {
    //? Guard the emit on a numeric responseIndex (mirrors the sync handler +
    //? validateApiMessage's own no-index branch below): this stop path runs
    //? BEFORE validateApiMessage, so a malformed frame lacking responseIndex
    //? would otherwise emit to the dead 'apiResponse-undefined' channel and
    //? leave the client hanging until its own ack timeout. Drop it silently.
    if (typeof responseIndex === 'number') {
      socket.emit(buildApiResponseEventName(responseIndex), {
        status: 'error',
        errorCode: preMsgResult.signal.errorCode,
        httpStatus: preMsgResult.signal.httpStatus ?? 403,
      });
    }
    return;
  }

  const user = await readSession(token);
  //? ET-02 — bind the resolved session into the active per-request ALS identity
  //? box so every subsequent capture attributes to this user. Identity also still
  //? flows to the legacy global via the `preApiValidate` hook subscriber in
  //? `@luckystack/error-tracking` (the ALS read takes precedence at capture time).
  setCurrentErrorTrackerIdentity(user?.id ? { id: user.id, email: user.email ?? undefined, username: user.name ?? undefined } : null);
  const preferredLocale =
    extractLanguageFromHeader(socket.handshake.headers['x-language'])
    ?? extractLanguageFromHeader(socket.handshake.headers['accept-language'])
    ?? undefined;

  //? Per-route formatter ref + resolved-name ref. Both start undefined and
  //? get set once the route is parsed + the apiEntry looked up — pre-lookup
  //? errors (invalid message shape, unknown route) emit with global formatter
  //? only because there's no apiEntry to read per-route formatter from. After
  //? lookup, every emit through `emitApiError` flows through the same chain.
  // eslint-disable-next-line prefer-const -- captured by emitApiError closure; assigned later after route resolution
  let currentRouteName: string | undefined;
  // eslint-disable-next-line prefer-const -- captured by emitApiError closure; assigned later after apiEntry lookup
  let currentPerRouteFormatter: ErrorFormatter | undefined;

  //? API-O6 parity — socket ERROR responses now run the SAME respond-hook chain
  //? as success responses (`emitApiResult`) and as the HTTP transport: preApiRespond
  //? (may rewrite/stop) → transformApiResponse (mutate) → error formatter → emit →
  //? postApiRespond (observe). Previously `emitApiError` emitted directly, so
  //? consumer respond hooks (PII redaction, response signing, audit logging) never
  //? fired on auth / rate-limit / validation / not-found rejections over WebSocket —
  //? a parity gap with HTTP, where every response (success AND error) runs them.
  const emitApiError: EmitApiError = async ({ response, fallbackHttpStatus }) => {
    const normalized = normalizeErrorResponse({
      response,
      preferredLocale,
      userLanguage: user?.language,
      fallbackHttpStatus,
    });
    const routeNameForHook = currentRouteName ?? 'api/unknown';

    //? preApiRespond may mutate the envelope or stop. A stop on an already-error
    //? response rebuilds a fresh error envelope from the signal (parity with
    //? `emitApiResult` + the HTTP path).
    // luckystack-allow no-as-unknown: hook payload boundary — normalizeErrorResponse returns a narrower type than the preApiRespond payload shape; fix requires @luckystack/core type alignment
    // eslint-disable-next-line no-restricted-syntax -- hook payload boundary, mirrors handleHttpApiRequest
    const preRespond = { routeName: routeNameForHook, user, response: normalized as unknown as { status: 'success' | 'error'; httpStatus?: number; [key: string]: unknown } };
    const preRespondResult = await dispatchHook('preApiRespond', preRespond);

    let finalResponse = preRespond.response;
    if (preRespondResult.stopped) {
      const stoppedEnvelope = normalizeErrorResponse({
        response: { status: 'error', errorCode: preRespondResult.signal.errorCode },
        preferredLocale,
        userLanguage: user?.language,
        fallbackHttpStatus: preRespondResult.signal.httpStatus ?? 403,
      });
      // luckystack-allow no-as-unknown: hook payload boundary — normalizeErrorResponse is narrower than the hook payload shape; fix requires @luckystack/core type alignment
      // eslint-disable-next-line no-restricted-syntax -- hook payload boundary, mirrors handleHttpApiRequest
      finalResponse = stoppedEnvelope as unknown as typeof preRespond.response;
    }

    const transformPayload = { routeName: routeNameForHook, user, response: finalResponse };
    await dispatchHook('transformApiResponse', transformPayload);

    const formatted = applyErrorFormatter({
      response: transformPayload.response,
      routeName: routeNameForHook,
      transport: 'socket',
      userId: user?.id,
      perRouteFormatter: currentPerRouteFormatter,
    });
    socket.emit(buildApiResponseEventName(responseIndex), formatted);

    //? postApiRespond is observation-only — the response is already on the wire.
    await dispatchHook('postApiRespond', { routeName: routeNameForHook, user, response: formatted });
  };

  const validated = await validateApiMessage({ msg, emitApiError });
  if (!validated) return;
  const { name, data: normalizedData } = validated;

  const parsedRoute = parseTransportRouteName({ value: name, prefix: 'api' });
  if (parsedRoute.status === 'error') {
    await emitApiError({
      response: {
        status: 'error',
        errorCode: 'routing.invalidServiceRouteName',
        errorParams: [{ key: 'name', value: name }],
      },
      fallbackHttpStatus: 400,
    });
    return;
  }

  const resolvedName = parsedRoute.normalizedFullName;
  currentRouteName = resolvedName;

  //? Built-in 'system/logout' needs special handling since it requires socket access.
  //? Match the full normalized route to avoid hijacking consumer routes whose final
  //? segment happens to be 'logout' (e.g. 'admin/logout/vN').
  if (parsedRoute.serviceRoute.normalizedRouteName === 'system/logout') {
    //? Apply the global per-IP bucket before logout so the shortcut can't be
    //? spammed uncapped — it bypasses applyApiRateLimits entirely.
    const logoutIpLimit = getProjectConfig().rateLimiting.defaultIpLimit;
    if (logoutIpLimit !== false && logoutIpLimit > 0) {
      const logoutIp = resolveClientIp({
        rawAddress: socket.handshake.address,
        headers: socket.handshake.headers,
        trustProxy: getProjectConfig().http.trustProxy,
        trustedProxyHopCount: getProjectConfig().http.trustedProxyHopCount,
      });
      const { allowed, resetIn } = await checkRateLimit({
        key: `ip:${logoutIp}:api:all`,
        limit: logoutIpLimit,
        windowMs: getProjectConfig().rateLimiting.windowMs,
      });
      if (!allowed) {
        void dispatchHook('rateLimitExceeded', {
          scope: 'ip',
          key: `ip:${logoutIp}:api:all`,
          limit: logoutIpLimit,
          windowMs: getProjectConfig().rateLimiting.windowMs,
          count: logoutIpLimit + 1,
          ip: logoutIp,
        });
        await emitApiError({
          response: {
            status: 'error',
            errorCode: 'api.rateLimitExceeded',
            errorParams: [{ key: 'seconds', value: resetIn }],
          },
          fallbackHttpStatus: 429,
        });
        return;
      }
    }
    //? API-O6 — route through `emitApiResult` so the respond-hook chain
    //? (preApiRespond, transformApiResponse, postApiRespond) fires for logout,
    //? matching all other routes. The return value of `performLogout` is void
    //? (success is implied by non-throw), so we pass a fixed success result.
    await performLogout({ token, socket, userId: user?.id ?? null });
    await emitApiResult({
      socket,
      responseIndex,
      resolvedName,
      error: null,
      result: { status: 'success', httpStatus: 200, result: true },
      preferredLocale,
      user,
    });
    return;
  }

  if (shouldLogDev()) {
    getLogger().debug(`api: ${resolvedName} called`);
  }

  const { apisObject, functionsObject } = await getRuntimeApiMaps();

  if (!apisObject[resolvedName]) {
    await emitApiError({
      response: {
        status: 'error',
        errorCode: 'api.notFound',
        errorParams: [{ key: 'name', value: name }],
      },
      fallbackHttpStatus: 404,
    });
    return;
  }

  const apiEntry = apisObject[resolvedName] as RuntimeApiEntry;
  currentPerRouteFormatter = apiEntry.errorFormatter;

  //? API-O4 — `httpMethod` (and the `inferHttpMethod` heuristic) is HTTP-ONLY.
  //? The socket transport does NOT enforce the declared HTTP method — all routes
  //? are callable over WebSocket regardless of method declaration. This is by
  //? design: socket.io has no HTTP-method concept and enforcing it would break
  //? existing consumers. If you need to restrict a route to HTTP only, do not
  //? expose it as a socket route, or gate it in `preSocketMessage`.

  //? Per-request lifecycle bundle (B1 abortController + cleanup, B2
  //? backpressure, abort-aware emitStream). Extracted to `_shared/
  //? requestLifecycle.ts`; the closures stay intact and the orchestrator
  //? threads the returned handles through the pipeline. `cleanupRequest`
  //? runs in every exit path below.
  const { abortController, abortSignal, emitStream, flushPressure, cleanupRequest } = createApiRequestLifecycle({
    socket,
    responseIndex,
    resolvedName,
  });

  //? Auth → rate-limit → validate → execute → respond.
  //? Auth runs before validate so unauthenticated probes can't enumerate
  //? routes or learn input shape from `inputValidation.message`.
  //? API-O7 — failed-auth requests do NOT consume a rate-limit bucket here.
  //? This is an explicit design choice: brute-force lockout is the
  //? responsibility of `@luckystack/login` (per-account lockout counter via
  //? `authLockout.ts`), and the `apiAuthRejected` hook lets consumers add
  //? additional throttles. Consuming the global-IP bucket on auth-fail would
  //? allow an attacker to trigger DoS for a victim account's IP by deliberately
  //? sending bad credentials.
  if (!(await checkApiAuth({ apiEntry, user, name, emitApiError }))) { cleanupRequest(); return; }

  const rateLimitOk = await runSocketRateLimits({ apiEntry, resolvedName, token, socket, user, emitApiError });
  if (!rateLimitOk) { cleanupRequest(); return; }

  //? Validation stage (mode resolve + preApiValidate -> validateInputByType ->
  //? postApiValidate). On failure it runs cleanup + emits the GENERIC
  //? `api.invalidInputType` (raw validator message never reaches the client)
  //? via the closures below, then returns false.
  const validationOk = await runSocketApiValidation({
    apiEntry,
    resolvedName,
    normalizedData,
    user,
    cleanupRequest,
    emitInvalidInputType: async () => { await emitApiError({
      response: { status: 'error', errorCode: 'api.invalidInputType' },
      fallbackHttpStatus: 400,
    }); },
  });
  if (!validationOk) return;

  //? Execution stage: preApiExecute (stop-signal short-circuit) -> handler ->
  //? postApiExecute. Returns either a stop signal or the (error, result) pair.
  const execution = await runSocketApiExecution({
    apiEntry,
    resolvedName,
    normalizedData,
    user,
    functionsObject,
    emitStream,
    abortSignal,
    abortController,
    flushPressure,
  });
  if (execution.stopped) {
    cleanupRequest();
    await emitApiError({
      response: { status: 'error', errorCode: execution.errorCode },
      fallbackHttpStatus: execution.httpStatus ?? 403,
    });
    return;
  }

  await emitApiResult({ socket, responseIndex, resolvedName, error: execution.error, result: execution.result, preferredLocale, user, perRouteFormatter: apiEntry.errorFormatter });
  cleanupRequest();
}
