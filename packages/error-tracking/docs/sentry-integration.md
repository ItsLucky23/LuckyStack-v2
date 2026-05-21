# Sentry integration

> Two ways to ship Sentry with LuckyStack — the legacy single-instance entry
> (`initializeSentry()`) and the multi-tracker adapter entry
> (`createSentryAdapter()`) — plus the per-package config registry
> (`registerSentryConfig`) that keeps Sentry-specific knobs out of
> `@luckystack/core`'s `ProjectConfig`.

## Two integration paths

LuckyStack supports two ways to wire Sentry. Both can coexist during migration;
the framework's own call sites fan out through whichever path is active.

### Path 1: legacy `initializeSentry()` (singleton-style)

Predates the multi-adapter registry. Reads env, calls `Sentry.init`, and wires
the shared DI surface (`initSharedSentry`) so framework code can dispatch
without depending on `@sentry/node` directly.

```ts
import { initializeSentry } from '@luckystack/error-tracking';
import { createLuckyStackServer } from '@luckystack/server';

initializeSentry();

const server = await createLuckyStackServer({ /* ... */ });
await server.listen();
```

### Path 2: adapter-style `createSentryAdapter()` (new)

Wraps the live `@sentry/node` SDK into the framework's backend-agnostic
`ErrorTracker` shape and registers it via `registerErrorTracker(...)`. Use this
when you want Sentry alongside another tracker (Datadog, PostHog, custom):

```ts
import * as Sentry from '@sentry/node';
import {
  registerErrorTrackers,
  createSentryAdapter,
  createDatadogAdapter,
  createPostHogAdapter,
} from '@luckystack/error-tracking';

Sentry.init({ dsn: process.env.SENTRY_DSN /* ... */ });

registerErrorTrackers([
  createSentryAdapter(),
  createDatadogAdapter({ tracer, statsd }),
  createPostHogAdapter({ client: posthog }),
]);
```

You can also use both paths together — `initializeSentry()` is still
responsible for Sentry SDK init + `beforeSend` cookie redaction, and
`registerErrorTracker(createSentryAdapter())` adds the SAME backend to the
fan-out registry. The legacy DI surface (`captureException`, `captureMessage`,
`setSentryUser`, `startSpan`) routes through BOTH paths after the migration so
no events are dropped.

## `initializeSentry()` — what it actually does

Source: `packages/error-tracking/src/sentry.ts`.

```ts
export const initializeSentry = () => {
  const dsn = process.env.SENTRY_DSN ?? process.env.VITE_SENTRY_DSN;
  const isProduction = process.env.NODE_ENV === 'production';
  const enabledOverride = process.env.SENTRY_ENABLED ?? process.env.VITE_SENTRY_ENABLED;

  if (!dsn) {
    if (process.env.NODE_ENV === 'production') {
      getLogger().warn('SENTRY_DSN not configured. Error monitoring disabled.');
    }
    return;
  }

  const sentryConfig = getSentryConfig().server;
  const tracesSampleRate = isProduction
    ? sentryConfig?.tracesSampleRate?.production ?? 0.2
    : sentryConfig?.tracesSampleRate?.development ?? 1;
  const ignoreErrors = sentryConfig?.ignoreErrors ?? ['Socket connection timeout', 'ECONNREFUSED'];

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate,
    serverName: getProjectName(),
    enabled: isProduction || enabledOverride === 'true',
    ignoreErrors,
    beforeSend(event) {
      if (event.request?.cookies) {
        delete event.request.cookies;
      }
      return event;
    },
  });

  initSharedSentry({
    captureException: (exception, context) => Sentry.captureException(exception, context),
    captureMessage:   (message, level)     => Sentry.captureMessage(message, level),
    setUser:          (user)               => { Sentry.setUser(user); },
    setContext:       (key, context)       => { Sentry.setContext(key, context); },
    startInactiveSpan:(context)            => Sentry.startInactiveSpan(context),
  });

  getLogger().info('Sentry initialized for error monitoring');
};
```

Behavior summary:

- **DSN lookup**: `SENTRY_DSN` -> `VITE_SENTRY_DSN`. Missing DSN -> no-op.
  Warns ONLY in production (so dev/test boots stay quiet).
- **Sample rate**: from `registerSentryConfig({ server: { tracesSampleRate } })`,
  branched on `NODE_ENV === 'production'`. Defaults: `0.2` in production,
  `1` in development.
- **`ignoreErrors`**: from `registerSentryConfig({ server: { ignoreErrors } })`.
  Default: `['Socket connection timeout', 'ECONNREFUSED']`. Pass an empty
  array to disable filtering.
- **`enabled` gating**: defaults to `NODE_ENV === 'production'`. Force-enable
  outside production by setting `SENTRY_ENABLED=true` (or
  `VITE_SENTRY_ENABLED=true`).
- **`serverName`**: resolved via `getProjectName()` from `@luckystack/core` —
  honors `registerProjectConfig({ session: { projectName } })` overrides, then
  falls back to the `PROJECT_NAME` env var, then `'luckystack'`.
