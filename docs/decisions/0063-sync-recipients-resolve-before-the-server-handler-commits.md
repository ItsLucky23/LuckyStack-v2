---
name: sync-recipients-resolve-before-the-server-handler-commits
title: A sync resolves its recipients before the `_server` handler runs, so a fan-out failure is never reported on a committed mutation
status: accepted
date: 2026-09-03
deciders: [mathijs]
tags: [sync, transport, multi-instance, error-states, redis]
supersedes: []
relates: [0058, 0037]
---

## Context

Both sync transports ran the `_server` handler first and asked the Redis adapter
for the recipient list (`fetchSockets()`) afterwards. That lookup fails on its
own: the adapter waits for an answer from every instance on its channel and
throws after its request timeout when one does not reply. A consumer (Flexbuddy)
hit exactly that — a dev laptop tunnelled into the staging Redis sat on the same
adapter channel as staging, so staging's lookups waited on a machine that had
gone to sleep. The originator was then told `sync.serverExecutionFailed` about
a role change that had already been saved; an empty room produced the same
shape with `sync.noReceiversFound`. The user retried, and the mutation ran
twice. ADR 0058 fixed the *empty-room* asymmetry between the transports but
kept the position: after `_server`, "the mutation has already been persisted".

Two ways to stop a delivery problem from masquerading as a mutation failure were
on the table.

## Decision

Resolve the recipients **before** the `_server` handler runs, on both
transports: after auth, rate-limit and the authorize hooks, right before input
validation. A lookup that throws or comes back empty is now a pre-commit
rejection — nothing was persisted, the error is true, and a retry is safe. The
error codes are unchanged (`sync.noReceiversFound`, `sync.serverExecutionFailed`);
only their meaning is: they no longer imply a saved change.

The related fix in core — a per-environment adapter key
(`resolveSocketAdapterKey`, `<PROJECT_NAME>:<env>:socket.io`) so environments
that share a Redis server stop forming one cluster — removes the trigger; this
decision removes the false report for whatever trigger comes next.

## Rejected alternatives

- **Keep the order and acknowledge success once `_server` committed, logging the
  fan-out failure (optionally a `deliveryDegraded` flag)** — rejected by the user
  as saying "success" about something that partly did not happen; the originator
  would learn nothing about recipients that missed the update, and a flag on the
  success envelope moves that judgement to every call site.
- **Keep the order and document the error as "saved, but not delivered"** —
  rejected: a documented false error is still a false error, and the observed
  consequence (retry, double mutation) does not go away by explaining it.
- **Roll back the `_server` mutation on a post-commit fan-out failure** —
  rejected: the framework does not own the handler's side effects (database,
  email, external calls) and cannot undo them; a rollback contract would be a
  promise the framework cannot keep.

## Consequences

- The recipient snapshot is taken one handler-execution earlier. A socket that
  joins the room while `_server` runs misses that single fan-out. Accepted: the
  window is the handler's own latency, and the previous order had the same
  window on the other side (a socket that left during `_server` was still
  emitted to and silently dropped).
- Every UI that read `sync.noReceiversFound` as "your change was saved, nobody
  was listening" is now wrong and should treat it as "not saved" — a behaviour
  change, shipped in a minor bump and called out in the sync CHANGELOG.
- ADR 0058's decision (an empty room is an error on every transport) stands
  unchanged; its stated *position* ("after the `_server` handler has run") is
  refined by this record.
- Framework docs that described the old order — `packages/sync/docs/room-fanout.md`
  §1/§8, `error-states.md`, `server-vs-client-handlers.md`, the sync `CLAUDE.md`
  INDEX and `docs/ARCHITECTURE_SYNC.md` — were rewritten in the same session.
