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

import {
  getCurrentErrorTrackerIdentity,
  loadPeer,
  sanitizeErrorString,
  sanitizeErrorStrings,
  type ErrorTracker,
  type ErrorTrackerEvent,
  type ErrorTrackerUser,
} from '@luckystack/core';

import { resolveExceptionEvent, resolveMessageEvent } from './runBeforeSend';

const localRequire = createRequire(import.meta.url);

//? Sentry's `captureException` / `captureMessage` second arg is a CaptureContext
//? that accepts a per-event `user` — passing it scopes identity to THIS event
//? without mutating the process-global `setUser` scope (ET-02). We model only the
//? fields we use.
interface SentryCaptureContext {
  level?: string;
  extra?: Record<string, unknown>;
  user?: ErrorTrackerUser;
}

interface SentrySDK {
  captureException: (exception: unknown, hint?: SentryCaptureContext) => string;
  captureMessage: (message: string, hint?: SentryCaptureContext) => string;
  setUser: (user: unknown) => void;
  setContext: (name: string, context: Record<string, unknown> | null) => void;
  startSpan: <T>(context: { name: string; op: string }, fn: () => T) => T;
  //? ET-O13: `close` drains the Sentry transport before process exit so buffered
  //? events are not lost on graceful shutdown. `timeout` is in milliseconds.
  close: (timeout?: number) => Promise<boolean>;
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

//? Build the per-event Sentry CaptureContext, attaching the ALS-bound identity
//? as a per-event `user` when a request scope is active (ET-02). When no ALS
//? scope exists (background capture) we omit `user` and Sentry falls back to
//? whatever the global `setUser` scope last held — preserving prior behavior.
const withIdentity = (hint?: SentryCaptureContext): SentryCaptureContext | undefined => {
  const alsUser = getCurrentErrorTrackerIdentity();
  if (!alsUser) return hint;
  return { ...hint, user: alsUser };
};

export const createSentryAdapter = (options: SentryAdapterOptions = {}): ErrorTracker => {
  const sentry = loadSentry();

  return {
    name: 'sentry',

    captureException(error, context) {
      const resolved = resolveExceptionEvent(options.beforeSend, error, context);
      if (!resolved) return;
      //? Scrub secrets interpolated into the error before it reaches Sentry (ET-O2,
      //? parity with the Datadog/PostHog adapters). A real Error gets its message +
      //? stack rebuilt scrubbed onto a same-named Error (so Sentry's type-based
      //? grouping is preserved); a NON-Error throw (e.g. `throw 'auth token=abc'`)
      //? is scrubbed as a string. Previously a real Error passed through with its
      //? RAW message/stack — an interpolated secret reached Sentry unscrubbed.
      let payload: Error | string;
      if (resolved.error instanceof Error) {
        const scrubbed = sanitizeErrorStrings(resolved.error);
        const rebuilt = new Error(scrubbed?.message ?? resolved.error.message);
        rebuilt.name = resolved.error.name;
        rebuilt.stack = scrubbed?.stack ?? resolved.error.stack;
        payload = rebuilt;
      } else {
        payload = sanitizeErrorString(String(resolved.error));
      }
      const hint = withIdentity(resolved.context ? { extra: resolved.context } : undefined);
      if (hint) {
        sentry.captureException(payload, hint);
      } else {
        sentry.captureException(payload);
      }
    },

    captureMessage(message, level, context) {
      const resolved = resolveMessageEvent(options.beforeSend, message, level, context);
      if (!resolved) return;
      const hint = withIdentity(
        resolved.context
          ? { level: resolved.level, extra: resolved.context }
          : { level: resolved.level },
      );
      //? ET-O2: scrub secrets interpolated into a free-text message string before
      //? it reaches Sentry (captureMessage never ran through the scrubber, and the
      //? request-scrub beforeSend doesn't cover event.message).
      sentry.captureMessage(sanitizeErrorString(resolved.message), hint);
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

    //? ET-O13: drain the Sentry transport on graceful shutdown via `Sentry.close()`.
    //? Called by `flushErrorTrackers()` so buffered error events are not lost when
    //? the process exits. 2 000 ms is the recommended safe-shutdown timeout.
    async flush() {
      await sentry.close(2000);
    },

    beforeSend: options.beforeSend,
  };
};
