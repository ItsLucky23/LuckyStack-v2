//? Datadog adapter. Thin wrapper around `dd-trace` (APM) + `hot-shots`
//? (StatsD client for metrics). Both are optional peer-deps with
//? boot-time guards.
//?
//? Datadog's exception capture model is different from Sentry's — there's
//? no first-class `captureException`. Conventionally you tag a span with
//? the error and let APM correlate. We do that here, plus emit a counter
//? metric (`luckystack.error.<kind>`) so dashboards can alert on rates
//? even without an APM trace.
//?
//? Usage:
//?   import { createDatadogAdapter } from '@luckystack/error-tracking';
//?   registerErrorTracker(createDatadogAdapter({ tracer, statsd }));
//?
//? The consumer initialises `dd-trace` themselves (because dd-trace MUST
//? be `require`'d first, before any other framework code) and passes the
//? handles in.

import { createRequire } from 'node:module';

import {
  ensurePeerDepInstalled,
  getCurrentErrorTrackerIdentity,
  sanitizeErrorString,
  sanitizeErrorStrings,
  type ErrorTracker,
  type ErrorTrackerEvent,
  type ErrorTrackerUser,
} from '@luckystack/core';

import { resolveExceptionEvent, resolveMessageEvent } from './runBeforeSend';

const localRequire = createRequire(import.meta.url);

interface DdTracerSpan {
  setTag: (key: string, value: unknown) => void;
  finish: () => void;
}

interface DdTracer {
  startSpan: (operation: string, options?: { tags?: Record<string, unknown> }) => DdTracerSpan;
}

interface DdStatsd {
  increment: (stat: string, value?: number, tags?: string[]) => void;
  gauge: (stat: string, value: number, tags?: string[]) => void;
  histogram: (stat: string, value: number, tags?: string[]) => void;
  //? ET-O13: hot-shots exposes `close` to flush the UDP send buffer and
  //? release the socket. Optional so the interface works without hot-shots.
  close?: (callback?: () => void) => void;
}

/**
 * @security PII note — user identity fields (`id`, `email`, `username`) passed
 * via `setErrorTrackerUser` are tagged onto APM spans as `usr.id`, `usr.email`,
 * `usr.name`. Sentry's `builtinBeforeSend` does NOT apply here: the Datadog
 * adapter bypasses the Sentry scrubbing pipeline entirely. If your organisation
 * requires that email addresses never leave the process boundary in plain text,
 * hash or omit the `email` field before calling `setErrorTrackerUser`.
 * There is no framework-level redaction of these span tags.
 */
