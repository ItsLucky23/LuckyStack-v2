# Changelog

All notable changes to `@luckystack/error-tracking` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
