# Auto-instrumentation via the core hook bus

> What `@luckystack/error-tracking` wires into the framework for you, and
> where each signal originates. As of 2026-05-21 the wiring is **hook-based**
> — `@luckystack/api` and `@luckystack/sync` no longer import this package
> directly. See `/docs/MIGRATION_HOOK_BASED_ERROR_TRACKING.md` for the
> migration history.

## The two wiring layers

LuckyStack instruments errors through TWO complementary layers:

1. **The shared DI surface in `@luckystack/core`.** `initializeSentry()` calls
   `initSharedSentry({ captureException, captureMessage, setUser, setContext,
   startInactiveSpan })`, which gives `@luckystack/core/src/sentrySetup.ts`
   live function pointers into `@sentry/node` without taking a build-time
   dep. The auto-instrumentation handlers in this package then forward to
   those slot helpers.
2. **The multi-tracker adapter registry in `@luckystack/core`.** Every helper
   also fans out through `captureExceptionAcrossTrackers` /
   `captureMessageAcrossTrackers` / `setErrorTrackerUser` /
   `startSpanAcrossTrackers`. Adapters registered via
   `registerErrorTracker(createSentryAdapter())` (or `createDatadogAdapter`,
   `createPostHogAdapter`, custom) receive the same signals.

Both layers run on every capture call — see
`packages/core/src/sentrySetup.ts`:

```ts
export const captureException = (error, context) => {
  if (sentry) {
    if (context) sentry.captureException(error, { extra: context });
    else         sentry.captureException(error);
  }
  captureExceptionAcrossTrackers(error, context);
};
```

This means a project that only calls `initializeSentry()` still benefits from
the registry (it's just empty) and a project that only calls
`registerErrorTracker(createSentryAdapter())` still benefits from the legacy
helpers used by framework packages (because the adapter fan-out picks them
up).

## Hook subscriptions

`enableErrorTrackingAutoInstrumentation()` registers the following handlers
on the core hook bus. Calling `initializeSentry()` runs this internally — you
only need to invoke it manually when your boot path skips `initializeSentry`
(adapter-only flows).

| Hook | Handler effect |
| --- | --- |
| `preApiValidate` | `setSentryUser(payload.user)` — earliest API hook that carries the resolved session. |
| `preApiExecute` | Opens a span via `startSpan(routeName, op)` where `op` is `api.request.http` when `payload.transport === 'http'` and `api.request` otherwise. Pinned on the payload via WeakMap. |
| `postApiExecute` | Looks up the WeakMap-pinned span and calls `span.end()`. |
| `preSyncAuthorize` | `setSentryUser(payload.user)` — first sync hook carrying the session. Fires for both socket and HTTP transports (the HTTP handler dispatches this hook so identity flows there as well). |
| `preSyncFanout` | Opens a `sync.request.http` span ONLY when `payload.transport === 'http'`. Socket fanout keeps the legacy "no-span" behavior. |
| `postSyncFanout` | Closes the HTTP-only sync span. |

### WeakMap span pinning

Spans are pinned on the payload object via two module-scoped `WeakMap`s
(`apiSpans`, `syncSpans`). The framework handlers in `@luckystack/api` and
`@luckystack/sync` construct each payload exactly once and pass the SAME
reference through the pre/post pair, so the WeakMap lookup in `postApi*` /
`postSync*` always finds the right span. Mutating `result` / `error` /
`durationMs` / `recipientCount` in place between dispatches is intentional —
those fields are observed by-name, not by snapshot.

If a future change clones the payload between dispatches (object-spread, JSON
round-trip), span pinning silently breaks. The smoke test is: log
`apiSpans.size` after both hooks fire and confirm it returns to zero (the
WeakMap entry is collected once `payload` is no longer referenced).

### `postLogout` is auto-wired (eager identity-clear)

`enableErrorTrackingAutoInstrumentation()` registers a `postLogout` handler
that calls `setSentryUser(null)` immediately on logout. This avoids a window
where the next anonymous request from the same socket would still show the
logged-out user in the error-tracker context (until `preApiValidate`
naturally clears it on the next API call).

Implementation uses a **type-only import** from `@luckystack/login`:

```ts
import type { PostLogoutPayload } from '@luckystack/login';
```

This pulls login's module augmentation of `HookPayloads` (which adds the
`postLogout` key) into scope so TypeScript accepts the
`registerHook('postLogout', ...)` call. The import is erased at compile time
— no runtime cycle between `@luckystack/error-tracking` and
`@luckystack/login`. The hook key (`'postLogout'`) is just a string lookup
against the core hook bus, so login does not need to be loaded at runtime.

Build-graph note: `@luckystack/login` is declared as a `devDependency` of
`@luckystack/error-tracking` for the DTS resolution above, and
`scripts/buildPackages.mjs` schedules `login` in an earlier wave than
`error-tracking` so its `dist/index.d.ts` exists when tsup's DTS emit runs.

