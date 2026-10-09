---
name: test-runner-probes-follow-the-project-transport
title: The test-runner probes routes over the project's own transport, and resets only what it needs
status: accepted
date: 2026-10-09
deciders: [ItsLucky23]
tags: [test-runner, sync, testing, server]
supersedes: []
relates: []
---

## Context

A consumer wiring the route lane against `@luckystack/test-runner` 0.10.1 reported six defects. Two of
them share one root cause: the runner tested a route over a different path than the one real users hit,
or changed server state the test itself depended on.

- `ctx.callSync` always used the `/sync/*` HTTP route, and the sweep layers did not walk sync routes at
  all. A project on the default `transport.invocation: 'socket'` sends every sync over Socket.io, which runs
  a separate server pipeline. Its sync routes therefore had no transport-level coverage, and a green
  `callSync` test proved nothing about the socket path.
- The runner's `/_test/reset` calls (bookends + between rate-limit endpoints) used the unscoped reset,
  which also deletes every Redis session — including the session an authenticated sweep runs on. Turning
  on the reset token logged the sweep out halfway through.

## Decision

1. **Probes follow `transport.invocation`.** `callSync` and the sweep layers' sync probes use Socket.io for
   `'socket'` projects and HTTP for `'routed-http'` projects; both can be overridden. The CSRF layer always
   probes over HTTP, because CSRF is an HTTP-only guard. Sync probes target one throwaway room per run that
   the sweep's own session joins, so membership enforcement sees what a real member sees.
2. **The reset gets a selector, and the runner always uses it.** `/_test/reset?only=<targets>` clears
   exactly the listed targets; an unknown or empty selector is a 400. The runner only ever sends
   `only=rateLimits`. The unscoped reset keeps its old meaning.

## Rejected alternatives

- **Keep sync on HTTP and document the gap.** Cheaper, but it leaves the default transport untested.
  The point of the route lane is to hit what users hit.
- **Change the unscoped reset to stop clearing sessions.** It fixes the runner, but silently changes
  behaviour for every CI setup that calls `/_test/reset` directly to log users out between suites.
- **Re-login after every reset.** This hides the problem and fails for sessions the runner did not
  create, such as a token supplied through `TEST_AUTH_TOKEN`.

## Consequences

- A `'socket'` project's existing `callSync` tests now run over the socket. Behaviour that differs
  between the two pipelines now surfaces as a test failure instead of being masked.
- Sweeping sync routes needs the generated `syncMetaMap`. Without it, `runAllTests` warns and sweeps
  API routes only.
- A new reset target must be added to the shared target list in `@luckystack/core`. Server and runner
  read the same list, so neither side can drift.
