/**
 * HTTP API Utilities
 * 
 * Helpers for HTTP API request handling including:
 * - Smart HTTP method detection based on API name
 * - Method validation
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Single source of truth for the GET-prefix naming heuristic
 * (`get` / `fetch` / `list`). Used by both `inferHttpMethod` here and the
 * client transport's `isGetMethod` fallback in `apiRequest.ts`, so the two
 * prefix heuristics can't drift apart. Expects an already-lowercased leaf name.
 */
export const isGetMethodName = (methodNameLower: string): boolean =>
  methodNameLower.startsWith('get') ||
  methodNameLower.startsWith('fetch') ||
  methodNameLower.startsWith('list');

/**
 * Infer the HTTP method from an API name based on common naming conventions.
 * 
 * - Names starting with "get" → GET
 * - Names starting with "delete" or "remove" → DELETE
 * - Names starting with "update" or "edit" → PUT
 * - Everything else → POST (create operations, actions)
 * 
 * @example
 * ```typescript
 * inferHttpMethod('getUserData')   // → 'GET'
 * inferHttpMethod('deleteAccount') // → 'DELETE'
 * inferHttpMethod('updateProfile') // → 'PUT'
 * inferHttpMethod('createUser')    // → 'POST'
 * inferHttpMethod('sendEmail')     // → 'POST'
 * ```
 */
export const inferHttpMethod = (apiName: string): HttpMethod => {
  // Extract the method name from the full path (e.g., "api/examples/getUserData" → "getUserData")
  const nameParts = apiName.split('/');
  const lastPart = nameParts.at(-1)?.toLowerCase() ?? '';
  const methodName = /^v\d+$/.test(lastPart)
    ? (nameParts.at(-2) ?? '').toLowerCase()
    : lastPart;

  if (isGetMethodName(methodName)) {
    return 'GET';
  }

  if (methodName.startsWith('delete') || methodName.startsWith('remove')) {
    return 'DELETE';
  }

  if (methodName.startsWith('update') || methodName.startsWith('edit') || methodName.startsWith('patch')) {
    return 'PUT';
  }

  // Default: POST for create operations and general actions
  return 'POST';
};

/**
 * Get the effective HTTP method for an API.
 * Uses explicit export if available, otherwise infers from name.
 */
export const getEffectiveHttpMethod = (
  apiConfig: { httpMethod?: HttpMethod },
  apiName: string
): HttpMethod => {
  return apiConfig.httpMethod ?? inferHttpMethod(apiName);
};

/**
 * Check if an HTTP method is valid for an API.
 *
 * @param requestMethod - The method from the HTTP request
 * @param allowedMethod - The method the API accepts
 * @returns true only when the method matches the route's allowed method.
 *
 * NOTE: `OPTIONS` is intentionally NOT treated as allowed here. A custom-route
 * author wiring this into their dispatch must answer CORS preflights BEFORE the
 * route check — letting `OPTIONS` through would execute the handler on a request
 * the CSRF middleware treats as non-state-changing (CSRF-exempt), opening a
 * bypass on method-locked routes.
 */
export const isMethodAllowed = (
  requestMethod: string,
  allowedMethod: HttpMethod
): boolean => {
  return requestMethod === allowedMethod;
};
