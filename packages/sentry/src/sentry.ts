/**
 * Sentry error monitoring initialization for the server.
 *
 * This module initializes Sentry for capturing errors, performance data,
 * and other monitoring information on the backend.
 *
 * @see https://docs.sentry.io/platforms/node/
 */

import * as Sentry from '@sentry/node';
import {
  getProjectConfig,
  initSharedSentry,
  captureException as sharedCaptureException,
  captureMessage as sharedCaptureMessage,
  setSentryUser as sharedSetSentryUser,
  startSpan as sharedStartSpan,
} from '@luckystack/core';

/**
 * Initialize Sentry error monitoring.
 * Should be called as early as possible in server startup.
 * Auto-disables when SENTRY_DSN is not set (no-op).
 */
export const initializeSentry = () => {
  const dsn = process.env.SENTRY_DSN ?? process.env.VITE_SENTRY_DSN;
  const isProduction = process.env.NODE_ENV === 'production';
  const enabledOverride = process.env.SENTRY_ENABLED ?? process.env.VITE_SENTRY_ENABLED;

  if (!dsn) {
    if (process.env.NODE_ENV === 'production') {
      console.log('SENTRY_DSN not configured. Error monitoring disabled.', 'yellow');
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',

    // Performance monitoring
    tracesSampleRate: isProduction
      ? getProjectConfig().sentry?.server?.tracesSampleRate?.production ?? 0.2
      : getProjectConfig().sentry?.server?.tracesSampleRate?.development ?? 1,

    // Additional options
    serverName: process.env.PROJECT_NAME ?? "",

    // Only send errors in production by default
    enabled: isProduction || enabledOverride === 'true',

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

  // Wire the shared DI surface exposed from @luckystack/core so framework code
  // can report errors without taking a direct dependency on @sentry/node.
  initSharedSentry({
    captureException: (exception, context) => Sentry.captureException(
      exception,
      context as Parameters<typeof Sentry.captureException>[1],
    ),
    captureMessage: (message, level) => Sentry.captureMessage(
      message,
      level as Parameters<typeof Sentry.captureMessage>[1],
    ),
    setUser: (user) => {
      Sentry.setUser(user as Parameters<typeof Sentry.setUser>[0]);
    },
    setContext: (key, context) => {
      Sentry.setContext(key, context as Parameters<typeof Sentry.setContext>[1]);
    },
    startInactiveSpan: (context) => {
      return Sentry.startInactiveSpan(
        context as Parameters<typeof Sentry.startInactiveSpan>[0],
      );
    },
  });

  console.log('Sentry initialized for error monitoring', 'green');
};

export const captureException = (
  error: unknown,
  context?: Record<string, unknown>
): void => {
  sharedCaptureException(error, context);
};

export const captureMessage = (
  message: string,
  level: 'info' | 'warning' | 'error' | 'fatal' = 'info',
  context?: Record<string, unknown>
): void => {
  sharedCaptureMessage(message, level, context);
};

export const setSentryUser = (user: {
  id?: string;
  email?: string;
  username?: string;
} | null): void => {
  sharedSetSentryUser(user);
};

export const startSpan = (name: string, op: string): unknown => {
  return sharedStartSpan(name, op);
};

export default Sentry;
