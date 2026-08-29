---
name: a-windows-only-entrypoint-check-made-the-cli-a-silent-no-op
title: An entry-point check that ignored symlinks made the scaffolder a silent no-op everywhere but Windows
severity: critical
area: packages/create-luckystack-app (CLI entry) + CI (e2e-scaffold)
date: 2026-08-29
tags: [cli, symlink, npx, cross-platform, silent-failure, ci]
---

# 0021 — An entry-point check that ignored symlinks made the scaffolder a silent no-op everywhere but Windows

## What happened

`npx create-luckystack-app my-app` on macOS/Linux loaded the module, ran nothing, printed nothing and
exited **0**. Not a crash, not an error message — a successful-looking run that created no project.

The `e2e-scaffold` CI job had never passed a single time since it was added. Its log is the whole story
in three lines:

```
[e2e] scaffold (real registry, WITH install)     <- 0.63 seconds, zero output, exit 0
[e2e] scaffold produced a project directory      <- the check's own banner
[e2e] scaffold produced no project directory
```

The step it shells out to reported success. Only the harness's separate "did a directory actually appear"
assertion caught it — which is the one reason this was ever visible at all.

## Root cause

The CLI guards its own side effects so the unit tests can import the module without triggering a
scaffold:

```ts
return path.resolve(process.argv[1]) === path.resolve(__filename);
```

On macOS/Linux npm installs a bin as a **symlink**: `node_modules/.bin/create-luckystack-app` →
`../create-luckystack-app/dist/index.js`. Node then reports the **symlink** in `process.argv[1]` but
resolves `import.meta.url` (hence `__filename`) to the link **target**. The two strings are never equal,
so the guard is permanently false and `main()` is never called.

Windows has no symlink here — npm writes a `.cmd` shim that passes the real path — so every local run on
the developer's machine was green, and the platform where it was broken was the one nobody ran it on.
The fix is to realpath **both** sides before comparing.

## How to avoid

- **A guard that decides whether to do the work at all must fail LOUD, never quiet.** "Did not run" and
  "ran and succeeded" both being exit 0 with no output is the same defect family as lesson 0019: the
  reassuring reading of an ambiguous signal is the one everybody takes.
- **`process.argv[1]` is the path node was GIVEN; `import.meta.url` / `__filename` is the path it
  RESOLVED.** They differ for any symlinked entry point — which is exactly how npm, npx and pnpm install
  every bin on POSIX. Compare `fs.realpathSync` of both, or don't compare paths at all.
- **A cross-platform CLI is unverified until CI runs it on the other platform.** Windows-only local
  testing cannot see a symlink bug, because Windows has no symlink to see. The e2e job was right; it was
  just never believed.
- **When a shelled-out command "succeeds" in under a second, it did not do the thing.** Wall-clock is a
  free assertion: a step that installs a package tree cannot finish in 0.6s.

Related: `docs/lessons/0019-a-skipped-check-reports-the-same-value-as-a-clean-one.md`.
