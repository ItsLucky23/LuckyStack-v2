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
