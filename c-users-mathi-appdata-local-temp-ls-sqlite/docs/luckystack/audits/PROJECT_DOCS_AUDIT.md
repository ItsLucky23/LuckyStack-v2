# LuckyStack v2 Project Documentation Audit

**Date:** 2026-06-09  
**Branch:** chore/package-split-prep (uncommitted, 0.2.0)  
**Scope:** Framework dev-repo documentation accuracy, completeness, and hygiene post-optional-package refactor  

## Executive Summary

The LuckyStack v2 framework documentation is mostly accurate post-0.2.0 optional-package refactor (§8 implementation complete per SESSION_STATE.md). However, three categories of issues were identified:

1. **Stale Claims in Architecture Docs** (§2): ARCHITECTURE_PACKAGING.md describes outdated overlay pattern for user-adapter registration; several docs reference removed env-resolver symlink issues.

2. **Redundancy & Design-Doc Bloat** (§3): SESSION_STATE.md duplicates large sections of DESIGN_OPTIONAL_SERVER_PACKAGES.md; FINAL_SWEEP.md and HANDOFF-R1-R5.md contain near-identical summaries.

3. **Gaps & Inconsistency** (§4): No consolidated "how to add a feature via luckystack add" guide; per-package CLAUDE.md files list internal functions as exports; missing architecture diagram; package READMEs have stale signatures.

**All issues are non-blocking for npm publish.**

---

## 1. Docs That May Be Stale/Inaccurate vs Current Code

### 1.1 ARCHITECTURE_PACKAGING.md — Outdated User-Adapter Pattern

**Claim:** (line ~18, Table §2.2) "Consumers swap the adapter via `luckystack/login/userAdapter.ts`."

**Current Reality:** User adapter registration is now auto-wired via `@luckystack/login/register` side-effect subpath (0.2.0 §8). While `luckystack/login/userAdapter.ts` overlay exists, the pattern is "register subpath auto-detects overlay if present," not "manually edit this file."

**File & Why:** `docs/ARCHITECTURE_PACKAGING.md` (last updated 2026-05-13, pre-§8 auto-detect implementation on 2026-06-08)

**Fix:** Rewrite §2.2 to explain register subpath auto-detection + optional overlay override pattern.

---

### 1.2 FINAL_SWEEP.md — Phantom env-resolver References

**Claims:**
1. (§2.1) "Stale `packages/env-resolver/dist/`" — needs removal and index refresh.
2. (§4) "npm install" needed to refresh the stale `@luckystack/env-resolver` symlink.

**Current Reality:** `packages/env-resolver/` folder does **not exist**; it was already removed. The `@luckystack/secret-manager` package is complete and functional.

**File & Why:** `docs/FINAL_SWEEP.md` (written 2026-06-02, pre-confirmation of removal)

**Fix:** Remove env-resolver-specific TODO items from §2.1 and §4. Retain "npm install" step but reword as "refresh workspace symlinks."

---

### 1.3 HANDOFF-R1-R5.md — Same env-resolver Reference

**Claim:** (§ Open items) "Before publish: `npm install` (refreshes the stale `@luckystack/env-resolver` symlink)"

**Fix:** Reword without env-resolver reference; keep npm install step.

---

### 1.4 Per-Package CLAUDE.md — Internal Functions Listed as Public API

**Issue:** Several per-package CLAUDE.md files (core, devkit, docs-ui, router, login) list internal helper functions in their Function Index as if they are consumer-facing stable exports, misleading AIs and developers.

**Example:** 
- `@luckystack/login/CLAUDE.md` includes `asOAuthUserData()` (internal cast helper)
- `@luckystack/devkit/CLAUDE.md` lists `sync_client.template.ts` (unreferenced internal template)

**File & Why:** Per-package CLAUDE.md; hand-curated before 0.1.0 publish

**Fix:** Audit each package's true public API and mark internal symbols clearly (e.g., prefix `[internal]` or separate section).

---

## 2. Redundant, Orphaned, or Contradictory Docs to Consolidate or Archive

### 2.1 SESSION_STATE.md vs DESIGN_OPTIONAL_SERVER_PACKAGES.md

**Issue:** Both documents describe the 0.2.0 install-anything-anytime architecture with significant overlap:
- Both explain three-layer architecture (package register, boot auto-detect, client bridges)
- Both list pure npm-i vs npx luckystack add matrix
- Both describe CSRF double-submit fallback
- Both reference same sequence and implementation files

**Where:** `SESSION_STATE.md` (root, 418 lines), `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md` (242 lines)

**Why it matters:** Returning dev/AI must read both, unsure which is canonical. SESSION_STATE.md says "read this first," then directs to DESIGN doc, creating redundant ping-pong.

**Fix:** Consolidate into single `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md` (canonical design spec). Reduce SESSION_STATE.md to TL;DR + cross-reference + session-specific context (uncommitted state, developer actions, next steps).

---

### 2.2 FINAL_SWEEP.md vs HANDOFF-R1-R5.md vs SESSION_STATE.md

