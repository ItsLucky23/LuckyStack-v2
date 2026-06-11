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

import { loadPeer, type ErrorTracker, type ErrorTrackerEvent } from '@luckystack/core';

import { resolveExceptionEvent, resolveMessageEvent } from './runBeforeSend';

const localRequire = createRequire(import.meta.url);

interface SentrySDK {
  captureException: (exception: unknown, hint?: { extra?: Record<string, unknown> }) => string;
  captureMessage: (message: string, hint?: { level?: string; extra?: Record<string, unknown> }) => string;
  setUser: (user: unknown) => void;
  setContext: (name: string, context: Record<string, unknown> | null) => void;
  startSpan: <T>(context: { name: string; op: string }, fn: () => T) => T;
}

//? `localRequire` (built from THIS module's `import.meta.url`) is passed so
//? resolution happens from the adapter's perspective, not core's node_modules.
const loadSentry = (): SentrySDK =>
  loadPeer<SentrySDK>(
    '@sentry/node',
    'Run `npm install @sentry/node` or remove the Sentry registration.',
    localRequire,
  );

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

  return {
    name: 'sentry',

    captureException(error, context) {
      const resolved = resolveExceptionEvent(options.beforeSend, error, context);
      if (!resolved) return;
      if (resolved.context) {
        sentry.captureException(resolved.error, { extra: resolved.context });
      } else {
        sentry.captureException(resolved.error);
      }
    },

    captureMessage(message, level, context) {
      const resolved = resolveMessageEvent(options.beforeSend, message, level, context);
      if (!resolved) return;
      if (resolved.context) {
        sentry.captureMessage(resolved.message, { level: resolved.level, extra: resolved.context });
      } else {
        sentry.captureMessage(resolved.message, { level: resolved.level });
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
