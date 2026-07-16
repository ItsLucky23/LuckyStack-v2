# v0.7.0 ORM + runtime readiness — 2026-07-16

> AI findings ledger (Findings Protocol).
> Scope: evidence behind “Prisma, MikroORM, and Drizzle are deeply tested on Node and Bun” · Method: harness/source audit, real deep type fixtures, direct Node+Bun codegen, real-registry scaffolds, ORM CRUD, production server boots, and health checks · Supersedes: —

Last updated: 2026-07-16

| # | Finding | Severity | Status | Since | Resolved | Notes |
|---|---------|----------|--------|-------|----------|-------|
| OR-01 | `e2eVerdaccio --runtime=bun` does not boot LuckyStack under Bun. | HIGH | fixed | 2026-07-16 | 2026-07-16 | `--runtime=node|bun|both` now boots the built server with the selected executable and requires HTTP 200 from `/livez` and `/_health`; all six ORM/runtime cells passed. |
| OR-02 | Drizzle has no real nested wire-projection fixture or Node/Bun runtime test here. | MED | fixed | 2026-07-16 | 2026-07-16 | Added a real three-level Drizzle relational-query inferred type, portable generated type queries, and SQLite CRUD/Date E2E. Node uses `better-sqlite3`; Bun uses `drizzle-orm/bun-sqlite`; the shared production bundle boots on both. |
| OR-03 | Prisma CRUD is proven on four databases and both runtimes, but deep relation-output projection is not pinned. | MED | fixed | 2026-07-16 | 2026-07-16 | Added a real Prisma `Result.GetResult` relation graph with four nested Dates and recursive `JsonValue`; Node and Bun projection gates pass without graph collapse or ellipses. |
| OR-04 | MikroORM deep type projection is strong, but runtime-serialization parity is a manual measurement rather than an automated Node+Bun assertion. | LOW | fixed | 2026-07-16 | 2026-07-16 | Added populated `EntityDTO<Loaded<...>>` coverage plus automated Node+Bun deep projection, ORM CRUD/Date serialization, production boot, and health assertions. |
| OR-05 | Vitest cannot currently execute this suite under Bun, although direct Bun imports and extraction work. | LOW | wontfix | 2026-07-16 | 2026-07-16 | Reconfirmed with Vitest 4.1.8/Vite 8.0.16: only Bun-launched Vitest transforms Zod's named export to undefined. Direct Bun Zod/core/devkit, codegen, all ORM CRUD, and the real server pass. Bun Vitest is therefore not used as runtime evidence; dedicated executable E2E gates cover Bun instead. |

## Final evidence

- The seven unpushed-review findings are fixed.
- Real deep output fixtures cover Prisma `Result.GetResult`, Drizzle relational
  query inference, and populated MikroORM `EntityDTO<Loaded<...>>` graphs. Node
  and Bun both project every nested `Date` to `string` without `any`, symbol-key
  internals, malformed recursion, or collapsed relations.
- The real-registry E2E scaffolds each ORM, installs its real dependencies,
  typechecks, builds, applies its SQLite schema, executes ORM CRUD plus nested
  Date serialization on Node and Bun, then boots that same production bundle on
  both runtimes and requires HTTP 200 from `/livez` and `/_health`.
- Prisma's broader MongoDB/MySQL/PostgreSQL/SQLite CRUD matrix on both runtimes
  remains covered by the dated Bun-feasibility run.
- Dependency audit after the Drizzle upgrade reports zero high/critical issues;
  remaining advisories are three moderate OpenTelemetry issues and one low
  esbuild development-server issue.

## Release interpretation

There are zero open items. The broad Prisma/MikroORM/Drizzle × Node/Bun claim is
now backed by repeatable type, serialization, CRUD, build, production-boot, and
health evidence. Vitest itself remains Node-hosted because its Bun transform path
breaks a valid Zod import; Bun behavior is tested by dedicated executable gates
instead of reporting a skipped or runner-broken suite as a pass.
