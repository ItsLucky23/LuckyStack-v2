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

import type { ErrorTracker, ErrorTrackerEvent } from '@luckystack/core';

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

const ensurePeerDepInstalled = (): void => {
  try {
    localRequire.resolve('dd-trace');
  } catch {
    throw new Error(
      '[error-tracking:datadog] The `dd-trace` package is not installed but createDatadogAdapter() was called. ' +
      'Run `npm install dd-trace hot-shots` and import dd-trace as the FIRST require in your server entry.',
    );
  }
};

const formatTags = (tags?: Record<string, string>): string[] => {
  if (!tags) return [];
  return Object.entries(tags).map(([k, v]) => `${k}:${v}`);
};

export const createDatadogAdapter = (options: DatadogAdapterOptions): ErrorTracker => {
  ensurePeerDepInstalled();

  const prefix = options.metricPrefix ?? 'luckystack.';

  const runBeforeSend = (event: ErrorTrackerEvent): ErrorTrackerEvent | null => {
    if (!options.beforeSend) return event;
    return options.beforeSend(event);
  };

  return {
    name: 'datadog',

    captureException(error, context) {
      const filtered = runBeforeSend({
        forwarded: true,
        kind: 'exception',
        payload: { error, context: context ?? null },
      });
      if (!filtered) return;
      const span = options.tracer.startSpan('luckystack.error', {
        tags: {
          'error.type': error instanceof Error ? error.name : typeof error,
          'error.msg': error instanceof Error ? error.message : String(error),
          ...context,
        },
      });
      span.setTag('error', true);
      if (error instanceof Error && error.stack) {
        span.setTag('error.stack', error.stack);
      }
      span.finish();
      options.statsd?.increment(`${prefix}error.exception`, 1, formatTags(context as Record<string, string> | undefined));
    },

    captureMessage(message, level, context) {
      const filtered = runBeforeSend({
        forwarded: true,
        kind: 'message',
        payload: { message, level, context: context ?? null },
      });
      if (!filtered) return;
      const span = options.tracer.startSpan('luckystack.message', {
        tags: {
          'message.text': message,
          'message.level': level,
          ...context,
        },
      });
      span.finish();
      options.statsd?.increment(`${prefix}error.message`, 1, [`level:${level}`, ...formatTags(context as Record<string, string> | undefined)]);
    },

    setUser(user) {
      //? dd-trace propagates user identity via span tags on the current
      //? span. We can't set it globally without an active span; consumers
      //? wanting user-tagged errors should pass it via context on each
      //? captureException call.
      if (user && options.tracer.setUser) {
        const span = options.tracer.startSpan('luckystack.user');
        options.tracer.setUser(span, user as Record<string, unknown>);
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
