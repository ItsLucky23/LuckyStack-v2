# LuckyStack Skills System Audit — 2026-06-09

## Executive Summary

**15 custom skills** exist in `/skills/custom/`, but the index file (`skills/custom/README.md`) documents only 3, leaving **12 skills undiscovered** by consumers. All 15 ship to consumers via `create-luckystack-app` framework-docs copy (verified in `/packages/create-luckystack-app/framework-docs/skills/`). The audit identifies quality improvements for each skill, a **complete replacement README index**, and **5 high-value missing skills** worth implementing for an AI-first framework.

## Part 1: Per-Skill Assessment

### 1. a11y-audit
**Quality**: High. Comprehensive axe-core + Tailwind contrast scanning.
**Improvements**: Add note on dynamic className limitations; consider optional `--headless-browser` flag to auto-start dev server.

### 2. add-new-api
**Quality**: Excellent. Clear template, strong typing discipline, covers rate-limit decision-making.
**Improvements**: Add subsection on testing; link to API contract in architecture doc earlier.

### 3. add-new-package
**Quality**: Excellent. Covers full monorepo scaffolding, peer-dep policy, CLAUDE.md pattern.
**Improvements**: Show banner template for stub docs; add note to run `npm run ai:capabilities` after first publish.

### 4. agent-browser
**Quality**: High. Clear Vercel Labs integration, per-route test scaffolding.
**Improvements**: Clarify `data-testid` assumption; add backup-first warning before overwrite.

### 5. audit-api-rate-limits
**Quality**: High. Smart heuristics, clear severity tiers, actionable remediation.
**Improvements**: Consider optional `--fix` flag for auto-patching safe suggestions; reference future `/audit-sync-rate-limits` skill.

### 6. audit-error-code-coverage
**Quality**: High. Comprehensive locale key scanning, clear MISSING/ORPHANED buckets.
**Improvements**: Note auto-translation via LLM is possible but not recommended; mention out-of-scope `useTranslator()` in components.

### 7. audit-invalid-page-locations
**Quality**: High. Clear routing rules, actionable fixes.
**Improvements**: Add reference to `validatePagePath` helper; consider `--fix` mode for auto-moves based on user choice.

### 8. audit-page-middleware-coverage
**Quality**: High. Configurable rules via `.claude/audits/page-middleware-rules.json`.
**Improvements**: Document AST-based checking out of scope; provide example config file in framework docs.

### 9. audit-sync-pairing
**Quality**: High. Clear pairing rules, addresses common sync refactor mistakes.
**Improvements**: Consider validating version consistency; clarify type-matching is handled by generators.

### 10. daily-handoff
**Quality**: Excellent. Strong structure (6 sections), length guidance, clear use vs. slash-command distinction.
**Improvements**: Add reminder to commit handoff file; optionally auto-populate "Files Touched" from `git status`.

### 11. ideas
**Quality**: High. Multi-input analysis (capabilities, project index, recent git), clear effort buckets.
**Improvements**: Consider `--focus <area>` flag for category filtering; emphasize freshness of input indexes.

### 12. lighthouse
**Quality**: High. Cross-references rollup visualizer, ranked code-split candidates.
**Improvements**: Add config option for custom ports; consider `--apply` flag for auto-wrapping imports in `React.lazy()`.

### 13. perf-budget
**Quality**: Excellent. Baseline capture + regression check, per-chunk thresholds, CI-ready.
**Improvements**: Document behavior when re-running on existing project; consider tracking gzip sizes alongside raw sizes.

### 14. security-audit
**Quality**: High. Multi-sweep approach (npm audit, secret scan, route auth, headers).
**Improvements**: Recommend gitleaks in Prerequisites; note CSP detection limitations with middleware.

### 15. upgrade-deps
**Quality**: Excellent. Semver-aware, safe-queue automation, major-bump proposals, changelog parsing.
**Improvements**: Add summary table (Passed/Failed/Skipped); note changelog parsing limitations across different package formats.

## Part 2: Complete README Index Replacement

Replace the "Available Skills" section in `skills/custom/README.md` with:

