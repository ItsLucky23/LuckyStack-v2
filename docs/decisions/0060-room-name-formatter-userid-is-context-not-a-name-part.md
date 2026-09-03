---
name: room-name-formatter-userid-is-context-not-a-name-part
title: The `userId` a room-name formatter receives is context, never part of a content room's physical name
status: accepted
date: 2026-09-03
deciders: [mathijs]
tags: [core, socket, multi-tenancy, rooms]
supersedes: []
relates: []
---

## Context

`registerRoomNameFormatter` lets a consumer namespace every framework room
(per-tenant prefixing, mirroring the Redis key formatter). The formatter gets
`{ purpose, userId }`. Under the single canonical `'broadcast'` purpose the
framework passes whichever user is performing the operation: the joiner on join
and rejoin, the SENDER on the sync fan-out, the originator on `broadcastStream`.
For a shared room those are different people, so a formatter that folds
`userId` into the physical name puts the join side and the send side in
different rooms and every broadcast reaches nobody — silently, and totally.

Nothing said this. The context type documented `userId` as "session user id when
known". A consumer running a real multi-tenant formatter asked, twice, whether
the sender's id was passed on purpose, and worked around the uncertainty by
passing `null` everywhere on its own side. `ARCHITECTURE_MULTI_TENANCY.md`
already describes a per-workspace key formatter, so the question is not
hypothetical.

## Decision

`userId` is context only. A formatter may log it or branch on it for a
genuinely separate family (`'presence'`), but MUST NOT use it to derive the
physical name of a content room. The contract is written on the context type,
in the core socket-bootstrap doc and in the package INDEX; no call site changes.
Per-user isolation belongs in the raw room code the consumer chooses (a token
room, a `user:<id>` room), which is stable across join, fan-out and stream.

## Rejected alternatives

- **Pass `userId: null` for every `'broadcast'` call** — rejected because it
  removes information the framework has for free (who is joining, who is
  sending) to protect against a misuse that a sentence forbids, and because a
  formatter that today logs the actor for audit would silently lose it.
- **Drop `userId` from the context type for `'broadcast'`** — rejected as a
  type-level break for every existing formatter signature to enforce something
  the default identity formatter never needed enforced.
- **Pass the same id on every side (e.g. the room owner)** — rejected because
  the framework does not know a room's owner; a shared room has none.

## Consequences

- The framework's own fan-out keeps passing the sender's id; that is now
  correct by contract, not by luck.
- `getRoomSockets(room, { userId })` inherits the same reading: the option is
  forwarded as context and defaults to `null`.
