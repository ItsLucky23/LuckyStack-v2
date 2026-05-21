# Span helpers + `SpanResult<T>`

> The performance-tracing surface that `@luckystack/error-tracking` exposes.
> Two entry points (`startSpan(name, op)` for the legacy single-Sentry path,
> `startSpanAcrossTrackers(name, op, fn)` for the multi-tracker registry),
> three per-adapter behaviors, and one historical type alias to be aware of.

## Two entry points

### `startSpan(name, op)` — legacy single-Sentry inactive-span starter

```ts
import { startSpan } from '@luckystack/error-tracking';

const span = startSpan(name, op) as { end?: () => void } | undefined;
try {
  // ... do work ...
} finally {
  span?.end?.();
}
```

Source: `packages/error-tracking/src/sentry.ts` -> forwards to
`sharedStartSpan` in `@luckystack/core/src/sentrySetup.ts` -> calls
`Sentry.startInactiveSpan({ name, op })` (wired by `initSharedSentry`).

Behavior:

- Returns the live INACTIVE span object — caller is responsible for calling
  `.end()` (or `.finish()` on older Sentry SDKs) themselves.
- The return type is `unknown` because the underlying span type comes from
  `@sentry/node` and we don't want a transitive type dep across framework
  packages. Cast to `{ end?: () => void }` at the call site, as
  `@luckystack/api`'s `handleApiRequest.ts` and `handleHttpApiRequest.ts` do.
- Returns `undefined` (effectively) when no Sentry instance is wired AND no
  adapter is registered. The legacy DI slot returns whatever
  `Sentry.startInactiveSpan(...)` returns; when not wired, it falls through
  to `startSpanAcrossTrackers(name, op, () => undefined)`, which returns
  `undefined` directly.
- Used at the framework's existing call sites:
  - `packages/api/src/handleApiRequest.ts` -> `'api.request'`
  - `packages/api/src/handleHttpApiRequest.ts` -> `'api.request.http'`
  - `packages/sync/src/handleHttpSyncRequest.ts` -> `'sync.request.http'`

The Socket.io sync handler (`packages/sync/src/handleSyncRequest.ts`)
currently does NOT wrap fan-out in a span — only the HTTP fallback does. If
you want spans on the socket path, register an adapter and rely on the
multi-tracker entry below.

### `startSpanAcrossTrackers<T>(name, op, fn)` — multi-tracker entry

```ts
import { startSpanAcrossTrackers } from '@luckystack/error-tracking';

const result = startSpanAcrossTrackers('db.query.users', 'db', () => {
  return prisma.user.findMany();
});
```

Source: `packages/core/src/errorTrackerRegistry.ts` (re-exported from
`@luckystack/error-tracking`).

```ts
export const startSpanAcrossTrackers = <T>(name: string, op: string, fn: () => T): T => {
  //? Spans don't fan out cleanly to multiple backends — they're nested
  //? execution scopes. We only invoke the FIRST registered tracker's
  //? startSpan (others get notified via captureException paths if they
  //? want to instrument). When no tracker supports spans, run the fn directly.
  const first = activeTrackers.find((t) => t.startSpan);
  if (!first?.startSpan) return fn();
  return first.startSpan(name, op, fn) as T;
};
```

Behavior:

- Walks the registered adapter list (in the order passed to
  `registerErrorTrackers`) and picks the FIRST adapter that implements
  `startSpan`.
- That adapter is responsible for running `fn()` inside its span scope, then
  finishing/ending the span. The helper returns whatever `fn()` returns.
- When NO registered adapter implements `startSpan`, the helper invokes
  `fn()` directly so callers don't need to gate on registration — the span
  becomes a transparent pass-through.
- Spans deliberately do NOT fan out. Spans are nested execution scopes with
  vendor-specific context propagation rules (active span, baggage, trace
  parent, etc.); running the same `fn` inside multiple vendors' span scopes
  at once would produce conflicting active-span state. Cross-backend trace
  correlation belongs at the dashboard layer (e.g. shared `trace_id` via
  OpenTelemetry), not in this helper.

### When to use which

- **`startSpan(name, op)`**: existing code paths that already call it
  (`@luckystack/api`, `@luckystack/sync` HTTP fallback). Keep using it during
  migration — it forwards to the same shared DI slot, so it still works after
  you also register `createSentryAdapter()`.
- **`startSpanAcrossTrackers(name, op, fn)`**: new code paths. Function form
  (`fn` callback) is safer than the inactive-span form because the helper
  guarantees `finish()` is called even when `fn` throws (see Datadog adapter's
  `try/finally`).

## Per-adapter span behavior

