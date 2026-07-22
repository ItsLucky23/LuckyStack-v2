# Changelog

All notable changes to `@luckystack/email` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.4] - 2026-07-22

### Added

- `sendEmail` accepts a cooperative `AbortSignal` and stable caller-provided
  idempotency key. Adapter context remains optional for backwards compatibility;
  Resend forwards the key to provider-native deduplication.

### Fixed

- Timeout/caller abort after provider dispatch now reports
  `deliveryOutcome: 'unknown'` instead of presenting “stopped waiting” as proof
  that delivery failed. Built-in adapters avoid dispatch when already aborted.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
