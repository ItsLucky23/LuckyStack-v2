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
import { defaultHttpStatusForResponse, extractLanguageFromHeader, normalizeErrorResponse } from '@luckystack/core';

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

interface RuntimeApiEntry {
  auth: AuthProps;
  main: (params: {
    data: Record<string, unknown>;
    user: SessionLayout | null;
    functions: Record<string, unknown>;
    stream: (payload?: ApiStreamPayload) => void;
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

const executeApiHandler = async ({ apiEntry, normalizedData, user, functionsObject, resolvedName, emitStream }: {
  apiEntry: RuntimeApiEntry;
  normalizedData: Record<string, unknown>;
  user: SessionLayout | null;
  functionsObject: Record<string, unknown>;
  resolvedName: string;
  emitStream: (payload?: ApiStreamPayload) => void;
}): Promise<{ error: Error | null; result: RuntimeApiResponse | undefined; durationMs: number }> => {
  //? Span open/close + identity propagation moved to hook subscribers in
  //? `@luckystack/error-tracking` (preApiExecute / postApiExecute). This
  //? handler is now transport-agnostic instrumentation-wise.
  const executeStart = Date.now();
  const [error, result] = await tryCatch(
    async () => await apiEntry.main({ data: normalizedData, user, functions: functionsObject, stream: emitStream }),
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
}: {
  socket: Socket;
  responseIndex: number;
  resolvedName: string;
  error: Error | null;
  result: RuntimeApiResponse | undefined;
  preferredLocale: string | undefined;
  user: SessionLayout | null;
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

  socket.emit(buildApiResponseEventName(responseIndex), transformPayload.response);

  //? `postApiRespond` is observation-only — the response is already on the
  //? wire. Use it for audit logging, metrics, dual-write replication.
  await dispatchHook('postApiRespond', { routeName: resolvedName, user, response: transformPayload.response });
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

  const emitApiError: EmitApiError = ({ response, fallbackHttpStatus }) => {
    socket.emit(buildApiResponseEventName(responseIndex), normalizeErrorResponse({
      response,
      preferredLocale,
      userLanguage: user?.language,
      fallbackHttpStatus,
    }));
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

  const emitStream = (payload: ApiStreamPayload = {}) => {
    if (shouldLogStream()) {
      getLogger().debug(`api: ${resolvedName} stream`, { payload });
    }
    socket.emit(buildApiStreamEventName(responseIndex), payload);
  };

  //? Auth → rate-limit → validate → execute → respond.
  //? Auth runs before validate so unauthenticated probes can't enumerate
  //? routes or learn input shape from `inputValidation.message`.
  if (!checkApiAuth({ apiEntry, user, name, emitApiError })) return;

  const rateLimitOk = await applyApiRateLimits({ apiEntry, resolvedName, token, socket, user, emitApiError });
  if (!rateLimitOk) return;

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
  });

  executePayload.result = result;
  executePayload.error = error ?? null;
  executePayload.durationMs = durationMs;
  await dispatchHook('postApiExecute', executePayload);

  await emitApiResult({ socket, responseIndex, resolvedName, error, result, preferredLocale, user });
}
