# Changelog

All notable changes to `@luckystack/presence` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Type declarations are emitted per source file by TypeScript 7 (`tsc -b`) instead of one bundled `.d.ts` per entry, so the framework build no longer runs package by package. The exported types are unchanged; relative imports inside the declarations carry `.js`, so `moduleResolution: "node16"`/`"nodenext"` projects resolve them as before.
- Package design guidance now ships as `AGENTS.md`, not `CLAUDE.md`. Handwritten docs focus on rationale and safety; exact API contracts remain in installed declarations/source.

## [0.10.0] - 2026-09-03

### Changed

- The activity sampler and the multi-tab disconnect guard read the Socket.io server with `getIoInstance({ raw: true })` and carry explicit `luckystack/no-local-socket-enumeration` opt-outs: each instance samples the sockets it owns, by design (`lastActivityBySocket` is local state). No behaviour change. **Known limitation, reported and NOT fixed here:** the multi-tab guard in `lifecycle.ts` does not see a live tab for the same session on another instance.

## [0.8.4] - 2026-08-17

### Changed

- Corrected install/dependency documentation so Socket.io, login, React, and React Router are presented as optional peers for their respective server/client integrations.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
