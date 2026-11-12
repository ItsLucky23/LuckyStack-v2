# Branch log — fix/devkit-typemap-single-run

## 2026-11-06 21:45 — Type-map generation complete in one run on a clean checkout

**User prompt (summary):** a colleague's handoff: `generateTypeMapFile()` needs two runs on a clean checkout because routes are extracted before `apiTypes.generated.ts` (with `Functions`, `ApiResponse`, …) exists. Generate the fixed part first, write a bootstrap file only when needed, keep the steady state free of extra work, add a regression test and a CHANGELOG note. The user was away and asked to finish it and ask questions afterwards.

**What I did:**
- Moved the `Functions` rendering before route extraction. A new step compares the file on disk with a bootstrap (the existing template with empty route maps); on a mismatch it writes the bootstrap, drops the cached Program and renders `Functions` again on the new Program (at most two bootstrap writes, then a warning).
- The comparison is on the syntax tree, not on text: the scaffolded `generateTypeMaps.ts` runs prettier over the file after each run (this repo and Flexbuddy both have prettier), so a text check would have bootstrapped on every run.
- Route imports stay in front of the `Functions` imports in the header, so the output order is unchanged.
- Regression test with a temp fixture project (a route that uses `functions.*`, one that uses `ApiResponse`): clean run = 2 Programs, then byte-identical output with 1 Program; steady state after prettier = 1 Program; a `Functions` change bootstraps again.

**Files touched:** `packages/devkit/src/typeMap/typeMapBootstrap.ts`, `packages/devkit/src/typeMapGenerator.ts`, `packages/devkit/src/typeMapGenerator.singleRun.test.ts`, `packages/devkit/CHANGELOG.md`, `packages/devkit/docs/type-map-generation.md`.

**Notes / decisions:**
- The new test fails on the old generator (`greeting: any` after run one).
- Flexbuddy scratch copy (outside both repos, patched devkit dist): run 1 = 18 lines with `any`, runs 2 and 3 byte-identical, no bootstrap in runs 2–3. The published 0.16.0 devkit on a clean copy: 536 lines with `any` after run 1, and its run 2 is byte-identical to the new run 1 (types, schemas, docs). Steady-state run time is unchanged within noise (new 52–56 s, old 55–59 s); the syntax comparison costs ~190 ms on the 38k-line formatted file.
- Not done: no release/version bump; Flexbuddy CI still runs `generateArtifacts` twice until it upgrades.
