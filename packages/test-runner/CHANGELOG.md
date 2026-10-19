# Changelog

All notable changes to `@luckystack/test-runner` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-10-19

### Added

- `runAllTests({ apiTransport, expectServerError })`, `runContractTests({ apiTransport, expectServerError, resetToken })`, `runFuzzTests({ apiTransport, resetToken })`, `apiTransport` on the auth and rate-limit layer inputs, `ctx.callApi(input, { transport })` and the `CallApiOptions` type.

### Changed

- **Breaking:** in socket-mode projects (the default `transport.invocation: 'socket'`) the contract, auth, rate-limit and fuzz layers and `ctx.callApi` test API routes over Socket.io, the path real clients use, instead of `/api/*` (ADR 0084). `createSocketProbeTransport` sends API routes over the socket too; the CSRF layer still probes over HTTP. Upgrade: expect results to change where the two pipelines differ; pass `apiTransport: 'http'` to `runAllTests`, or `{ transport: 'http' }` to `ctx.callApi`, to keep the old path.
- **Breaking:** the contract layer fails on routing errors (`notFound`, `methodNotAllowed`, `invalidName`) and on server errors (HTTP 5xx, `serverExecutionFailed`, `internalServerError`) instead of passing any well-formed error. Upgrade: list routes that throw on purpose in the new `expectServerError` option of `runAllTests` / `runContractTests`.

### Fixed

- **Token-mode projects:** `runAllTests({ authToken })` sends the session as `Authorization: Bearer` instead of a Cookie and skips the CSRF layer with a note. Before, the CSRF layer failed every state-changing route by mistake and ran real mutations on the sweep's session.
- **Contract and fuzz probes that hit the rate limiter are reported as skipped instead of passed.** With a reset token (`resetToken` / `TEST_RESET_TOKEN`) both layers reset rate limits before each route.
- **The session `Cookie:` header uses the effective cookie name** when `http.sessionCookiePrefix` is set (`__Host-…` / `__Secure-…`), in the sweep, the test sockets and `ctx` calls. Before, the runner sent the unprefixed name, which the server no longer reads.

## [0.12.0] - 2026-10-15

### Changed

- Requires Node.js 22.13 or newer (was 20). Node 20 stopped receiving security updates in April 2026, and the scaffold's lint toolchain (ESLint 10) needs 22.13.

## [0.11.0] - 2026-10-14

### Changed

- Type declarations are emitted per source file by TypeScript 7 (`tsc -b`) instead of one bundled `.d.ts` per entry, so the framework build no longer runs package by package. The exported types are unchanged; relative imports inside the declarations carry `.js`, so `moduleResolution: "node16"`/`"nodenext"` projects resolve them as before.
- Package design guidance now ships as `AGENTS.md`, not `CLAUDE.md`. Handwritten docs focus on rationale and safety; exact API contracts remain in installed declarations/source.

## [0.10.2] - 2026-10-09

### Added

- The auto-sweep layers (contract, auth, rate-limit, CSRF, fuzz) now cover sync routes when `runAllTests` receives the generated `syncMetaMap` (+ optionally `syncInputSchemas` for Zod-valid sync payloads). Sync probes travel over Socket.io — the pipeline real clients use — unless the project's `transport.invocation` is `routed-http` or `syncTransport: 'http'` is set; the CSRF layer always probes sync over HTTP, since CSRF is an HTTP-only guard. Each run uses one throwaway `lstest-room-<uuid>` room, which the sweep session joins when an `authToken` is given, so room-membership enforcement sees a member. Without `syncMetaMap`, `runAllTests` warns that sync routes are not swept.
- New exports: `createHttpProbeTransport`, `createSocketProbeTransport`, `defaultProbeTransport`, `sendProbe` and the `ProbeTransport` family of types; `createSampleInputFor` + `InputSchemaMap`; `SyncMetaMap` / `SyncMetaEntry`; `CallSyncOptions`. `EndpointDescriptor` gains an optional `kind` (`walkSyncEndpoints` sets `'sync'`; absent means API).
- `runAllTests` writes the full summary JSON itself: `outputFile` option, defaulting to `TEST_OUTPUT_FILE`, else `test-results.json`; `false` disables it. Entry scripts no longer need their own write.
- `resetServerState` accepts `only?: TestResetTarget[]` to clear just those targets (`/_test/reset?only=`).
- Registered custom layers receive `sampleInput` in `TestLayerInput` (the same Zod-valid payload the contract sweep sends), and `runRegisteredLayers` accepts `syncMetaMap`, `filter`, `apiInputSchemas`, `syncInputSchemas` and `inputFor`. `method` is `undefined` for sync endpoints.

