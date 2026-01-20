import { captureException } from '../utils/sentry';

/**
 * Wraps an async function with error handling.
 * Errors are automatically captured by Sentry (if enabled).
 * 
 * @param func - The async function to execute
 * @param params - Optional parameters to pass to the function
 * @param context - Optional context for Sentry error tracking
 * @returns Tuple of [error, result] - only one will be non-null
 * 
 * @example
 * ```typescript
 * const [error, users] = await tryCatch(
 *   async () => await prisma.user.findMany(),
 *   undefined,
 *   { operation: 'getUsers' }
 * );
 * 
 * if (error) {
 *   return { status: 'error', message: 'Failed to fetch users' };
 * }
 * return { status: 'success', users };
 * ```
 */
const tryCatch = async <T, P>(
  func: (values: P) => Promise<T> | T,
  params?: P,
  context?: Record<string, any>
): Promise<[Error | null, T | null]> => {
  try {
    const response = await func(params as P);
    return [null, response];
  } catch (error) {
    // Capture error in Sentry with optional context
    captureException(error, context);
    return [error as Error, null];
  }
}

export { tryCatch }