- **`beforeSend` cookie redaction**: every event has `event.request.cookies`
  removed before transmit. This is the minimum redaction layer; add domain
  knowledge via `registerRedactedLogKeys(...)` in `@luckystack/core` for
  breadcrumb redaction.
- **Shared DI wiring**: `initSharedSentry({ ... })` registers `captureException`,
  `captureMessage`, `setUser`, `setContext`, and `startInactiveSpan` so
  framework code reaches Sentry through `@luckystack/core`'s legacy slot
  (no direct `@sentry/node` import in `@luckystack/api`, `@luckystack/sync`,
  or `@luckystack/login`).

The function is idempotent — calling it twice does NOT re-init the SDK (Sentry
handles that internally), but it WILL re-register the shared DI surface, which
is harmless.

## Legacy helper exports

These four functions live in `packages/error-tracking/src/sentry.ts` and
forward to the shared DI surface set up by `initSharedSentry`. They are NOT
direct calls into `@sentry/node` — they go through `@luckystack/core`'s
`sentrySetup.ts`, which also fans out to the multi-tracker registry. That
means migrating to `registerErrorTracker(createSentryAdapter())` does not
break consumers still importing these helpers.

```ts
captureException(error: unknown, context?: Record<string, unknown>): void;

captureMessage(
  message: string,
  level?: 'info' | 'warning' | 'error' | 'fatal', // default 'info'
  context?: Record<string, unknown>,
): void;

setSentryUser(user: { id?: string; email?: string; username?: string } | null): void;

startSpan(name: string, op: string): unknown; // returns the live inactive span
```

When no DSN is configured AND no adapter is registered, all four are no-ops —
safe to leave in production code unconditionally.

## `createSentryAdapter(options?)` — adapter entry

Source: `packages/error-tracking/src/adapters/sentry.ts`.

```ts
interface SentryAdapterOptions {
  /**
   * Optional before-send hook applied to every event the framework emits
   * through this adapter. Return null to drop. Receives an `ErrorTrackerEvent`
   * — payload includes the original error / message + extras.
   */
  beforeSend?: (event: ErrorTrackerEvent) => ErrorTrackerEvent | null;
}

createSentryAdapter(options?: SentryAdapterOptions): ErrorTracker;
```

Lazy-loads `@sentry/node` via `createRequire(import.meta.url).resolve('@sentry/node')`.
Missing peer-dep produces a hard boot error:

```
[error-tracking:sentry] The `@sentry/node` package is not installed but
createSentryAdapter() was called. Run `npm install @sentry/node` or remove
the Sentry registration.
```

The adapter returns:

```ts
{
  name: 'sentry',
  captureException(error, context),
  captureMessage(message, level, context),
  setUser(user),
  setContext(key, context),
  startSpan(name, op, fn),
  beforeSend: options.beforeSend,
}
```

`startSpan` uses the active-span API (`Sentry.startSpan({ name, op }, fn)`),
not the inactive-span API used by the legacy `startSpan(name, op)` helper.
See `span-helpers.md` for the difference.

## Migration path: singleton -> registry

Recommended progression for an existing project on the legacy entry:

1. **Pin the call sites.** Existing `captureException` / `captureMessage` /
   `setSentryUser` / `startSpan` imports from `@luckystack/error-tracking`
   continue to work unchanged. They route through `@luckystack/core`'s shared
   slot AND through the multi-tracker registry (see
   `packages/core/src/sentrySetup.ts`). No code changes required.
2. **Keep `initializeSentry()` at boot.** It still owns Sentry SDK init,
   `beforeSend` cookie redaction, and shared DI wiring. Don't replace it
   with `Sentry.init` until you no longer need the legacy helpers.
3. **Add `registerErrorTracker(createSentryAdapter())` after `initializeSentry()`**
   when you want a second backend alongside Sentry. The same exception now
   flows to Sentry twice (once via the legacy DI slot, once via the adapter
   fan-out), but Sentry's SDK deduplicates by event id so dashboards stay
   clean. To strip the legacy path, drop `initializeSentry()` and call
   `Sentry.init(...)` directly in your server entry — but you lose the
   built-in `beforeSend` cookie redaction and config-registry-driven sample
   rate, so re-implement those manually if you do.
4. **Switch new code to `registerErrorTrackers([...])`** with multiple
   adapters. Use this when adding Datadog / PostHog / custom backends:

   ```ts
   import * as Sentry from '@sentry/node';
   import {
     initializeSentry,
     registerErrorTrackers,
     createSentryAdapter,
     createDatadogAdapter,
   } from '@luckystack/error-tracking';

   initializeSentry();
   registerErrorTrackers([
     createSentryAdapter(),
     createDatadogAdapter({ tracer, statsd }),
   ]);
   ```

5. **Remove the legacy entry** once every call site goes through
   `captureExceptionAcrossTrackers` / `captureMessageAcrossTrackers` /
   `setErrorTrackerUser` instead of the legacy helpers. The framework's own
   call sites (`@luckystack/api`, `@luckystack/sync`, `@luckystack/login`)
   still use the legacy helpers; until those migrate, keep
   `initializeSentry()` in your boot path.

## Config registry: `registerSentryConfig` / `getSentryConfig`