| Skill | Purpose |
| --- | --- |
| [`a11y-audit/`](./a11y-audit/SKILL.md) | Run axe-core against every route plus Tailwind-token contrast validation. |
| [`add-new-api/`](./add-new-api/SKILL.md) | Add a new API endpoint under `src/{page}/_api/` with template + typing. |
| [`add-new-package/`](./add-new-package/SKILL.md) | Scaffold a new `@luckystack/*` package in the monorepo with full setup. |
| [`agent-browser/`](./agent-browser/SKILL.md) | Generate per-route E2E tests using `@vercel-labs/agent-browser`. |
| [`audit-api-rate-limits/`](./audit-api-rate-limits/SKILL.md) | Scan API endpoints and flag missing/suspect rate-limit configs. |
| [`audit-error-code-coverage/`](./audit-error-code-coverage/SKILL.md) | Cross-check error codes against locale JSON files; flag missing translations. |
| [`audit-invalid-page-locations/`](./audit-invalid-page-locations/SKILL.md) | Scan pages and flag files that aren't routeable under the invisible-parent convention. |
| [`audit-page-middleware-coverage/`](./audit-page-middleware-coverage/SKILL.md) | Flag pages that should have middleware export but don't (e.g., `/admin` without auth). |
| [`audit-sync-pairing/`](./audit-sync-pairing/SKILL.md) | Flag orphaned sync files (client without server or vice versa). |
| [`daily-handoff/`](./daily-handoff/SKILL.md) | Produce a structured handoff document when closing a session. |
| [`ideas/`](./ideas/SKILL.md) | Surface feature gaps and improvement candidates across the repo, bucketed by effort. |
| [`lighthouse/`](./lighthouse/SKILL.md) | Run Lighthouse, parse unused-JS audit, and propose code-split candidates. |
| [`perf-budget/`](./perf-budget/SKILL.md) | Capture bundle-size baseline and guard against regressions on subsequent builds. |
| [`security-audit/`](./security-audit/SKILL.md) | OWASP-flavored sweep: npm audit, secrets, auth coverage, security headers. |
| [`upgrade-deps/`](./upgrade-deps/SKILL.md) | Semver-aware dependency updater: bump patch/minor safely, surface majors individually. |

## Part 3: High-Value Missing Skills (Prioritized)

### Priority 1 (High) — Page Scaffolding
**Name**: `add-new-page`
**Trigger**: `/add-new-page <name> [--template dashboard|plain]`
**What**: Create folder structure, page.tsx with template, optional middleware, register in indexes.
**Why**: Framework has `/add-new-api` + `/add-new-package` but no page scaffold. AIs hand-write pages daily; this closes critical gap. High consumer impact.

### Priority 1 (High) — Component Library
**Name**: `add-new-component`
**Trigger**: `/add-new-component <name> [--ui-primitive|--smart-component]`
**What**: Create `src/_components/{Name}.tsx` with standard patterns, JSDoc, optional context integration.
**Why**: Reduces component duplication across projects, enforces consistent patterns. High consumer impact.

### Priority 2 (Medium) — AI Index Management
**Name**: `refresh-ai-indexes`
**Trigger**: `/refresh-ai-indexes [--full]`
**What**: Run `npm run ai:*` commands to regenerate CLAUDE/capabilities/project-index snapshots.
**Why**: AIs frequently add code but forget index regeneration. Ensures fresh context. Documented in rule 12 but enforcement is manual.

### Priority 2 (Medium) — Full Feature Scaffolding
**Name**: `scaffold-feature-module`
**Trigger**: `/scaffold-feature-module <name> [--with-api] [--with-sync] [--with-tests]`
**What**: Create coordinated page + api + sync + components + types + tests in one pass.
**Why**: Bridges multiple scaffolding skills into single workflow. Accelerates full-stack feature development.

### Priority 3 (Medium) — Onboarding
**Name**: `explain-codebase`
**Trigger**: `/explain-codebase [--focus routing|apis|components|sync]`
**What**: Generate structured markdown explaining architecture, patterns, checklist, workflows, troubleshooting.
**Why**: Fresh AIs need structured onboarding. Currently requires manual reading. Valuable for team expansion.

## Part 4: Skill Distribution Verification

All 15 custom skills **DO ship to consumers** via `create-luckystack-app`:

✓ Framework repo: 15 skills in `/skills/custom/`
✓ Bundled copy: 15 skills in `/packages/create-luckystack-app/framework-docs/skills/custom/`
✓ Template copy: 7 skills (subset) in `/packages/create-luckystack-app/template/skills/custom/`

**Note**: Template omits `add-new-api`, `add-new-package`, `audit-*`, `daily-handoff` intentionally — consumer projects don't need framework development skills.

Slash commands: ✓ All 7 from `.claude/commands/` ship to consumers.
Official skills: Placeholder in `skills/official/` (currently empty; awaiting Anthropic bundle).

## Part 5: Summary & Recommendations

**Immediate**:
1. Update `skills/custom/README.md` with complete 15-skill table (Part 2).
2. Create `.claude/audits/page-middleware-rules.json` template.
3. Document template-subset decision in `create-luckystack-app` source.

**Medium-term**:
1. Implement Priority 1 & 2 missing skills.
2. Add `--fix`/`--apply` flags to awareness-only skills.
3. Create skill-contribution checklist.

**Long-term**:
1. Spin up official Anthropic skill bundle.
2. Add skill versioning/deprecation.
3. Implement MCP server for skill discovery.

---

**Status Summary**
| Item | Count | Status |
|---|---|---|
| Custom skills | 15 | ✓ Complete |
| Skills shipped | 15 | ✓ Complete |
| Skills in README | 3 | ✗ Stale (20% coverage) |
| Slash commands | 7 | ✓ All shipped |
| Missing (Priority 1) | 2 | Proposed |
| Missing (Priority 2-3) | 3 | Proposed |
