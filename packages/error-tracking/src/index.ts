export {
  initializeSentry,
  captureException,
  captureMessage,
  setSentryUser,
  startSpan,
} from './sentry';
export { default } from './sentry';

//? Explicit opt-in for adapter-only consumers that don't call
//? `initializeSentry()`. Registers the framework hook subscribers that
//? propagate identity + open spans on `preApiExecute` / `preSyncFanout`.
export { enableErrorTrackingAutoInstrumentation } from './autoInstrumentation';

//? Backend-agnostic adapter pattern. Replaces the Sentry-only DI surface
//? with a pluggable ErrorTracker interface (which lives in @luckystack/core
//? to keep the dep graph clean). Built-in adapters ship below — consumers
//? can also implement custom trackers against any backend (CloudWatch,
//? New Relic, Honeybadger, Bugsnag, ...).
export {
  registerErrorTracker,
  registerErrorTrackers,
  getActiveErrorTrackers,
  captureExceptionAcrossTrackers,
  captureMessageAcrossTrackers,
  setErrorTrackerUser,
  recordMetricAcrossTrackers,
  startSpanAcrossTrackers,
} from './adapter';
export type {
  ErrorTracker,
  ErrorTrackerContext,
  ErrorTrackerUser,
  ErrorTrackerEvent,
  SpanResult,
} from './adapter';

export { createSentryAdapter } from './adapters/sentry';
export type { SentryAdapterOptions } from './adapters/sentry';
export { createDatadogAdapter } from './adapters/datadog';
export type { DatadogAdapterOptions } from './adapters/datadog';
export { createPostHogAdapter } from './adapters/posthog';
export type { PostHogAdapterOptions } from './adapters/posthog';

export {
  registerSentryConfig,
  getSentryConfig,
  DEFAULT_SENTRY_CONFIG,
} from './sentryConfig';
export type {
  SentryConfig,
  SentryConfigInput,
  SentryClientConfig,
  SentryServerConfig,
  SentrySampleRates,
} from './sentryConfig';
