//? PostHog adapter. Thin wrapper around `posthog-node`. PostHog is
//? primarily a product-analytics platform but supports exception
//? tracking via `captureException` (newer SDKs) or fallback to a
//? custom `$exception` event.
//?
//? Usage:
//?   import { PostHog } from 'posthog-node';
//?   import { createPostHogAdapter } from '@luckystack/error-tracking';
//?   const client = new PostHog(env.POSTHOG_KEY, { host: 'https://us.i.posthog.com' });
//?   registerErrorTracker(createPostHogAdapter({ client }));
//?
//? `recordMetric` maps to a custom event named `metric_<name>` so dashboards
//? can chart values without leaving PostHog. Spans are no-ops — PostHog
//? doesn't model distributed traces; use Datadog/Sentry alongside if you
//? need APM.

import { createRequire } from 'node:module';

import { ensurePeerDepInstalled, type ErrorTracker, type ErrorTrackerEvent } from '@luckystack/core';

import { resolveExceptionEvent, resolveMessageEvent } from './runBeforeSend';

const localRequire = createRequire(import.meta.url);

interface PostHogClient {
  capture: (event: { distinctId: string; event: string; properties?: Record<string, unknown> }) => void;
  identify?: (input: { distinctId: string; properties?: Record<string, unknown> }) => void;
  captureException?: (error: unknown, distinctId?: string, properties?: Record<string, unknown>) => void;
  shutdown?: () => Promise<void>;
}

export interface PostHogAdapterOptions {
  /**
   * Live PostHog client (`new PostHog(apiKey, { host })`). The consumer
   * initialises it so they retain control over flush timing + shutdown
   * during graceful server stop.
   */
  client: PostHogClient;
  /**
   * Default distinct id used when no user is set (anonymous events). PostHog
   * requires every event to have a distinctId; this is the fallback.
   */
  anonymousDistinctId?: string;
  beforeSend?: (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;
}

export const createPostHogAdapter = (options: PostHogAdapterOptions): ErrorTracker => {
  //? `localRequire` (this module's `createRequire`) resolves `posthog-node`
  //? from the adapter's perspective, not core's node_modules.
  ensurePeerDepInstalled('posthog-node', 'Run `npm install posthog-node`.', localRequire);

  let currentDistinctId = options.anonymousDistinctId ?? 'anonymous';

  return {
    name: 'posthog',

    captureException(error, context) {
      const resolved = resolveExceptionEvent(options.beforeSend, error, context);
      if (!resolved) return;
      const { error: fwdError, context: fwdContext } = resolved;
      const properties: Record<string, unknown> = {
        'error.type': fwdError instanceof Error ? fwdError.name : typeof fwdError,
        'error.message': fwdError instanceof Error ? fwdError.message : String(fwdError),
        'error.stack': fwdError instanceof Error ? fwdError.stack : undefined,
        ...fwdContext,
      };
      //? Prefer the dedicated `captureException` API when the installed
      //? posthog-node version supports it; fall back to a custom
      //? `$exception` event for older clients.
      if (options.client.captureException) {
        options.client.captureException(fwdError, currentDistinctId, properties);
        return;
      }
      options.client.capture({
        distinctId: currentDistinctId,
        event: '$exception',
        properties,
      });
    },

    captureMessage(message, level, context) {
      const resolved = resolveMessageEvent(options.beforeSend, message, level, context);
      if (!resolved) return;
      options.client.capture({
        distinctId: currentDistinctId,
        event: 'log_message',
        properties: { message: resolved.message, level: resolved.level, ...resolved.context },
      });
    },

    setUser(user) {
      if (!user?.id) {
        currentDistinctId = options.anonymousDistinctId ?? 'anonymous';
        return;
      }
      currentDistinctId = user.id;
      if (options.client.identify) {
        options.client.identify({
          distinctId: user.id,
          properties: {
            email: user.email,
            username: user.username,
          },
        });
      }
    },

    recordMetric(name, value, tags) {
      options.client.capture({
        distinctId: currentDistinctId,
        event: `metric_${name}`,
        properties: { value, ...tags },
      });
    },

    beforeSend: options.beforeSend,
  };
};
