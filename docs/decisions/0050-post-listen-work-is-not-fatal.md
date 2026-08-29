---
name: post-listen-work-is-not-fatal
title: Post-listen work runs through `afterListen` and does not kill a listening server
status: accepted
date: 2026-08-18
deciders: [ItsLucky23]
tags: [server, boot, resilience, scaffold]
supersedes: []
relates: [0025]
---

# 0050 — Post-listen work runs through `afterListen` and does not kill a listening server

## Context

A consumer project reported a boot crash-loop. The sequence in its logs:

```
Server is running on http://127.0.0.1:83/
[attachment-queue] reconciled ocr: live=0 pending=0
[server] failed to start: MongoServerSelectionError: getaddrinfo ENOTFOUND mongo
[Supervisor] Server crashed with code 1. Restarting in 300ms
```

The server had bound its port and was serving. What failed was a durable queue
worker started *after* `listen()`, whose first database query could not resolve
the `mongo` hostname (a Docker-compose service name, resolved outside Docker).

The scaffolded `server/server.ts` wraps the whole boot in an IIFE:

```ts
await server.listen();
await startAttachmentWorkers(...);   // consumer appended this
})().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
```

Appending post-listen work to that chain silently extends "fatal" to everything
after the bind. One unreachable dependency therefore killed a healthy process,
the supervisor restarted it, the dependency was still down, and it looped —
roughly every 40 seconds. The log line was also untrue: the server *had* started.

Worth noting the inconsistency this exposed: Redis in the same boot hit an
`ETIMEDOUT`, retried, and connected. The database path had no such tolerance,
purely because of where its caller happened to sit in the chain.

## Decision

`RunningLuckyStackServer` gains `afterListen(task, options?)`, and the scaffolded
`server/server.ts` ships an explicit slot for it.

- **Before `listen()` stays fatal.** A failure there means there is no server;
  `process.exit(1)` is the correct response and the `failed to start:` message is
  accurate.
- **After `listen()` is not.** `afterListen` runs the task, and on rejection logs
  loudly and continues. The server keeps serving whatever does not depend on the
  broken thing.
- **`{ fatal: true }` restores propagation** for a task the process genuinely has
  no purpose without. `{ label }` names the task in the failure log.

Implementation is a standalone `runAfterListenTask` in `packages/server/src/afterListen.ts`
rather than a closure inside `createServer`, so the behaviour is unit-testable
without standing up a fully bootstrapped server.

## Rejected alternatives

- **Leave it to the consumer.** Technically their `server.ts` is theirs to edit —
  but the template ships the fatal catch, and its shape actively invites appending
  post-listen work to the same chain. A framework that hands you a footgun and
  calls the resulting misuse your problem is not being helpful.
- **Make the template's catch never exit.** Rejected: a pre-listen failure must
  stay loud and fatal. Losing that would trade a visible crash-loop for a process
  that idles forever having never bound a port.
- **Retry post-listen tasks with backoff inside the framework.** Rejected as the
  wrong layer: the framework cannot know whether a given task is safe to retry,
  how often, or whether partial completion is tolerable. Log-and-continue leaves
  that policy with the code that owns the task, which can wrap it in whatever
  retry it wants.
- **A `postListen` lifecycle hook in the core hook registry.** Rejected as more
  machinery than the problem needs — hook ordering, error semantics per
  subscriber, and a registration surface, when the consumer already has a natural
  place to write the code (their `server.ts`) and just needed the failure boundary
  drawn in the right spot.

## Consequences

- A post-listen dependency outage now produces a running-but-degraded server plus
  a loud log line, instead of a crash-loop. That is the intended trade: partial
  availability beats none, and the log says what is broken.
- A consumer who WANTS the old fail-fast behaviour for a specific task has to opt
  in with `{ fatal: true }` — a deliberate choice rather than an accident of
  placement.
- Existing projects keep their current `server/server.ts`; the new slot arrives as
  a `.new` sidecar via `npx luckystack update --app` (ADR 0025) and has to be
  merged by hand.
- `afterListen` is on the `RunningLuckyStackServer` interface, so any code that
  structurally implements that type (test doubles, wrappers) must add it.
