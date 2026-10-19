---
name: boot-uuid-key-is-namespaced-by-project
title: The boot UUID Redis key is namespaced by project
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [readiness, redis, boot-uuid, router, multi-instance]
supersedes: []
relates: [0036]
---

## Context

ADR 0036 keeps one boot UUID per environment in Redis. The key named only the
environment, so two projects with the same environment name on one Redis
overwrote each other's key. That rotated the other project's health-signing
secret, produced false handshake mismatches between router and backend, and
let `/readyz` stay green on the other project's key. The Socket.io adapter key
is already scoped by project for the same shared-Redis case.

## Decision

The boot UUID key includes the project name next to the environment, and one
core function builds it for every reader and writer: the backend that writes
and refreshes it and the router handshake that reads it. The project name in
this key comes from `PROJECT_NAME` (default `luckystack`) only, never from
`session.projectName` in `config.ts`, because the standalone router CLI does
not load `config.ts`.

## Rejected alternatives

- **Build the key with the general Redis key formatter.** It also applies the
  project's key-formatting rules, which ties an infrastructure key to
  application key policy.
- **Add the prefix in the router only.** Writer and reader would drift apart.
- **Use the general project name (`session.projectName` before
  `PROJECT_NAME`).** The router CLI cannot see a name set only in config, so
  backend and router would build different keys.

## Consequences

- Router and backends must be upgraded together and resolve the same project
  name; a mixed pair reports a handshake mismatch, which is a startup failure
  with the strict boot handshake.
- Router and backend always agree when they share `PROJECT_NAME`, which the
  scaffold's `deploy.config.ts` synchronizes. A project that names itself only
  through `session.projectName` uses `luckystack` in this key, so two such
  projects on one Redis and environment still share a boot UUID; set
  `PROJECT_NAME` to separate them.
