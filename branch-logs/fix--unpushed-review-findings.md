# Branch: fix/unpushed-review-findings

> Append-only progress log. New entries go at the bottom.

## 2026-07-16 12:02 — Resolve all unpushed-review findings in isolated worktree

**User prompt (summary)**: Create a separate branch containing a copy of every current uncommitted change, leave the benchmark AI's `main` worktree untouched, and fix every open item from the unpushed-branch review.

**What I did**:
- Created a separate Git worktree/branch and copied all 49 tracked/untracked working files as a point-in-time snapshot without stashing, switching, or cleaning `main`.
- Synchronized the benchmark AI's post-snapshot oha harness/report and ADR 0028 into this worktree while leaving its `main` files untouched.
- Fixed the root server bundle's `@luckystack/core/config` alias and added a regression guard.
- Rebuilt complete project registrations after secret resolution in both repo and scaffold config, preserving auth/session/rate-limit policy while refreshing public/CORS/OAuth URLs.
- Made transport contracts fail loudly on Date inputs and binary/BigInt outputs; modeled JSON omission/null semantics for outputs and streams.
- Added stream extraction-error diagnostics and limited Zod fallback diagnostics to the API inputs that actually generate schemas.
- Aligned Bun's engine floor and runtime documentation, recorded ADRs 0029/0030, and closed BR-01 through BR-07 in the findings ledger.
- Verified unit, lint/invariants, full production build, and strict Redis integration gates.

**Files touched**: `scripts/bundleServer.mjs`, `config.ts`, `packages/create-luckystack-app/{template/config.ts,src/*.test.ts,CHANGELOG.md}`, `packages/devkit/{src/typeMap/**,docs/**,CLAUDE.md,CHANGELOG.md}`, `docs/{ARCHITECTURE_API.md,ARCHITECTURE_SYNC.md,HOSTING.md,decisions/0028-*.md,decisions/0029-*.md,findings/**}`, generated AI indexes, and all files copied from the `main` snapshot.

**Notes / decisions**: ADR 0029 chooses explicit JSON-stable route contracts over implicit Date hydration or broad binary unions. ADR 0030 preserves `registerProjectConfig` replacement semantics and refreshes via a complete config factory instead of changing core to cumulative merge. `main` remained on its original worktree for the concurrent benchmark AI.

## 2026-07-16 12:35 — Audit v0.7.0 ORM × runtime evidence

**User prompt (summary)**: Integrate the latest `main`, resolve conflicts, identify the real v0.7.0 blockers, and prove whether nested types, Date serialization, and ORM-specific regressions are covered across Node/Bun and Prisma/MikroORM/Drizzle.

**What I did**:
- Confirmed `git merge main` is already up to date; compared the live uncommitted `main` snapshot file-by-file and found 41 identical files, 11 intentionally superseded by fixes, and zero missing changes.
- Audited the Verdaccio, ORM, wire-projection, and runtime matrices without treating historical claims as fresh proof.
- Ran the real deep MikroORM extractor directly under Bun; it emitted bounded output with `createdAt: string`, no symbol-key leakage, and no crash.
- Found that Bun-launched Vitest itself fails during Zod import transformation while direct Bun Zod/core/devkit imports pass, so this is a harness gap rather than evidence of a framework runtime failure.
- Recorded the five remaining evidence/automation gaps in a dated findings ledger.

**Files touched**: `docs/findings/2026-07-16-v070-orm-runtime-readiness/README.md`, `docs/findings/README.md`, and branch-log metadata.

**Notes / decisions**: The seven reviewed product defects remain fixed. The currently open items block the broad “all ORMs deeply tested on both runtimes” claim; they are not newly confirmed product bugs. Closing Drizzle and repeatable runtime cells requires user-gated dependency installs and temporary server/registry processes.

## 2026-07-16 14:15 — Close Prisma/Drizzle/MikroORM × Node/Bun release matrix

**User prompt (summary)**: Permission granted to install the needed dependencies and run the complete Prisma, Drizzle, and MikroORM verification; explain and eliminate the remaining release blockers.

**What I did**:
- Added real deep fixtures for Prisma `Result.GetResult`, Drizzle relational-query inference, and populated MikroORM `EntityDTO<Loaded<...>>`, plus direct Node/Bun projection gates. Fixed exact Prisma `JsonValue` recognition, recursive `Jsonify<T>` stability, and portable emitted queries for checker-owned absolute inferred types.
- Expanded the real-registry E2E to typecheck/build each scaffold, apply its SQLite schema, execute real ORM CRUD plus nested Date serialization on Node and Bun, boot the same production bundle on both runtimes, and require HTTP 200 from `/livez` and `/_health`.
- Fixed the blockers exposed by that matrix: secure Drizzle `^0.45.2`, stale no-auth prune tokens, and runtime-aware Drizzle SQLite (`better-sqlite3` on Node, `bun:sqlite` on Bun, with the native Bun module externalized from esbuild).
- Closed OR-01 through OR-04. Reconfirmed Bun-hosted Vitest's Zod transform defect and closed OR-05 as `wontfix`; dedicated direct-Bun and executable E2E gates provide the runtime evidence instead.
- Verified 1810/1810 unit tests, direct Node+Bun ORM projection, all six real ORM/runtime E2E cells, lint/package-lint/invariants, 17/17 package builds, client build, and server bundle. Dependency audit has zero high/critical advisories.

**Files touched**: `packages/{core,devkit,create-luckystack-app,cli}/**`, `scripts/{e2eVerdaccio.mjs,bundleServer.mjs,verifyOrmWireProjection.ts}`, `package*.json`, `tsconfig.server.json`, changelogs, `docs/findings/2026-07-16-v070-orm-runtime-readiness/README.md`, findings index, and branch-log metadata.

**Notes / decisions**: Bun remains a supported server runtime, not a required Vitest host. The live `npm run test` business suite was not counted as a code failure when invoked without this worktree's server/database; it contacted an unrelated listener and returned `api.notFound`/missing `DATABASE_URL`. Vite's existing `async_hooks`, dependency-eval, and plugin-timing warnings remain outside this ORM/runtime change and are reported rather than silently suppressed.
