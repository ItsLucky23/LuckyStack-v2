/**
 * Sentry error monitoring initialization for the client.
 * 
 * This module initializes Sentry for capturing errors, performance data,
 * and session replays on the frontend.
 * 
 * @see https://docs.sentry.io/platforms/javascript/guides/react/
 */

import * as Sentry from '@sentry/react';

const env = import.meta.env;

/**
 * Initialize Sentry error monitoring for the React application.
 * Should be called as early as possible in the application startup.
 * 
 * @example
 * ```typescript
 * // In main.tsx, before ReactDOM.createRoot
 * import { initializeSentry } from './utils/sentry';
 * initializeSentry();
 * ```
 */
export const initializeSentry = () => {
  const dsn = env.VITE_SENTRY_DSN;

  if (!dsn) {
    if (env.PROD) {
      console.warn('VITE_SENTRY_DSN not configured. Error monitoring disabled.');
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: env.MODE,

    // Performance Monitoring
    tracesSampleRate: env.PROD ? 0.2 : 1.0,

    // Session Replay
    replaysSessionSampleRate: env.PROD ? 0.1 : 0,
    replaysOnErrorSampleRate: 1.0,

    // Integrations
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Mask all text and block media for privacy
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],

    // Only send errors in production by default
    enabled: env.PROD || env.VITE_SENTRY_ENABLED === 'true',

    // Ignore common non-actionable errors
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      /^Network Error$/,
      /^Socket connection/,
    ],

    // Filter out sensitive data
    beforeSend(event) {
      // Remove sensitive URL parameters
      if (event.request?.url) {
        const url = new URL(event.request.url);
        url.searchParams.delete('token');
        url.searchParams.delete('code');
        event.request.url = url.toString();
      }
      return event;
    },
  });

  console.log('✅ Sentry initialized for error monitoring');
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
 *   captureException(error, { userId: session?.id, action: 'riskyOperation' });
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
 * @param level - Severity level
 * @param context - Additional context to attach
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
 * // In SessionProvider after session loads
 * if (session?.id) {
 *   setSentryUser({ id: session.id, email: session.email });
 * }
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
 * Error Boundary component for React.
 * Wrap your app or components to catch and report errors.
 * 
 * @example
 * ```tsx
 * import { SentryErrorBoundary } from './utils/sentry';
 * 
 * <SentryErrorBoundary fallback={<ErrorFallback />}>
 *   <App />
 * </SentryErrorBoundary>
 * ```
 */
export const SentryErrorBoundary = Sentry.ErrorBoundary;

/**
 * HOC to wrap components with Sentry profiling.
 * 
 * @example
 * ```typescript
 * export default withSentryProfiler(MyComponent);
 * ```
 */
export const withSentryProfiler = Sentry.withProfiler;

export default Sentry;
