//? error-tracking package-owned PostHog runtime configuration. Mirrors
//? `registerSentryConfig` so the env-gated zero-config PostHog path in
//? `./register` can be tuned (anonymous distinct id, per-event `beforeSend`,
//? posthog-node client options) WITHOUT the consumer hand-rolling the client.
//?
//? Lives in `@luckystack/error-tracking` (not `@luckystack/core`) so projects
//? that don't install the error-tracking package never see PostHog-specific
//? knobs in their `ProjectConfig`.

import type { ErrorTrackerEvent } from '@luckystack/core';

export interface PostHogConfig {
  /**
   * Default distinct id for anonymous (pre-login) events. PostHog requires a
   * distinctId on every event; this is the fallback. Default `'anonymous'`.
   */
  anonymousDistinctId?: string;
  /**
   * Per-event hook applied by the auto-registered PostHog adapter. Return
   * `null` (or `{ ...event, forwarded: false }`) to drop, or a transformed
   * event to redact. Same contract as the other adapters' `beforeSend`.
   */
  beforeSend?: (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;
  /**
   * Extra options forwarded to `new PostHog(key, clientOptions)`. `host` is
   * still read from `POSTHOG_HOST` when omitted here; anything set here wins.
   */
  clientOptions?: { host?: string } & Record<string, unknown>;
}

let activeConfig: PostHogConfig = {};

export const registerPostHogConfig = (config: PostHogConfig): void => {
  //? Last-write-wins, consistent with `registerSentryConfig`.
  activeConfig = { ...config };
};

export const getPostHogConfig = (): PostHogConfig => activeConfig;
