# @luckystack/error-tracking

> AI summary + function INDEX (referenced from root /CLAUDE.md as AI_INDEX.md). For deep specs see `docs/` next to this file.

## What this package does

Optional, pluggable error-tracking integration for LuckyStack. Ships a backend-agnostic `ErrorTracker` adapter contract (the contract + registry lives in `@luckystack/core` so framework code in `api` / `sync` / `server` can dispatch events without taking a dep on a specific observability backend) plus three built-in adapters: Sentry (`@sentry/node`), Datadog (`dd-trace` + `hot-shots`), and PostHog (`posthog-node`). Multiple adapters can be registered at once and every captured event fans out to all of them; per-adapter throws are swallowed so one buggy tracker cannot break the chain. Also exposes the legacy single-Sentry entry (`initializeSentry`, `captureException`, `captureMessage`, `setSentryUser`, `startSpan`) which auto-wires into the framework's hook surface (`apiError`, `syncError`, `preApiExecute`/`postApiExecute`, `preSyncFanout`/`postSyncFanout`, `postLogin`/`postLogout`) and is a safe no-op when `SENTRY_DSN` is missing.

## When to USE this package

- Production deploy needs error/exception capture, performance traces, or release health on top of the framework's `tryCatch` flow.
- Project wants to combine multiple observability backends (e.g. Sentry for errors + Datadog APM + PostHog product analytics) without writing fan-out plumbing.
- Custom backend (CloudWatch, New Relic, Honeybadger, Bugsnag, ...) needs to be slotted in — implement the `ErrorTracker` interface and call `registerErrorTracker(...)`.
- Per-package Sentry knobs (sample rates, ignoreErrors) need to be set without polluting `@luckystack/core`'s `ProjectConfig`.

## When to NOT suggest this (yet)

- Pure local dev / scratch projects with no production deploy — every export is a no-op without `SENTRY_DSN` or another tracker registration, so installing the package buys nothing.
- Audit-trail / "what happened?" use cases — that belongs in the future `@luckystack/monitoring` package (separate repo, see `docs/MONITORING.md`). Error-tracking covers the "why did it break?" half only.
- Frontend-only error capture — this package targets the server runtime. Client-side Sentry should be configured directly in the React entry, not through `initializeSentry()`.
- Custom transports that re-implement framework error capture — use the adapter pattern instead of forking; that is what the `ErrorTracker` contract exists for.

## Function Index

| Function / Export | One-liner | Deep doc |
|---|---|---|
| `registerErrorTracker(tracker)` | Replace the active tracker list with a single `ErrorTracker`. Idempotent. | -> docs/adapter-pattern.md |
| `registerErrorTrackers(trackers)` | Replace the active tracker list with multiple `ErrorTracker`s — every capture fans out to all of them. | -> docs/adapter-pattern.md |
| `getActiveErrorTrackers()` | Read the current adapter list (snapshot). | -> docs/adapter-pattern.md |
| `captureExceptionAcrossTrackers(error, context?)` | Fan-out exception capture. Per-tracker throws are swallowed. | -> docs/adapter-pattern.md |
| `captureMessageAcrossTrackers(message, level, context?)` | Fan-out message capture across all registered trackers. | -> docs/adapter-pattern.md |
| `setErrorTrackerUser(user)` | Propagate session identity to every registered tracker. | -> docs/adapter-pattern.md |
| `recordMetricAcrossTrackers(name, value, tags?)` | Fan-out custom metric emission (only trackers implementing `recordMetric`). | -> docs/adapter-pattern.md |
| `startSpanAcrossTrackers(name, op, fn)` | Run `fn` inside the FIRST registered tracker's span (spans do not fan out cleanly). Falls back to direct invocation if no tracker supports spans. | -> docs/span-helpers.md |
| `createSentryAdapter(options?)` | Build an `ErrorTracker` wrapping the live `@sentry/node` SDK. Boot-time peer-dep guard. | -> docs/sentry-integration.md |
| `createDatadogAdapter(options)` | Build an `ErrorTracker` wrapping a consumer-supplied `dd-trace` + `hot-shots` pair. Boot-time peer-dep guard. | -> docs/adapter-pattern.md |
| `createPostHogAdapter(options)` | Build an `ErrorTracker` wrapping a consumer-supplied `posthog-node` client. Boot-time peer-dep guard. | -> docs/adapter-pattern.md |
| `initializeSentry()` | Legacy entry — reads `SENTRY_DSN` + sample rates, calls `Sentry.init`, wires the shared DI surface via `initSharedSentry`, and internally calls `enableErrorTrackingAutoInstrumentation()` so hook subscribers are wired in one step. No-op without DSN. | -> docs/sentry-integration.md |
| `enableErrorTrackingAutoInstrumentation()` | Explicit opt-in for adapter-only consumers (no Sentry SDK). Registers hook subscribers on `preApiValidate`, `preApiExecute`, `postApiExecute`, `preSyncAuthorize`, `preSyncFanout`, `postSyncFanout` for identity propagation + span lifecycle. Idempotent. | -> docs/auto-instrumentation.md |
| `captureException(error, context?)` | Legacy single-Sentry helper. Forwards through the shared DI surface. | -> docs/sentry-integration.md |
| `captureMessage(message, level?, context?)` | Legacy single-Sentry helper for manual breadcrumbs. | -> docs/sentry-integration.md |
| `setSentryUser(user)` | Legacy single-Sentry user identity setter (called by `@luckystack/login` on login/logout). | -> docs/sentry-integration.md |
| `startSpan(name, op)` | Legacy single-Sentry inactive-span starter. | -> docs/span-helpers.md |
| `registerSentryConfig(input)` | Register Sentry-specific sample rates + ignoreErrors. Owned by this package, not part of `ProjectConfig`. | -> docs/sentry-integration.md |
| `getSentryConfig()` | Read the merged active `SentryConfig`. | -> docs/sentry-integration.md |
| `DEFAULT_SENTRY_CONFIG` | Default sample-rate + ignoreErrors values used until `registerSentryConfig` runs. | -> docs/sentry-integration.md |
| Types: `ErrorTracker`, `ErrorTrackerContext`, `ErrorTrackerUser`, `ErrorTrackerEvent`, `SpanResult<T>` | Adapter contract types (re-exported from `@luckystack/core`). | -> docs/adapter-pattern.md |
| Types: `SentryAdapterOptions`, `DatadogAdapterOptions`, `PostHogAdapterOptions` | Per-adapter option shapes. | -> docs/adapter-pattern.md |
| Types: `SentryConfig`, `SentryConfigInput`, `SentryClientConfig`, `SentryServerConfig`, `SentrySampleRates` | Sentry config registry types. | -> docs/sentry-integration.md |

