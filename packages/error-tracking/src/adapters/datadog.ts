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

import { ensurePeerDepInstalled, type ErrorTracker, type ErrorTrackerEvent } from '@luckystack/core';

import { resolveExceptionEvent, resolveMessageEvent } from './runBeforeSend';

const localRequire = createRequire(import.meta.url);

interface DdTracerSpan {
  setTag: (key: string, value: unknown) => void;
  finish: () => void;
}

interface DdTracer {
  startSpan: (operation: string, options?: { tags?: Record<string, unknown> }) => DdTracerSpan;
  setUser?: (span: DdTracerSpan, user: Record<string, unknown>) => void;
}

interface DdStatsd {
  increment: (stat: string, value?: number, tags?: string[]) => void;
  gauge: (stat: string, value: number, tags?: string[]) => void;
  histogram: (stat: string, value: number, tags?: string[]) => void;
}

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

const formatTags = (tags?: Record<string, string>): string[] => {
  if (!tags) return [];
  return Object.entries(tags).map(([k, v]) => `${k}:${v}`);
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

  return {
    name: 'datadog',

    captureException(error, context) {
      const resolved = resolveExceptionEvent(options.beforeSend, error, context);
      if (!resolved) return;
      const { error: fwdError, context: fwdContext } = resolved;
      const span = options.tracer.startSpan('luckystack.error', {
        tags: {
          'error.type': fwdError instanceof Error ? fwdError.name : typeof fwdError,
          'error.msg': fwdError instanceof Error ? fwdError.message : String(fwdError),
          ...fwdContext,
        },
      });
      span.setTag('error', true);
      if (fwdError instanceof Error && fwdError.stack) {
        span.setTag('error.stack', fwdError.stack);
      }
      span.finish();
      options.statsd?.increment(`${prefix}error.exception`, 1, formatTags(fwdContext as Record<string, string> | undefined));
    },

    captureMessage(message, level, context) {
      const resolved = resolveMessageEvent(options.beforeSend, message, level, context);
      if (!resolved) return;
      const { message: fwdMessage, level: fwdLevel, context: fwdContext } = resolved;
      const span = options.tracer.startSpan('luckystack.message', {
        tags: {
          'message.text': fwdMessage,
          'message.level': fwdLevel,
          ...fwdContext,
        },
      });
      span.finish();
      options.statsd?.increment(`${prefix}error.message`, 1, [`level:${fwdLevel}`, ...formatTags(fwdContext as Record<string, string> | undefined)]);
    },

    setUser(user) {
      //? dd-trace propagates user identity via span tags on the current
      //? span. We can't set it globally without an active span; consumers
      //? wanting user-tagged errors should pass it via context on each
      //? captureException call.
      if (user && options.tracer.setUser) {
        const span = options.tracer.startSpan('luckystack.user');
        options.tracer.setUser(span, user);
        span.finish();
      }
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

    beforeSend: options.beforeSend,
  };
};
