//? error-tracking package-owned runtime configuration. Mirrors the same
//? lazy registration pattern as `@luckystack/presence`'s
//? `registerPresenceConfig` so consumers can `registerSentryConfig({...})`
//? after the package is imported.
//?
//? Lives in `@luckystack/error-tracking` (not `@luckystack/core`) so projects
//? that don't install the error-tracking package never see Sentry-specific
//? knobs in their `ProjectConfig`.

import { deepMerge, getLogger, type DeepPartial } from '@luckystack/core';

export interface SentrySampleRates {
  development: number;
  production: number;
}

/**
 * RESERVED — not consumed by the server-side `initializeSentry()` (which reads
 * only `getSentryConfig().server`). Browser Sentry (session replay, client
 * traces) is configured directly in the React entry. Setting these slots is a
 * silent no-op on the server; `registerSentryConfig` warns when they are set.
 */
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
  //? The `client.*` slots (replay/session sample rates) are a RESERVED, browser-
  //? only surface that the server-side `initializeSentry()` never reads — setting
  //? them is a silent no-op. Warn loudly so an author wiring "Sentry session
  //? replay" through this server config doesn't ship a no-op believing it took
  //? effect.
  if (config.client && Object.keys(config.client).length > 0) {
    getLogger().warn(
      '[error-tracking] registerSentryConfig({ client }) is a no-op on the server — '
      + 'the `client.*` slots (replaysSessionSampleRate, replaysOnErrorSampleRate, '
      + 'tracesSampleRate) are browser-only and are NOT read by initializeSentry(). '
      + 'Configure Sentry session replay directly in your React entry instead.',
    );
  }
  activeConfig = deepMerge(DEFAULT_SENTRY_CONFIG, config);
};

export const getSentryConfig = (): SentryConfig => activeConfig;
