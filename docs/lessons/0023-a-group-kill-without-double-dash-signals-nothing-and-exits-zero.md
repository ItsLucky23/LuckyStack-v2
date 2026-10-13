---
name: a-group-kill-without-double-dash-signals-nothing-and-exits-zero
title: Stopping a spawned shell left its server running; a process-group kill without `--` signals nothing and still exits 0
severity: medium
area: scripts/ (e2eVerdaccio.mjs, any script that spawns a long-lived child with shell: true)
date: 2026-10-14
tags: [tooling, processes, posix, silent-failure, e2e]
---

# 0023 — Stopping a spawned shell left its server running; a process-group kill without `--` signals nothing and still exits 0

## What happened

Every local `e2e:verdaccio` run left a verdaccio process on port 4873 after printing "cleaned up". The
next run then talked to a registry that held none of its tarballs. The harness comment already said
"kill the TREE, not just the direct child", but on Linux/macOS it called `child.kill()`.

The first fix spawned the child `detached` (its own process group) and ran `kill -TERM -<pgid>`. The run
still leaked: the command exited 0 and no process received a signal.

## Root cause

Two silent failures stacked:

- With `shell: true` the direct child is `sh -c`; `child.kill()` stops only that wrapper. `npx` →
  `npm exec` → `sh -c verdaccio` → `verdaccio` are reparented and keep the port.
- procps-ng `kill` parses `-835879` after `-TERM` as an option, not as a negative process-group id. It
  signals nothing and returns 0, so the cleanup looks successful.

## How to avoid

- On POSIX, spawn a long-lived child with `detached: true` and stop it with
  `kill -TERM -- -<pid>`; the `--` is required. Because a detached group no longer receives the
  terminal's Ctrl+C, also stop owned groups in a SIGINT/SIGTERM handler.
- Verify cleanup by observation (`ss -ltn`, `ps -g <pgid>`), not by the kill command's exit code.
