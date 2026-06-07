# Changelog

All notable changes to `create-luckystack-app` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5]

### Fixed

- **AI dev-instructions scaffold option now actually works.** The framework AI
  docs (`CLAUDE.md`, `docs/`, `skills/`, `.claude/commands`, `branch-logs/README.md`)
  were copied from the monorepo root, which is absent in a published install — so
  selecting "include AI instructions" silently copied nothing. They are now
  bundled into the package at build time (`framework-docs/`) and copied from there.
- **OAuth multi-select toggle on Windows.** The spacebar now toggles a provider
  whether the console reports it as `key.name === 'space'` or only as the raw
  `' '` string (some Windows consoles do the latter), so providers can be selected.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
