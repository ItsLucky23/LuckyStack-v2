---
name: partial-session-updates-only-write-when-the-session-exists
title: Partial session updates only write when the session still exists
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [security, session, auth, server, login]
supersedes: []
relates: [0018]
---

## Context

Socket room joins and leaves and location updates read the session, wait for
consumer hooks and socket.io, and then write the whole session back with a
plain write and a fresh expiry. A delete in between — logout, revoke, a
password change, "sign out everywhere" — was undone by that write: the session
came back with a new lifetime and its token was back in the user's active set.
The per-token lock only orders socket operations against each other, not
against deletes (sweep finding 009).

## Decision

The session-provider contract gains an "only if it exists" write. The server's
read-modify-write paths use it. A provider must not recreate a deleted session
for such a write and answers `session.notFound` instead. The login package
implements it with an optional atomic adapter operation (Redis `SET … XX`) and
falls back to re-reading before the write for adapters without it. Such a write
refreshes the active-set expiry but never adds the token to the set.

## Rejected alternatives

- **Re-read on the server and abort when the session is gone.** The window
  between re-read and write stays open, and adapters still write blindly.
- **A compare-and-set script, or updating only the changed field.** It would
  also fix lost updates between concurrent writers, but it needs a new storage
  primitive and record layout in every adapter; too large for a bug fix.
- **Tombstones on delete.** Extra keys and expiry handling on every delete.

## Consequences

- Custom session providers should honour the new option, and custom adapters
  should implement the atomic write; otherwise a narrow re-read window remains.
- Lost updates between concurrent writers of different fields are not
  addressed.
- Other code that updates a session after an awaited step can opt in.
