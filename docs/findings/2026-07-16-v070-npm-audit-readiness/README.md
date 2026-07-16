# v0.7.0 npm audit readiness — 2026-07-16

> AI findings ledger (Findings Protocol).
> Scope: resolve the release branch's three moderate and one low npm audit findings · Method: dependency-tree inspection, direct/floor upgrades, lockfile verification, `npm audit`, package builds/tests, and real-registry scaffold installation · Supersedes: —

Last updated: 2026-07-16

| # | Finding | Severity | Status | Since | Resolved | Notes |
|---|---------|----------|--------|-------|----------|-------|
| NA-01 | Sentry's OpenTelemetry tree resolved three vulnerable package nodes covered by GHSA-8988-4f7v-96qf. | MED | fixed | 2026-07-16 | 2026-07-16 | Upgraded the repository, scaffold, CLI asset, peer floor, and docs to Sentry 10.66.0; the lockfile now resolves `@opentelemetry/core`, `resources`, and `sdk-trace-base` 2.9.0. |
| NA-02 | The transitive esbuild version retained one low-severity development-server advisory. | LOW | fixed | 2026-07-16 | 2026-07-16 | Upgraded `tsx` to 4.23.1 and pinned the workspace override to esbuild 0.28.1; scaffold and CLI dependency surfaces were kept in sync. |

## Verification

- `npm audit`: **0 vulnerabilities**.
- Full unit suite: **1817/1817 passed**.
- Strict Redis integration suite: **13/13 passed**.
- All package builds, root client/server builds, lint, TypeScript, invariant lint,
  changelog check, and package-specific browser-boundary regressions passed.
- A real Verdaccio publication/scaffold with Sentry + Drizzle installed from the
  generated tarballs, typechecked, built without browser warnings, executed SQLite
  CRUD + nested Date serialization on Node and Bun, and returned HTTP 200 from
  `/livez` and `/_health` on both runtimes.
