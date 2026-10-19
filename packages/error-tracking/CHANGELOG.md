# Changelog

All notable changes to `@luckystack/error-tracking` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-10-19

### Changed

- **Breaking:** the Datadog `error.exception` and `error.message` counters are tagged only with `source`, `fn`, `hook` and `method` (plus `error.type` on exceptions) instead of the whole capture context, so per-request values no longer each create a billed time series. APM spans keep the full context. Upgrade: dashboards that filter these counters on other keys must list those keys in the new `createDatadogAdapter({ metricTagKeys })` option (default `DEFAULT_DATADOG_METRIC_TAG_KEYS`).

### Fixed

- **An error from an anonymous request is no longer attributed to another user making a request at the same time** (Datadog `usr.*` tags, PostHog distinctId, Sentry user). Inside a request the request's own identity is used; the process-wide user from `setSentryUser` is only used outside any request (ADR 0085).
- **Breaking:** auto-instrumentation no longer sets the process-wide user on every API and sync request, and no longer clears it on logout. Upgrade: projects that wire Sentry through the deprecated `initSharedSentry` themselves no longer get the request user on their events; switch to `initializeSentry()` or register `createSentryAdapter()`.
- **The PostHog adapter no longer sends an `$identify` event (with the user's email) on every authenticated request.** It identifies again only when id, email or username changes.
- **Sentry and PostHog receive the scrubbed `error.cause` chain** (as a linked exception) and the scalar `code`, `responseCode`, `statusCode` and `status` fields, so the provider cause `@luckystack/email` attaches to batch reports is no longer lost.

## [0.12.0] - 2026-10-15

### Changed

- Requires Node.js 22.13 or newer (was 20). Node 20 stopped receiving security updates in April 2026, and the scaffold's lint toolchain (ESLint 10) needs 22.13.

## [0.11.0] - 2026-10-14

### Changed

- Type declarations are emitted per source file by TypeScript 7 (`tsc -b`) instead of one bundled `.d.ts` per entry, so the framework build no longer runs package by package. The exported types are unchanged; relative imports inside the declarations carry `.js`, so `moduleResolution: "node16"`/`"nodenext"` projects resolve them as before.
- Package design guidance now ships as `AGENTS.md`, not `CLAUDE.md`. Handwritten docs focus on rationale and safety; exact API contracts remain in installed declarations/source.

## [0.8.4] - 2026-08-17

### Changed

- Reworked the consumer quickstart around the generic multi-tracker registry and documented the distinct automatic Sentry/PostHog and first-import Datadog initialization paths; legacy Sentry APIs remain explicit compatibility surfaces.

## [0.8.1] - 2026-07-27

### Fixed

- Production error-tracking policy follows `NODE_ENV` while Sentry's environment label continues to use the named deploy topology.

## [0.7.4] - 2026-07-22

### Security

- PostHog and Datadog message adapters now spread caller context before their
  canonical scrubbed message/severity and request-bound identity fields. A
  colliding context key can no longer restore secret-bearing text, downgrade
  severity, or spoof `usr.*` attribution.

## [0.7.0] - 2026-07-16

### Security

- Raised the optional `@sentry/node` peer floor to `^10.66.0`. That line uses
  OpenTelemetry 2.9 and fixes the unbounded W3C Baggage allocation advisory
  GHSA-8988-4f7v-96qf present in the previous 2.7 transitive stack.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