**Issue:** Three documents describe the same body of work (0.2.0 release, R1–R5 remediation, optional packages) with near-identical summaries:
- FINAL_SWEEP.md §1: 21 lines summarizing work done
- HANDOFF-R1-R5.md intro: 8 lines with verbatim overlap
- SESSION_STATE.md §0: 27 lines recapping install-anything-anytime + R1–R5

**Where:** `docs/FINAL_SWEEP.md`, `docs/HANDOFF-R1-R5.md`, `SESSION_STATE.md`

**Why it matters:** Maintenance burden—if a detail changes (test count, feature status), three files need updating. New readers confused about which is the status document.

**Fix:** 
- **SESSION_STATE.md** (root) = sole working-context handoff for current branch. Full TL;DR, uncommitted state, developer actions.
- **FINAL_SWEEP.md** → archive as `docs/_archive/FINAL_SWEEP_2026-06-02.md` (serves as historical session record).
- **HANDOFF-R1-R5.md** → clarify intent: is this a shipped framework doc (consumers see it) or internal record? If shipped, ensure consumer-accessible and link to SESSION_STATE.md for live updates.

---

### 2.3 PUBLISH_READINESS_AUDIT.md — Confusing Status Phrasing

**Issue:** §1 lists "Resolved since the initial audit" as completed items (e.g., "Missing per-package LICENSE — DONE"). Since entire document is post-audit + post-fix, the phrasing "since the initial" is ambiguous—reads like audit is ongoing, not concluded.

**Where:** `docs/PUBLISH_READINESS_AUDIT.md` §1

**Fix:** Change table header to "**Status at audit completion**" and reword opening: "All 14 packages now pass all gates. Items resolved during audit:" (removes temporal ambiguity).

---

## 3. Gaps to Fill

### 3.1 Missing: Consolidated "How to Add a Feature via luckystack add" Guide

**Gap:** SESSION_STATE.md §6 describes the `@luckystack/cli` design, but there is **no end-to-end consumer guide** for how to use it. A developer adding presence to an existing project doesn't know:
- Does `npx luckystack add presence` run `npm i` automatically?
- Do I need to edit files after?
- How do I revert if something breaks?
- What gets injected into which files?

**Impact:** Developers run the command blind, leading to confusion and support burden.

**Fix:** Create `docs/LUCKYSTACK_ADD_GUIDE.md` (~45 min) with:
- Flow diagram: base-only scaffold → `npx luckystack add login` → server boot → client mount visibility
- Per-feature checklist (login: pages copied, LoginForm imported, config slots set; presence: JSX mounts re-injected, lifecycle wired)
- Troubleshooting: "types not found after add", "socket errors after presence add", "how to remove a feature"

---

### 3.2 Missing: Install-Anything-Anytime Architecture Diagram

**Gap:** The three-layer architecture (§10 in DESIGN_OPTIONAL_SERVER_PACKAGES.md) is described in prose. A diagram would clarify:
1. Package `./register` subpath (auto-loaded at bootstrap before overlay)
2. Consumer overlay folder (last-writer-wins override)
3. Client bridge dynamic imports (sync receive, presence JSX mounts)

And timing: when each layer runs (bootstrap time, import time, render time).

**Impact:** Harder for AIs and future developers to grasp precedence rules and why certain features need the CLI vs pure npm-i.

**Fix:** Add mermaid diagram to `docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md` §10 (~30 min).

---

### 3.3 Missing: Base-Only Scaffold Onboarding

**Gap:** DESIGN_OPTIONAL_SERVER_PACKAGES.md §6 and SESSION_STATE.md §7 mention a "base / full / custom" choice at scaffold time. But there is **no guide** for developers on:
- What a base-only project includes vs omits (no auth UI, no presence, no sync)
- What features are unavailable (no user login, no room presence, no real-time sync)
- Migration path to add features later

**Impact:** User following "install base only" gets working scaffold but doesn't know what's missing and how to bootstrap later.

**Fix:** Add section to `docs/DEVELOPER_GUIDE.md` or create `docs/BASE_ONLY_SCAFFOLD.md` (~30 min):
- Base scaffold contents + README
- What's absent + why
- How to migrate: `npm i @luckystack/presence` vs `npx luckystack add presence`

---

### 3.4 Undocumented: @luckystack/cli Public API

**Gap:** `packages/cli/CLAUDE.md` is minimal (3 KB). The `add login` and `add presence` subcommands are fully implemented but lack:
- Per-feature documentation: which assets are copied, what config changes made, idempotency guarantees
- Subcommand reference: signatures, options, return codes (`npx luckystack add --help`)
- Error recovery: what to do if package missing, if file injection fails

**Impact:** Developers lack reference material for the CLI beyond trial-and-error.

**Fix:** Expand `packages/cli/CLAUDE.md` (~30 min) to include subcommand index (signatures, options) and per-feature injection details.

---

### 3.5 Inconsistency: Package README Signatures Drift

