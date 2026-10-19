---
name: http-sync-answers-once-saved-and-fans-out-in-the-background
title: The HTTP/SSE sync transport answers the originator once the change is saved; fan-out continues in the background
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [sync, transport, http, error-states]
supersedes: []
relates: [0063, 0058]
---

## Context

The socket transport answers the originator after the `_server` handler has
saved the change and the `preSyncFanout` gate has allowed delivery, before the
per-recipient loop runs. That loop is serial: it awaits every `_client` handler
and yields every few sockets, so on a large room it can take longer than the
client's request timeout.

The HTTP/SSE transport answered only after the loop finished. Over
`transport.invocation: 'routed-http'` a caller in a large room therefore got
`sync.requestTimeout` (504) about a mutation that was already saved, retried,
and applied it twice. That is the failure ADR 0063 set out to remove, and it
broke the package rule that both transports answer the same thing at the same
point. The owner chose this option over waiting for the whole fan-out and over
leaving it (sweep finding 017).

## Decision

On both transports the originator is answered once `_server` has saved the
change and `preSyncFanout` has allowed delivery. Delivery to recipients and the
`postSyncFanout` hook then continue in the background; their failures go to the
logger and the error tracker and never change the answer. A `preSyncFanout`
stop is still an error answer, because it runs before the answer point.

## Rejected alternatives

- **Wait for the whole fan-out, with a longer or no timeout on sync routes.**
  It holds a connection and a proxy slot for as long as the slowest room takes.
  Any proxy or load-balancer timeout outside the framework brings "timed out
  but saved" back, and the answer still differs from websockets.
- **Leave it.** It keeps a known double-mutation path on the HTTP transport,
  which is the one meant for multi-instance deployments.
- **Add a delivery-status flag to the answer.** Already rejected in ADR 0063:
  it reports success about something that partly failed and pushes that
  judgement to every call site.

## Consequences

- ADR 0063 rejected "answer once `_server` committed and log the fan-out
  failure" for the recipient *lookup*, which can fail and was then reported as
  a mutation failure. That lookup still runs before the commit. What runs after
  the answer is per-recipient delivery, whose outcome neither transport ever
  reported to the originator. This record only aligns when HTTP answers.
- When an HTTP sync call resolves, recipients may not have received the event
  yet. Code and tests that need delivery to be complete observe
  `postSyncFanout`, which now fires after the answer.
- A process that stops in the middle of the loop loses the rest of that fan-out
  without the originator knowing. This was already true on websockets.
- The background loop keeps the request's error-tracker identity, because the
  per-request identity scope carries over into the detached work.
