---
name: local-socket-enumeration-is-unreachable-by-default
title: The per-instance socket maps are made unreachable for consumer code by three layers — a lint rule, a helper, and a dev-only guard on `getIoInstance()`
status: accepted
date: 2026-09-03
deciders: [mathijs]
tags: [core, socket, multi-instance, eslint, dx]
supersedes: []
relates: [0058]
---

## Context

Socket.io offers three ways to reach the sockets of a room that look identical
in an editor. `io.sockets.adapter.rooms.get(room)` and enumerating
`io.sockets.sockets` see only THIS instance; `io.in(room).fetchSockets()` spans
every instance behind the Redis adapter. The adapter synchronises delivery,
not the two local maps, so a fan-out or a guard built on them works in
development and goes dead on every other instance of a split deployment. In one
consumer project this mistake was made three times, independently, by different
authors, and two of the three were copied from the framework's own
`room-fanout.md`, which described the fan-out with the local maps.

Three failures in one codebase is not carelessness; it is an API in which the
wrong path is shorter and easier to find than the right one. The framework's
internals had already moved to `fetchSockets()`; what was wrong was what it
offered and described to consumers.

## Decision

Three layers, each catching what the previous cannot:

1. **ESLint rule `luckystack/no-local-socket-enumeration`** in
   `@luckystack/core/eslint` — catches what is WRITTEN (`.adapter.rooms`,
   `.adapter.sids`, enumeration of `.sockets.sockets`); `.get(id)` stays
   allowed because a local lookup from a local handler is correct by
   definition. Cheapest layer; reaches every existing project on upgrade.
2. **`getRoomSockets(room, { userId })`** in `@luckystack/core` — makes the
   right path the shortest: formatter under `'broadcast'`, cross-instance
   fetch, `userId` defaulting to `null`. Throws when no server is registered.
3. **A dev-only guard on `getIoInstance()`** — a Proxy that throws on the same
   three surfaces, catching what is COMPUTED (bracket access, destructuring, a
   lookup behind a variable) that no static rule can see. Production returns
   the raw server; `getIoInstance({ raw: true })` is the escape hatch for the
   deliberate per-instance cases, which also carry a lint opt-out with a reason.

The doc that taught the pattern is rewritten to describe the cross-instance
fan-out and to name the two maps as per-instance.

## Rejected alternatives

- **Lint rule only** — rejected because it cannot see computed access and does
  nothing for the author who never runs lint on a script; and because a rule
  that says what NOT to do without offering what TO do pushes people to the
  next-best local pattern.
- **Helper only** — rejected because the three local lookups remain reachable
  and look just as valid; existing code is not touched by a new export.
- **Guard in production too** — rejected: a thrown error on a hot path in
  production is worse than a missed recipient, and the raw server must stay
  untouched for the Redis adapter and Socket.io internals.
- **Wrap the server at `setIoInstance` instead of at `getIoInstance`** —
  rejected because the framework's own internals (`loadSocket`, the adapter)
  must keep the raw instance; wrapping on the way OUT keeps the guard on the
  consumer edge only.

## Consequences

- Four framework-internal sites (login session kick and update, presence
  multi-tab guard and sampler, sync backpressure sampling) now read the raw
  server explicitly and carry the lint opt-out; two of them are known
  per-instance limitations reported in the 0.10.0 handoff, not fixed here.
- A consumer test that builds a fake server and enumerates it locally through
  `getIoInstance()` will now throw under vitest (`NODE_ENV=test` is not
  production). That is intended: it surfaces the bug in the test, where it is
  cheapest.
