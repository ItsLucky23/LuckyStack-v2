---
name: server-owned-shutdown-budget
title: Keep shutdown budgets on server creation and announce parent grace over IPC
status: accepted
date: 2026-11-16
deciders: [implementation-agent]
tags: [server, devkit, shutdown]
supersedes: []
relates: []
---

## Context

Consumers with multi-minute work could not drain through framework signal handlers. Extending only the child timeout would still leave the supervisor free to exit early. The supervisor must not import core or consumer config because env-loading side effects would leak stale values into replacement children.

## Decision

Configure the shutdown budget at server creation, inherited by the high-level bootstrap. Announce the resulting cleanup ceiling to the supervisor over its existing IPC channel. Keep programmatic shutdown idempotent while treating a repeat of the first process signal as explicit escalation. A different signal during the drain is ignored: a terminal Ctrl+C reaches a supervised child as SIGINT and again as the supervisor's SIGTERM.

## Rejected alternatives

- Replacing framework signal handlers in consumers duplicates lifecycle ownership and breaks across upgrades.
- Importing consumer config in the supervisor violates its environment isolation boundary.
- Requiring two matching settings on IPC-capable runtimes leaves a silent parent/child timeout mismatch.

## Consequences

Existing defaults remain intact. Production retains per-step budgets, so operators must allow extra deployment grace for cleanup. Runtimes without IPC still need an explicit supervisor environment override. Server and devkit must preserve the small IPC message contract.
