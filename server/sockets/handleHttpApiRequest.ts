/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/restrict-template-expressions, @typescript-eslint/prefer-nullish-coalescing */

import { getSession } from '../functions/session';
import { rateLimiting, AuthProps, SessionLayout } from '../../config';
import { getRuntimeApiMaps as getRuntimeApiMapsFromSource } from '../prod/runtimeMaps';
import { validateRequest } from '../utils/validateRequest';
import { setSentryUser, startSpan } from '../functions/sentry';
import { checkRateLimit } from '../utils/rateLimiter';
import { inferHttpMethod, HttpMethod } from '../utils/httpApiUtils';
import tryCatch from '../../shared/tryCatch';
import { defaultHttpStatusForResponse, extractLanguageFromHeader, normalizeErrorResponse } from '../utils/responseNormalizer';
import { validateInputByType } from '../utils/runtimeTypeValidation';

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

interface RuntimeApiRoute {
  auth: AuthProps;
  main: (params: {
    data: Record<string, unknown>;
    user: SessionLayout | null;
    functions: Record<string, unknown>;
    stream: (payload?: ApiStreamPayload) => void;
  }) => Promise<RuntimeApiResult> | RuntimeApiResult;
  inputType?: string;
  inputTypeFilePath?: string;
  rateLimit?: number | false;
  httpMethod?: HttpMethod;
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

export type ApiHttpStreamEvent = ApiStreamPayload;

export async function handleHttpApiRequest({
  name,
  data,
  token,
  requesterIp,
  xLanguageHeader,
  acceptLanguageHeader,
  method = 'POST',
  stream,
}: HttpApiRequestParams): Promise<ApiNetworkResponse> {

  const normalizedName = name.startsWith('api/') ? name : `api/${name}`;

  const preferredLocale =
    extractLanguageFromHeader(xLanguageHeader)
    ?? extractLanguageFromHeader(acceptLanguageHeader);
  const user = await getSession(token);
  setSentryUser(user?.id ? {
    id: typeof user.id === 'string' ? user.id : String(user.id),
    email: user.email,
  } : null);

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

  console.log(`http api: ${normalizedName} called`, 'cyan');

  const { apisObject, functionsObject } = await getRuntimeApiMapsFromSource();

  //? Resolve API: try exact match first, then fall back to root-level
  //? e.g. "api/examples/session" → not found → try "api/session"
  const nameSegments = normalizedName.split('/').filter(Boolean);
  const requestedVersion = nameSegments.at(-1);
  const apiBaseName = nameSegments.at(-2);
  let resolvedName = normalizedName;
  if (!apisObject[normalizedName] && apiBaseName && requestedVersion) {
    const rootKey = `api/${apiBaseName}/${requestedVersion}`;
    if (apisObject[rootKey]) {
      resolvedName = rootKey;
    }
  }

  // Check if API exists
  if (!apisObject[resolvedName]) {
    return buildNetworkError({
      response: {
        status: 'error',
        errorCode: 'api.notFound',
        errorParams: [{ key: 'name', value: normalizedName }],
      },
      fallbackHttpStatus: 404,
    });
  }

  const runtimeApiRoute = apisObject[resolvedName] as RuntimeApiRoute;
  const { auth, main, httpMethod: declaredMethod } = runtimeApiRoute;
  const inputType = runtimeApiRoute.inputType;
  const inputTypeFilePath = runtimeApiRoute.inputTypeFilePath;

  const inputValidation = await validateInputByType({
    typeText: inputType,
    value: requestData,
    rootKey: 'data',
    filePath: inputTypeFilePath,
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

  // HTTP method validation
  const expectedMethod = declaredMethod ?? inferHttpMethod(resolvedName);
  if (method !== expectedMethod) {
    console.log(`Method mismatch for ${normalizedName}: expected ${expectedMethod}, got ${method}`, 'yellow');
    return buildNetworkError({
      response: {
        status: 'error',
        errorCode: 'api.methodNotAllowed',
        errorParams: [{ key: 'method', value: expectedMethod }],
      },
      fallbackHttpStatus: 405,
    });
  }

  // Auth validation: check login requirement
  if (auth.login && !user?.id) {
      console.log(`ERROR: HTTP API ${name} requires login`, 'red');
      return buildNetworkError({
        response: { status: 'error', errorCode: 'auth.required' },
        fallbackHttpStatus: 401,
      });
    }

  if (!user) {
    return buildNetworkError({
      response: { status: 'error', errorCode: 'auth.forbidden' },
      fallbackHttpStatus: 403,
    });
  }

  // Auth validation: check additional requirements
  const authResult = validateRequest({ auth, user });
  if (authResult.status === 'error') {
    console.log(`ERROR: Auth failed for HTTP API ${name}: ${authResult.errorCode}`, 'red');
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
    ? rateLimiting.defaultApiLimit
    : apiRateLimit;

  if (effectiveApiLimit !== false && effectiveApiLimit > 0) {
    const requesterIdentity = token ?? requesterIp ?? 'anonymous';
    const keyPrefix = token ? 'token' : 'ip';
    const rateLimitKey = `${keyPrefix}:${requesterIdentity}:api:${normalizedName}`;

    const { allowed, resetIn } = await checkRateLimit({
      key: rateLimitKey,
      limit: effectiveApiLimit,
      windowMs: rateLimiting.windowMs
    });

    if (!allowed) {
      console.log(`Rate limit exceeded for HTTP API ${normalizedName}`, 'yellow');
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
  if (rateLimiting.defaultIpLimit !== false && rateLimiting.defaultIpLimit > 0) {
    const ipBucket = requesterIp ?? 'unknown';
    const { allowed, resetIn } = await checkRateLimit({
      key: `ip:${ipBucket}:api:all`,
      limit: rateLimiting.defaultIpLimit,
      windowMs: rateLimiting.windowMs
    });

    if (!allowed) {
      console.log(`Global IP rate limit exceeded for ${ipBucket}`, 'yellow');
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

  // Execute the API handler
  const emitApiStream = (payload: ApiStreamPayload = {}) => {
    if (!stream) {
      return;
    }

    stream(payload);
  };

  const span = startSpan(normalizedName, 'api.request.http') as { end?: () => void } | undefined;
  const [error, result] = await tryCatch(
    async () => await main({ data: requestData, user, functions: functionsObject, stream: emitApiStream }),
    undefined,
    {
      handler: 'handleHttpApiRequest',
      api: resolvedName,
      userId: user?.id,
      transport: 'http',
    },
  );
  span?.end?.();

  if (error) {
    console.log(`ERROR in HTTP API ${normalizedName}:`, error, 'red');
    return buildNetworkError({
      response: { status: 'error', errorCode: 'api.internalServerError' },
      fallbackHttpStatus: 500,
    });
  }

  if (result !== undefined && result !== null) {
    console.log(`http api: ${normalizedName} completed`, 'cyan');

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

      return {
        ...result,
        status: 'success',
        httpStatus: defaultHttpStatusForResponse({
          status: 'success',
          explicitHttpStatus: typeof result.httpStatus === 'number' ? result.httpStatus : undefined,
        }),
      } as ApiNetworkResponse;
    }

    return buildNetworkError({
      response: { status: 'error', errorCode: 'api.invalidResponseStatus' },
      fallbackHttpStatus: 500,
    });
  }

  console.log(`WARNING: HTTP API ${normalizedName} returned nothing`, 'yellow');
  return buildNetworkError({
    response: { status: 'error', errorCode: 'api.emptyResponse' },
    fallbackHttpStatus: 500,
  });
}