### Sentry (`createSentryAdapter`)

```ts
startSpan(name, op, fn) {
  return sentry.startSpan({ name, op }, fn);
}
```

Uses Sentry's ACTIVE-SPAN API (`Sentry.startSpan(context, callback)`), not the
inactive-span API used by the legacy `startSpan(name, op)` helper. Active
spans become the current span for the duration of `fn`, so nested
`Sentry.startSpan` calls inside `fn` will attach as children automatically.
Finishes the span when `fn` resolves or throws.

### Datadog (`createDatadogAdapter`)

```ts
startSpan(name, op, fn) {
  const span = options.tracer.startSpan(name, { tags: { op } });
  try {
    return fn();
  } finally {
    span.finish();
  }
}
```

Starts a dd-trace span tagged with `op`, runs `fn`, finishes the span in a
`finally` block. Note: dd-trace's `tracer.startSpan` does NOT make the new
span the active span — that requires `tracer.scope().activate(span, fn)`. The
adapter intentionally keeps it simple; if you need active-span propagation
for nested instrumentation, wrap `fn` in `tracer.scope().activate(span, fn)`
inside a custom adapter.

### PostHog (`createPostHogAdapter`)

No `startSpan` implementation. PostHog doesn't model distributed traces —
it's a product-analytics platform with discrete event capture. If you need
APM, register Datadog or Sentry alongside.

### No adapters registered

`startSpanAcrossTrackers` calls `fn()` directly. The legacy `startSpan(name, op)`
returns `undefined`. Either way, your code path runs unchanged.

## `SpanResult<T>` historical note

```ts
export type SpanResult<T> = T;
```

`SpanResult<T>` was originally a conditional type that unwrapped `Promise<T>`:

```ts
// Earlier version (no longer in use):
export type SpanResult<T> = T extends Promise<infer U> ? Promise<U> : T;
```

Both branches collapsed to `T`, and tsup's `.d.ts` emitter choked on the
conditional widening during package builds (the type alias surfaced into
downstream packages with `T` already widened to `unknown`, which then
required `as unknown as SpanResult<...>` casts at every call site — exactly
the kind of unsafe cast pattern our strict-typing policy forbids).

It was simplified to a direct `type SpanResult<T> = T` alias and kept exported
so adapter authors can still annotate with `SpanResult<T>` for documentation
intent (e.g. "this function's return type matches the inner `fn`'s return
type, span machinery is transparent"). It is no longer functionally
necessary — `startSpanAcrossTrackers<T>(...): T` is the same shape.

```ts
import type { SpanResult } from '@luckystack/error-tracking';

const runQuery = <T>(fn: () => T): SpanResult<T> => {
  return startSpanAcrossTrackers('db.query', 'db', fn);
};
```

## Best practices

- **Wrap heavy work, not every line.** Spans are cheap but not free. Wrap
  `_api/*.ts` and `_sync/*.ts` handlers (already done by the framework's
  request transports), then any explicit database batch or external HTTP
  call. Don't span individual `prisma.x.findUnique` calls.
- **Use the function form.** `startSpanAcrossTrackers(name, op, fn)` is
  exception-safe (Datadog adapter uses `try/finally`); the legacy
  `startSpan(name, op)` form requires manual `.end()` and leaks spans on
  thrown exceptions.
- **Don't nest `startSpanAcrossTrackers` across packages.** If
  `@luckystack/api` already opens a span around the request, don't open
  another one inside the handler — Sentry will record them as children
  (good), but Datadog's inactive-by-default semantics will produce
  disconnected siblings (confusing). Re-use the surrounding span via
  vendor-specific active-span APIs inside a custom adapter if you need
  fine-grained nesting.
- **Don't cast the legacy return.** `startSpan(name, op)` returns `unknown`
  on purpose. The cast `as { end?: () => void } | undefined` at framework
  call sites is the documented contract — wider casts (e.g. `as Span`) tie
  call sites to `@sentry/node`'s span type and break when a non-Sentry
  adapter is the active backend.

## Related

- Adapter contract + multi-tracker registry: `./adapter-pattern.md`.
- Sentry integration (legacy `initializeSentry` vs `createSentryAdapter`):
  `./sentry-integration.md`.
- Framework call sites that wrap requests in spans:
  `./auto-instrumentation.md`.
- Source:
  - `packages/error-tracking/src/sentry.ts` (legacy `startSpan`).
  - `packages/core/src/errorTrackerRegistry.ts` (`startSpanAcrossTrackers`,
    `SpanResult<T>`).
  - `packages/error-tracking/src/adapters/{sentry,datadog,posthog}.ts` (per-adapter
    span behavior).
