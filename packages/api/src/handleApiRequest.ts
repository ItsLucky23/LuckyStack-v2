/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import type { apiMessage, PostApiExecutePayload } from '@luckystack/core';
import { getSession, logout } from '@luckystack/login';
import type { BaseSessionLayout as SessionLayout } from '@luckystack/login';
import { getProjectConfig } from '@luckystack/core';
import type { AuthProps } from '@luckystack/login';
import { Socket } from 'socket.io';
import { getRuntimeApiMaps } from '@luckystack/core';
import {
  validateRequest,
  checkRateLimit,
  tryCatch,
  parseTransportRouteName,
  buildApiResponseEventName,
  buildApiStreamEventName,
  dispatchHook,
  validateInputByType,
  getLogger,
} from '@luckystack/core';
import {
  defaultHttpStatusForResponse,
  extractLanguageFromHeader,
  normalizeErrorResponse,
  applyErrorFormatter,
  registerApiAbortController,
  unregisterApiAbortController,
  socketEventNames,
} from '@luckystack/core';
import type { ErrorFormatter } from '@luckystack/core';

interface handleApiRequestType {
  msg: apiMessage,
  socket: Socket,
  token: string | null,
}

type ApiStreamPayload = Record<string, unknown>;

interface RuntimeErrorResponse {
  status: 'error';
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean; }[];
  httpStatus?: number;
  message?: string;
  [key: string]: unknown;
}

interface RuntimeSuccessResponse {
  status: 'success';
  message?: string;
  httpStatus?: number;
  [key: string]: unknown;
}

type RuntimeApiResponse = RuntimeSuccessResponse | RuntimeErrorResponse;

//? B2 — backpressure helper for API handlers. Same opt-in pattern as
//? sync; resolves once the originator socket's pending write buffer drops
//? below the threshold. Default 1 MB.
export interface ApiFlushPressureOptions {
  thresholdBytes?: number;
}
export type ApiFlushPressure = (options?: ApiFlushPressureOptions) => Promise<void>;

interface RuntimeApiEntry {
  auth: AuthProps;
  main: (params: {
    data: Record<string, unknown>;
    user: SessionLayout | null;
    functions: Record<string, unknown>;
    stream: (payload?: ApiStreamPayload) => void;
    //? B1 — aborts on `apiCancel` or socket disconnect.
    abortSignal: AbortSignal;
    //? B2 — backpressure helper bound to the originator socket.
    flushPressure: ApiFlushPressure;
  }) => Promise<RuntimeApiResponse>;
  inputType?: string;
  inputTypeFilePath?: string;
  rateLimit?: number | false;
  /**
   * Per-route validation strictness.
   * `'strict'` (default): runtime Zod validation runs, mismatched payloads
   *   are rejected with `api.invalidInputType`.
   * `'relaxed'` / `{ input: 'skip' }`: skip the validate step. Use for public
   *   webhooks that receive third-party-shaped payloads you can't model in TS,
   *   or for migration windows when input shapes are in flux.
   */
  validation?: 'strict' | 'relaxed' | { input: 'skip' | 'strict' };
  /**
   * Per-route error response formatter. Receives the normalized error
   * envelope + context and returns the shape to emit. Falls back to the
   * global formatter from `registerErrorFormatter(...)`, then to the
   * framework default `normalizeErrorResponse`. See
   * docs/ARCHITECTURE_EXTENSION_POINTS.md for the resolution order.
   */
  errorFormatter?: ErrorFormatter;
}

interface ApiErrorResponse {
  status: 'error';
  httpStatus?: number;
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean; }[];
}

type EmitApiError = (args: { response: ApiErrorResponse; fallbackHttpStatus?: number; }) => void;

const shouldLogDev = () => getProjectConfig().logging.devLogs;
const shouldLogStream = () => getProjectConfig().logging.stream;