Sentry-specific runtime knobs (sample rates, ignoreErrors, replay sample
rates) live in `@luckystack/error-tracking`'s own config registry — NOT in
`@luckystack/core`'s `ProjectConfig`. Rationale: installers that ship without
error tracking should not see Sentry knobs in their config bag.

Source: `packages/error-tracking/src/sentryConfig.ts`.

### Types

```ts
export interface SentrySampleRates {
  development: number;
  production: number;
}

export interface SentryClientConfig {
  tracesSampleRate?: SentrySampleRates;
  replaysSessionSampleRate?: SentrySampleRates;
  replaysOnErrorSampleRate?: SentrySampleRates;
}

export interface SentryServerConfig {
  tracesSampleRate?: SentrySampleRates;
  /**
   * Errors matching any of these strings are not sent to Sentry. Default
   * `['Socket connection timeout', 'ECONNREFUSED']`. Set to an empty array
   * to disable filtering, or extend with installer-specific noise.
   */
  ignoreErrors?: string[];
}

export interface SentryConfig {
  client?: SentryClientConfig;
  server?: SentryServerConfig;
}

export type SentryConfigInput = DeepPartial<SentryConfig>;
```

### `DEFAULT_SENTRY_CONFIG`

```ts
export const DEFAULT_SENTRY_CONFIG: SentryConfig = {
  server: {
    ignoreErrors: ['Socket connection timeout', 'ECONNREFUSED'],
  },
};
```

`tracesSampleRate` is intentionally absent from the default — `initializeSentry()`
applies the `0.2` / `1` production/development split when no rate is registered.

### `registerSentryConfig(input)` / `getSentryConfig()`

```ts
export const registerSentryConfig = (config: SentryConfigInput): void => {
  activeConfig = deepMerge(DEFAULT_SENTRY_CONFIG, config);
};

export const getSentryConfig = (): SentryConfig => activeConfig;
```

Deep-merges over `DEFAULT_SENTRY_CONFIG`. Call once at boot, BEFORE
`initializeSentry()`:

```ts
import {
  registerSentryConfig,
  initializeSentry,
} from '@luckystack/error-tracking';

registerSentryConfig({
  server: {
    tracesSampleRate: { development: 1, production: 0.1 },
    ignoreErrors: [
      'Socket connection timeout',
      'ECONNREFUSED',
      'ResizeObserver loop limit exceeded',
    ],
  },
  client: {
    tracesSampleRate: { development: 1, production: 0.1 },
    replaysSessionSampleRate: { development: 0, production: 0.05 },
    replaysOnErrorSampleRate: { development: 0, production: 1 },
  },
});

initializeSentry();
```

Calling `registerSentryConfig` AFTER `initializeSentry()` has no effect on the
SDK — `Sentry.init` snapshots the config at call time. It does affect any
later call that re-reads `getSentryConfig()`, but no built-in path does that.

### Why this lives in `@luckystack/error-tracking`

Three reasons:

1. **Optional dep isolation.** `ProjectConfig` is imported by every framework
   package via `@luckystack/core`. Putting Sentry knobs there would force
   every consumer to know about Sentry even if they never install it.
2. **Per-package config ownership.** Mirrors `@luckystack/presence`'s
   `registerPresenceConfig`, `@luckystack/email`'s `registerEmailConfig`,
   etc. Each package owns its own runtime knobs; `ProjectConfig` stays small.
3. **Test isolation.** `activeConfig` is a module-level let bound to
   `DEFAULT_SENTRY_CONFIG`. Tests can reset it by re-importing the module
   with `vi.resetModules()` (no shared singleton with `@luckystack/core`).

## Env var summary

| Env var | Read by | Effect |
|---|---|---|
| `SENTRY_DSN` | `initializeSentry()` | DSN. Missing -> no-op. |
| `VITE_SENTRY_DSN` | `initializeSentry()` | Fallback for Vite-style envs. |
| `SENTRY_ENABLED` | `initializeSentry()` | `'true'` force-enables outside production. |
| `VITE_SENTRY_ENABLED` | `initializeSentry()` | Fallback for Vite-style envs. |
| `NODE_ENV` | `initializeSentry()` | Selects `tracesSampleRate.development` vs `.production`, gates `enabled`, sets `environment`. |
| `PROJECT_NAME` | `getProjectName()` | Sentry `serverName` fallback. |

Datadog / PostHog env vars are consumed by THEIR SDKs before being handed to
`createDatadogAdapter` / `createPostHogAdapter` — `@luckystack/error-tracking`
does not read them directly. See `adapter-pattern.md` for the per-adapter
contract.

## Related

- Adapter contract + multi-tracker registry: `./adapter-pattern.md`.
- Span helpers + `SpanResult<T>` history: `./span-helpers.md`.
- Framework hook touchpoints: `./auto-instrumentation.md`.
- Source: `packages/error-tracking/src/sentry.ts`,
  `packages/error-tracking/src/sentryConfig.ts`,
  `packages/error-tracking/src/adapters/sentry.ts`.
- Legacy DI surface (fan-out to registry): `packages/core/src/sentrySetup.ts`.
