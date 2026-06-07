# Changelog

All notable changes to `@luckystack/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5]

### Removed

- **`DNS` dropped from the env schema.** It was a reserved/legacy var that
  conflated the backend origin (OAuth callback host) with the public origin
  (where users browse). Projects now derive the backend origin from
  `SERVER_IP`/`SERVER_PORT` and set the public origin via `app.publicUrl` (see the
  scaffold's `config.ts`). Leftover `DNS=` lines in existing `.env` files are
  harmless — the schema is `loose()`, so unknown keys pass through ignored.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
