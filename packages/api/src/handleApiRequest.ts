/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import type { apiMessage, PostApiExecutePayload } from '@luckystack/core';
import { readSession, performLogout } from '@luckystack/core';
import type { BaseSessionLayout as SessionLayout } from '@luckystack/core';
import { getProjectConfig } from '@luckystack/core';
import { Socket } from 'socket.io';
import { getRuntimeApiMaps } from '@luckystack/core';
import {
  validateRequest,
  checkRateLimit,
  tryCatch,
  parseTransportRouteName,
  buildApiResponseEventName,
  dispatchHook,
  getLogger,
  resolveClientIp,
} from '@luckystack/core';
import {
  extractLanguageFromHeader,
  normalizeErrorResponse,
  applyErrorFormatter,
} from '@luckystack/core';
import type { ErrorFormatter } from '@luckystack/core';
import type { ApiStreamPayload, ApiFlushPressure, RuntimeApiResponse, RuntimeApiEntry } from './_shared/apiTypes';
import { shouldLogDev } from './_shared/logFlags';
import { normalizeApiResponse } from './_shared/responseEnvelope';
import { createApiRequestLifecycle } from './_shared/requestLifecycle';
import { runSocketApiValidation } from './_shared/socketValidationStage';

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

type EmitApiError = (args: { response: ApiErrorResponse; fallbackHttpStatus?: number; }) => void;

const validateApiMessage = ({ msg, emitApiError }: {
  msg: apiMessage;
  emitApiError: EmitApiError;
}): { name: string; data: Record<string, unknown> } | null => {
  const { name, data, responseIndex } = msg;

  if (!responseIndex && typeof responseIndex !== 'number') {
    if (shouldLogDev()) {
      getLogger().warn('api: no response index given');
    }
    return null;
  }

  if (!name || !data || typeof name != 'string' || typeof data != 'object') {
    emitApiError({
      response: { status: 'error', errorCode: 'api.invalidRequest' },
      fallbackHttpStatus: 400,
    });
    return null;
  }

  return { name, data: data as Record<string, unknown> };
};