**Gap:** Several per-package README.md files have stale or incomplete function signatures. (Noted in `docs/PUBLISH_READINESS_AUDIT.md` §3, e.g., `@luckystack/router` README documents `startRouter`/`startHealthPoller` without current parameter types.)

**Impact:** Consumers copy-paste incorrect code from published READMEs on npm.

**Fix:** Before npm publish, regenerate per-package API tables and verify all README signatures match the current CLAUDE.md Function Index (~1 hour).

---

## 4. Doc-Hygiene Issues & Loose Files

### 4.1 Stale References to Removed env-resolver

**Files Affected:** FINAL_SWEEP.md (2 refs), HANDOFF-R1-R5.md (1 ref)

**Status:** Covered in §1.2–1.3. Fix is to reword without env-resolver name.

---

### 4.2 Consistency: Framework vs Shipped-Doc Boundary Unclear

**Issue:** HANDOFF-R1-R5.md is described as "deliberately-shipped framework doc" in FINAL_SWEEP.md §3, yet it reads as a session handoff. Unclear if it:
- Remains in `docs/` as shipped consumer-facing doc (then should be updated for clarity)
- OR should be archived to `docs/_archive/` as a historical record

**Where:** `docs/HANDOFF-R1-R5.md`

**Fix:** Add a clear header comment or README note clarifying intent. If shipped, ensure it's consumer-accessible in shipped structure and mirrors current SESSION_STATE.md. If archive, move to `docs/_archive/`.

---

### 4.3 ARCHITECTURE_PACKAGING.md — Size & Merge-Conflict Risk

**Issue:** 1,867 lines; dense per-section coverage; flagged in ROADMAP.md §5 as a known merge-conflict hotspot.

**Impact:** Large docs invite ad-hoc edits that conflict with parallel work.

**Fix (Low Priority, Future Sprint):** Consider splitting into smaller topic files:
- `docs/ARCHITECTURE_PACKAGING_CORE.md` — core, api, server packages
- `docs/ARCHITECTURE_PACKAGING_FEATURES.md` — login, presence, sync, email, docs-ui
- Keep `ARCHITECTURE_PACKAGING.md` as index linking to subtopics

---

## 5. Prioritized Action List

### Critical (before npm publish or next AI session)

1. **Fix ARCHITECTURE_PACKAGING.md §2.2** — rewrite user-adapter pattern description (§1.1). Est. **~15 min**
2. **Remove env-resolver references** from FINAL_SWEEP.md §2.1 & §4, HANDOFF-R1-R5.md open items (§1.2–1.3). Est. **~10 min**
3. **Consolidate SESSION_STATE + DESIGN docs** (§2.1). Move SESSION_STATE to branch-log model; DESIGN becomes canonical. Est. **~1 hour**

### High (improves onboarding clarity, non-blocking for publish)

4. **Create `docs/LUCKYSTACK_ADD_GUIDE.md`** (§3.1). Flow diagram, per-feature checklists, troubleshooting. Est. **~45 min**
5. **Add architecture diagram to DESIGN_OPTIONAL_SERVER_PACKAGES.md** (§3.2). Mermaid: three layers, timing, precedence. Est. **~30 min**
6. **Audit per-package CLAUDE.md function listings** (§1.4). Mark [internal] or separate section. Est. **~1 hour** (distributed, low priority)

### Medium (consistency, non-blocking)

7. **Update PUBLISH_READINESS_AUDIT.md §1** wording — change "since initial" to "at completion." Est. **~5 min**
8. **Create base-only scaffold onboarding** in DEVELOPER_GUIDE.md (§3.3). Est. **~30 min**
9. **Expand @luckystack/cli CLAUDE.md** with subcommand reference (§3.4). Est. **~30 min**

### Low (future sprints)

10. **Verify TESTING_PLAN.md status** (§4.1). Confirm present/removed and update FINAL_SWEEP.md §3. Est. **~5 min**
11. **Clarify HANDOFF-R1-R5.md shipped-vs-internal intent** with header comment (§4.2). Est. **~5 min**
12. **Split ARCHITECTURE_PACKAGING.md** into smaller topic files (§4.3). Future sprint. Est. **~2 hours**

---

## Notes for Next Session

- **All issues are non-blocking** for 0.2.0 npm publish. Package tests, builds, gates all pass.
- **Core architecture accuracy is verified** against source code—working implementation matches design docs (verified: `capabilities.ts` auto-detect, `./register` auto-load, bootstrap sequence).
- **Onboarding clarity** (gaps §3.1–3.3) is the **largest UX gap** post-refactor. Returning devs + new users will benefit most from consolidated guides.
- **Future doc strategy:** After npm publish, adopt per-version changelogs and decouple session records from shipped docs. Consider "shipped docs" folder (`docs/for-consumers/`) vs "dev docs" (`docs/dev/`).

---

*End of audit. All findings consolidated for immediate action (items 1–3) and backlog (items 4–12). No commits made — all recommendations ready for user review and action.*
