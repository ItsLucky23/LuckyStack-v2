---
name: typescript-7-checks-typescript-6-serves-the-js-api
title: TypeScript 7 type-checks and emits declarations; TypeScript 6 stays only for tools that need the JavaScript compiler API, and every tool shares one thread budget
status: accepted
date: 2026-10-13
deciders: [ItsLucky23]
tags: [build, tooling, typescript, performance, packaging]
supersedes: []
relates: []
---

## Context

The completion gate (lint, build, unit tests) took about 7.5 minutes sequentially
on a 12-thread machine and used a fraction of it: `tsc` and the per-package
declaration bundling were single-threaded, the package build ran in six
dependency waves, and ESLint ran one process per scope. TypeScript 7 (the Go
compiler) checks this repository about ten times faster and builds project
references in parallel, but it ships no JavaScript compiler API. typescript-eslint,
tsup's declaration pass and devkit's route-type generator all used that API.

Running every tool at once is only safe with a shared limit: each type-aware ESLint
worker holds its own TypeScript program (~2 GB here), and a Go or Rust tool takes
every core by default.

## Decision

Split the compiler by role. `@typescript/native` (TypeScript 7) does all
type-checking and declaration emit, called by path because the TypeScript 6
package also installs a `tsc` command. The `typescript` name is an alias of
`@typescript/typescript6`, kept only for tools that load the JavaScript API
(typescript-eslint, tsup's bundler). Devkit moves to the TypeScript 7.1 API over
its native process, exact-pinned, so it no longer follows the project's
`typescript` version.

Package declarations come from one `tsc -b` solution build (references mirror the
real `@luckystack` imports) instead of a bundled `.d.ts` per package; tsup emits
JavaScript only. Emitted relative specifiers get an explicit `.js`, because a
`node16`/`nodenext` consumer with `skipLibCheck` otherwise resolves every
LuckyStack type to `any` without an error. `stableTypeOrdering` keeps
TypeScript 6 consumers of the generator in TypeScript 7's order.

`npm run verify` runs lint, typecheck, build and unit tests concurrently inside one
thread budget (`LUCKYSTACK_MAX_THREADS`, default all cores), split by weight per
task and passed on as `GOMAXPROCS`/`RAYON_NUM_THREADS`; ESLint's worker count is
also capped by available memory.

## Rejected alternatives

- **Stay on TypeScript 5/6 and only parallelise the scripts** — rejected because
  `tsc` and declaration bundling remain single-threaded; they were the long pole.
- **TypeScript 7 everywhere, dropping the JavaScript API** — rejected because
  typescript-eslint has no TypeScript 7 support; type-aware lint would be lost.
- **Keep tsup's bundled declarations** — rejected because it checks each package
  again, sequentially per dependency wave, and keeps the JavaScript API in the
  type path. The per-file layout was accepted on the condition that the public
  type surface stays equal (verified: 1164 exports, no difference).
- **Let each tool pick its own thread count** — rejected because concurrent
  tools each claiming all cores oversubscribe the machine, and unbounded ESLint
  workers exhaust memory.

## Consequences

The full gate fell from about 7.5 minutes to about 70 seconds here; see the
branch log of 2026-10-13 for the before/after table. Two TypeScript versions are
installed side by side until typescript-eslint supports TypeScript 7; then the
alias can go. Devkit depends on a TypeScript 7.1 dev build until 7.1 is stable;
upgrading it is a deliberate, tested pin bump. Generated route types reordered
once. Consumers upgrade `package.json` by hand (the update command never touches
it); the scaffold changelog lists the steps.
