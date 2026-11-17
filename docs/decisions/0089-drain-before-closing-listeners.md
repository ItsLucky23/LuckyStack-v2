---
name: drain-before-closing-listeners
title: Drain in a preServerDrain hook before closing the HTTP listener and Socket.io
status: accepted
date: 2026-11-17
deciders: [user, implementation-agent]
tags: [server, cron, core, shutdown]
supersedes: []
relates: [0011, 0088]
---

## Context

Graceful shutdown called `httpServer.close()` before `preServerStop`. On Node 24 that refuses new connections and drops idle keep-alives at once. A consumer that waits minutes in `preServerStop` (running AI turns) therefore refused every request during the wait; behind a single-instance proxy each page load returned 502, and the app could not even answer "the server is restarting". Cron's teardown sits on `preServerStop` after the app's handlers, so it kept starting new runs during that wait.

## Decision

Add a `preServerDrain` hook that runs first, with the listeners and Socket.io still open, under the same per-step budget. Then close HTTP and Socket.io together and continue with `preServerStop` and cleanup as before. Core exposes a process-wide `isServerShuttingDown()` flag, set before the drain; cron checks it on every tick to start nothing new and to give up leadership. A flag instead of a cron drain handler, because handlers run in registration order and the app's drain handler is registered before cron's.

## Rejected alternatives

- An option that keeps HTTP open during `preServerStop`: one hook would mean "still serving" or "already closed" depending on config, and cleanup handlers could not rely on either.
- Closing Socket.io after `preServerStop`, as before: clients would stay on the stopping server instead of reconnecting to the replacement.
- A cron `preServerDrain` handler: blocked behind earlier drain handlers for the whole drain.

## Consequences

Consumers move long waits from `preServerStop` to `preServerDrain`. Socket.io is closed when `preServerStop` runs. Production shutdown has one more bounded step, so the announced supervisor grace is 6× the budget. The drain only helps when the platform's kill timeout exceeds it.
