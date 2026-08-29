---
name: a-second-discovery-walk-only-diverges-in-production
title: A second discovery walk only diverges in production
severity: high
area: codegen
date: 2026-08-14
tags: [function-injection, codegen, dev-prod-parity, runtime-maps, deploy]
---

# 0018 — A second discovery walk only diverges in production

## What happened

A deployed build crashed with `TypeError` on `await functions.sleep.sleep(...)`: `functions.sleep` was `undefined`. The same call worked locally, the generated types declared it, the type checker accepted it, and `npm run lint && npm run build` were green. The same hole also hid `functions.tryCatch` — the error-handling helper every API and sync handler is told to use — so the scaffold's own `logout_v1` route was one production request away from the identical crash.

The cause was not the calling code. `scripts/generateServerRequests.ts` walked two hardcoded directories instead of reading `paths.serverFunctionDirs`, so the entire `shared/` root was missing from every production map. It also keyed modules on `path.basename()`, so any module in a subdirectory landed on the wrong key.

## Root cause

Three layers answered "which function modules exist and what are they called" with three separate directory walks: the dev loader, the type-map generator, and the production map generator. Only the third was wrong, and it is the only one that never runs during development — in dev, `runtimeMapsLoader` delegates to the devkit loader instead.

That combination makes the defect structurally invisible before deploy. Every local signal is produced by one of the two correct walks. There is no test, type error, or lint rule that compares the shipped artifact against the contract the other two layers publish.

## How to avoid

- When more than one layer must agree on *what exists* — file discovery, key derivation, route naming — give them one shared function to call. Two walks over the same tree are a latent divergence, not a duplication smell you can defer.
- Be specific about which layers a green local build actually exercised. "Dev works, types are green, build passes" says nothing about a generated production artifact that no local code path loads.
- Treat a generated file that only production reads as untested by default. Assert on its content (this repo now does, in `packages/devkit/src/functionRegistry.test.ts`), or generate it from a source that is already covered.
- Make a discovery collision throw at build time. Both defects here degraded to a silently incomplete map; the flattened key even overwrote one module with another without a word.
- When a config key has a default (`serverFunctionDirs` defaults to `['functions', 'shared']`), check that every consumer reads the config rather than restating the default. A hardcoded copy of a default is a copy that stops matching.

## Related

- Decision: `docs/decisions/0046-derive-function-injection-keys-from-one-shared-registry.md`
- Findings: `docs/findings/2026-08-14-prod-function-map-divergence/`