## Config keys (env vars + registerSentryConfig slots)

- `SENTRY_DSN` / `VITE_SENTRY_DSN` (env, optional) — DSN read by `initializeSentry()`. Without it the legacy entry is a no-op (warns in production only).
- `SENTRY_ENABLED` / `VITE_SENTRY_ENABLED` (env, optional) — set to `'true'` to force-enable outside `NODE_ENV=production`.
- `NODE_ENV` (env, required for sample-rate branching) — selects `tracesSampleRate.development` vs `.production` and gates `enabled` by default.
- `DD_API_KEY`, `DD_SITE`, `DD_TRACE_AGENT_URL`, etc. (env, consumed by `dd-trace`) — read by the dd-trace SDK before it is handed to `createDatadogAdapter`. This package does not read them directly.
- `POSTHOG_KEY` / `POSTHOG_HOST` (env, consumed by `posthog-node`) — read by the PostHog SDK before it is handed to `createPostHogAdapter`. This package does not read them directly.
- `registerSentryConfig({ server: { tracesSampleRate, ignoreErrors }, client: { tracesSampleRate, replaysSessionSampleRate, replaysOnErrorSampleRate } })` — runtime config registry merged into `DEFAULT_SENTRY_CONFIG`.

## Peer dependencies

- **Required (runtime deps)**: `@luckystack/core`.
- **Peer (canonical ranges, all optional)**:
  - `@sentry/node@^10.48.0` — required only when `createSentryAdapter()` or `initializeSentry()` is called. Hard boot error otherwise.
  - `dd-trace@^5.0.0` — required only when `createDatadogAdapter(...)` is called. Hard boot error otherwise. Consumer MUST require dd-trace as the first import in the server entry.
  - `hot-shots@^10.0.0` — optional companion for `dd-trace` (metrics via StatsD). Adapter still captures exceptions without it.
  - `posthog-node@^4.0.0` — required only when `createPostHogAdapter(...)` is called. Hard boot error otherwise.

## Related

- Adapter pattern + multi-tracker registry: `./docs/adapter-pattern.md`.
- Sentry integration (legacy + adapter): `./docs/sentry-integration.md`.
- Span helpers + `SpanResult<T>` alias: `./docs/span-helpers.md`.
- Auto-instrumentation via framework hooks: `./docs/auto-instrumentation.md`.
- README (consumer quickstart): `./README.md`.
- Future strategy spec for the `@luckystack/monitoring` companion package: `/docs/MONITORING.md`.
