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

import {
  ensurePeerDepInstalled,
  getCurrentErrorTrackerIdentity,
  sanitizeErrorString,
  sanitizeErrorStrings,
  type ErrorTracker,
  type ErrorTrackerEvent,
} from '@luckystack/core';

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

  //? Treat empty/whitespace as absent (an unset-env-var read can yield `''`,
  //? which `??` would pass straight through). PostHog requires a NON-empty
  //? distinctId, so a blank value would silently drop/mis-bucket every
  //? anonymous capture — fall back to 'anonymous' instead.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- `||` is intentional: an empty/whitespace value must fall back to 'anonymous' (`??` would let `''` through, and PostHog rejects an empty distinctId).
  const anonymousDistinctId = options.anonymousDistinctId?.trim() || 'anonymous';
  //? Closure fallback identity, set by `setUser`. Used ONLY for non-request /
  //? background captures that run outside any per-request ALS scope. Per-request
  //? captures resolve the distinctId from the ALS at capture time (ET-02).
  let fallbackDistinctId = anonymousDistinctId;

  //? Resolve the distinctId at CAPTURE time: prefer the per-request ALS identity
  //? (ET-02 — isolated per concurrent request, survives await boundaries) and only
  //? fall back to the closure `fallbackDistinctId` when no request scope is active.
  const resolveDistinctId = (): string => {
    const alsUser = getCurrentErrorTrackerIdentity();
    if (alsUser?.id) return alsUser.id;
    return fallbackDistinctId;
  };

  return {
    name: 'posthog',

    captureException(error, context) {
      const resolved = resolveExceptionEvent(options.beforeSend, error, context);
      if (!resolved) return;
      const { error: fwdError, context: fwdContext } = resolved;
      //? ET-O2: scrub secrets interpolated into error.message / error.stack
      //? before they reach PostHog. The context-level key-based scrub already
      //? covers the `context` object; this covers the free-text string fields.
      const scrubbed = sanitizeErrorStrings(fwdError);
      //? sanitizeErrorStrings returns null for a NON-Error throw, so scrub the
      //? stringified value too (ET-O2) — a `throw 'token=abc'` would otherwise ship
      //? the raw secret to PostHog unscrubbed.
      const errorMessage = scrubbed?.message ?? (fwdError instanceof Error ? fwdError.message : sanitizeErrorString(String(fwdError)));
      const errorStack = scrubbed?.stack ?? (fwdError instanceof Error ? fwdError.stack : undefined);
      //? ET-O2: spread caller context FIRST so the scrubbed `error.*` fields set
      //? below always win — otherwise a caller-supplied `error.message`/`error.stack`
      //? in `fwdContext` could override (and un-scrub) the redacted values.
      const properties: Record<string, unknown> = {
        ...fwdContext,
        'error.type': fwdError instanceof Error ? fwdError.name : typeof fwdError,
        'error.message': errorMessage,
        //? Only emit `error.stack` when a stack actually exists — a non-Error
        //? throw would otherwise add a noisy explicit-`undefined` field.
        ...(errorStack === undefined ? {} : { 'error.stack': errorStack }),
      };
      //? Prefer the dedicated `captureException` API when the installed
      //? posthog-node version supports it; fall back to a custom
      //? `$exception` event for older clients.
      const distinctId = resolveDistinctId();
      if (options.client.captureException) {
        options.client.captureException(fwdError, distinctId, properties);
        return;
      }
      options.client.capture({
        distinctId,
        event: '$exception',
        properties,
      });
    },

    captureMessage(message, level, context) {
      const resolved = resolveMessageEvent(options.beforeSend, message, level, context);
      if (!resolved) return;
      options.client.capture({
        distinctId: resolveDistinctId(),
        event: 'log_message',
        //? ET-O2: scrub secrets interpolated into a free-text message string before
        //? it reaches PostHog (captureMessage never ran through the scrubber).
        properties: { message: sanitizeErrorString(resolved.message), level: resolved.level, ...resolved.context },
      });
    },

    setUser(user) {
      if (!user?.id) {
        fallbackDistinctId = anonymousDistinctId;
        return;
      }
      fallbackDistinctId = user.id;
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
        distinctId: resolveDistinctId(),
        event: `metric_${name}`,
        properties: { value, ...tags },
      });
    },

    //? ET-16 flush lifecycle: drain posthog-node's in-memory event batch on
    //? graceful shutdown via the client's `shutdown()` (no-op when the client
    //? doesn't expose one). `flushErrorTrackers()` calls this on server stop.
    async flush() {
      await options.client.shutdown?.();
    },

    beforeSend: options.beforeSend,
  };
};