const checkApiAuth = ({ apiEntry, user, name, emitApiError }: {
  apiEntry: RuntimeApiEntry;
  user: SessionLayout | null;
  name: string;
  emitApiError: EmitApiError;
}): boolean => {
  if (apiEntry.auth.login && !user?.id) {
    if (shouldLogDev()) {
      getLogger().warn(`api: ${name} requires login`, { route: name });
    }
    emitApiError({
      response: { status: 'error', errorCode: 'auth.required' },
      fallbackHttpStatus: 401,
    });
    return false;
  }

  const authResult = validateRequest({ auth: apiEntry.auth, user: user! });
  if (authResult.status === 'error') {
    if (shouldLogDev()) {
      getLogger().warn(`api: auth failed for ${name}`, { route: name, errorCode: authResult.errorCode });
    }
    emitApiError({
      response: {
        status: 'error',
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

const applyApiRateLimits = async ({ apiEntry, resolvedName, token, socket, user, emitApiError }: {
  apiEntry: RuntimeApiEntry;
  resolvedName: string;
  token: string | null;
  socket: Socket;
  user: SessionLayout | null;
  emitApiError: EmitApiError;
}): Promise<boolean> => {
  const apiRateLimit = apiEntry.rateLimit;
  const effectiveApiLimit = apiRateLimit === undefined
    ? getProjectConfig().rateLimiting.defaultApiLimit
    : apiRateLimit;

  //? Resolve the real client IP once for both buckets. With the default
  //? `http.trustProxy: false` this returns `socket.handshake.address` verbatim
  //? (only IPv4-mapped IPv6 is canonicalized), preserving historical keys;
  //? when a trusted proxy is configured it honors X-Forwarded-For / X-Real-IP.
  const resolvedIp = resolveClientIp({
    rawAddress: socket.handshake.address,
    headers: socket.handshake.headers,
    trustProxy: getProjectConfig().http.trustProxy,
  });

  if (effectiveApiLimit !== false && effectiveApiLimit > 0) {
    const requesterIdentity = token ?? resolvedIp;
    const keyPrefix = token ? 'token' : 'ip';
    const rateLimitKey = `${keyPrefix}:${requesterIdentity}:api:${resolvedName}`;

    const { allowed, resetIn } = await checkRateLimit({
      key: rateLimitKey,
      limit: effectiveApiLimit,
      windowMs: getProjectConfig().rateLimiting.windowMs,
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
        getLogger().warn(`api: rate limit exceeded for ${resolvedName}`, { route: resolvedName, key: rateLimitKey });
      }
      emitApiError({
        response: {
          status: 'error',
          errorCode: 'api.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
        },
        fallbackHttpStatus: 429,
      });
      return false;
    }
  }

  const defaultIpLimit = getProjectConfig().rateLimiting.defaultIpLimit;
  if (defaultIpLimit !== false && defaultIpLimit > 0) {
    const requesterIp = resolvedIp;

    const { allowed, resetIn } = await checkRateLimit({
      key: `ip:${requesterIp}:api:all`,
      limit: defaultIpLimit,
      windowMs: getProjectConfig().rateLimiting.windowMs,
    });

    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        scope: 'ip',
        key: `ip:${requesterIp}:api:all`,
        limit: defaultIpLimit,
        windowMs: getProjectConfig().rateLimiting.windowMs,
        count: defaultIpLimit + 1,
        ip: requesterIp,
      });
      if (shouldLogDev()) {
        getLogger().warn(`api: global IP rate limit exceeded`, { ip: requesterIp });
      }
      emitApiError({
        response: {
          status: 'error',
          errorCode: 'api.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
        },
        fallbackHttpStatus: 429,
      });
      return false;
    }
  }

  return true;
};

const executeApiHandler = async ({ apiEntry, normalizedData, user, functionsObject, resolvedName, emitStream, abortSignal, flushPressure }: {
  apiEntry: RuntimeApiEntry;
  normalizedData: Record<string, unknown>;
  user: SessionLayout | null;
  functionsObject: Record<string, unknown>;
  resolvedName: string;
  emitStream: (payload?: ApiStreamPayload) => void;
  abortSignal: AbortSignal;
  flushPressure: ApiFlushPressure;
}): Promise<{ error: Error | null; result: RuntimeApiResponse | undefined; durationMs: number }> => {
  //? Span open/close + identity propagation moved to hook subscribers in
  //? `@luckystack/error-tracking` (preApiExecute / postApiExecute). This
  //? handler is now transport-agnostic instrumentation-wise.
  const executeStart = Date.now();
  const [error, result] = await tryCatch(
    async () => await apiEntry.main({ data: normalizedData, user, functions: functionsObject, stream: emitStream, abortSignal, flushPressure }),
    undefined,
    {
      handler: 'handleApiRequest',
      api: resolvedName,
      userId: user?.id,
      transport: 'socket',
    },
  );
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
  flushPressure,
}: {
  apiEntry: RuntimeApiEntry;
  resolvedName: string;
  normalizedData: Record<string, unknown>;
  user: SessionLayout | null;
  functionsObject: Record<string, unknown>;
  emitStream: (payload?: ApiStreamPayload) => void;
  abortSignal: AbortSignal;
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

  const { error, result, durationMs } = await executeApiHandler({
    apiEntry,
    normalizedData,
    user,
    functionsObject,
    resolvedName,
    emitStream,
    abortSignal,
    flushPressure,
  });

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
  const preRespond = { routeName: resolvedName, user, response: envelope as { status: 'success' | 'error'; httpStatus?: number; [key: string]: unknown } };
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
  }) as { status: 'success' | 'error'; httpStatus?: number; [key: string]: unknown };

  socket.emit(buildApiResponseEventName(responseIndex), formattedResponse);

  //? `postApiRespond` is observation-only — the response is already on the
  //? wire. Use it for audit logging, metrics, dual-write replication.
  await dispatchHook('postApiRespond', { routeName: resolvedName, user, response: formattedResponse });
};

