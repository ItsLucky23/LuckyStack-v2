# Changelog

All notable changes to `@luckystack/secret-manager` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0]

### Added

- Initial release. Rotation-aware secret resolver client: scans `process.env` for pointer-shaped values (`<BASE>_V<n>`), resolves them in one `POST /resolve` request against an external secret-manager server, and overwrites `process.env` with the real values. Supports `local` / `remote` / `hybrid` modes and opt-in dev hot reload (`.env` watch + interval poll). The companion append-only secret-manager server lives in its own repository (see `docs/architecture.md`).
