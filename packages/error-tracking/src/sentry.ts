/**
 * Sentry error monitoring initialization for the server.
 *
 * This module initializes Sentry for capturing errors, performance data,
 * and other monitoring information on the backend.
 *
 * @see https://docs.sentry.io/platforms/node/
 */

import { createRequire } from 'node:module';

import {
  getLogger,
  getProjectName,
  initSharedSentry,
  captureException as sharedCaptureException,
  captureMessage as sharedCaptureMessage,
  setSentryUser as sharedSetSentryUser,
  startSpan as sharedStartSpan,
} from '@luckystack/core';

import { getSentryConfig } from './sentryConfig';
import { enableErrorTrackingAutoInstrumentation } from './autoInstrumentation';

const localRequire = createRequire(import.meta.url);

//? `@sentry/node` is an OPTIONAL peer. Importing it at module top-level would
//? make `import '@luckystack/error-tracking'` throw ERR_MODULE_NOT_FOUND for
//? consumers on the adapter-only / Datadog / PostHog path who never installed
//? Sentry. Load it lazily (mirroring the Datadog/PostHog/Sentry adapters) so
//? the package stays import-safe and only touches @sentry/node when Sentry is
//? actually initialized or the default export is accessed.
type SentryModule = typeof import('@sentry/node');

let cachedSentry: SentryModule | null = null;

const loadSentry = (): SentryModule => {
  if (cachedSentry) return cachedSentry;
  try {
    localRequire.resolve('@sentry/node');
  } catch {
    throw new Error(
      '[error-tracking:sentry] The `@sentry/node` package is not installed but Sentry was used. ' +
      'Run `npm install @sentry/node`, or use the adapter API / another tracker instead.',
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cachedSentry = localRequire('@sentry/node') as SentryModule;
  return cachedSentry;
};

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
      getLogger().warn('SENTRY_DSN not configured. Error monitoring disabled.');
    }
    return;
  }

  //? dsn is set ⇒ the consumer opted into Sentry, so the optional peer must be
  //? present. Resolve it lazily here (module top-level stays import-safe).
  const Sentry = loadSentry();

  const sentryConfig = getSentryConfig().server;
  const tracesSampleRate = isProduction
    ? sentryConfig?.tracesSampleRate?.production ?? 0.2
    : sentryConfig?.tracesSampleRate?.development ?? 1;
  const ignoreErrors = sentryConfig?.ignoreErrors ?? ['Socket connection timeout', 'ECONNREFUSED'];

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',

    // Performance monitoring
    tracesSampleRate,

    // Additional options — `getProjectName()` resolves at call time and
    // honors projectConfig overrides, not just the raw env var.
    serverName: getProjectName(),

    // Only send errors in production by default
    enabled: isProduction || enabledOverride === 'true',

    // Ignore certain errors
    ignoreErrors,

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

  //? Register the hook subscribers that previously lived as direct imports
  //? in `@luckystack/api` and `@luckystack/sync`. Idempotent — calling
  //? `initializeSentry()` twice (or alongside an explicit
  //? `enableErrorTrackingAutoInstrumentation()`) is safe.
  enableErrorTrackingAutoInstrumentation();

  getLogger().info('Sentry initialized for error monitoring');
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

//? Lazy default export: forwards property access to the real `@sentry/node`
//? SDK on first use, so `import Sentry from '@luckystack/error-tracking'` stays
//? import-safe when the optional peer is absent and only resolves it when
//? actually touched. Functions are bound to the module so call-site `this` is
//? correct.
const sentryProxy = new Proxy({}, {
  get: (_target, prop) => {
    const mod = loadSentry();
    const value: unknown = Reflect.get(mod, prop);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(mod) : value;
  },
}) as SentryModule;

export default sentryProxy;
