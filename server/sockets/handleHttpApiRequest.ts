import { tryCatch } from '../functions/tryCatch';
import { apis, functions } from '../prod/generatedApis';
import { devApis, devFunctions } from '../dev/loader';
import { getSession } from '../functions/session';
import config, { SessionLayout } from '../../config';
import { validateRequest } from '../utils/validateRequest';
import { captureException } from '../utils/sentry';
import { checkRateLimit } from '../utils/rateLimiter';
import { inferHttpMethod, HttpMethod } from '../utils/httpApiUtils';

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
  data: Record<string, any>;
  token: string | null;
  /** HTTP method from the request */
  method?: HttpMethod;
}

interface ApiResponse {
  status: 'success' | 'error';
  result?: any;
  message?: string;
  /** HTTP status code to return (for error cases) */
  httpStatus?: number;
}

export async function handleHttpApiRequest({
  name,
  data,
  token,
  method = 'POST'
}: HttpApiRequestParams): Promise<ApiResponse> {

  // Validate request format
  if (!name || typeof name !== 'string') {
    return {
      status: 'error',
      message: 'Missing or invalid API name'
    };
  }

  if (data && typeof data !== 'object') {
    return {
      status: 'error',
      message: 'Data must be an object'
    };
  }

  const requestData = data || {};

  // Get user session
  const user = await getSession(token);

  // Built-in API handlers
  if (name === 'session') {
    return { status: 'success', result: user };
  }

  // Note: 'logout' doesn't make sense for stateless HTTP - skip it
  if (name === 'logout') {
    return {
      status: 'error',
      message: 'Use cookie-based logout or DELETE request instead'
    };
  }

  console.log(`http api: ${name} called`, 'cyan');

  const apisObject = process.env.NODE_ENV === 'development' ? devApis : apis;

  // Check if API exists
  if (!apisObject[name]) {
    return {
      status: 'error',
      message: `API not found: ${name}`,
      httpStatus: 404
    };
  }

  const { auth, main, httpMethod: declaredMethod } = apisObject[name];

  // HTTP method validation
  const expectedMethod = declaredMethod ?? inferHttpMethod(name);
  if (method !== expectedMethod) {
    console.log(`Method mismatch for ${name}: expected ${expectedMethod}, got ${method}`, 'yellow');
    return {
      status: 'error',
      message: `Method not allowed. Use ${expectedMethod} for this endpoint.`,
      httpStatus: 405
    };
  }

  // Auth validation: check login requirement
  if (auth?.login) {
    if (!user?.id) {
      console.log(`ERROR: HTTP API ${name} requires login`, 'red');
      return {
        status: 'error',
        message: 'Authentication required'
      };
    }
  }

  // Auth validation: check additional requirements
  const authResult = validateRequest({ auth, user: user as SessionLayout });
  if (authResult.status === 'error') {
    console.log(`ERROR: Auth failed for HTTP API ${name}: ${authResult.message}`, 'red');
    return authResult as ApiResponse;
  }

  // Rate limiting check
  const apiRateLimit = apisObject[name].rateLimit;
  const effectiveLimit = apiRateLimit !== undefined
    ? apiRateLimit
    : config.rateLimiting.defaultApiLimit;

  if (effectiveLimit !== false && effectiveLimit > 0) {
    // For HTTP, we use token-based key or fall back to a generic "http" key
    const rateLimitKey = user?.id
      ? `user:${user.id}:api:${name}`
      : `http:api:${name}`;

    const { allowed, remaining, resetIn } = checkRateLimit({
      key: rateLimitKey,
      limit: effectiveLimit,
      windowMs: config.rateLimiting.windowMs
    });

    if (!allowed) {
      console.log(`Rate limit exceeded for HTTP API ${name}`, 'yellow');
      return {
        status: 'error',
        message: `Rate limit exceeded. Try again in ${resetIn} seconds.`
      };
    }
  }

  // Execute the API handler
  const functionsObject = process.env.NODE_ENV === 'development' ? devFunctions : functions;
  const [error, result] = await tryCatch(
    async () => await main({ data: requestData, user, functions: functionsObject })
  );

  if (error) {
    console.log(`ERROR in HTTP API ${name}:`, error, 'red');
    captureException(error, { api: name, userId: user?.id, source: 'http' });
    return {
      status: 'error',
      message: error.message || 'Internal server error'
    };
  }

  if (result) {
    console.log(`http api: ${name} completed`, 'cyan');

    // Check if result is already formatted as ApiResponse
    if (result && typeof result === 'object' && (result.status === 'success' || result.status === 'error')) {
      return result as ApiResponse;
    }

    // Wrap raw data in success response
    return { status: 'success', result };
  }

  console.log(`WARNING: HTTP API ${name} returned nothing`, 'yellow');
  return {
    status: 'error',
    message: 'API returned no result'
  };
}
