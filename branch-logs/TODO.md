# State of the `chore/package-split-prep` branch — summary + TODO

> Single-source snapshot of this mega-session: everything that landed, the testing system's current state, and what still needs doing. Pick from here in future sessions. Last updated: 2026-05-22.

---

## 1. What we did this session

16 distinct work blocks; each has its own entry in `branch-logs/chore--package-split-prep.md`. High-level themes:

### Lint contract (entry 9)

- 9 custom eslint rules in `@luckystack/core/src/eslint/` (no separate `@luckystack/eslint-config` package).
- Two-file scaffold split: `eslint.official.config.js` (third-party plugins) + `eslint.luckystack.config.js` (framework rules).
- Package-gated rules — `no-raw-fetch-in-src`, `no-unsafe-api-wrappers`, `no-unsafe-sync-wrappers` only fire when the relevant `@luckystack/*` peer is installed.
- `hasPackage()` probe uses fs-based check (handles pure-ESM `@luckystack/*` exports that defeat `require.resolve`).
- Default-only re-export aliasing in the rule (`shared/tryCatch.ts` → `functions.tryCatch.tryCatch`).
- AST traversal hardened against eslint's `parent` pointers (was looping infinitely on first lint).
- File-level disable comments on `src/docs/page.tsx` and `src/playground/page.tsx` (legitimate demo files).
- Auth-skip refined twice — first to be URL-aware (only fires on `/api/` or `/sync/`), then to use path-start match (so consumer `/api/auth/...` typed routes still fire).
- `try/finally` no longer triggers `no-raw-try-catch` (was a false positive).

### Branch-log infrastructure (entries 9, 11)

- `branch-logs/INDEX.md` table — Branch / Ticket(s) / Last updated / Status / Entries — with backfilled rows.
- Section 6.5 added to `docs/BRANCH_LOG_PROTOCOL.md` making INDEX updates mandatory on every append.
- CLAUDE.md Branch Log Protocol section now references Section 6.5.

### Function injection — multi-directory (entries 12)

- Codegen + runtime + hot reload + import-dependency-graph all walk an array of dirs (default `['functions', 'shared']`).
- Conflict-throw at every level when the same key path lands in two roots.
- Default-only re-export aliasing produces `functions.<name>.<name>(…)` instead of `.default(…)`.
- Wildcard re-export support — `export * from 'X'` emits `<name>: typeof import('X')` (entry 14 fix).
- Nested subdirs work transparently — `functions/test/helper.ts` → `functions.test.helper.<EXPORT>`.
- Backwards-compat shim — old `serverFunctionsDir: string` still honored.
- Deleted `functions/sleep.ts` and `packages/create-luckystack-app/template/functions/sleep.ts` (duplicates of `shared/sleep.ts`).
- Re-wrote `functions/redis.ts` + `functions/sentry.ts` (and scaffold copies) to use `export … from` syntax (the local-import-then-re-export form produced `any` in the generated interface).
- `shared/sleep.ts` + `shared/tryCatch.ts` flipped from `../packages/core/src/X` relative paths to `@luckystack/core` package paths (entry 14).

### Dead-code cleanup (entry 13)

- `server/functions/` removed entirely (5 files — orphaned by the multi-dir default change).
- CLAUDE.md prose around `tryCatch` import paths rewritten to reflect reality.

### AI_CAPABILITIES snapshot (entries 13, 14, 15)

- New `scripts/generateAiCapabilities.mjs` — pure Node ESM, deterministic, idempotent.
- Sections: installed `@luckystack/*` packages → server-injected `functions.*` map → API routes → Sync routes → root `functions/` source → `shared/` → `src/_functions/` → `src/_components/`.
- Regex-extracted signatures (not just names): `setMenuHandlerRef(ref: MenuHandlerRef)` etc. Lossy on nested parens (~10%); 90% case clean.
- API/Sync route tables — Route / Method / Rate limit / Has stream / Tests columns, parsed from `apiTypes.generated.ts` (`_ProjectApiTypeMap` + `_ProjectSyncTypeMap`).
- Quoted page paths handled (`"reset-password"`).
- Wildcard re-export labels — `re-export * from <path>`.
- Tests column shows `✓` when a `<name>_v<N>.tests.ts` file exists alongside the route source.
- Pre-commit hook (`.githooks/pre-commit`) regenerates both `ai:index` AND `ai:capabilities`.
- CLAUDE.md rules 12 + 15 strengthened: AI runs both autonomously in-session; hook is a safety net.
- Memory entry `feedback_ai_snapshot_autonomous_regen.md` captures the trigger table.

### Handler migration (entry 12)

- `src/settings/_api/revokeSession_v1.ts` switched from raw `import { tryCatch } from '@luckystack/core'` to the injected `functions.tryCatch.tryCatch(...)`. Confirmed via grep this was the only handler with a raw tryCatch import.

### Documentation (entries 12, 16)

