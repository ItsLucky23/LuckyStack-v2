/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { apiMessage } from '../../../server/sockets/socket';
import { getSession, logout } from '@luckystack/login';
import { logging, rateLimiting, SessionLayout } from '../../../config';
import type { AuthProps } from '@luckystack/login';
import { Socket } from 'socket.io';
import { getRuntimeApiMaps } from '../../../server/prod/runtimeMaps';
import {
  validateRequest,
  checkRateLimit,
  tryCatch,
  parseTransportRouteName,
  buildApiResponseEventName,
  buildApiStreamEventName,
  dispatchHook,
  validateInputByType,
} from '@luckystack/core';
import { setSentryUser, startSpan } from '@luckystack/sentry';
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
}

const shouldLogDev = logging.devLogs;
const shouldLogStream = logging.stream;

export default async function handleApiRequest({ msg, socket, token }: handleApiRequestType) {
  //? This event gets triggered when the client uses the apiRequest function
  //? We validate the message, check auth then execute

  if (typeof msg != 'object') {
    if (shouldLogDev) {
      console.log('socket message was not a json object!!!!', 'red');
    }
    return;
  }

  const { name, data, responseIndex } = msg;
  const user = await getSession(token)
  setSentryUser(user?.id ? {
    id: user.id,
    email: user.email || undefined,
  } : null);
  const preferredLocale =
    extractLanguageFromHeader(socket.handshake.headers['x-language'])
    || extractLanguageFromHeader(socket.handshake.headers['accept-language']);

  const emitApiError = ({
    response,
    fallbackHttpStatus,
  }: {
    response: { status: 'error'; httpStatus?: number; errorCode?: string; errorParams?: { key: string; value: string | number | boolean; }[] };
    fallbackHttpStatus?: number;
  }) => {
    return socket.emit(buildApiResponseEventName(responseIndex), normalizeErrorResponse({
      response,
      preferredLocale,
      userLanguage: user?.language,
      fallbackHttpStatus,
    }));
  };

  if (!responseIndex && typeof responseIndex !== 'number') {
    if (shouldLogDev) {
      console.log('no response index given!!!!', 'red');
    }
    return;
  }

  if (!name || !data || typeof name != 'string' || typeof data != 'object') {
    return emitApiError({
      response: {
        status: 'error',
        errorCode: 'api.invalidRequest',
      },
      fallbackHttpStatus: 400,
    });
  }

  const normalizedData = data as Record<string, unknown>;

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
  const routeLeaf = parsedRoute.serviceRoute.routeName.split('/').at(-1);

  //? 'logout' needs special handling since it requires socket access
  if (routeLeaf === 'logout') {
    await logout({ token, socket, userId: user?.id || null });
    return socket.emit(buildApiResponseEventName(responseIndex), {
      status: 'success',
      httpStatus: 200,
      result: true,
    });
  }

  if (shouldLogDev) {
    console.log(`api: ${resolvedName} called`, 'blue');
  }

  const { apisObject, functionsObject } = await getRuntimeApiMaps();

  //? Check if API exists
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
  const { auth, main } = apiEntry;
  const inputType = apiEntry.inputType;
  const inputTypeFilePath = apiEntry.inputTypeFilePath;

  const emitApiStream = (payload: ApiStreamPayload = {}) => {
    if (shouldLogStream) {
      console.log(`api: ${resolvedName} stream`, payload, 'cyan');
    }

    socket.emit(buildApiStreamEventName(responseIndex), payload);
  };

  const inputValidation = await validateInputByType({
    typeText: inputType,
    value: normalizedData,
    rootKey: 'data',
    filePath: inputTypeFilePath,
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

  //? Auth validation: check login requirement
  if (auth.login && !user?.id) {
      if (shouldLogDev) {
        console.log(`ERROR: API ${name} requires login`, 'red');
      }
      return emitApiError({
        response: { status: 'error', errorCode: 'auth.required' },
        fallbackHttpStatus: 401,
      });
    }

  //? Auth validation: check additional requirements
  const authResult = validateRequest({ auth, user: user! });
  if (authResult.status === "error") {
    if (shouldLogDev) {
      console.log(`ERROR: Auth failed for ${name}: ${authResult.errorCode}`, 'red');
    }
    return emitApiError({
      response: {
        status: 'error',
        errorCode: authResult.errorCode || 'auth.forbidden',
        errorParams: authResult.errorParams,
        httpStatus: authResult.httpStatus,
      },
      fallbackHttpStatus: authResult.httpStatus ?? 403,
    });
  }

  //? Rate limiting check: per-API bucket (custom rateLimit or defaultApiLimit fallback)
  const apiRateLimit = apiEntry.rateLimit;
  const effectiveApiLimit = apiRateLimit === undefined
    ? rateLimiting.defaultApiLimit
    : apiRateLimit;

  if (effectiveApiLimit !== false && effectiveApiLimit > 0) {
    const requesterIdentity = token ?? socket.handshake.address ?? 'unknown';
    const keyPrefix = token ? 'token' : 'ip';
    const rateLimitKey = `${keyPrefix}:${requesterIdentity}:api:${resolvedName}`;

    const { allowed, resetIn } = await checkRateLimit({
      key: rateLimitKey,
      limit: effectiveApiLimit,
      windowMs: rateLimiting.windowMs
    });

    if (!allowed) {
      if (shouldLogDev) {
        console.log(`Rate limit exceeded for ${resolvedName}`, 'yellow');
      }
      return emitApiError({
        response: {
          status: 'error',
          errorCode: 'api.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
        },
        fallbackHttpStatus: 429,
      });
    }
  }

  //? Global per-IP bucket across all APIs
  if (rateLimiting.defaultIpLimit !== false && rateLimiting.defaultIpLimit > 0) {
    const requesterIp = socket.handshake.address ?? 'unknown';

    const { allowed, resetIn } = await checkRateLimit({
      key: `ip:${requesterIp}:api:all`,
      limit: rateLimiting.defaultIpLimit,
      windowMs: rateLimiting.windowMs
    });

    if (!allowed) {
      if (shouldLogDev) {
        console.log(`Global IP rate limit exceeded for ${requesterIp}`, 'yellow');
      }
      return emitApiError({
        response: {
          status: 'error',
          errorCode: 'api.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
        },
        fallbackHttpStatus: 429,
      });
    }
  }

  const preExecuteResult = await dispatchHook('preApiExecute', {
    routeName: resolvedName,
    data: normalizedData,
    user,
  });
  if (preExecuteResult.stopped) {
    return emitApiError({
      response: {
        status: 'error',
        errorCode: preExecuteResult.signal.errorCode,
      },
      fallbackHttpStatus: preExecuteResult.signal.httpStatus ?? 403,
    });
  }

  //? Execute the API handler
  const executeStart = Date.now();
  const span = startSpan(name, 'api.request') as { end?: () => void } | undefined;
  const [error, result] = await tryCatch(
    async () => await main({ data: normalizedData, user, functions: functionsObject, stream: emitApiStream }),
    undefined,
    {
      handler: 'handleApiRequest',
      api: resolvedName,
      userId: user?.id,
      transport: 'socket',
    },
  );
  span?.end?.();

  await dispatchHook('postApiExecute', {
    routeName: resolvedName,
    data: normalizedData,
    user,
    result,
    error: error ?? null,
    durationMs: Date.now() - executeStart,
  });

  if (error) {
    if (shouldLogDev) {
      console.log(`ERROR in ${resolvedName}:`, error, 'red');
    }
    socket.emit(buildApiResponseEventName(responseIndex), normalizeErrorResponse({
      response: {
        status: 'error',
        errorCode: 'api.internalServerError',
      },
      preferredLocale,
      userLanguage: user?.language,
      fallbackHttpStatus: 500,
    }));
  } else if (result !== undefined && result !== null) {
    if (shouldLogDev) {
      console.log(`api: ${resolvedName} completed`, 'blue');
    }

    if (result.status === 'success' || result.status === 'error') {
      if (result.status === 'error') {
        socket.emit(buildApiResponseEventName(responseIndex), normalizeErrorResponse({
          response: result,
          preferredLocale,
          userLanguage: user?.language,
          fallbackHttpStatus: defaultHttpStatusForResponse({
            status: 'error',
            explicitHttpStatus: typeof result.httpStatus === 'number' ? result.httpStatus : undefined,
          }),
        }));
      } else {
        socket.emit(buildApiResponseEventName(responseIndex), {
          ...result,
          status: 'success',
          httpStatus: defaultHttpStatusForResponse({
            status: 'success',
            explicitHttpStatus: typeof result.httpStatus === 'number' ? result.httpStatus : undefined,
          }),
        });
      }
    } else {
      socket.emit(buildApiResponseEventName(responseIndex), normalizeErrorResponse({
        response: {
          status: 'error',
          errorCode: 'api.invalidResponseStatus',
        },
        preferredLocale,
        userLanguage: user?.language,
        fallbackHttpStatus: 500,
      }));
    }
  } else {
    if (shouldLogDev) {
      console.log(`WARNING: ${resolvedName} returned nothing`, 'yellow');
    }
    socket.emit(buildApiResponseEventName(responseIndex), normalizeErrorResponse({
      response: {
        status: 'error',
        errorCode: 'api.emptyResponse',
      },
      preferredLocale,
      userLanguage: user?.language,
      fallbackHttpStatus: 500,
    }));
  }
}