//? Legacy Sentry single-instance slot. Predates the multi-adapter
//? ErrorTracker registry. New code should `registerErrorTracker(...)`
//? from `@luckystack/error-tracking`; this file keeps backwards
//? compatibility AND fans out events through any registered adapters so
//? a project can mix legacy `initSharedSentry` + new `registerErrorTracker`
//? during migration.
//?
//? The framework's own call sites (`captureException`, `captureMessage`,
//? `setSentryUser`, `startSpan`) keep working unchanged — they now route
//? through both the legacy slot and the new adapter list.

import {
  captureExceptionAcrossTrackers,
  captureMessageAcrossTrackers,
  setErrorTrackerUser,
  startSpanAcrossTrackers,
} from './errorTrackerRegistry';
import { sanitizeForLog } from './redactedLogKeys';

interface SentryInstance {
  captureException: (exception: unknown, ...args: unknown[]) => string;
  captureMessage: (message: string, ...args: unknown[]) => string;
  setUser: (user: unknown) => void;
  setContext: (key: string, context: unknown) => void;
  startInactiveSpan?: (context: unknown) => unknown;
}

let sentry: SentryInstance | undefined;

/**
 * @deprecated Use `registerErrorTracker` from `@luckystack/error-tracking` instead.
 * Will be removed in a future major version.
 */
export const initSharedSentry = (instance: SentryInstance): void => {
  sentry = instance;
};

//? Pass `extra` inline via Sentry's hint-shaped second argument so contexts
//? don't leak across concurrent captures. Previously we called
//? `sentry.setContext('additional', context)` which is process-global until
//? cleared — under concurrent captures the first context could leak into the
//? second's report.
//? CORE-O4: sanitize context before passing to the legacy Sentry slot so raw
//? tokens/passwords don't reach `extra` when a consumer mixes initSharedSentry
//? with framework capture. The multi-adapter path already sanitizes in
//? errorTrackerRegistry.ts; this brings the legacy path into parity.
export const captureException = (
  error: unknown,
  context?: Record<string, unknown>,
): void => {
  if (sentry) {
    if (context) {
      sentry.captureException(error, { extra: sanitizeForLog(context) as Record<string, unknown> });
    } else {
      sentry.captureException(error);
    }
  }
  //? Multi-adapter fan-out. When no adapter is registered this is a no-op.
  captureExceptionAcrossTrackers(error, context);
};

export const captureMessage = (
  message: string,
  level: 'info' | 'warning' | 'error' | 'fatal' = 'info',
  context?: Record<string, unknown>,
): void => {
  if (sentry) {
    if (context) {
      sentry.captureMessage(message, { level, extra: sanitizeForLog(context) as Record<string, unknown> });
    } else {
      sentry.captureMessage(message, level);
    }
  }
  captureMessageAcrossTrackers(message, level, context);
};

export const setSentryUser = (user: {
  id?: string;
  email?: string;
  username?: string;
} | null): void => {
  sentry?.setUser(user);
  setErrorTrackerUser(user);
};

export const startSpan = (name: string, op: string): unknown => {
  //? Multi-adapter span coordination: first registered adapter that
  //? supports spans wins (spans don't fan out cleanly). Legacy Sentry
  //? single-instance path still creates the inactive span for backwards
  //? compatibility on consumers that haven't migrated.
  if (sentry?.startInactiveSpan) {
    return sentry.startInactiveSpan({ name, op });
  }
  //? No-op span body is intentional — this is the legacy inactive-span shape
  //? consumers built against; the real span lifecycle is managed elsewhere.
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- legacy inactive-span shape
  startSpanAcrossTrackers(name, op, () => {});
};
