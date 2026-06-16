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
//? ET-O10: `export *` replaces the hand-synced named re-export list so
//? adapter.ts additions (ET-N2 additions: flushErrorTrackers, appendErrorTracker,
//? runWithErrorTrackerIdentity*, registerPreCaptureFilter, startSpanHandle) are
//? automatically visible to consumers without a manual index.ts edit.
export * from './adapter';

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

//? ET-N1: posthogConfig.ts was entirely dead — not exported, not imported by
//? register.ts. Export it so consumers can tune the auto-registered PostHog
//? adapter via `registerPostHogConfig({ beforeSend, anonymousDistinctId })`.
export { registerPostHogConfig, getPostHogConfig } from './posthogConfig';
export type { PostHogConfig } from './posthogConfig';
