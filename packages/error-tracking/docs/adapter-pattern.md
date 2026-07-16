# Adapter pattern + multi-tracker registry

> Backend-agnostic error capture for LuckyStack. One contract, any number of
> backends, fan-out at the call site. Lets you slot Sentry, Datadog, PostHog,
> or any custom backend (CloudWatch, New Relic, Honeybadger, Bugsnag, ...) into
> the framework without forking `@luckystack/core`.

## Why the registry lives in `@luckystack/core`

Framework code in `@luckystack/api`, `@luckystack/sync`, `@luckystack/server`,
and `@luckystack/login` needs to report exceptions, messages, and user identity
without depending on a specific observability vendor. If the registry lived in
`@luckystack/error-tracking`, every framework package would inherit a transitive
dep on `@sentry/node` (or whatever else we chose), and projects that ship
without error tracking would still pull it into their lockfile.

The split is:

- **Contract + registry**: `packages/core/src/errorTrackerRegistry.ts` — types
  (`ErrorTracker`, `ErrorTrackerContext`, `ErrorTrackerUser`, `ErrorTrackerEvent`,
  `SpanResult<T>`) plus the registry functions (`registerErrorTracker`,
  `registerErrorTrackers`, `getActiveErrorTrackers`, `captureExceptionAcrossTrackers`,
  `captureMessageAcrossTrackers`, `setErrorTrackerUser`, `recordMetricAcrossTrackers`,
  `startSpanAcrossTrackers`).
- **Adapter implementations**: `packages/error-tracking/src/adapters/*.ts` —
  `createSentryAdapter`, `createDatadogAdapter`, `createPostHogAdapter`.

The error-tracking package re-exports the registry surface so consumers can do
everything from one import path:

```ts
import {
  registerErrorTracker,
  createSentryAdapter,
  type ErrorTracker,
} from '@luckystack/error-tracking';
```

Framework packages that only need to dispatch (never register) import directly
from `@luckystack/core` to avoid the dep on the error-tracking package.

## The `ErrorTracker` contract

```ts
export interface ErrorTracker {
  /** Human-readable identifier; used in logs + diagnostics. */
  name: string;

  captureException: (error: unknown, context?: ErrorTrackerContext) => void;

  captureMessage: (
    message: string,
    level: 'info' | 'warning' | 'error' | 'fatal',
    context?: ErrorTrackerContext,
  ) => void;

  setUser: (user: ErrorTrackerUser | null) => void;

  /** Optional. Used by `setContextAcrossTrackers`-style call sites. */
  setContext?: (key: string, context: ErrorTrackerContext | null) => void;

  /** Optional. First tracker that implements this wins span ownership. */
  startSpan?: <T>(name: string, op: string, fn: () => T) => T;

  /** Optional. Skipped when an adapter doesn't implement it. */
  recordMetric?: (name: string, value: number, tags?: Record<string, string>) => void;

  /** Optional. Called per-event with the canonical `ErrorTrackerEvent`. */
  beforeSend?: (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;
}
```

Supporting types:

```ts
export interface ErrorTrackerContext {
  [key: string]: unknown;
}

export interface ErrorTrackerUser {
  id?: string;
  email?: string;
  username?: string;
  [key: string]: unknown;
}

export interface ErrorTrackerEvent {
  /** When false, the adapter must not forward this event (beforeSend opt-out). */
  forwarded: boolean;
  kind: 'exception' | 'message';
  payload: Record<string, unknown>;
}

export type SpanResult<T> = T;
```

All adapter fields besides `name`, `captureException`, `captureMessage`, and
`setUser` are optional. A minimal adapter only needs those four methods; the
registry skips optional methods on adapters that omit them.

## Registration: single vs multi vs append

```ts
// Replace the active list with a single tracker (idempotent).
registerErrorTracker(tracker: ErrorTracker): void;

// Replace the active list with N trackers — every capture fans out to all of them.
registerErrorTrackers(trackers: ErrorTracker[]): void;

// Append a tracker WITHOUT clobbering already-registered ones.
// De-duplicates by name: re-appending the same adapter name replaces that entry
// in place, so repeated calls are safe. Use this for async auto-registration
// (e.g. PostHog) where the order of registration relative to the consumer's
// registerErrorTrackers call is non-deterministic.
appendErrorTracker(tracker: ErrorTracker): void;

// Snapshot the active list (useful for diagnostics + tests).
getActiveErrorTrackers(): ErrorTracker[];
```

