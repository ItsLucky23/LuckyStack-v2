# Changelog

All notable changes to `@luckystack/presence` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-10-19

### Changed

- **Breaking:** only for a custom room-name formatter that returns a different name for purpose `'presence'` than for `'broadcast'`. Presence fan-out (`userAfk`, `userBack`, `userLeft`) and `getRoomPresence` now format content room names with `'broadcast'`, the purpose the sockets joined them under, so such a formatter no longer silences all presence. Such a formatter delivered no presence events before. The misleading startup warning about non-identity formatters is removed (see the 2026-10-19 amendment to ADR 0060). Upgrade: remove the `'presence'` branch from your formatter.

### Fixed

- **A user who reconnects while their disconnect grace window is being torn down is no longer announced as "left" and logged out.** The teardown stops once the user is back.
- **With several server instances, a refresh or reconnect that lands on another instance no longer gets the user announced as departed** and their session deleted when the old instance's grace window ends. The live-connection check sees sockets on every instance.
- **An idle user is announced as AFK once per idle period instead of once a minute**, and each AFK check looks up only that user's sockets instead of every socket in the cluster.
- **`LocationProvider` with an inline `searchParamFilter` array no longer re-sends the location on every parent render** (each send also cost a session write and an `onLocationUpdate` call). It sends only when the path or a forwarded query value changes.

## [0.12.0] - 2026-10-15

### Changed

- Requires Node.js 22.13 or newer (was 20). Node 20 stopped receiving security updates in April 2026, and the scaffold's lint toolchain (ESLint 10) needs 22.13.

## [0.11.0] - 2026-10-14

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
