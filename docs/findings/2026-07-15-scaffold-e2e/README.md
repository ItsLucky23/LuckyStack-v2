# Scaffold end-to-end via a local registry — 2026-07-15

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: a real `create-luckystack-app` scaffold + install resolved by SEMVER from a throwaway verdaccio, then generate → typecheck → build · Tool: `npm run e2e:verdaccio` (new this session) · Supersedes: —

Last updated: 2026-07-15

**Why this folder exists:** a `file:` + `overrides` harness cannot reach the real install path — the scaffolder resolves `@luckystack/*` by semver from a registry. That gap is where **Bug H** hid (a Windows `npm.cmd` space-in-path bug that silently broke `npx create-luckystack-app` for every standard Windows user, missed by 1370 green unit tests). The recipe previously existed only as prose in `branch-logs/`; it is now `scripts/e2eVerdaccio.mjs`.

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| E1 | **A freshly scaffolded project cannot `npm run typecheck` or `npm run build`.** Both fail with `TS2307: Cannot find module '../_sockets/apiTypes.generated'` plus ~4 cascading errors in `SessionProvider.tsx` (`Type 'string' is not assignable to type 'never'`). The scaffold ships **without** the generated route/type maps: the repo root has a guarded `postinstall` that generates them when missing, **the template does not**; `test` chains `generateArtifacts` (deliberately, per the package docs) but `typecheck` and `build` do not; and `main()` runs install + `prisma generate` but never generation. The intended first command IS `npm run server`, which generates them via the dev supervisor — so the happy path works and this only bites someone who typechecks/builds **before ever running the dev server**: a CI pipeline (`npm ci && npm run typecheck`), or an AI agent asked to verify the scaffold. | MED | open | 2026-07-15 | — | Found by the first full e2e run. Recommended fix: mirror the root's guarded `postinstall` into `template/package.json`. **Not applied — outside the task that found it (Report-Without-Auto-Fixing).** Note `docs/UPGRADING.md` already prescribes `generateArtifacts` → `typecheck`, so the sharp edge is known on the upgrade path but not on the scaffold path |

## What the e2e proved GREEN (the real install path)

Real registry, real semver resolution, real onboarding install — not a `file:` shortcut:

**`npm run e2e:verdaccio` (npm + node baseline): ALL GREEN, exit 0.**

| Step | Result |
|---|---|
| build packages | ✅ |
| publish 17/17 to the local registry | ✅ (via the REAL `scripts/publishPackages.mjs`, not a reimplementation) |
| the registry serves OUR tarball, not npmjs | ✅ `http://127.0.0.1:4873/create-luckystack-app/-/create-luckystack-app-0.6.7.tgz` |
| **scaffold via `npx`, WITH install** | ✅ ← the onboarding path Bug H broke |
| **`npm install` (idempotent re-install)** | ✅ ← the add/upgrade path |
| generateArtifacts | ✅ |
| typecheck | ✅ |
| build | ✅ |

### Matrix coverage

| PM | Runtime | Status |
|---|---|---|
| npm | node | ✅ **ALL GREEN** |
| bun | node | ⏳ running |
| npm | bun | not yet run |
| bun | bun | not yet run |

## Harness bugs found by RUNNING it (all mine, all fixed)

Recorded because the pattern matters more than the bugs: **three of the eight would have produced a GREEN run that proved nothing** — strictly worse than a red one, because red forces you to look. The script had been written, reviewed, and called "ready" before any of these surfaced.

| # | Bug | Would have caused |
|---|---|---|
| 1 | `waitForPort` probed IPv4 while verdaccio binds `[::1]` given only a port | Full timeout against a healthy server. The manual check passed only because `curl localhost` prefers IPv6 on Windows |
| 2 | `stdio: 'ignore'` discarded verdaccio's log | A clear "address in use" became a mute 120s timeout |
| 3 | No pre-flight port check | 🔴 **Publishing into, and testing against, someone else's registry** |
| 4 | `kill()` on the `npx` wrapper, not the tree | Every run orphaned a verdaccio that poisons the next run — this is what created the stray that exposed #1 |
| 5 | `create-luckystack-app` is **unscoped**, so `@luckystack/*`-local-only didn't cover it → fell through to the npmjs proxy | 🔴 **Silently testing the PUBLISHED scaffolder** |
| 6 | Reimplemented `npm publish` instead of calling `scripts/publishPackages.mjs` | Missed that `publishConfig.provenance: true` needs the `--provenance=false` FORM (plain `--no-provenance` and the env var do nothing — lesson 0005, walked into again), and skipped the script's idempotency check. A harness built to catch drift, introducing drift |
| 7 | npx caches under `_npx/<hash>` keyed by the package **spec**, not the registry | 🔴 **Silently running the npmjs copy** even with a correct local registry. Fixed with a per-run `npm_config_cache` |
| 8 | Skipped `generateArtifacts` | Misread E1 as a harness artifact instead of the real finding it is |

Mitigation now in the script: an explicit **"the registry serves OUR tarball"** assertion (#5 and #7 would both have failed it immediately), a pre-flight port check that refuses to run (#3), and tree-kill teardown (#4). A harness that claims it tests the real path must **prove** it, not assume it.
