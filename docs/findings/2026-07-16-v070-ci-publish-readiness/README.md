# v0.7.0 CI publish readiness — 2026-07-16

> AI findings ledger (Findings Protocol).
> Scope: follow the v0.7.0 GitHub Actions release through installation and publication · Method: tag-triggered workflow, failed-log inspection, cross-npm local reproduction, lockfile repair, regular CI rerun, manual CI publication from corrected `main` · Supersedes: —

Last updated: 2026-07-16

| # | Finding | Severity | Status | Since | Resolved | Notes |
|---|---------|----------|--------|-------|----------|-------|
| CI-01 | The Windows-generated lockfile omitted two optional WASM transitive packages, so Linux `npm ci` rejected the graph before any v0.7.0 build or publication step. | HIGH | fixed | 2026-07-16 | 2026-07-16 | Failed publish run `29507130350` safely stopped at install. Added direct tooling-only dev dependencies for `@emnapi/core` and `@emnapi/runtime`, which retain the cross-platform lock entries. Local `npm ci --dry-run --ignore-scripts` passes under npm 10.9.4, 11.6.1, and 12.0.1; corrected Linux CI installed successfully on Node 20 and 22. The publish workflow pins npm 11.6.1 instead of mutable `latest`; GitHub actions moved to v5. |
| CI-02 | A Windows-specific Bun-supervisor test used the host OS's `path.isAbsolute`, so its intentionally Windows-shaped fixture failed on Linux after the lockfile let CI finally reach the unit suite. | MED | fixed | 2026-07-16 | 2026-07-16 | Runtime code was not implicated: the other nine supervisor tests passed. The assertion now uses `path.win32.isAbsolute`, matching the Windows `.cmd` scenario it explicitly simulates. Corrected run `29508630527` passed install, generation, package builds, lint, full build, and 1817/1817 tests on Node 20 and 22. |

## Final publication

The failed tag workflow did not run build, pack, or publish; npm still reported 0.6.7
for both `@luckystack/core` and `create-luckystack-app` after the failure. The corrected
commit was first published safely through the workflow's explicit `workflow_dispatch`
real-publish path.

GitHub publish run [`29509197209`](https://github.com/ItsLucky23/LuckyStack-v2/actions/runs/29509197209)
completed every gate and the real provenance publish from corrected `main` commit
`508ef66`. Registry verification confirmed all 17 packages at 0.7.0. npm exposes SLSA
provenance attestations for both scoped packages (verified on `@luckystack/core`) and
the unscoped scaffolder (`create-luckystack-app`).

After publication, the user explicitly approved aligning the release tag with the
provenance source. `v0.7.0` now peels to `508ef66`; the forced tag-update rerun
[`29514853464`](https://github.com/ItsLucky23/LuckyStack-v2/actions/runs/29514853464)
passed every gate and idempotently accepted the already-published versions.
