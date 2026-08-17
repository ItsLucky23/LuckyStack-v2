---
name: derive-function-injection-keys-from-one-shared-registry
title: Derive function-injection keys from one shared registry
status: accepted
date: 2026-08-14
deciders: [mathijs]
tags: [function-injection, codegen, runtime-maps, dev-prod-parity, devkit]
relates: [0042]
---

## Context

The injected `functions` parameter was discovered independently by three layers:

- the dev loader (`packages/devkit/src/loader.ts`) walked every configured `paths.serverFunctionDirs` root and nested by directory;
- the type-map generator (`packages/devkit/src/typeMap/functionsMeta.ts`) walked the same roots and also nested;
- the production map generator (`scripts/generateServerRequests.ts`, and its `create-luckystack-app` template twin) walked two hardcoded directories — `./functions` and `./server/functions` — and keyed every module on `path.basename()` alone.

The third walk disagreed with the other two in two independent ways.

**Missing root.** `serverFunctionDirs` defaults to `['functions', 'shared']`, but the production generator never read the config and never scanned `shared/`. Every `shared/*.ts` module was therefore absent from every generated production map. That includes `shared/tryCatch.ts` and `shared/sleep.ts` — the modules this project's own contract tells route authors to reach through `functions.tryCatch.tryCatch(...)` and `functions.sleep.sleep(...)`. A deployed build raised `TypeError: Cannot read properties of undefined` on the first handler that used either.

**Flattened keys.** Because the key was the bare filename, `shared/rbac/engine.ts` became `functions.engine` in production while dev and the emitted `Functions` interface both said `functions.rbac.engine`. Two modules sharing a filename in different subdirectories silently overwrote each other in the same map.

Neither defect was reachable before deploy. In development `runtimeMapsLoader` delegates to the devkit loader, and the generated types are produced by the second walk — so `npm run lint`, `npm run build`, and the type checker were all green while the artifact that actually ships was wrong. The failure surfaced only as a production runtime crash.

## Decision

Discovery and key derivation move into one module, `packages/devkit/src/functionRegistry.ts`, which all three layers now call:

- `collectFunctionModules()` walks every configured root in `paths.serverFunctionDirs` order and derives each module's key path from its location relative to the root that owns it.
- `renderFunctionsMap()` renders that module list into the nested `functions` export of a generated production map.

The dev loader, the type-map generator, and both production generators consume these. No layer performs its own walk.

Collisions are detected during discovery rather than by whichever emitter happens to write last. A cross-root duplicate key and a key that would be both a module and a namespace both **throw** for the build-time callers, failing `generateArtifacts` with a named diagnostic. The dev loader passes an `onConflict` callback and instead warns and keeps the first claim, because a running dev server should not hard-crash on a duplicate.

`runtimeMapsLoader`'s function-equivalence check (ADR 0042) becomes recursive, since a nested namespace object is rebuilt fresh per preset and a shallow comparison would read two structurally identical namespaces as differing implementations.

The hardcoded `./server/functions` scan is dropped. It is not in the default config, neither other layer ever read it, and no template or repository directory of that name exists — modules placed there were injected in production but absent from dev and from the generated types, which is the same divergence class this decision removes. Projects that want that directory add it to `paths.serverFunctionDirs`.

## Rejected alternatives

- **Patch the production generator in place** (add `shared/`, build a nested key). Fixes the two known symptoms and leaves three independent walks free to drift again on the next change. The defect was the duplication, not the arithmetic.
- **Flatten the dev loader and the type generator to match production.** Makes the cheapest layer authoritative and discards nested namespaces, which are a documented feature of `serverFunctionDirs`.
- **Move `shared/*.ts` into `functions/`.** The `shared/` shims exist so browser-side importers can pull a browser-safe implementation by file path without dragging the server barrel into the Vite bundle. Relocating them trades a server bug for a client bundling bug, and a re-export shim in `functions/` would trip the cross-root collision check.
- **Validate at boot instead of at build.** A readiness probe that compares the generated map against the type map would catch it later and per-deploy; generating from one source makes the mismatch unrepresentable.
- **Warn instead of throw on a duplicate key at build time.** A warning in generator output is exactly what nobody reads; the silent overwrite this replaces was itself a swallowed conflict.

## Consequences

- Production maps grew from the `functions/` set to the full configured registry. In this repository that is 4 modules to 10.
- `functions.<dir>.<file>` now resolves in production for any depth, matching dev and the generated `Functions` interface.
- A duplicate or module/namespace key collision fails the build with exit code 1 and a message naming both source files, where it previously produced a silently incomplete map.
- Consumers upgrading past this version get the fix by running `npm run generateArtifacts`; no source change is required in their project.
- A project that relied on the undocumented `server/functions` scan must add that path to `paths.serverFunctionDirs`.
