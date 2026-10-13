# Room fanout

A receiver supplied by a client must be authorized before delivery. Server-side policy limits global broadcast and room targeting; membership for socket requests comes from the connection, while HTTP/SSE uses persisted session room membership because it has no originator socket. Do not use recipient-specific handlers as a substitute for this sender gate. See `../src/_shared/receiverAuth.ts`, `../src/handleSyncRequest.ts`, `../src/handleHttpSyncRequest.ts`.

The two membership sources are deliberate (ADR 0059). The socket check tests the room the fanout will actually deliver to. HTTP has no originator socket, and resolving the caller's sockets across instances before authorization would add a Redis round-trip to every HTTP sync. Consequence: on routed HTTP, a successful sync does not prove that the caller is in the room or will receive the fanout. A session can still list a room that its socket has not re-joined since a reconnect. Re-joining after a reconnect is the consumer's job.

Each authenticated socket's private token room is for session-targeted messages; never expose token room names to unrelated callers. Tenant room formatting must be consistent when joining and fanning out (`../../core/src/roomNameFormatterRegistry.ts`). The `userId` a formatter receives is context only. It is the joiner on join and the sender on fanout. A formatter that builds it into a content room's physical name therefore splits join and send into different rooms, and every broadcast reaches nobody (ADR 0060). Put per-user isolation in the room code itself.

## Recipients are resolved across instances, before the handler commits

Both transports enumerate the room across every instance that shares the adapter, after authorization and before the `_server` handler (ADR 0063). An empty list or a failed lookup is therefore reported before anything is persisted (see `./error-states.md`). The accepted cost: the recipient snapshot is taken one handler execution earlier, so a socket that joins while the handler runs misses that one fanout.

A recipient on another instance is a full recipient. Its per-recipient handler runs on the instance handling the request, and the result is delivered through the remote socket handle. Correctness does not need sticky sessions.

Never build a fanout target, presence list or room snapshot from the per-instance socket maps (`io.sockets.adapter.rooms`, `adapter.sids` or enumerating `io.sockets.sockets`). Under the Redis adapter they return a partial view that looks complete, with no error, and silently drop the rest of the cluster (ADR 0061). Use `getRoomSockets` (`../../core/src/roomSockets.ts`) or `io.in(room).fetchSockets()`. A lint rule, `no-local-socket-enumeration`, and a guard on `getIoInstance()` that throws outside production both catch this mistake. Deliberate per-instance work opts out explicitly with a stated reason. See `../../core/src/localSocketEnumerationGuard.ts`, `../../core/docs/redis-adapter.md`.

## Per-recipient hook and counts

`preSyncRecipient` acts on one recipient, on both transports and for remote recipients too. A stop skips only that recipient. A stop with an override output delivers a redacted payload instead. Its `recipientUserId` is always null, because resolving a user per socket would cost one session read per recipient on the hot path. A handler that needs the user reads the session by `recipientToken`. Payload shape: `HookPayloads` in `@luckystack/core`.

`recipientCount` counts the recipients the loop emitted to, not the ones that received the payload. A socket that disconnected after the snapshot and a recipient whose handler failed are still counted. Only `ignoreSelf` and a skipping `preSyncRecipient` stop lower the count. Across an adapter, the server has no delivery confirmation, so an observer that needs one must add a client-side acknowledgement. Fanout yields to the event loop on both transports, because a fanout started over HTTP still runs on the receiving instance's event loop.
