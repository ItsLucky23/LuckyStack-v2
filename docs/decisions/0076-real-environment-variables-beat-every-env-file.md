---
name: real-environment-variables-beat-every-env-file
title: A real environment variable beats every env file, including .env.local
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [config, env, deployment, bun]
supersedes: []
relates: [0045]
---

## Context

Core loaded `.env` without override and every later env file (`.env.local`,
further `LUCKYSTACK_ENV_FILES` entries) with override. The loader's override
cannot tell a value from an earlier file apart from a real environment
variable, so `.env.local` silently replaced values set by the shell, Docker,
Kubernetes or CI. The code comment and the Bun-feasibility findings both said
an ambient variable wins, and called that load-bearing for containers (sweep
finding 047). ADR 0045 removed the backend port from the environment but did
not decide file precedence, so this record relates to it without replacing it.

## Decision

A variable that is already in the process environment when env loading starts
beats every env file. Among the files, the later file still wins. "Already
present" is decided at the start of each load, so a repeated load does not
overwrite values written in between, such as values a secret manager resolved.

## Rejected alternatives

- **Keep the override and fix the comments.** It lets `.env.local` override
  orchestrator secrets and modes.
- **Remember which keys came from files and re-apply them on a repeated
  load.** It would overwrite secret-manager-resolved values with their raw
  pointers, and it breaks when two copies of core are loaded.
- **Load every file without override.** It breaks the `.env` → `.env.local`
  layering.

## Consequences

- Deployments get the precedence the documentation already promised.
- A developer who exported a variable in their shell must unset it if
  `.env.local` should win.
- Under Bun with its own env auto-load on, Bun's preloaded values now count as
  ambient, so Bun's precedence decides (it already ranks `.env.local` above
  `.env`). The existing auto-load warning still fires.