- NEW `docs/ARCHITECTURE_FUNCTION_INJECTION.md` — full spec (walk order, conflict policy, nested subdirs, special cases, scaffold story).
- NEW `docs/ARCHITECTURE_TESTING.md` — full spec (two layers, file naming, TestContext shape, CLI flags, side effects, scaffolding workflow, sample failure output).
- `docs/PACKAGE_OVERVIEW.md` — Core row mentions the `./eslint` subpath; devkit row mentions multi-dir injection.
- `docs/AI_QUICK_INDEX.md` regenerated.

### `/review_memory` slash command (entry 16)

- `.claude/commands/review_memory.md` — YAML frontmatter + procedural body. Walks MEMORY.md + linked files, surfaces by type with mtime, accepts free-form keep/update/delete, applies edits.
- AI_QUICK_INDEX now lists 7 slash commands (was 6).

### Testing system (entry 16) — see Section 2 for the full breakdown

- Removed CLAUDE.md "No Test Files" rule. Replaced with constructive "Testing" guidance.
- Built `@luckystack/test-runner` Layer 5 (per-route business-logic tests).
- Scaffold script `npm run scaffold:test <route>` creates stubs.
- Consumer-side orchestrator `scripts/testAll.ts` (mirrored to scaffold template).

---

## 2. Testing — current state

### What's built (this session)

| Component | Path | Purpose |
|---|---|---|
| `runCustomTests` | `packages/test-runner/src/customTests.ts` | Discovers `<name>_v<N>.tests.ts` files alongside `_api/`/`_sync/` sources, dynamic-imports, builds a route-bound `TestContext`, runs each exported `customTests` case. |
| `TestContext` interface | same file | `callApi`, `callSync`, `session` (login/logout/current), `prisma`, `expect` (eq/ok/throws/matches). |
| `runAllTests` orchestrator | `packages/test-runner/src/runAllTests.ts` | Runs all 5 layers (contract / auth / rate-limit / fuzz / custom) with shared filter/skip. `logRunAllSummary` formatter. |
| Consumer-side runner | `scripts/testAll.ts` + scaffold template | Thin TS that loads generated types + calls `runAllTests`. Env-var config. |
| Scaffold script | `scripts/scaffoldRouteTest.mjs` + scaffold template | `npm run scaffold:test <page>/<name>/<v>` → writes stub with input shape inlined as a comment + checklist of common scenarios + placeholder case that throws. Refuses overwrite. |
| Architecture doc | `docs/ARCHITECTURE_TESTING.md` | Full spec. |
| CLAUDE.md "Testing" block | `CLAUDE.md` Inherited Rules section | Replaced the old "No Test Files" ban with two-layer guidance. |
| Sample stub | `src/settings/_api/revokeSession_v1.tests.ts` | One working example — placeholder throws `TODO: implement this test case`. |

### What's verified

- `npm run build:packages` — 14/14 clean, including `@luckystack/test-runner` with the new exports.
- `npm run lint` — clean. The sample stub file lints clean.
- `npm run ai:capabilities` — Tests column shows `✓` for `revokeSession/v1`, `—` for the rest. Confirmed end-to-end that scaffold + capabilities snapshot wire together.
- `node scripts/scaffoldRouteTest.mjs settings/revokeSession/v1` — created the stub correctly, refuses overwrite on re-run, errors cleanly on invalid route.

### What's NOT verified

- **`npm run test` was never actually invoked this session.** The infrastructure builds clean and types check out, but no end-to-end run happened because:
  - Running tests requires `npm run server` first (server start is non-autonomous per CLAUDE.md rule 8).
  - The sample stub throws on purpose — the run would fail.
- **`ctx.session.login()` runtime behavior** is unverified — calls `@luckystack/login`'s `saveSession`, which writes to Redis. The Prisma user isn't auto-created (deliberate); tests that need a user must `await ctx.prisma.user.create({...})` first.
- **`ctx.callApi()` / `ctx.callSync()` HTTP plumbing** — POSTs to `${baseUrl}/api/<route>` and `${baseUrl}/sync/<route>` with the current session cookie. Code is straightforward but not exercised.

### Missing tests (backfill)

- **16 existing API routes** have no `*.tests.ts` stubs. The auto-sweep covers them; per-route business-logic tests are TODO. Run `npm run scaffold:test <route>` for each, then fill in opportunistically when the AI next touches that route.
- **5 existing sync routes** — same.

### Missing test-runtime helpers

- **No transaction-per-test wrapping.** Tests run against the real dev Prisma + Redis. Isolation is the test author's responsibility (use unique emails, clean up afterward, or use a separate test DB).
- **No mock/stub helpers.** Out of scope for v1.
- **No fixture system.** Each test builds its own users / state from scratch.

---

## 3. Missing code / files

### Files that exist but should be updated

