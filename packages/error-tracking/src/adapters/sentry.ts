//? Sentry adapter. Wraps `@sentry/node` calls into the framework's
//? backend-agnostic `ErrorTracker` shape. Use via:
//?
//?   import { createSentryAdapter } from '@luckystack/error-tracking';
//?   import { registerErrorTracker } from '@luckystack/core';
//?
//?   registerErrorTracker(createSentryAdapter());
//?
//? The existing `initializeSentry()` flow continues to work — it sets up
//? `@sentry/node` with the right DSN + sample rates + ignoreErrors. After
//? that init runs, `createSentryAdapter()` wraps the live SDK so events
//? fan out through the new multi-tracker registry.

import { createRequire } from 'node:module';

import type { ErrorTracker, ErrorTrackerEvent } from '@luckystack/core';

const localRequire = createRequire(import.meta.url);

interface SentrySDK {
  captureException: (exception: unknown, hint?: { extra?: Record<string, unknown> }) => string;
  captureMessage: (message: string, hint?: { level?: string; extra?: Record<string, unknown> }) => string;
  setUser: (user: unknown) => void;
  setContext: (name: string, context: Record<string, unknown> | null) => void;
  startSpan: <T>(context: { name: string; op: string }, fn: () => T) => T;
}

const loadSentry = (): SentrySDK => {
  try {
    localRequire.resolve('@sentry/node');
  } catch {
    throw new Error(
      '[error-tracking:sentry] The `@sentry/node` package is not installed but createSentryAdapter() was called. ' +
      'Run `npm install @sentry/node` or remove the Sentry registration.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = localRequire('@sentry/node') as SentrySDK;
  return mod;
};

export interface SentryAdapterOptions {
  /**
   * Optional before-send hook applied to every event the framework emits
   * through this adapter. Return null to drop. Receives an `ErrorTrackerEvent`
   * — payload includes the original error / message + extras.
   */
  beforeSend?: (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;
}

export const createSentryAdapter = (options: SentryAdapterOptions = {}): ErrorTracker => {
  const sentry = loadSentry();

  const runBeforeSend = (event: ErrorTrackerEvent): ErrorTrackerEvent | null => {
    if (!options.beforeSend) return event;
    const result = options.beforeSend(event);
    return result;
  };

  return {
    name: 'sentry',

    captureException(error, context) {
      const filtered = runBeforeSend({
        forwarded: true,
        kind: 'exception',
        payload: { error, context: context ?? null },
      });
      if (!filtered) return;
      if (context) {
        sentry.captureException(error, { extra: context });
      } else {
        sentry.captureException(error);
      }
    },

    captureMessage(message, level, context) {
      const filtered = runBeforeSend({
        forwarded: true,
        kind: 'message',
        payload: { message, level, context: context ?? null },
      });
      if (!filtered) return;
      if (context) {
        sentry.captureMessage(message, { level, extra: context });
      } else {
        sentry.captureMessage(message, { level });
      }
    },

    setUser(user) {
      sentry.setUser(user);
    },

    setContext(key, context) {
      sentry.setContext(key, context);
    },

    startSpan(name, op, fn) {
      return sentry.startSpan({ name, op }, fn);
    },

    beforeSend: options.beforeSend,
  };
};
