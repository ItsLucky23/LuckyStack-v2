# Contributing to LuckyStack

This document covers the conventions framework maintainers follow. End-user
documentation lives in `docs/DEVELOPER_GUIDE.md` and the per-package
`packages/*/README.md` files.

## Versioning policy

LuckyStack ships in **lockstep**: every `@luckystack/*` package on npm carries
the same version number on every release (mirrors the Vite, Vue, and Astro
release model). Peer-dep ranges between framework packages use `^x.y.z`
pinned to the current major.

Why lockstep:
- The packages are tightly inter-coupled (`@luckystack/server` requires
  matching `@luckystack/api` + `@luckystack/login` + `@luckystack/sync`).
- Consumers don't need to think about compatibility matrices.
- A single `@luckystack/server@1.4.0` install pulls a coherent set of
  dependencies.

Independent versioning is not supported and won't be accepted in PRs.

## Publishability tiers

| Tier | Packages | Status |
| --- | --- | --- |
| A (publishable) | core, sentry, login, api, sync, presence, server, test-runner, docs-ui, create-luckystack-app | `"private": false`, published per release |
| B (monorepo-only) | devkit, router | `"private": true`, never published — these are project-glue tools that depend on the consumer's source tree |

## Adding a new framework package

1. Place the package under `packages/<name>/`.
2. Mirror an existing package's layout: `package.json`, `tsconfig.json`,
   `tsup.config.ts`, `src/`, `README.md`.
3. Add it to `scripts/buildPackages.mjs`'s `ORDER` array in topological
   build order.
4. If it ships hooks, add a `src/hookPayloads.ts` augmenting
   `@luckystack/core`'s `HookPayloads` (see `packages/login/src/hookPayloads.ts`
   or `packages/server/src/hookPayloads.ts` for the exact pattern).
5. If it adds runtime configuration knobs, register a registry under
   `@luckystack/core` (`registerXxx` / `getXxx`) instead of reaching for env
   vars or relative imports.

## Avoid

- Relative imports that escape the package boundary (`from '../../../...'`).
  Use registries on `@luckystack/core` instead.
- Hard-coded filesystem paths. Read from `getProjectConfig().paths` or
  `getSrcDir()` / etc.
- Hard-coded route markers (`_api`, `_sync`). Read from `getRoutingRules()`.
- Direct `process.env.*` reads inside framework packages for anything that
  belongs in `ProjectConfig` or `DeployConfig`.
- Direct `@prisma/client` enum imports. Use the user adapter or pass the
  values in as plain strings.
