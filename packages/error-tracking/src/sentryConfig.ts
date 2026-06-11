//? error-tracking package-owned runtime configuration. Mirrors the same
//? lazy registration pattern as `@luckystack/presence`'s
//? `registerPresenceConfig` so consumers can `registerSentryConfig({...})`
//? after the package is imported.
//?
//? Lives in `@luckystack/error-tracking` (not `@luckystack/core`) so projects
//? that don't install the error-tracking package never see Sentry-specific
//? knobs in their `ProjectConfig`.

import { deepMerge, type DeepPartial } from '@luckystack/core';

export interface SentrySampleRates {
  development: number;
  production: number;
}

export interface SentryClientConfig {
  tracesSampleRate?: SentrySampleRates;
  replaysSessionSampleRate?: SentrySampleRates;
  replaysOnErrorSampleRate?: SentrySampleRates;
}

export interface SentryServerConfig {
  tracesSampleRate?: SentrySampleRates;
  /**
   * Errors matching any of these strings are not sent to Sentry. Default
   * `['Socket connection timeout', 'ECONNREFUSED']`. Set to an empty array
   * to disable filtering, or extend with installer-specific noise.
   */
  ignoreErrors?: string[];
}

export interface SentryConfig {
  client?: SentryClientConfig;
  server?: SentryServerConfig;
}

export const DEFAULT_SENTRY_CONFIG: SentryConfig = {
  server: {
    ignoreErrors: ['Socket connection timeout', 'ECONNREFUSED'],
  },
};

export type SentryConfigInput = DeepPartial<SentryConfig>;

let activeConfig: SentryConfig = DEFAULT_SENTRY_CONFIG;

export const registerSentryConfig = (config: SentryConfigInput): void => {
  activeConfig = deepMerge(DEFAULT_SENTRY_CONFIG, config);
};

export const getSentryConfig = (): SentryConfig => activeConfig;