export interface DatadogAdapterOptions {
  /**
   * Live dd-trace instance. Consumer-initialised because dd-trace MUST
   * be required before any other framework module (it patches Node's
   * core to instrument outgoing requests). Pass `tracer.init()`'s return
   * value or import dd-trace directly.
   */
  tracer: DdTracer;
  /**
   * Live StatsD client (typically `hot-shots`). Optional — without it the
   * adapter still captures exceptions via spans but skips metric emit.
   */
  statsd?: DdStatsd;
  /** Prefix prepended to every metric name. Default `'luckystack.'`. */
  metricPrefix?: string;
  beforeSend?: (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;
}

//? Coerce arbitrary context values to StatsD tag strings. Context is typed
//? `Record<string, unknown>`, so a raw `${k}:${v}` would render objects as
//? `key:[object Object]` and `String(symbol)` would THROW a TypeError and take
//? the whole capture path down. Stringify objects as JSON, symbols via
//? `.toString()`, everything else via `String(...)`.
const formatTags = (tags?: Record<string, unknown>): string[] => {
  if (!tags) return [];
  return Object.entries(tags).map(([k, v]) => {
    const value =
      typeof v === 'symbol'
        ? v.toString()
        : (v !== null && typeof v === 'object'
          ? JSON.stringify(v)
          : String(v));
    return `${k}:${value}`;
  });
};

export const createDatadogAdapter = (options: DatadogAdapterOptions): ErrorTracker => {
  //? `localRequire` (this module's `createRequire`) resolves `dd-trace` from
  //? the adapter's perspective, not core's node_modules.
  ensurePeerDepInstalled(
    'dd-trace',
    'Run `npm install dd-trace hot-shots` and import dd-trace as the FIRST require in your server entry.',
    localRequire,
  );

  const prefix = options.metricPrefix ?? 'luckystack.';

  //? Closure fallback identity, set by `setUser`. Used ONLY for non-request /
  //? background captures that run outside any per-request ALS scope. Datadog has
  //? no process-global user slot reachable through the minimal tracer interface,
  //? so we tag the spans we own rather than opening a throwaway `luckystack.user`
  //? span on every identity set (which produced one junk span per request).
  let fallbackUser: Record<string, unknown> | null = null;

  //? Resolve the user at CAPTURE time: prefer the per-request ALS identity (ET-02
  //? — isolated per concurrent request, survives await boundaries) and fall back
  //? to the closure `fallbackUser` only when no request scope is active.
  const resolveUser = (): ErrorTrackerUser | Record<string, unknown> | null =>
    getCurrentErrorTrackerIdentity() ?? fallbackUser;

  const userTags = (): Record<string, unknown> => {
    const currentUser = resolveUser();
    if (!currentUser) return {};
    const tags: Record<string, unknown> = {};
    if (currentUser.id !== undefined) tags['usr.id'] = currentUser.id;
    if (currentUser.email !== undefined) tags['usr.email'] = currentUser.email;
    if (currentUser.username !== undefined) tags['usr.name'] = currentUser.username;
    return tags;
  };

  return {
    name: 'datadog',

    captureException(error, context) {
      const resolved = resolveExceptionEvent(options.beforeSend, error, context);
      if (!resolved) return;
      const { error: fwdError, context: fwdContext } = resolved;
      //? ET-O2: scrub secrets interpolated into error.message / error.stack
      //? before they reach Datadog. The context-level key-based scrub covers
      //? the `context` object; this covers the free-text string fields.
      const scrubbed = sanitizeErrorStrings(fwdError);
      //? sanitizeErrorStrings returns null for a NON-Error throw, so scrub the
      //? stringified value too (ET-O2) — a `throw 'token=abc'` would otherwise tag
      //? the raw secret onto the span unscrubbed.
      const errorMessage = scrubbed?.message ?? (fwdError instanceof Error ? fwdError.message : sanitizeErrorString(String(fwdError)));
      const errorStack = scrubbed?.stack ?? (fwdError instanceof Error ? fwdError.stack : undefined);
      const span = options.tracer.startSpan('luckystack.error', {
        //? Spread consumer `fwdContext` FIRST so the framework-owned error.* and
        //? usr.* identity tags below cannot be shadowed by arbitrary capture context.
        tags: {
          ...fwdContext,
          'error.type': fwdError instanceof Error ? fwdError.name : typeof fwdError,
          'error.msg': errorMessage,
          ...userTags(),
        },
      });
      span.setTag('error', true);
      if (errorStack !== undefined) {
        span.setTag('error.stack', errorStack);
      }
      //? ET-N4: increment the counter BEFORE finishing the span so Datadog can
      //? correlate the StatsD metric with the active trace span. Emitting after
      //? `span.finish()` caused the metric timestamp to lag the span close, which
      //? broke APM-to-metrics correlation in Datadog dashboards.
      options.statsd?.increment(`${prefix}error.exception`, 1, formatTags(fwdContext));
      span.finish();
    },

    captureMessage(message, level, context) {
      const resolved = resolveMessageEvent(options.beforeSend, message, level, context);
      if (!resolved) return;
      const { message: fwdMessage, level: fwdLevel, context: fwdContext } = resolved;
      const span = options.tracer.startSpan('luckystack.message', {
        tags: {
          //? ET-O2: scrub secrets interpolated into a free-text message string
          //? (e.g. captureMessage(`reset token=${t}`)) before it reaches Datadog.
          'message.text': sanitizeErrorString(fwdMessage),
          'message.level': fwdLevel,
          ...userTags(),
          ...fwdContext,
        },
      });
      //? ET-N4: same pattern as captureException — counter before finish for correlation.
      options.statsd?.increment(`${prefix}error.message`, 1, [`level:${fwdLevel}`, ...formatTags(fwdContext)]);
      span.finish();
    },

    setUser(user) {
      //? Record the closure-fallback identity for the next capture's span tags
      //? instead of opening a dedicated `luckystack.user` span per call (which
      //? produced one junk span per request). Per-request captures prefer the ALS
      //? identity (ET-02); this fallback only covers non-request captures. Datadog
      //? correlates the user via the `usr.*` tags attached in capture*.
      fallbackUser = user;
    },

    recordMetric(name, value, tags) {
      if (!options.statsd) return;
      options.statsd.gauge(`${prefix}${name}`, value, formatTags(tags));
    },

    startSpan(name, op, fn) {
      const span = options.tracer.startSpan(name, { tags: { op } });
      try {
        return fn();
      } finally {
        span.finish();
      }
    },

    //? #62: handle-style span for the request lifecycle (open at preApiExecute,
    //? close at postApiExecute). dd-trace's `startSpan().finish()` maps directly,
    //? so an adapter-only Datadog consumer gets real APM request-timing spans
    //? through the registry's `startSpanHandle` delegation.
    startSpanHandle(name, op) {
      const span = options.tracer.startSpan(name, { tags: { op } });
      return {
        finish: () => {
          span.finish();
        },
      };
    },

    //? ET-O13: flush the hot-shots UDP send buffer on graceful shutdown so
    //? in-flight StatsD metrics are not silently dropped. `dd-trace` itself
    //? does not require an explicit flush (traces are sent synchronously in
    //? the APM agent).
    flush() {
      return new Promise<void>((resolve) => {
        if (options.statsd?.close) {
          options.statsd.close(resolve);
        } else {
          resolve();
        }
      });
    },

    beforeSend: options.beforeSend,
  };
};
