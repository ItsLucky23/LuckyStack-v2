---
name: exclude-test-files-from-every-import-everything-surface
title: Exclude test files from every import-everything surface
status: accepted
date: 2026-08-21
deciders: [mathijs]
tags: [overlay, function-injection, bundling, dev-prod-parity, conventions]
relates: [0046]
---

## Context

Three framework surfaces discover files on disk and then import every one they find:

- the **overlay loader** (`packages/server/src/bootstrap.ts`) — imports every `.ts`/`.js` directly inside `luckystack/<pkg>/`;
- the **overlay bundler** (`scripts/bundleServer.mjs` and its `create-luckystack-app` template twin) — statically bundles that same set into the production server;
- **server function injection** (`packages/devkit/src/functionRegistry.ts`) — walks every `paths.serverFunctionDirs` root and injects each module onto the `functions` parameter, in dev, in the generated `Functions` interface, and in the production runtime map.

None of them excluded test files. Route discovery never needed to: `getUser_v1.tests.ts` fails the `_v<N>.ts` filename regex, so it is filtered for free. The three surfaces above match on "is it a `.ts`", which nothing about a test file fails.

The consequences differ by how the test file is written. One that imports a test runner crashes boot — loud, and recoverable. One that only performs side effects (registering a stub adapter, seeding a fixture, overriding a provider) is imported at boot and baked into the production bundle, quietly changing production behaviour. The failure mode is silent exactly where it matters most.

Separately, the overlay walk is flat by design, and it dropped subdirectories without a word. Overlay code placed one level down never ran, and nothing in the logs pointed at it.

## Decision

`@luckystack/core` owns one convention: `isTestFile` (`*.test|tests|spec.*` across `ts/tsx/js/jsx/mts/cts/mjs/cjs`) and `isTestDirectory` (`__tests__`, `__mocks__`). All three surfaces consult it.

The overlay contract is owned by one exported function, `collectOverlayEntries(packageDir)` in `@luckystack/server`. It returns the files to import in load order plus the subdirectories it skipped. The runtime loader and both bundlers call it, so what boots and what ships are decided by the same code rather than by three lookalike implementations.

A skipped subdirectory is now **reported** — the loader warns, naming the folder and what to do about it — except for conventional test folders, which are meant to be ignored.

The bundlers keep a small inline fallback for the fresh-checkout case where the package dist does not exist yet. A parity test pins its pattern to core's, mirroring how `OVERLAY_ORDER` is already pinned.

This is deliberately broader than devkit's route-only `isRouteTestFile` (`.tests.ts`). That predicate governs route filenames, where the framework dictates the convention; these surfaces hold consumer-authored files, and consumers write `.test.ts` and `.spec.ts` too.

## Rejected alternatives

- **Document it and move on.** The trap is invisible until production behaves differently from dev, which is the same shape as ADR 0046 and cost a full session to trace there. A convention nobody can violate beats a convention nobody reads.
- **Filter only in the loader.** The bundler would still ship the file, so dev and prod would disagree — the precise divergence ADR 0046 exists to prevent.
- **Reuse `isRouteTestFile` unchanged.** `.tests.ts` only. A consumer's `userAdapter.test.ts` would still boot.
- **Make the overlay walk recursive.** A larger contract change: it would give subdirectories a load order that does not currently exist, and change which files run for every existing project. Warning keeps today's behaviour and makes it visible.
- **Throw on a skipped subdirectory.** Too aggressive for a folder a consumer may keep on purpose (notes, fixtures, scratch). A warning names the problem without breaking a working boot.

## Consequences

- A test file inside `luckystack/<pkg>/` or a `serverFunctionDirs` root is now ignored everywhere instead of being imported at boot and bundled into production.
- `functions/db.tests.ts` no longer appears as `functions['db.tests']` in the generated `Functions` interface or the production runtime map.
- A project that (knowingly or not) relied on an overlay test file executing at boot loses that side effect. This is the intended correction; the file was never meant to run in production.
- Overlay code in a subdirectory still does not run, but now says so on every boot.
- `collectOverlayEntries` is public API: consumers and tooling can ask what a given overlay folder contributes without reimplementing the walk.
