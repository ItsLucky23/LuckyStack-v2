---
name: hot-reload-accepts-a-synchronous-pause-while-building-types
title: Hot reload accepts a synchronous pause while building types, and says so
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [devkit, hot-reload, dx, performance, typescript]
supersedes: []
relates: [0067, 0079]
---

## Context

Type-map generation and the input-type read on each route reload both build a
TypeScript program synchronously through the TypeScript 7 API (ADR 0067).
Scheduling that work for later only delays it; it still runs on the main
thread, and the dev server answers no requests meanwhile. The devkit
instructions and the hot-reload doc claimed that hot reload does not block
requests (sweep finding 035).

## Decision

Accept the pause in development. The docs now say the dev server does not
answer requests during a regeneration or route reload, and the dev server logs
how long each of them took. This was the owner's choice (option b) over moving
the work off the main thread.

## Rejected alternatives

- **Move generation to a worker thread or child process.** A larger change;
  it stays a possible follow-up if the pause becomes a real problem.
- **Leave the docs as they were.** They described behaviour the server does
  not have.

## Consequences

- In large projects requests stall during a regeneration; the log line names
  the cause and how long it took.
- Revisit when the pause is long enough to hurt day-to-day development.
