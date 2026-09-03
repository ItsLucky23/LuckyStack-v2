---
name: an-empty-room-is-an-error-on-every-sync-transport
title: A sync fan-out to an empty room is `sync.noReceiversFound` on every transport, including routed-http
status: accepted
date: 2026-09-03
deciders: [mathijs]
tags: [sync, transport, multi-instance, error-states]
supersedes: []
relates: [0037, 0059, 0063]
---

## Context

The socket transport has always answered a fan-out to an empty room with
`sync.noReceiversFound` (404). The HTTP/SSE transport — the one `routed-http`
invocation uses, and therefore the one a multi-instance deployment runs on — did
not: it fetched the recipients, ran the loop zero times and answered `success`.
The code carried a comment calling that "normal over the HTTP fallback": the
caller IS the originator and may have no socket at all.

A consumer audit (Flexbuddy, DEV-376) showed the cost of that reasoning. Every
room bug looks the same from the outside — the room is empty: a wrong room name,
a socket that had not re-joined after a reconnect, a session moved but the
socket not, a formatter mismatch between the join side and the send side. On
socket the framework reports that class itself; on routed-http three such bugs
stayed invisible for months and were only found by a targeted audit, because a
broadcast that reached nobody was indistinguishable from one that was delivered.
The asymmetry was the wrong way round: the transport built for multi-instance
was the silent one.

## Decision

The HTTP handler checks the fetched recipient list and answers
`sync.noReceiversFound` (404) when it is empty, in the same position as the
socket handler. Same code, same status, same hooks skipped. This is a
behaviour change for a caller that relied on HTTP-success for an empty room,
and it ships in a minor bump for that reason. Where that position is — before
or after the `_server` handler — is decided by ADR 0063 (before, on both
transports, in the same release); this decision only fixes that both
transports answer the same thing at the same point.

## Rejected alternatives

- **Keep the asymmetry and document it** — rejected because a documented silent
  success is still a silent success; the consumer's three bugs were not caused
  by missing documentation but by the absence of any signal at runtime.
- **A `sync.strictReceivers` flag, default off, plus a dev warning** — rejected
  because it keeps the unsafe behaviour as the default; every project that
  never reads the flag inherits the blind spot, and the projects most likely to
  hit it (split deployments) are the least likely to be running with dev logs.
- **`recipientCount: 0` on the success envelope** — rejected because it adds
  a field the socket transport does not have and moves the decision to every
  call site instead of the one place that already knows.

## Consequences

- A pure HTTP caller (no socket of its own) targeting its own token-room now
  gets the 404 it would have got on socket. That is the correct reading: nobody
  was listening.
- Because recipients are resolved before `_server` runs (ADR 0063), the error
  means nothing was persisted and a retry is safe — on both transports;
  `docs/room-fanout.md` §8 says so.
- `error-states.md` no longer needs a socket-vs-HTTP column for this code; the
  remaining transport difference is the membership check (ADR 0059).