| File | What's stale |
|---|---|
| `packages/devkit/AI_INDEX.md` | Still references `serverFunctionsDir` (singular). Should mention multi-dir scan. |
| `packages/devkit/docs/loader-pipeline.md` | Same — still mentions the old singular config. |
| `packages/devkit/docs/hot-reload.md` | Same. |
| `packages/devkit/docs/type-map-generation.md` | Same. |
| `packages/test-runner/AI_INDEX.md` | Doesn't list `runAllTests`, `runCustomTests`, `TestContext`, `CustomTestCase`, `discoverCustomTestFiles`, `logRunAllSummary`. |
| `packages/test-runner/docs/*` | Doesn't cover the new Layer 5 (per-route business-logic tests). |
| CLAUDE.md "Core Rules (26)" header | Count is misleading now — function-injection contract + testing layer added. Rename or renumber. |

### Files missing entirely

| File | Purpose | When to create |
|---|---|---|
| `docs/PACKAGE_DEPENDENCY_GRAPH.md` | Auto-generated cross-package dependency graph for AI refactoring. Data already in `packages/devkit/src/importDependencyGraph.ts`. | When the AI starts hitting "what packages depend on this one?" lookups frequently. |
| `docs/FEATURE_INVENTORY.md` | Higher-level than route inventory — "which user-visible features exist + which routes/components implement each". | When a fresh AI session struggles to map "do we have feature X?" to source. |
| Test stubs for 16 API + 5 sync routes | Per-route `*.tests.ts` files. | Opportunistically — when the AI next touches each route. |

### Memory entries missing

- **No memory yet for the testing convention.** Future AI sessions might not know `npm run scaffold:test <route>` runs after every new route. Worth a `feedback_testing_workflow.md` post-commit.

---

## 4. Bugs / inconsistencies still in the code

### Pre-commit decisions

| Item | What |
|---|---|
| `src/settings/_api/revokeSession_v1.tests.ts` | Placeholder that throws `TODO: implement this test case`. `npm run test` will fail until filled in or deleted. **Recommendation: keep as a working example, accept that `npm run test` is red until backfilled.** |

### Real gaps

| Item | Why | Effort |
|---|---|---|
| `shared/` wildcard re-exports still use relative paths | 4 files (`responseNormalizer.ts`, `sentrySetup.ts`, `serviceRoute.ts`, `socketEvents.ts`) do `export * from '../packages/core/src/X'`. Flipping to `@luckystack/core` would silently change the exposed surface (broader/narrower than the internal module). Needs audit. | ~30 min |
| AI_CAPABILITIES signature regex truncates on nested parens | `(cb: () => void, opts: { retries?: number }) => bar` truncates at first `)`. ~10% of signatures. Fix: TS-Program-backed extraction via `packages/devkit/src/typeMap/tsProgram.ts`. | +200 lines + devkit dep |
| Scaffold script falls back to "(shape not detected)" if `generateArtifacts` hasn't run | The stub gets a placeholder comment instead of the real input shape. Fix: have the scaffold script run `generateArtifacts` first when missing. | ~10 min |
| Pre-commit hook regenerates `ai:capabilities` but `apiTypes.generated.ts` might be stale | If consumer commits without `generateArtifacts`, the snapshot reflects stale routes. Options: add a CLAUDE.md note, or have the hook run `generateArtifacts` too (~10s slower). | ~5 min or ~10s/commit |

---

## 5. Genuinely deferred (future sessions)

| Item | Notes |
|---|---|
| Cross-package dependency graph doc | Data in `importDependencyGraph.ts`. |
| Pre-push hook running `npm run test` | Requires running server. |
| Auto-update `branch-logs/INDEX.md` via git hook | Post-commit hook. `npm run ai:index-branchlogs` reserved in protocol. |
| GitHub Action for cross-PR file-overlap | Multi-AI coordination. |
| `/cross_branch_audit` slash command | Deferred when user said prose prompts against INDEX.md mtime are enough. |
| TS-Program-backed signature extraction | See bug list above. |
| `docs/FEATURE_INVENTORY.md` | See missing files above. |
| Skill creation discipline | When should AI propose a new skill in `skills/custom/`? Convention loose. |
| `/review_memory` proactive scheduling | Tied to staleness; could prompt the user at session boundaries. |
| Mock helpers / transaction-per-test wrapping | Out of v1 scope. |

---

## 6. Suggested commit split (if splitting)

1. **Lint contract + branch-log INDEX** (entries 9–11): `@luckystack/core/eslint` rules, root + scaffold config split, `INDEX.md` infrastructure, Section 6.5.
2. **Function injection multi-dir + AI_CAPABILITIES enrichment + dead-code cleanup** (entries 12–14): codegen+runtime walks `functions/` + `shared/`, conflict-throw, wildcard re-export support, default-only aliasing, deleted `server/functions/` + `functions/sleep.ts`, AI_CAPABILITIES signatures + injection map.
3. **Routes section in AI_CAPABILITIES** (entry 15): API + Sync route tables.
4. **Testing system + `/review_memory`** (entry 16): per-route test scaffolding, `runAllTests` orchestrator, replaced no-test-files rule, `ARCHITECTURE_TESTING.md`, `/review_memory` slash command.

Or one fat commit — the branch-log entries already give you a per-feature narrative inside.