//? Track routes we've already warned about so we don't spam the log every
//? request. Set is module-level — fine for the dev-only warning.
const warnedMissingInputType = new Set<string>();
const warnIfInputTypeMissing = (resolvedName: string, inputType: string | undefined): void => {
  if (!getProjectConfig().dev.warnOnMissingInputType) return;
  if (inputType && inputType.trim().length > 0 && inputType.trim() !== 'any') return;
  if (warnedMissingInputType.has(resolvedName)) return;
  warnedMissingInputType.add(resolvedName);
  getLogger().warn(`api: route ${resolvedName} has no inputType — runtime input validation is disabled. Regenerate types or set the inputType on the handler.`);
};

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

  if (effectiveApiLimit !== false && effectiveApiLimit > 0) {
    const requesterIdentity = token ?? socket.handshake.address ?? 'unknown';
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
    const requesterIp = socket.handshake.address ?? 'unknown';

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

const buildApiResponseEnvelope = ({
  resolvedName,
  error,
  result,
  preferredLocale,
  user,
}: {
  resolvedName: string;
  error: Error | null;
  result: RuntimeApiResponse | undefined;
  preferredLocale: string | undefined;
  user: SessionLayout | null;
}): { status: 'success' | 'error'; httpStatus?: number; [key: string]: unknown } => {
  if (error) {
    if (shouldLogDev()) {
      getLogger().error(`api: error in ${resolvedName}`, error, { route: resolvedName });
    }
    return { ...normalizeErrorResponse({
      response: { status: 'error', errorCode: 'api.internalServerError' },
      preferredLocale,
      userLanguage: user?.language,
      fallbackHttpStatus: 500,
    }) };
  }

  if (result === undefined || result === null) {
    if (shouldLogDev()) {
      getLogger().warn(`api: ${resolvedName} returned nothing`);
    }
    return { ...normalizeErrorResponse({
      response: { status: 'error', errorCode: 'api.emptyResponse' },
      preferredLocale,
      userLanguage: user?.language,
      fallbackHttpStatus: 500,
    }) };
  }

  if (shouldLogDev()) {
    getLogger().debug(`api: ${resolvedName} completed`);
  }

  if (result.status !== 'success' && result.status !== 'error') {
    return { ...normalizeErrorResponse({
      response: { status: 'error', errorCode: 'api.invalidResponseStatus' },
      preferredLocale,
      userLanguage: user?.language,
      fallbackHttpStatus: 500,
    }) };
  }

  if (result.status === 'error') {
    return { ...normalizeErrorResponse({
      response: result,
      preferredLocale,
      userLanguage: user?.language,
      fallbackHttpStatus: defaultHttpStatusForResponse({
        status: 'error',
        explicitHttpStatus: typeof result.httpStatus === 'number' ? result.httpStatus : undefined,
      }),
    }) };
  }

  return {
    ...result,
    status: 'success',
    httpStatus: defaultHttpStatusForResponse({
      status: 'success',
      explicitHttpStatus: typeof result.httpStatus === 'number' ? result.httpStatus : undefined,
    }),
  };
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
  const envelope = buildApiResponseEnvelope({ resolvedName, error, result, preferredLocale, user });

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
  const user = await getSession(token);
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
    await logout({ token, socket, userId: user?.id || null });
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

  //? B1 — per-request AbortController. Aborts on `apiCancel { responseIndex }`
  //? from the originator OR socket disconnect. Cleanup runs in every exit
  //? path (errors, validation rejects, completion) to remove the disconnect
  //? listener and drop the cancel-registry entry. The signal is also handed
  //? to `emitStream` so chunks queued after an abort never hit the wire.
  const abortController = new AbortController();
  const abortKey = registerApiAbortController(socket.id, responseIndex, abortController);
  const onSocketDisconnect = () => { abortController.abort(); };
  socket.once(socketEventNames.disconnect, onSocketDisconnect);
  let cleanupDone = false;
  const cleanupRequest = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    socket.off(socketEventNames.disconnect, onSocketDisconnect);
    unregisterApiAbortController(abortKey);
  };

  const emitStream = (payload: ApiStreamPayload = {}) => {
    if (abortController.signal.aborted) {
      if (shouldLogStream()) {
        getLogger().debug(`api: ${resolvedName} stream skipped — request aborted`);
      }
      return;
    }
    if (shouldLogStream()) {
      getLogger().debug(`api: ${resolvedName} stream`, { payload });
    }
    socket.emit(buildApiStreamEventName(responseIndex), payload);
  };

  //? B2 — backpressure helper for API handlers. Same shape as the sync
  //? variant but always scoped to a single originator socket. Polls the
  //? engine.io writeBuffer length every 10ms until the buffer drains below
  //? threshold (default 1 MB ≈ 1024 packets at ~1KB each).
  const apiFlushPressure: ApiFlushPressure = async ({ thresholdBytes } = {}) => {
    if (abortController.signal.aborted) return;
    const effectiveThresholdBytes = typeof thresholdBytes === 'number' && thresholdBytes > 0
      ? thresholdBytes
      : 1_048_576;
    const packetThreshold = Math.max(1, Math.ceil(effectiveThresholdBytes / 1024));
    interface EngineIoConnLike {
      writeBuffer?: { length: number };
      transport?: { writable?: boolean };
    }
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (abortController.signal.aborted) return;
      const conn = (socket as unknown as { conn?: EngineIoConnLike }).conn;
      const packets = conn?.writeBuffer?.length ?? 0;
      const writable = conn?.transport?.writable ?? true;
      if (!writable) return;
      if (packets < packetThreshold) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  };

  //? Auth → rate-limit → validate → execute → respond.
  //? Auth runs before validate so unauthenticated probes can't enumerate
  //? routes or learn input shape from `inputValidation.message`.
  if (!checkApiAuth({ apiEntry, user, name, emitApiError })) { cleanupRequest(); return; }

  const rateLimitOk = await applyApiRateLimits({ apiEntry, resolvedName, token, socket, user, emitApiError });
  if (!rateLimitOk) { cleanupRequest(); return; }

  //? Per-route validation toggle. `'relaxed'` or `{ input: 'skip' }` skips
  //? runtime input validation entirely — useful for public webhooks (Stripe,
  //? Slack, GitHub) where the third party's payload shape isn't reasonable
  //? to model in TypeScript. Default `'strict'`.
  const validationMode = (() => {
    const v = apiEntry.validation;
    if (!v) return 'strict';
    if (typeof v === 'string') return v;
    return v.input === 'skip' ? 'relaxed' : 'strict';
  })();

  if (validationMode === 'strict') {
    warnIfInputTypeMissing(resolvedName, apiEntry.inputType);
  }
  await dispatchHook('preApiValidate', { routeName: resolvedName, data: normalizedData, user, transport: 'socket' });

  if (validationMode === 'strict') {
    const inputValidation = await validateInputByType({
      typeText: apiEntry.inputType,
      value: normalizedData,
      rootKey: 'data',
      filePath: apiEntry.inputTypeFilePath,
    });

    await dispatchHook('postApiValidate', {
      routeName: resolvedName,
      data: normalizedData,
      user,
      validation: inputValidation,
      transport: 'socket',
    });

    if (inputValidation.status === 'error') {
      cleanupRequest();
      return emitApiError({
        response: {
          status: 'error',
          errorCode: 'api.invalidInputType',
          errorParams: [{ key: 'message', value: inputValidation.message }],
        },
        fallbackHttpStatus: 400,
      });
    }
  } else {
    //? Relaxed: surface the skip via postApiValidate so audit handlers see it.
    await dispatchHook('postApiValidate', {
      routeName: resolvedName,
      data: normalizedData,
      user,
      validation: { status: 'success' },
      transport: 'socket',
    });
  }

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
    cleanupRequest();
    return emitApiError({
      response: { status: 'error', errorCode: preExecuteResult.signal.errorCode },
      fallbackHttpStatus: preExecuteResult.signal.httpStatus ?? 403,
    });
  }

  const { error, result, durationMs } = await executeApiHandler({
    apiEntry,
    normalizedData,
    user,
    functionsObject,
    resolvedName,
    emitStream,
    abortSignal: abortController.signal,
    flushPressure: apiFlushPressure,
  });

  executePayload.result = result;
  executePayload.error = error ?? null;
  executePayload.durationMs = durationMs;
  await dispatchHook('postApiExecute', executePayload);

  await emitApiResult({ socket, responseIndex, resolvedName, error, result, preferredLocale, user, perRouteFormatter: apiEntry.errorFormatter });
  cleanupRequest();
}