export default async function handleApiRequest({ msg, socket, token }: handleApiRequestType) {
  //? This event gets triggered when the client uses the apiRequest function.
  //? Validate the message, check auth, then execute the registered handler.

  if (typeof msg != 'object') {
    if (shouldLogDev()) {
      getLogger().warn('api: socket message was not a json object');
    }
    return;
  }

  const { responseIndex } = msg;
  const user = await readSession(token);
  //? Identity propagation now flows via the `preApiExecute` hook subscriber
  //? registered by `@luckystack/error-tracking`'s `enableErrorTrackingAutoInstrumentation()`.
  //? Direct `setSentryUser` removed from this handler — see migration doc.
  const preferredLocale =
    extractLanguageFromHeader(socket.handshake.headers['x-language'])
    || extractLanguageFromHeader(socket.handshake.headers['accept-language'])
    || undefined;

  //? Per-route formatter ref + resolved-name ref. Both start undefined and
  //? get set once the route is parsed + the apiEntry looked up — pre-lookup
  //? errors (invalid message shape, unknown route) emit with global formatter
  //? only because there's no apiEntry to read per-route formatter from. After
  //? lookup, every emit through `emitApiError` flows through the same chain.
  let currentRouteName: string | undefined;
  let currentPerRouteFormatter: ErrorFormatter | undefined;

  const emitApiError: EmitApiError = ({ response, fallbackHttpStatus }) => {
    const normalized = normalizeErrorResponse({
      response,
      preferredLocale,
      userLanguage: user?.language,
      fallbackHttpStatus,
    });
    const formatted = applyErrorFormatter({
      response: normalized as unknown as Record<string, unknown> & { status?: string },
      routeName: currentRouteName ?? 'api/unknown',
      transport: 'socket',
      userId: user?.id,
      perRouteFormatter: currentPerRouteFormatter,
    });
    socket.emit(buildApiResponseEventName(responseIndex), formatted);
  };

  const validated = validateApiMessage({ msg, emitApiError });
  if (!validated) return;
  const { name, data: normalizedData } = validated;

  const parsedRoute = parseTransportRouteName({ value: name, prefix: 'api' });
  if (parsedRoute.status === 'error') {
    return emitApiError({
      response: {
        status: 'error',
        errorCode: 'routing.invalidServiceRouteName',
        errorParams: [{ key: 'name', value: name }],
      },
      fallbackHttpStatus: 400,
    });
  }

  const resolvedName = parsedRoute.normalizedFullName;
  currentRouteName = resolvedName;

  //? Built-in 'system/logout' needs special handling since it requires socket access.
  //? Match the full normalized route to avoid hijacking consumer routes whose final
  //? segment happens to be 'logout' (e.g. 'admin/logout/vN').
  if (parsedRoute.serviceRoute.normalizedRouteName === 'system/logout') {
    await performLogout({ token, socket, userId: user?.id || null });
    return socket.emit(buildApiResponseEventName(responseIndex), {
      status: 'success',
      httpStatus: 200,
      result: true,
    });
  }

  if (shouldLogDev()) {
    getLogger().debug(`api: ${resolvedName} called`);
  }

  const { apisObject, functionsObject } = await getRuntimeApiMaps();

  if (!apisObject[resolvedName]) {
    return emitApiError({
      response: {
        status: 'error',
        errorCode: 'api.notFound',
        errorParams: [{ key: 'name', value: name }],
      },
      fallbackHttpStatus: 404,
    });
  }

  const apiEntry = apisObject[resolvedName] as RuntimeApiEntry;
  currentPerRouteFormatter = apiEntry.errorFormatter;

  //? Per-request lifecycle bundle (B1 abortController + cleanup, B2
  //? backpressure, abort-aware emitStream). Extracted to `_shared/
  //? requestLifecycle.ts`; the closures stay intact and the orchestrator
  //? threads the returned handles through the pipeline. `cleanupRequest`
  //? runs in every exit path below.
  const { abortSignal, emitStream, flushPressure, cleanupRequest } = createApiRequestLifecycle({
    socket,
    responseIndex,
    resolvedName,
  });

  //? Auth → rate-limit → validate → execute → respond.
  //? Auth runs before validate so unauthenticated probes can't enumerate
  //? routes or learn input shape from `inputValidation.message`.
  if (!checkApiAuth({ apiEntry, user, name, emitApiError })) { cleanupRequest(); return; }

  const rateLimitOk = await applyApiRateLimits({ apiEntry, resolvedName, token, socket, user, emitApiError });
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
    emitInvalidInputType: () => emitApiError({
      response: { status: 'error', errorCode: 'api.invalidInputType' },
      fallbackHttpStatus: 400,
    }),
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
    flushPressure,
  });
  if (execution.stopped) {
    cleanupRequest();
    return emitApiError({
      response: { status: 'error', errorCode: execution.errorCode },
      fallbackHttpStatus: execution.httpStatus ?? 403,
    });
  }

  await emitApiResult({ socket, responseIndex, resolvedName, error: execution.error, result: execution.result, preferredLocale, user, perRouteFormatter: apiEntry.errorFormatter });
  cleanupRequest();
}