`registerErrorTracker` and `registerErrorTrackers` REPLACE the active list.
`appendErrorTracker` ACCUMULATES — it was specifically designed to prevent the
async PostHog auto-registration race where the loser of a
`registerErrorTracker`/`registerErrorTrackers` replace call would silently
vanish. Use `appendErrorTracker` whenever you need to add a tracker at a point
in the boot lifecycle where the consumer may have already registered others.

```ts
import {
  registerErrorTrackers,
  appendErrorTracker,
  getActiveErrorTrackers,
  createSentryAdapter,
  createDatadogAdapter,
  createPostHogAdapter,
} from '@luckystack/error-tracking';

// Synchronous registration at boot — all three at once.
registerErrorTrackers([
  createSentryAdapter(),
  createDatadogAdapter({ tracer, statsd }),
  createPostHogAdapter({ client: posthog }),
]);

// Later, in an async feature flag toggle — appendErrorTracker is safe here
// because it will not clobber the adapters registered above.
appendErrorTracker(myCustomCloudWatchAdapter);

// appendErrorTracker de-dupes by name, so registering the same name twice
// replaces the existing entry rather than doubling it:
appendErrorTracker(createDatadogAdapter({ tracer, statsd, metricPrefix: 'v2.' }));
// ↑ the old 'datadog' entry is replaced, not added alongside it.
```

## Fan-out semantics

Every capture call dispatched through the registry walks the active tracker
list IN ORDER and invokes the matching method. Per-tracker throws are caught
and discarded so one buggy adapter cannot break the chain:

```ts
export const captureExceptionAcrossTrackers = (
  error: unknown,
  context?: ErrorTrackerContext,
): void => {
  for (const tracker of activeTrackers) {
    try {
      tracker.captureException(error, context);
    } catch {
      // Swallow — one buggy tracker must not break the chain.
    }
  }
};
```

The same shape applies to:

- `captureMessageAcrossTrackers(message, level, context?)`
- `setErrorTrackerUser(user)`
- `recordMetricAcrossTrackers(name, value, tags?)` — additionally skips
  trackers that don't implement `recordMetric` (no NoOp wrapper, no `?.()`
  on a missing key).

Spans are the one exception (see `startSpanAcrossTrackers` below).

## `ErrorTrackerEvent` + `beforeSend` chain

`beforeSend` is a PER-ADAPTER filter. Each built-in adapter constructs an
`ErrorTrackerEvent` describing the dispatch (`{ forwarded: true, kind, payload }`)
and runs `options.beforeSend(event)` if provided. The hook can do two things,
both of which the adapter honours:

- **Drop the event** — return `null`, OR return the event with `forwarded: false`.
  Either way the event is dropped for THAT adapter only; other adapters in the
  list still receive it.
- **Transform the event** — return the event with a mutated or replaced
  `payload`. The adapter forwards the RETURNED payload, never the original, so a
  redacting `beforeSend` actually redacts what reaches the backend. Prefer an
  immutable copy (`{ ...event, payload: { ...event.payload, context: scrubbed } }`)
  — mutating the shared `event` object in place would also affect any sibling
  adapter that receives the same event.

```ts
registerErrorTracker(
  createSentryAdapter({
    beforeSend: (event) => {
      // Drop noisy validation errors before they reach Sentry,
      // but Datadog/PostHog still get them via their own adapters.
      if (
        event.kind === 'exception' &&
        event.payload.error instanceof ValidationError
      ) {
        return null; // (or: return { ...event, forwarded: false })
      }
      // Redact PII from the context before it leaves the process.
      const context = event.payload.context as Record<string, unknown> | null;
      if (context && 'email' in context) {
        return { ...event, payload: { ...event.payload, context: { ...context, email: '[redacted]' } } };
      }
      return event;
    },
  }),
);
```

`beforeSend` is intentionally not on the registry. Cross-adapter filtering
should be done at the dispatch site (e.g. inside a `tryCatch` wrapper that
rate-limits or deduplicates before calling `captureExceptionAcrossTrackers`).

## `setUser` propagation

`setErrorTrackerUser(user)` fans out user identity to every adapter. Pass
`null` to clear (logout):