Consumers who only use a custom error-tracker adapter (no Sentry SDK at
all) still get this identity-clear automatically once they call
`enableErrorTrackingAutoInstrumentation()` after `registerErrorTracker(...)`.

## `tryCatch` integration (unchanged)

Source: `packages/core/src/tryCatch.ts`.

```ts
import { captureException } from './sentrySetup';

export default async function tryCatch<T, P>(
  func: (values: P) => Promise<T> | T,
  params?: P,
  context?: Record<string, unknown>
): Promise<[Error | null, T | null]> {
  try {
    const response = await func(params as P);
    return [null, response];
  } catch (error) {
    captureException(error, context);
    return [error as Error, null];
  }
}
```

Every `tryCatch` invocation forwards its caught error to `captureException`
with the call-site-provided `context`. This is THE primary instrumentation
hook for consumer-code errors. The behavior is identical pre- and post-
migration.

## Cross-package signal flow summary

```
   Consumer code              Framework hooks          Error tracking
   (_api / _sync / page)      (api / sync / core)      (this package)

   throw new Error()
                  tryCatch (core)
                  captureException ─ (sentrySetup) ──────────────────┐
                                                                     │
                                            Sentry shared DI slot ◄──┤
                                            adapter registry ◄───────┘


   request arrives
                  preApiValidate / preSyncAuthorize ──────────────┐
                                                                  │
                                       registerHook subscribers ◄─┤
                                       → setSentryUser(user)      │
                                                                  │
                  preApiExecute / preSyncFanout (transport=http) ─┤
                                                                  │
                                       → startSpan(...)           │
                                       → WeakMap.set(payload, sp) │
                                                                  │
                  postApiExecute / postSyncFanout ────────────────┘
                                       → WeakMap.get(payload).end()
```

## Redaction layers

Cookie redaction is wired by `initializeSentry()`'s `Sentry.init({ beforeSend })`:

```ts
beforeSend(event) {
  if (event.request?.cookies) {
    delete event.request.cookies;
  }
  return event;
}
```

This applies to ANY event the Sentry SDK transmits (including ones the SDK
captures automatically without a framework call site, e.g. unhandled
rejections). The redaction operates on the Sentry event shape, not the
`ErrorTrackerEvent` shape — it cannot run on Datadog / PostHog / custom
adapters. Use those adapters' `beforeSend` option to apply equivalent
redaction:

```ts
import {
  createSentryAdapter,
  createDatadogAdapter,
  registerErrorTrackers,
} from '@luckystack/error-tracking';

const stripSecrets = (event) => {
  const ctx = (event.payload.context as Record<string, unknown> | undefined) ?? null;
  if (ctx) {
    delete ctx.password;
    delete ctx.token;
    delete ctx.sessionToken;
  }
  return event;
};

registerErrorTrackers([
  createSentryAdapter({ beforeSend: stripSecrets }),
  createDatadogAdapter({ tracer, statsd, beforeSend: stripSecrets }),
]);
```

For BREADCRUMB key redaction (Sentry breadcrumb payloads from API/sync
context logging), use `registerRedactedLogKeys(['password', 'token', ...])`
from `@luckystack/core`. The framework's hot paths consult
`isRedactedLogKey(key)` before logging values.

## Adapter-only quickstart

A consumer that doesn't use Sentry can run the auto-instrumentation in two
calls:

```ts
import { tracer } from './tracer-init'; // dd-trace required FIRST
import { StatsD } from 'hot-shots';
import {
  registerErrorTracker,
  createDatadogAdapter,
  enableErrorTrackingAutoInstrumentation,
} from '@luckystack/error-tracking';

registerErrorTracker(createDatadogAdapter({ tracer, statsd: new StatsD() }));
enableErrorTrackingAutoInstrumentation();
```

The hook subscribers fire `setSentryUser` / `startSpan` — but with no Sentry
SDK init those calls fan out only through the adapter registry to the
registered Datadog adapter. No Sentry transport is opened.

## Related

- Adapter contract + multi-tracker registry: `./adapter-pattern.md`.
- Sentry integration (legacy + adapter coexistence): `./sentry-integration.md`.
- Span helpers + `SpanResult<T>` history: `./span-helpers.md`.
- Migration history: `/docs/MIGRATION_HOOK_BASED_ERROR_TRACKING.md`.
- Core-side shared slot + dual dispatch: `packages/core/src/sentrySetup.ts`.
- Core-side registry: `packages/core/src/errorTrackerRegistry.ts`.
- Framework dispatch sites (hook-only after migration):
  - `packages/api/src/handleApiRequest.ts`
  - `packages/api/src/handleHttpApiRequest.ts`
  - `packages/sync/src/handleSyncRequest.ts`
  - `packages/sync/src/handleHttpSyncRequest.ts`
- Hook subscriber registration: `packages/error-tracking/src/autoInstrumentation.ts`.
