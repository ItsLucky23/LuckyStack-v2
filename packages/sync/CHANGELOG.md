# Changelog

All notable changes to `@luckystack/sync` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Named production topology environments no longer enable development-only loopback rate-limit bypasses for socket or HTTP sync invocation.

## [0.8.0] - 2026-07-27

### Added

- `syncRequest` can invoke owning services through HTTP/SSE in routed transport mode while callbacks, rooms and fanout continue over the single Socket.io connection.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
