# Changelog

All notable changes to `@luckystack/sync` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-10-19

### Changed

- **Breaking:** the HTTP/SSE sync transport answers the sender as soon as the change is saved and `preSyncFanout` allows delivery; delivery to recipients continues in the background. That is the point where websockets already answered (ADR 0071). Before, a slow fan-out to a large room could time out the sender after the change was saved, and a retry applied it twice. Upgrade: don't assume recipients have been reached when an HTTP sync call resolves; code or tests that need delivery to be complete should listen to the `postSyncFanout` hook.

### Fixed

- **`broadcastStream` to receiver `'all'` reaches every connected socket** across instances, like the final fan-out. It used to target a literal room called `'all'` and reached nobody.
- **Syncing to your own session token works under a custom room-name formatter.** It failed with `sync.notRoomMember` over websockets and `sync.noReceiversFound` over HTTP; the token room is now addressed unformatted, the same way it is joined.
- **The error tracker no longer stores the raw session token as `receiver`** when a sync targets a token room. It is shortened to its first 4 characters, as `targetToken` already was.
- **The socket status reaches `RECONNECTING` with the attempt number during reconnects.** socket.io-client v4 emits `reconnect_attempt` only on the Manager, so the listener on the Socket never fired.
- **A socket `syncRequest` whose connection drops before the acknowledgement settles at once with the new error code `sync.disconnected`** (added to `SYNC_ERROR_CODES`), like `apiRequest` does with `api.disconnected`. Before, it waited for `sync.requestTimeoutMs` (30 s), or forever with the timeout disabled, and leaked two listeners. Projects with their own locale files should add a `sync.disconnected` translation; the scaffold's locales have it from `create-luckystack-app` 0.15.0.

### Security

- **Over the HTTP/SSE transport a room member could choose the callback name other members received** (`cb` in the request body), and so trigger another route's callbacks with data that never passed that route's server checks. Recipients now always receive the server-resolved route name, as on websockets; the body `cb` is ignored.
- **Stream chunks from `broadcastStream`, `streamTo` and a `_client` handler's `stream` carried the sender's callback name** on both transports, so they could trigger another route's stream callbacks. They are now keyed on the server-resolved route.

## [0.12.0] - 2026-10-15

### Changed

- Requires Node.js 22.13 or newer (was 20). Node 20 stopped receiving security updates in April 2026, and the scaffold's lint toolchain (ESLint 10) needs 22.13.

## [0.11.0] - 2026-10-14

### Changed

- Type declarations are emitted per source file by TypeScript 7 (`tsc -b`) instead of one bundled `.d.ts` per entry, so the framework build no longer runs package by package. The exported types are unchanged; relative imports inside the declarations carry `.js`, so `moduleResolution: "node16"`/`"nodenext"` projects resolve them as before.
- Package design guidance now ships as `AGENTS.md`, not `CLAUDE.md`. Handwritten docs focus on rationale and safety; exact API contracts remain in installed declarations/source.

## [0.10.0] - 2026-09-03

### Changed

- **BREAKING (behaviour): the HTTP / `routed-http` fan-out rejects an empty room with `sync.noReceiversFound` (404)**, exactly like the socket transport and at the same position. Until now the HTTP path answered `success` with zero recipients, so a wrong room name, a socket that had not re-joined, or a join/send formatter mismatch was indistinguishable from a delivered broadcast — on precisely the transport built for multi-instance (three consumer bugs stayed invisible for months, DEV-376). A caller that relied on HTTP-success for an empty room must handle the code the socket transport already produced. Where that position sits relative to `_server` is the next entry.
- **BREAKING (behaviour): recipients are resolved BEFORE the `_server` handler runs, on both transports.** The cross-instance `fetchSockets()` lookup moved from after execution to right before input validation. It can fail on its own — the Redis adapter's request timeout when an instance on the same adapter key does not answer (a dev laptop tunnelled into the staging Redis, asleep) — and it can come back empty; when either happened after `_server` had persisted its mutation, the originator was told `error` about a change that had been saved, and a retry applied it twice. Now `sync.noReceiversFound` and a lookup-failure `sync.serverExecutionFailed` are pre-commit rejections: nothing was persisted, a retry is safe. Behaviour change for a UI that read `sync.noReceiversFound` as "saved, but nobody was listening" — that reading is now wrong. The recipient snapshot is taken one handler-execution earlier, so a socket that joins the room while `_server` runs misses that one fan-out.

### Added

- **`SYNC_ERROR_CODES` / `SyncErrorCode`** exported from `@luckystack/sync` AND `@luckystack/sync/client`: the canonical list of every framework-emitted `sync.*` error code (both transports, the `_client` stage, and the server's HTTP sync route). Write a parity test of your locale files against it instead of retyping `docs/error-states.md` — `translate()` renders a missing key as the raw key. A framework test keeps the list equal to the source literals and the scaffold locales in parity with it.
- **Dev warning on `routed-http` when membership passed on the session's `roomCodes` but the caller has no socket in the target room.** Over HTTP membership is LOGICAL (there is no originator socket to test), so a successful `syncRequest` does not prove you are in the room or will receive the fan-out; the recipient list is already in hand, so the handler now says so in dev. The asymmetry itself is deliberate and documented in `docs/ARCHITECTURE_SYNC.md`.
- `preSyncRecipient` receives `recipientToken` on both transports (see `@luckystack/core`).

### Fixed

- `docs/error-states.md` lacked `sync.receiverNotAllowed` and `sync.notRoomMember` (403, BOTH transports) and claimed a built-in i18n catalog that does not exist. `docs/room-fanout.md` still described the fan-out as per-instance (`adapter.rooms`) and advised sticky sessions, while the code has used cross-instance `fetchSockets()` for several releases — `_client` handlers DO run for remote recipients. That doc taught two consumer bugs.

## [0.8.4] - 2026-08-17

### Changed

- Corrected dependency, generated-typing, error-tracker, and transport-span documentation, including the current root no-cast rule and HTTP-only automatic sync request span.

## [0.8.1] - 2026-07-27

### Fixed

- Named production topology environments no longer enable development-only loopback rate-limit bypasses for socket or HTTP sync invocation.

## [0.8.0] - 2026-07-27

### Added

- `syncRequest` can invoke owning services through HTTP/SSE in routed transport mode while callbacks, rooms and fanout continue over the single Socket.io connection.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