```ts
import { setErrorTrackerUser } from '@luckystack/error-tracking';

setErrorTrackerUser({ id: session.userId, email: session.email });
// ... later:
setErrorTrackerUser(null);
```

The framework already wires this on session changes — see
`auto-instrumentation.md` for the call sites in `@luckystack/api`,
`@luckystack/sync`, and `@luckystack/login`.

## `recordMetricAcrossTrackers`

Custom metrics route only through adapters that implement `recordMetric`. The
Datadog adapter forwards them to StatsD (`statsd.gauge(...)`); the PostHog
adapter maps them to a `metric_<name>` event so dashboards can chart them; the
Sentry adapter omits `recordMetric` entirely (Sentry's metrics product is
deprecated, so we don't auto-forward).

```ts
import { recordMetricAcrossTrackers } from '@luckystack/error-tracking';

recordMetricAcrossTrackers('api.request.latency_ms', durationMs, {
  route: 'examples/getUserData',
  version: 'v1',
});
```

## `startSpanAcrossTrackers`

Spans do not fan out cleanly across backends — they are nested execution scopes
with vendor-specific propagation rules. Only the FIRST registered tracker that
implements `startSpan` runs the span; when no tracker supports spans, the
helper invokes `fn()` directly so callers don't need to gate on registration:

```ts
export const startSpanAcrossTrackers = <T>(name: string, op: string, fn: () => T): T => {
  const first = activeTrackers.find((t) => t.startSpan);
  if (!first?.startSpan) return fn();
  return first.startSpan(name, op, fn) as T;
};
```

See `span-helpers.md` for the legacy `startSpan(name, op)` entry and the
historical note on `SpanResult<T>`.

## Built-in adapters

All three built-in adapters live under `packages/error-tracking/src/adapters/`
and share the same boot-time peer-dep guard pattern: `createRequire(...)` +
`localRequire.resolve('<peer>')` inside a `try/catch`. A missing peer-dep
produces a hard, descriptive boot error rather than a silent fall-through.

### `createSentryAdapter(options?)`

```ts
interface SentryAdapterOptions {
  beforeSend?: (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;
}

createSentryAdapter(options?: SentryAdapterOptions): ErrorTracker;
```

- Peer-dep: `@sentry/node@^10.66.0`. Missing -> boot error.
- Resolves the SDK lazily via `createRequire(import.meta.url)`.
- Forwards `captureException(error, { extra: context })`, `captureMessage`,
  `setUser`, `setContext`, and `startSpan({ name, op }, fn)`.
- Returns an `ErrorTracker` with `name: 'sentry'`.

The consumer is responsible for `Sentry.init(...)` — either by calling
`initializeSentry()` (legacy entry, reads `SENTRY_DSN` + `registerSentryConfig`)
or by calling `Sentry.init(...)` directly. See `sentry-integration.md` for the
two paths and the migration story.

### `createDatadogAdapter(options)`

```ts
interface DatadogAdapterOptions {
  tracer: DdTracer;        // live dd-trace instance (consumer-initialised)
  statsd?: DdStatsd;       // optional hot-shots client for metrics
  metricPrefix?: string;   // default 'luckystack.'
  beforeSend?: (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;
}

createDatadogAdapter(options: DatadogAdapterOptions): ErrorTracker;
```

- Peer-deps: `dd-trace@^5.0.0` (required), `hot-shots@^10.0.0` (optional). The
  guard only enforces `dd-trace`; without `hot-shots` metrics are skipped but
  exception capture still works.
- `dd-trace` MUST be the FIRST `require` in your server entry (it patches
  Node's core modules for instrumentation). The adapter takes the live tracer
  in via `options.tracer` rather than requiring it itself, so the call order
  stays under consumer control.
- Datadog has no first-class `captureException`. The adapter starts a
  short-lived span named `luckystack.error`, tags it with
  `error.type`, `error.msg`, `error.stack`, and `error: true`, then finishes
  it. APM correlates this with the surrounding trace.
- `captureMessage` writes a `luckystack.message` span tagged with the text +
  level, and (if `statsd` is present) increments `luckystack.error.message`
  with a `level:<level>` tag.
- `setUser` calls `tracer.setUser(span, user)` on a throwaway span. Datadog
  propagates user identity via span tags, not process-globals, so this is a
  best-effort signal; tag the user via `context` on individual
  `captureException` calls for reliable correlation.
- `recordMetric(name, value, tags)` -> `statsd.gauge('<prefix><name>', value, tags)`.
- `startSpan(name, op, fn)` -> `tracer.startSpan(name, { tags: { op } })` wrapped
  in `try/finally` with `span.finish()`.
- Returns an `ErrorTracker` with `name: 'datadog'`.

### `createPostHogAdapter(options)`

```ts
interface PostHogAdapterOptions {
  client: PostHogClient;        // live `new PostHog(apiKey, { host })` instance
  anonymousDistinctId?: string; // default 'anonymous'
  beforeSend?: (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;
}

createPostHogAdapter(options: PostHogAdapterOptions): ErrorTracker;
```

- Peer-dep: `posthog-node@^4.0.0`. Missing -> boot error.
- PostHog is primarily a product-analytics platform; exception tracking is a
  recent addition. The adapter prefers `client.captureException(error, distinctId, properties)`
  when the installed SDK supports it, and falls back to a custom `$exception`
  event for older SDKs.
- `captureMessage` -> custom `log_message` event with `{ message, level, ...context }`.
- `setUser` updates the internal `currentDistinctId` and (if available) calls
  `client.identify({ distinctId, properties: { email, username } })`. Passing
  `null` reverts to the configured `anonymousDistinctId`.
- `recordMetric` -> custom `metric_<name>` event with `{ value, ...tags }`.
- `startSpan` is intentionally absent — PostHog doesn't model distributed
  traces. Use Datadog or Sentry alongside if APM matters.
- Returns an `ErrorTracker` with `name: 'posthog'`.

The consumer owns the client lifecycle (creation + `shutdown()` on graceful
server stop) so flush timing stays under their control.

## Writing a custom adapter

To slot in an unsupported backend (CloudWatch, New Relic, Honeybadger,
Bugsnag, Rollbar, Logflare, ...) implement the `ErrorTracker` interface
directly. There is no inheritance or base class — adapters are plain objects:

```ts
import {
  registerErrorTracker,
  type ErrorTracker,
} from '@luckystack/error-tracking';
import { CloudWatchLogsClient, PutLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';

const client = new CloudWatchLogsClient({ region: 'eu-west-1' });

const cloudwatchAdapter: ErrorTracker = {
  name: 'cloudwatch',

  captureException(error, context) {
    void client.send(new PutLogEventsCommand({
      logGroupName: 'luckystack/errors',
      logStreamName: process.env.HOSTNAME ?? 'unknown',
      logEvents: [{
        timestamp: Date.now(),
        message: JSON.stringify({
          level: 'error',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          context,
        }),
      }],
    }));
  },

  captureMessage(message, level, context) {
    void client.send(new PutLogEventsCommand({
      logGroupName: 'luckystack/errors',
      logStreamName: process.env.HOSTNAME ?? 'unknown',
      logEvents: [{
        timestamp: Date.now(),
        message: JSON.stringify({ level, message, context }),
      }],
    }));
  },

  setUser(user) {
    // CloudWatch has no user concept — capture identity inline via context.
    // No-op here; capture sites should pass user id in context when needed.
  },
};

registerErrorTracker(cloudwatchAdapter);
```

Guidelines for custom adapters:

- Keep `captureException` synchronous (no `await`). Fire-and-forget the
  underlying transport; consumers expect zero added latency.
- Throw nothing. The registry catches per-adapter throws, but defensive code
  here keeps stack traces readable in tests.
- Implement only what the backend supports. `recordMetric`, `startSpan`, and
  `setContext` are optional — leave them off rather than stubbing no-ops.
- If you need a peer-dep guard, mirror the built-in adapters'
  `createRequire(import.meta.url)` + `localRequire.resolve(...)` pattern so
  missing peers crash at boot, not at first capture.

## Related

- Sentry integration (legacy + adapter coexistence + config registry):
  `./sentry-integration.md`.
- Span helpers + `SpanResult<T>` history: `./span-helpers.md`.
- Framework hook touchpoints wired by `initializeSentry()`:
  `./auto-instrumentation.md`.
- Core-side registry source: `packages/core/src/errorTrackerRegistry.ts`.
- Built-in adapter sources: `packages/error-tracking/src/adapters/{sentry,datadog,posthog}.ts`.
