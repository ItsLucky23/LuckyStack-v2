# @luckystack/error-tracking

Pluggable server-side error capture and tracing for LuckyStack. The package re-exports the backend-neutral `ErrorTracker` registry from `@luckystack/core` and ships Sentry, Datadog, and PostHog adapters. Multiple adapters can run together; one failing adapter does not break request handling or sibling trackers.

## Install

In a scaffolded app, use the feature command so the dependency and injected `functions.sentry.*` compatibility shim arrive together:

```bash
npx luckystack add error-tracking
```

Then install the SDK for the backend you use:

```bash
npm install @sentry/node             # Sentry
npm install posthog-node             # PostHog
npm install dd-trace hot-shots       # Datadog; hot-shots supplies optional metrics
```

The package has no required vendor SDK. These four peers are optional and are loaded only by their matching integration.

## Initialization paths

### Sentry: automatic from environment

`bootstrapLuckyStack` auto-imports `@luckystack/error-tracking/register`. When `SENTRY_DSN` is set, that entry initializes Sentry, registers its adapter, and enables the framework hook instrumentation. No consumer boot call is required.

```env
SENTRY_DSN=https://...
# SENTRY_ENABLED=false # explicit opt-out while retaining the DSN
```

`initializeSentry()` remains public for custom bootstraps and legacy consumers. It is Sentry-specific and is a no-op without a DSN.

### PostHog: automatic adapter registration

With `POSTHOG_KEY` set, the same side-effect entry dynamically creates and appends a PostHog adapter. It can coexist with Sentry because registration uses `appendErrorTracker`.

```env
POSTHOG_KEY=phc_...
POSTHOG_HOST=https://us.i.posthog.com
```

Use `registerPostHogConfig(...)` before the register entry runs when you need a custom host/options, anonymous distinct id, or `beforeSend` filter. In a custom bootstrap or when full hook-based span wiring is required without Sentry, call `enableErrorTrackingAutoInstrumentation()` after registering the adapter.

### Datadog: first-import manual setup

`dd-trace` must be imported and initialized before framework modules so it can patch Node I/O. The scaffolder therefore places an enable-later block at the top of `server/server.ts`; uncomment that block and its adapter-registration block. Datadog is not auto-created by the register entry.

```ts
// Must precede framework imports:
import tracer from 'dd-trace';
tracer.init();

// During boot:
import StatsD from 'hot-shots';
import {
  createDatadogAdapter,
  registerErrorTracker,
  enableErrorTrackingAutoInstrumentation,
} from '@luckystack/error-tracking';

registerErrorTracker(createDatadogAdapter({ tracer, statsd: new StatsD() }));
enableErrorTrackingAutoInstrumentation();
```

### Custom or multi-tracker setup

```ts
import {
  registerErrorTrackers,
  createSentryAdapter,
  createPostHogAdapter,
  enableErrorTrackingAutoInstrumentation,
} from '@luckystack/error-tracking';

registerErrorTrackers([
  createSentryAdapter(), // initialize the Sentry SDK first
  createPostHogAdapter({ client: posthog }),
]);
enableErrorTrackingAutoInstrumentation();
```

`registerErrorTracker(s)` replaces the active list. `appendErrorTracker` adds or replaces one tracker by `name` without clobbering the others.

## Backend-neutral API

| Export | Purpose |
| --- | --- |
| `registerErrorTracker(tracker)` | Replace the list with one adapter. |
| `registerErrorTrackers(trackers)` | Replace the list with multiple adapters. |
| `appendErrorTracker(tracker)` | Append/de-duplicate one adapter by name. |
| `getActiveErrorTrackers()` | Snapshot active adapters. |
| `captureExceptionAcrossTrackers(...)` | Fan out an exception. |
| `captureMessageAcrossTrackers(...)` | Fan out a message. |
| `setErrorTrackerUser(...)` | Propagate fallback identity across adapters. Request handlers also use request-scoped identity. |
| `recordMetricAcrossTrackers(...)` | Emit through adapters that implement metrics. |
| `startSpanAcrossTrackers(...)` / `startSpanHandle(...)` | Delegate a span to the first adapter that supports it. |
| `flushErrorTrackers()` | Drain adapters that implement graceful flush. |
| `enableErrorTrackingAutoInstrumentation()` | Subscribe identity/span lifecycle handlers to framework hooks. Idempotent. |
| `createSentryAdapter(...)` | Wrap initialized `@sentry/node`. |
| `createDatadogAdapter(...)` | Wrap consumer-initialized `dd-trace` and optional `hot-shots`. |
| `createPostHogAdapter(...)` | Wrap a `posthog-node` client. |

The legacy `captureException`, `captureMessage`, `setSentryUser`, `startSpan`, `registerSentryConfig`, and `initializeSentry` exports remain intentionally Sentry-named compatibility APIs. New vendor-neutral integrations should use the registry surface above.

## Automatic signal flow

- Framework `tryCatch` calls dispatch exception capture through core, then across every registered adapter.
- API/sync request handling establishes request-scoped identity so concurrent users do not share tracker context.
- Auto-instrumentation hooks propagate identity, open/close request spans where supported, and clear fallback identity on logout.
- Graceful server shutdown flushes adapters that expose `flush()`.
- Built-in adapters scrub secret-bearing error/message strings; use each adapter's `beforeSend` to enforce project-specific filtering or PII policy.

There are no `apiError` or `syncError` hook subscriptions: handler failures flow through `tryCatch` and the central capture registry.

## Vendor-specific behavior

- **Sentry:** first-class exceptions/messages, contexts, user scope, spans, and SDK drain.
- **Datadog:** exceptions/messages become APM spans plus optional StatsD counters; custom metrics use `hot-shots`.
- **PostHog:** uses `captureException` when available, otherwise `$exception`; messages and metrics become custom events.

Datadog user fields become `usr.*` APM tags and PostHog identity may include email/username. Decide whether to omit or transform PII before calling the identity APIs.

## Deep docs

- [`docs/adapter-pattern.md`](./docs/adapter-pattern.md) — contract, fan-out, filtering, and built-in adapters.
- [`docs/auto-instrumentation.md`](./docs/auto-instrumentation.md) — hook and `tryCatch` signal flow.
- [`docs/sentry-integration.md`](./docs/sentry-integration.md) — dedicated Sentry compatibility and SDK behavior.
- [`docs/span-helpers.md`](./docs/span-helpers.md) — span ownership and lifecycle.

## License

MIT — see [LICENSE](../../LICENSE).
