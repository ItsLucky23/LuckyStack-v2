chore: AI-docs architecture overhaul + publishability sweep + hook-based error-tracking migration

Consolidates the full pre-publish work on this branch:

## 1. Publishability sweep (D-tasks, completed earlier in branch)

- Extension points + adapter patterns per @luckystack/* package (D.1-D.14)
- Strict typing policy enforced (no `as unknown`/`as any` casts)
- Optional peer-dep boot guards (C.4) - RESEND_API_KEY etc. hard-crash without peer
- Validator CJS-interop fix (`src/reset-password/_api/sendReset_v1.ts`)
- Boot perf: defer initial type-map gen + drop 2 redundant invalidateProgramCache calls (~20s -> ~10s)
- Fresh-checkout resilience: gitignore + postinstall for apiInputSchemas.generated.ts

## 2. AI documentation architecture overhaul

- New canonical `/CLAUDE.md` (root, 267 lines, 26 rules + inherited patterns)
- `.claude/CLAUDE.md` removed (content migrated)
- **Per-package AI_INDEX.md** (14 files, was CLAUDE.md, renamed for naming clarity vs root /CLAUDE.md) with function INDEX + deep-doc references
- Per-package `docs/` folders with 80 deep-doc files (~20,500 lines) - function signatures, args/types, return shapes, hook lifecycles, edge cases, code examples
- 6 slash commands in `.claude/commands/`: save_handoff / combine_handoff / load_handoff / log_progress / review_branch / parallel_review
- `skills/` folder with official/custom split + 3 starter skills (add-new-api, add-new-package, daily-handoff)
- `branch-logs/` system (NOT gitignored) for cross-session AI progress tracking
- `docs/AGENT_TEAM_PLAYBOOK.md` (generalized from external project, activated via slash commands)
- `docs/PACKAGE_OVERVIEW.md` (use-case + peer-deps tabel + cheatsheet + decision matrix)
- `docs/BRANCH_LOG_PROTOCOL.md` (when/how AI logs progress)
- `docs/AI_QUICK_INDEX.md` (auto-regenerated via `npm run ai:index`)
- `scripts/generateAiIndex.mjs` (repomix-vervanger, no external deps)
- All publishable packages: `"files"` array uitgebreid met "AI_INDEX.md" + "docs"
- `create-luckystack-app`: scaffold-time copy van root CLAUDE.md + docs + skills + .claude/commands + branch-logs/README
- Root `/CLAUDE.md` Quick Links dual-target paths (framework dev + consumer post-install)
- `docs/PROJECT_CONTEXT.md` archived to `docs/_archive/` (>90% overlap)
- `dump_tempt/` folder cleaned (waardevol materiaal verplaatst, rest verwijderd)
- Random root files removed: `AI.md`, `scan-1.md`, `scan-2.md`, `suggestions.md`, `lucky-stack-v2-0.0.0.tgz`, `lint-all-full.log`
- `SESSION_STATE.md` archived to `docs/_archive/SESSION_STATE_2026-05-20.md` (replaced by branch-log protocol)
- `functions/game.ts` removed (legacy game-project code) + repl.ts cleanup of game commands

## 3. Hook-based error-tracking migration

Refactors framework error-tracking from direct imperative imports to hook-based wiring:

- `packages/core/src/hooks/types.ts`: optional `transport?: 'socket' | 'http'` field added to API + Sync hook payloads
- 4 framework handlers (`handleApiRequest.ts`, `handleHttpApiRequest.ts`, `handleSyncRequest.ts`, `handleHttpSyncRequest.ts`): direct `setSentryUser` + `startSpan` calls removed; payload-reuse pattern for WeakMap span-pinning
- New `packages/error-tracking/src/autoInstrumentation.ts` (~110 lines): `enableErrorTrackingAutoInstrumentation()` registers hooks (preApiValidate/setSentryUser, preApiExecute/startSpan, postApiExecute/end, preSyncAuthorize/setSentryUser, preSyncFanout/startSpan, postSyncFanout/end). Module-scoped idempotency flag.
- WeakMap pinning: `apiSpans: WeakMap<PreApiExecutePayload, SpanHandle>`, `syncSpans: WeakMap<PreSyncFanoutPayload, SpanHandle>`
- `initializeSentry()` now internally calls `enableErrorTrackingAutoInstrumentation()` (backwards-compat for existing consumers)
- Public exports (`setSentryUser`, `startSpan`, `captureException`) preserved for backwards-compat
- `packages/error-tracking/docs/auto-instrumentation.md` rewritten for hook-based flow
- `docs/MIGRATION_HOOK_BASED_ERROR_TRACKING.md`: status banner "PLANNED" -> "EXECUTED 2026-05-21"

## Verification

- `npm run lint`: 0 errors, 0 warnings
- `node scripts/buildPackages.mjs`: 14/14 succeeded in 19.12s
- `npm run ai:index`: detected 14 packages, 6 commands, 3 skills (post-rename)
- `npm pack --dry-run --workspace=packages/login`: AI_INDEX.md + 8 deep-doc files in tarball, no CLAUDE.md
- Type-checks per package clean (`tsc --noEmit` per `tsconfig.json`)
- Grep for stale `packages/<X>/CLAUDE.md` refs: 0 hits in active code/docs (only branch-logs historical entries)
- Grep for direct `setSentryUser`/`startSpan` in handler files: 0 hits (all via hook handlers)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
