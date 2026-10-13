---
name: two-typescripts-share-one-tsc-bin-and-install-order-picks-it
title: With TypeScript 6 and 7 side by side, `tsc` in scripts silently ran TypeScript 6 after a reinstall
severity: medium
area: package.json scripts, scripts/buildPackages.mjs, scaffold template
date: 2026-10-14
tags: [tooling, typescript, npm, bin, silent-failure]
---

# 0024 — With TypeScript 6 and 7 side by side, `tsc` in scripts silently ran TypeScript 6 after a reinstall

## What happened

The toolchain keeps `typescript` as an alias of `@typescript/typescript6` (for the JavaScript API) and
installs TypeScript 7 as `@typescript/native`, which owns the `tsc` command. After a plain `npm install`
the lockfile held a stray `typescript@6.0.3` and `node_modules/.bin/tsc` pointed at TypeScript 6. Every
`tsc -b` still succeeded, only ten times slower and with TypeScript 6 semantics; nothing failed.

## Root cause

`@typescript/typescript6` depends on a real `typescript@6` package (installed under another name), and
that package also declares a `tsc` bin. When two installed packages declare the same bin name, npm
links whichever it places last, so the winner depends on install order and lockfile state.

## How to avoid

- Call the compiler by path (`node node_modules/@typescript/native/bin/tsc`) in every script that
  must run TypeScript 7; never rely on a bare `tsc` while two TypeScript versions are installed.
- After a dependency change, check `readlink node_modules/.bin/tsc` and the `typescript` entry in the
  lockfile (it must be the alias). See ADR 0067.
