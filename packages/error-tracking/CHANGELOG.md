# Changelog

All notable changes to `@luckystack/error-tracking` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
