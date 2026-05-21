# Error Tracker Registry

> Deep specs for the backend-agnostic error tracker registry + legacy Sentry slot. Source: `packages/core/src/errorTrackerRegistry.ts`, `sentrySetup.ts`. Bijgewerkt: 2026-05-20.

## Overview

The error tracker registry is the seam between framework code (which never imports a specific observability backend) and adapters for Sentry / Datadog / PostHog / etc. The slot lives in `@luckystack/core`; adapter implementations ship in `@luckystack/error-tracking`. Multiple adapters can be active at once via `registerErrorTrackers([...])` — every event fans out to all of them, and per-adapter errors are swallowed so one buggy tracker can't break the chain.

The legacy `initSharedSentry(instance)` + `captureException` / `captureMessage` / `setSentryUser` / `startSpan` API predates the multi-adapter registry. It is kept for backwards compatibility and dual-fans events through both the legacy slot AND any adapters registered with the new API, so a project can migrate incrementally.

`startSpanAcrossTrackers` deliberately invokes only the first adapter that supports `startSpan` — spans don't fan out cleanly because they're nested execution scopes.

## Types

```typescript
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
  forwarded: boolean;
  kind: 'exception' | 'message';
  payload: Record<string, unknown>;
}

export type SpanResult<T> = T;

export interface ErrorTracker {
  name: string;
  captureException: (error: unknown, context?: ErrorTrackerContext) => void;
  captureMessage: (
    message: string,
    level: 'info' | 'warning' | 'error' | 'fatal',
    context?: ErrorTrackerContext,
  ) => void;
  setUser: (user: ErrorTrackerUser | null) => void;
  setContext?: (key: string, context: ErrorTrackerContext | null) => void;
  startSpan?: <T>(name: string, op: string, fn: () => T) => T;
  recordMetric?: (name: string, value: number, tags?: Record<string, string>) => void;
  beforeSend?: (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;
}
```

`SpanResult<T>` is an alias for `T` — the conditional unwrap collapsed in both branches and `tsup`'s dts emit choked on the widening. Kept as an exported alias so adapter authors can still annotate intent.

## API Reference — Multi-Adapter Registry

### `registerErrorTracker(tracker: ErrorTracker): void`

**Behavior:** Replaces the active list with `[tracker]`. Use this for single-tracker setups.

### `registerErrorTrackers(trackers: ErrorTracker[]): void`

**Behavior:** Replaces the active list with a copy of the input array (`[...trackers]`). Use for multi-backend setups (Sentry + Datadog, etc.).

### `getActiveErrorTrackers(): ErrorTracker[]`

Returns the current array (the internal reference — treat as read-only).

### `captureExceptionAcrossTrackers(error, context?): void`

**Behavior:** For each active tracker, calls `tracker.captureException(error, context)` inside a per-tracker `try / catch` that silently swallows failures.

### `captureMessageAcrossTrackers(message, level, context?): void`

Same fan-out shape as `captureExceptionAcrossTrackers` for messages.

### `setErrorTrackerUser(user: ErrorTrackerUser | null): void`

Calls `tracker.setUser(user)` on every active tracker (errors swallowed).

### `recordMetricAcrossTrackers(name, value, tags?): void`

**Behavior:** Skips trackers that don't define `recordMetric`. Errors are swallowed.

### `startSpanAcrossTrackers<T>(name, op, fn): T`

**Behavior:**
- Finds the first tracker with a `startSpan` method.
- If found, returns `tracker.startSpan(name, op, fn)` cast to `T`.
- If none exist, returns `fn()` directly (no instrumentation).

**Why not fan-out:** Spans are nested execution scopes — invoking multiple `startSpan` implementations would nest each other and produce confusing traces.

### Example — register multiple adapters

```typescript
import { registerErrorTrackers, type ErrorTracker } from '@luckystack/core';

const sentryAdapter: ErrorTracker = { /* ... */ };
const datadogAdapter: ErrorTracker = { /* ... */ };

registerErrorTrackers([sentryAdapter, datadogAdapter]);
```

## API Reference — Legacy Sentry Slot

### `initSharedSentry(instance: SentryInstance): void`

**Signature:**
```typescript
interface SentryInstance {
  captureException: (exception: unknown, ...args: unknown[]) => string;
  captureMessage: (message: string, ...args: unknown[]) => string;
  setUser: (user: unknown) => void;
  setContext: (key: string, context: unknown) => void;
  startInactiveSpan?: (context: unknown) => unknown;
}

export const initSharedSentry = (instance: SentryInstance): void
```

**Behavior:** Stores the Sentry SDK instance in a module-level slot. New code should `registerErrorTracker(...)` from `@luckystack/error-tracking` instead.

### `captureException(error, context?): void`

**Behavior:**
- When the legacy Sentry slot is populated, calls `sentry.captureException(error, { extra: context })` (or no second arg when no context).
- ALSO calls `captureExceptionAcrossTrackers(error, context)` so any modern adapters receive the same event.

**Concurrency note:** Context is passed inline via the hint-shaped second argument so contexts don't leak across concurrent captures. The previous implementation used `sentry.setContext('additional', context)` which was process-global and leaked under concurrent captures.

### `captureMessage(message, level?, context?): void`

**Behavior:** Mirror of `captureException` for messages. Level defaults to `'info'`.

### `setSentryUser(user): void`

Calls `sentry?.setUser(user)` and fans out via `setErrorTrackerUser(user)`.

### `startSpan(name, op): unknown`

**Behavior:**
- If `sentry?.startInactiveSpan` exists, returns `sentry.startInactiveSpan({ name, op })`.
- Otherwise falls back to `startSpanAcrossTrackers(name, op, () => undefined)` — useful when the project uses an adapter-only setup that supports spans.

## Edge cases

- All multi-adapter fan-out paths swallow per-tracker errors. There is no way to surface them — by design, since framework hot paths (`tryCatch`, hook dispatch) must never crash because of a misbehaving tracker.
- `registerErrorTracker` and `registerErrorTrackers` replace the active list — call once at boot. There is no `unregister` API.
- `beforeSend` and `forwarded` on `ErrorTrackerEvent` are advisory for adapter authors. Core does not call `beforeSend` itself; the adapter implementation is expected to honor it.

## Example — minimal custom adapter

```typescript
import { registerErrorTracker, type ErrorTracker } from '@luckystack/core';

const stdoutAdapter: ErrorTracker = {
  name: 'stdout',
  captureException: (error, context) => {
    console.error('exception:', error, context);
  },
  captureMessage: (message, level, context) => {
    console.log(`[${level}] ${message}`, context);
  },
  setUser: () => { /* no-op */ },
};

registerErrorTracker(stdoutAdapter);
```

## Related

- Function INDEX: `packages/core/AI_INDEX.md`
- Architecture: `docs/ARCHITECTURE_EXTENSION_POINTS.md`
- README: `packages/core/README.md`, `packages/error-tracking/README.md`
- Source: `packages/core/src/errorTrackerRegistry.ts`, `sentrySetup.ts`
