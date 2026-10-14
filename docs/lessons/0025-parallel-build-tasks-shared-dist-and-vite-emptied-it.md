---
name: parallel-build-tasks-shared-dist-and-vite-emptied-it
title: Running vite build and the server bundle in parallel deleted dist/server.js while every step exited 0
severity: high
area: package.json build/verify scripts (root and scaffold template), scripts/e2eVerdaccio.mjs
date: 2026-10-14
tags: [build, parallelism, vite, silent-failure, e2e, ci]
---

# 0025 — Running vite build and the server bundle in parallel deleted dist/server.js while every step exited 0

## What happened

The TypeScript 7 toolchain work made `build` and `verify` run `vite build` and
`node scripts/bundleServer.mjs` as separate parallel tasks. Every run exited 0:
the local gate, CI on GitHub, and the verdaccio e2e (install, typecheck, build).
An upgrade test that started the production server afterwards found no
`dist/server.js`: four builds out of four lost it, in the root repo and in a
scaffold. `npm run build && npm run prod` was broken on `main`.

## Root cause

Both tasks write to `dist/`. Vite empties its output directory when it writes
the bundle, near the end of its build, so the server bundle (done in about a
second) was written first and then deleted. The gates only looked at exit codes;
nothing checked that the artefacts existed.

## How to avoid

- Before running build steps in parallel, list their outputs. Tasks that write
  the same directory (or one empties what another writes) stay one task, in
  order: here `"vite build && node scripts/bundleServer.mjs"`.
- A build gate checks its artefacts, not only the exit code: the e2e now asserts
  `dist/index.html` and `dist/server.js` after `build` and `verify`, and a unit
  test rejects `build`/`verify` scripts that run the client build and the server
  bundle as separate parallel tasks.
- Start the built server at least once when a delivery change touches the build
  (the e2e's `--runtime=node`). See ADR 0067.
