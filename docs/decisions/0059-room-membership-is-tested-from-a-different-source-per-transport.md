---
name: room-membership-is-tested-from-a-different-source-per-transport
title: `sync.requireRoomMembership` tests physical membership on socket and logical membership on routed-http, deliberately
status: accepted
date: 2026-09-03
deciders: [mathijs]
tags: [sync, transport, auth, multi-instance]
supersedes: []
relates: [0037, 0058]
---

## Context

`sync.requireRoomMembership` must be enforced on both transports, but they can
only test against different sources. The socket handler has the originating
socket and tests whether it is physically in the (formatted) room — the exact
room the fan-out will deliver to. The HTTP handler has no originator socket; the
only membership it can see is the session's persisted `roomCodes` plus the
caller's own token-room. Both code paths carried a comment about this, but the
comments covered one case (the token-room) and no document said what it means
in general:

- a session with the `roomCode` whose socket has not (re)joined → HTTP allows,
  socket refuses; the fan-out goes to a room the caller is not in, and the
  caller gets `success` while receiving nothing;
- a socket that joined without the `roomCode` being persisted → the reverse.

A consumer hit the first case after a socket reconnect and had to derive the
rule from the built `dist`. The question was whether to unify the two checks
on one source.

## Decision

Keep the two sources, and make the consequence explicit in three places: a
section in `ARCHITECTURE_SYNC.md` with the table and the sentence *"on
routed-http a successful `syncRequest` does not prove you are in the room
yourself or that you will receive the fan-out"*; the `sync.requireRoomMembership`
entry in the sync package INDEX; and a dev-mode warning in the HTTP handler when
the check passed on `roomCodes` while none of the fetched recipients carries the
caller's token — the recipient list is already in hand at that point, so the
warning is free.

## Rejected alternatives

- **Unify on the logical source (`roomCodes`) for both transports** — rejected
  because the socket check tests the room the fan-out actually delivers to; a
  socket that joined a room the session does not list is a real, physical
  member and would start being refused, and a persisted code whose socket is
  gone would start being allowed on socket too, widening the silent case
  instead of removing it.
- **Unify on the physical source** — impossible on HTTP: there is no originator
  socket, and resolving the caller's sockets through `fetchSockets()` before
  authorization would add a cross-instance Redis round-trip to every HTTP sync
  just to answer a question the session already answers well enough.
- **Reject on HTTP when the caller has no socket in the room** — rejected
  because a caller without any socket (a pure HTTP client, a worker) is a
  legitimate originator that never expects to receive its own fan-out; refusing
  it would break the very case the HTTP transport exists for.

## Consequences

- Consumer-side reconnect handling stays consumer-side (re-join, or reset a
  cached membership flag on socket loss); the framework now says that this is
  needed instead of leaving it to be inferred from user behaviour.
- The dev warning is `logging.devLogs`-gated and costs one array scan over the
  already-fetched recipients.
