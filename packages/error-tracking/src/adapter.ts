//? Adapter contract + registry lives in `@luckystack/core` so framework
//? code in api / sync / server can dispatch events without taking a dep
//? on this package. We re-export the surface here so consumers can do
//? everything from one import path:
//?
//?   import { ErrorTracker, registerErrorTracker, SentryAdapter } from '@luckystack/error-tracking';

export {
  registerErrorTracker,
  registerErrorTrackers,
  appendErrorTracker,
  getActiveErrorTrackers,
  captureExceptionAcrossTrackers,
  captureMessageAcrossTrackers,
  setErrorTrackerUser,
  recordMetricAcrossTrackers,
  startSpanAcrossTrackers,
  //? Keep lifecycle/span/filter helpers available through the adapter barrel;
  //? missing re-exports previously broke consumer imports with TS2305.
  flushErrorTrackers,
  startSpanHandle,
  runWithErrorTrackerIdentity,
  runWithErrorTrackerIdentityScope,
  registerPreCaptureFilter,
} from '@luckystack/core';

export type {
  ErrorTracker,
  ErrorTrackerContext,
  ErrorTrackerUser,
  ErrorTrackerEvent,
  SpanResult,
  //? ET-N2: type exports were also absent despite being documented.
  SpanHandle,
  PreCaptureFilter,
} from '@luckystack/core';
