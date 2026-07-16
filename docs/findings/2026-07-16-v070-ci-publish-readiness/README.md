# v0.7.0 CI publish readiness — 2026-07-16

> AI findings ledger (Findings Protocol).
> Scope: follow the v0.7.0 GitHub Actions release through installation and publication · Method: tag-triggered workflow, failed-log inspection, cross-npm local reproduction, lockfile repair, regular CI rerun, manual CI publication from corrected `main` · Supersedes: —

Last updated: 2026-07-16

| # | Finding | Severity | Status | Since | Resolved | Notes |
|---|---------|----------|--------|-------|----------|-------|
| CI-01 | The Windows-generated lockfile omitted two optional WASM transitive packages, so Linux `npm ci` rejected the graph before any v0.7.0 build or publication step. | HIGH | in-progress | 2026-07-16 | — | Failed publish run `29507130350` safely stopped at install. Added direct tooling-only dev dependencies for `@emnapi/core` and `@emnapi/runtime`, which retain the cross-platform lock entries. Local `npm ci --dry-run --ignore-scripts` now passes under npm 10.9.4, 11.6.1, and 12.0.1. The publish workflow pins npm 11.6.1 instead of mutable `latest`; GitHub actions moved to v5. Awaiting corrected Linux CI + GitHub publish confirmation. |

## Publication safety

The failed tag workflow did not run build, pack, or publish; npm still reported 0.6.7
for both `@luckystack/core` and `create-luckystack-app` after the failure. Because the
remote `v0.7.0` tag already exists, the corrected commit will be published via the
workflow's explicit `workflow_dispatch` real-publish path rather than force-moving a
public tag.