### Changed

- **`ctx.callSync` follows the project's `transport.invocation`.** For a socket-mode project (the default) it now emits a real Socket.io `sync` instead of always posting to `/sync/*`, and the case's socket joins `opts.receiver` first (except `'all'`; opt out with `joinRoom: false`). Override per call with `opts.transport: 'http'`. New `opts.ignoreSelf`. A test that relied on HTTP-only behaviour in a socket-mode project must pass `transport: 'http'`.
- **The runner's own resets no longer clear sessions.** The `runAllTests` bookends and the rate-limit layer's between-endpoint reset send `only=rateLimits`, so an authenticated sweep is no longer logged out by its own reset. A direct `resetServerState` call without `only` still clears sessions as before.
- `filter` (`TEST_FILTER`) is passed to every layer and applied before any request. Previously every route was swept and only the report was filtered.

### Fixed

- GET routes receive their sample payload: probes encode it into the reserved `__luckystack_data` query key (core `buildRoutedGetUrl`) instead of dropping it, so a GET route with a required field no longer fails validation in every layer.
- Sockets the runner opens on the caller's `authToken` session (the sync-sweep member socket and the socket probe transport) close with `intentionalDisconnect`, the signal a real client sends on a tab switch. With `@luckystack/presence` installed, a plain close made presence log that session out a few seconds after the sweep.
- The bookend documentation no longer claims the reset drops rows the sweep created. `/_test/reset` never touched the application database; `lstest_*` rows persist.

## [0.10.1] - 2026-09-03

### Fixed

- Layer 5: `ctx.callApi(input)` on a `GET` route silently dropped `input`, so the server always saw `data = {}` and any `GET` route with a required field rejected the call with `api.invalidInputType` before `main()` ran. `input` now travels as the `__luckystack_data` query-string value, encoded by the shared `buildRoutedGetUrl` helper from `@luckystack/core` — the same contract the real client sends and the server reads. Non-`GET` routes are unchanged (JSON body).

## [0.8.5] - 2026-08-17

### Changed

- Test-only: the `runAllTests` characterization suite now mocks `@luckystack/login`, so it no longer cold-loads that package (and its dependency graph) on every `authToken` case. This removes a timeout-under-load flake and adds the first assertions for the CSRF-header branch of `buildAuthHeaders`, which previously degraded to a warning on every run. No runtime behaviour change.

## [0.8.4] - 2026-08-17

### Changed

- Documented the fail-closed `/_test/reset` contract accurately: exact development/test mode plus required token, default Redis session namespaces only, and no application-DB or custom-SessionAdapter cleanup.

## [0.7.4] - 2026-07-22

### Added

- `resolveTestEnvironment({ loadProjectConfig? })` and `RunAllTestsInput.loadProjectConfig`
  give the test process the same env prefix as server/ORM boot: load env files,
  lazily read consumer config, then dynamically run optional secret-manager
  resolution before any layer or Layer-5 test-module import.
- `resolveTestBaseUrl({ cwd?, fallbackUrl? })` centralizes live-test target
  resolution: explicit `TEST_BASE_URL`, then the backend's actually-bound dev
  port advertisement (only while its owner PID is alive), then the caller's
  config-derived fallback.

### Fixed

- Layer-5 tests that directly use Prisma/Redis no longer receive unresolved
  values such as `DATABASE_URL_V1` merely because only the separate live-server
  process ran secret-manager bootstrap. A configured resolver that cannot load
  now fails before test execution with an actionable error.
- Direct `runCustomTests(...)` calls now have the same lazy config/env bootstrap
  as `runAllTests`; both public orchestrators require the loader and fail closed
  when an untyped caller omits it. The internal prepared entrypoint prevents a
  second env load from replacing resolved secrets with pointers.

## [0.5.0] - 2026-07-11

### Changed

- `ctx.prisma` (Layer-5 custom tests) resolves lazily — projects without a
  registered database client (orm: `none`/drizzle/mikro-orm) can run DB-free
  custom tests; the eager resolve used to abort the whole custom-test phase.
- `@prisma/client` peer dependency is now optional (ADR 0020).

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
