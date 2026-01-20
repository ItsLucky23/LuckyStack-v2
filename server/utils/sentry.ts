/**
 * Sentry error monitoring initialization for the server.
 * 
 * This module initializes Sentry for capturing errors, performance data,
 * and other monitoring information on the backend.
 * 
 * @see https://docs.sentry.io/platforms/node/
 */

import * as Sentry from '@sentry/node';

/**
 * Initialize Sentry error monitoring.
 * Should be called as early as possible in server startup.
 * 
 * @example
 * ```typescript
 * import { initializeSentry } from './utils/sentry';
 * 
 * // At the very top of server.ts, before any other imports
 * initializeSentry();
 * ```
 */
export const initializeSentry = () => {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    if (process.env.NODE_ENV === 'production') {
      console.log('⚠️ SENTRY_DSN not configured. Error monitoring disabled.', 'yellow');
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',

    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

    // Profiling (optional - requires @sentry/profiling-node)
    // profilesSampleRate: 0.1,

    // Additional options
    serverName: process.env.PROJECT_NAME || 'luckystack-server',

    // Only send errors in production by default
    enabled: process.env.NODE_ENV === 'production' || process.env.SENTRY_ENABLED === 'true',

    // Ignore certain errors
    ignoreErrors: [
      'Socket connection timeout',
      'ECONNREFUSED',
    ],

    // Attach additional context
    beforeSend(event) {
      // Remove sensitive data if needed
      if (event.request?.cookies) {
        delete event.request.cookies;
      }
      return event;
    },
  });

  console.log('✅ Sentry initialized for error monitoring', 'green');
};

/**
 * Capture an exception and send it to Sentry.
 * 
 * @param error - The error to capture
 * @param context - Additional context to attach to the error
 * 
 * @example
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   captureException(error, { userId: user.id, action: 'riskyOperation' });
 * }
 * ```
 */
export const captureException = (
  error: unknown,
  context?: Record<string, unknown>
) => {
  if (context) {
    Sentry.setContext('additional', context);
  }
  Sentry.captureException(error);
};

/**
 * Capture a message (non-error event) and send it to Sentry.
 * 
 * @param message - The message to capture
 * @param level - Severity level (info, warning, error, fatal)
 * @param context - Additional context to attach
 * 
 * @example
 * ```typescript
 * captureMessage('User exceeded rate limit', 'warning', { userId: user.id });
 * ```
 */
export const captureMessage = (
  message: string,
  level: 'info' | 'warning' | 'error' | 'fatal' = 'info',
  context?: Record<string, unknown>
) => {
  if (context) {
    Sentry.setContext('additional', context);
  }
  Sentry.captureMessage(message, level);
};

/**
 * Set user context for error tracking.
 * Call this after user authentication.
 * 
 * @param user - User information to attach to errors
 * 
 * @example
 * ```typescript
 * setSentryUser({ id: user.id, email: user.email });
 * ```
 */
export const setSentryUser = (user: {
  id?: string;
  email?: string;
  username?: string;
} | null) => {
  Sentry.setUser(user);
};

/**
 * Create a performance transaction span.
 * Useful for tracking custom operations.
 * 
 * @param name - Name of the operation
 * @param op - Operation type (e.g., 'http', 'db', 'function')
 * @returns A span object with a finish method
 * 
 * @example
 * ```typescript
 * const span = startSpan('processPayment', 'payment');
 * try {
 *   await processPayment();
 * } finally {
 *   span.end();
 * }
 * ```
 */
export const startSpan = (name: string, op: string) => {
  return Sentry.startInactiveSpan({ name, op });
};

export default Sentry;
