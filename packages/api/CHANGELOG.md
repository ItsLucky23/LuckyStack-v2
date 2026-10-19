# Changelog

All notable changes to `@luckystack/api` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-10-19

### Fixed

- **Breaking:** a `preApiValidate` hook that returns a stop signal now blocks the request on both the socket and HTTP transports. The client gets the signal's `errorCode` with its `httpStatus` (default 403), and the route handler does not run. Before, the stop was silently ignored. Upgrade: review every `preApiValidate` handler that returns `{ stop: true, ... }`; those requests are now rejected, as the hook contract always promised.
- **HTTP API respond hooks** (`preApiRespond`, `transformApiResponse`, `postApiRespond`) **and the error formatter get the canonical route name.** Before, they got the request's raw spelling, so a trailing slash, backslash or surrounding whitespace could get past redaction or audit filters keyed by route.
- **Socket API `apiAuthRejected` gets the canonical route name** instead of the raw message name, so spelling variants of one route share one throttle key, as they already did over HTTP.
- **`api.requestTimeoutMs: 0`, or any negative value, disables the server-side API timeout** on both transports, as the client already read it. Before, every request that awaited I/O returned `api.timeout` (504).
- **`preApiRespond`, `transformApiResponse` and `postApiRespond` payloads carry the documented `transport` tag** (`'socket'` or `'http'`) on both transports, for success and error responses.

## [0.12.0] - 2026-10-15

### Changed

- Requires Node.js 22.13 or newer (was 20). Node 20 stopped receiving security updates in April 2026, and the scaffold's lint toolchain (ESLint 10) needs 22.13.

## [0.11.0] - 2026-10-14

### Changed

- Type declarations are emitted per source file by TypeScript 7 (`tsc -b`) instead of one bundled `.d.ts` per entry, so the framework build no longer runs package by package. The exported types are unchanged; relative imports inside the declarations carry `.js`, so `moduleResolution: "node16"`/`"nodenext"` projects resolve them as before.
- Package design guidance now ships as `AGENTS.md`, not `CLAUDE.md`. Handwritten docs focus on rationale and safety; exact API contracts remain in installed declarations/source.

## [0.8.4] - 2026-08-17

### Changed

- Corrected consumer documentation for optional Prisma/error-tracking dependencies, registered-tracker capture, generated-type rule links, and stale freshness metadata.

## [0.8.1] - 2026-07-27

### Fixed

- Named deployment environments no longer enable development-only loopback rate-limit bypasses when `NODE_ENV=production`.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
