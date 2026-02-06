/**
 * HTTP API Utilities
 * 
 * Helpers for HTTP API request handling including:
 * - Smart HTTP method detection based on API name
 * - Method validation
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

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
  const methodName = nameParts[nameParts.length - 1].toLowerCase();

  if (methodName.startsWith('get') || methodName.startsWith('fetch') || methodName.startsWith('list')) {
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
 * @returns true if the method matches or if it's a preflight OPTIONS request
 */
export const isMethodAllowed = (
  requestMethod: string,
  allowedMethod: HttpMethod
): boolean => {
  return requestMethod === allowedMethod || requestMethod === 'OPTIONS';
};
