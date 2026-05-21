//? Adapter contract + registry lives in `@luckystack/core` so framework
//? code in api / sync / server can dispatch events without taking a dep
//? on this package. We re-export the surface here so consumers can do
//? everything from one import path:
//?
//?   import { ErrorTracker, registerErrorTracker, SentryAdapter } from '@luckystack/error-tracking';

export {
  registerErrorTracker,
  registerErrorTrackers,
  getActiveErrorTrackers,
  captureExceptionAcrossTrackers,
  captureMessageAcrossTrackers,
  setErrorTrackerUser,
  recordMetricAcrossTrackers,
  startSpanAcrossTrackers,
} from '@luckystack/core';

export type {
  ErrorTracker,
  ErrorTrackerContext,
  ErrorTrackerUser,
  ErrorTrackerEvent,
  SpanResult,
} from '@luckystack/core';
