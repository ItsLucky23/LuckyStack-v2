---
name: a-changed-route-dependency-restarts-the-dev-server
title: A changed route dependency restarts the supervised dev server instead of reloading the route in place
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [devkit, hot-reload, dx, supervisor]
supersedes: []
relates: []
---

## Context

Hot reload re-imports a changed route with a cache-busting query, but the ESM
loader caches the route's own imports by their plain URL. After a helper that a
route imports changed, the re-imported route therefore still ran the old helper
code, while the docs claimed that later requests use fresh source (sweep
finding 032).

## Decision

When a file that routes import changes, the dev server asks its supervisor for
a restart over an IPC channel, and the supervisor handles it like a change to a
watched core file: a debounced graceful stop, then a fresh start. Without the
supervisor the affected routes are still re-imported, so their input types
refresh, and a warning says the handler code needs a restart. Editing a route
file itself still reloads that route in place. Bun on Windows is untested with
the IPC channel, so it keeps plain stdio and gets the warning instead.

## Rejected alternatives

- **A loader hook that passes the cache-busting query on to imported modules.**
  It works differently under tsx and Bun, and memory grows with every reload.
- **Fix only the docs and log "restart needed".** The dev server stays silently
  wrong in the common case of editing a helper.
- **Exit with a special code that the supervisor restarts on.** It skips the
  server's graceful shutdown.

## Consequences

- A helper edit now costs a full restart: sockets reconnect, and the new
  process regenerates types on boot.
- The restart module is bundled into the supervisor and must import nothing,
  which the environment-hygiene test also checks.
