# LuckyStack v2 — AI Usability Audit Report

**Date**: 2026-06-09  
**Scope**: Consumer AI agent ability to build entire apps with minimal human code  
**Evaluated against**: Six concrete user goals for AI-driven development

---

## Executive Summary

LuckyStack v2 ships a **strong foundation** for AI-driven development with well-designed entry points, comprehensive auto-generated indexes, and clear protocol documentation. A consumer AI agent can reliably find what it needs and stay synchronized as features are added.

However, there are **five concrete gaps** that prevent the promise from being fully realized without incremental human guidance:

1. **No automatic package recommendation loop** — Rules guide AI to suggest \@luckystack/*\ installs, but there's no behavioral encoding of *when* or *how* to notice and propose an install.
2. **No user-preference conflict detection** — Missing explicit rule for detecting contradictions between user stated preferences and framework documentation/rules, and no guidance for AI to propose alignment.
3. **Graphify optionality creates a staleness risk** — Native \AI_PROJECT_INDEX.md\ is excellent for <50 routes, but upgrade to graphify is opt-in and documented separately, creating dual-maintenance concerns for larger projects.
4. **Branch-log discoverability for consumer sessions** — Protocol is clearly documented, but consumer AI agents lack a prominent "this is your first session" hook that surfaces the log mechanism and its benefits.
5. **RAG retrieval scaling beyond markdown** — Native indexes are deterministic markdown; no guidance on how to layer retrieval (graphify MCP, vector DB, etc.) when project size or query complexity exceeds what static tables can surface.

**Positive findings** offset these gaps: entry points are clear, pre-commit hook ensures snapshots stay synchronized, capability/project indexes are auto-generated from authoritative sources, Rule 12 explicitly surfaces "not-yet-installed package" decision points, and bundle shipping puts framework AI docs in every consumer project.

---

## Goal 1: Discovery & Entry Points

**Status**: ✅ GOOD

**Summary**: Entry points are unmissable. Root CLAUDE.md Quick Links table (lines 7–20) explicitly maps consumer-path locations. Session-start rule 28 instructs exact sequence. Clarity is high. No gaps.

---

## Goal 2: Automatic Documentation Loop

**Status**: ✅ GOOD

**Summary**: Three regen commands are autonomous per Rule 8. Pre-commit hook ensures in-session AI refresh sees new state before next prompt. Loop is closed for code and doc changes. Minor gap: consumer's pre-commit hook doesn't regenerate AI_QUICK_INDEX.md for new commands/skills (correct behavior, but in-session refresh not guaranteed). Mitigation: add note to Rule 15 clarifying in-session behavior.

---

## Goal 3: RAG & Graphify Integration

**Status**: ⚠️ PARTIAL

**Summary**: Native indexes are deterministic and sufficient for <50 routes. Graphify documentation is thorough but separate. Gap: consumers lack decision tree on when/how to layer advanced retrieval (graphify, vector embeddings, MCP server mode). Recommendation: add "Scaling AI Context" section to AI_BOOST_OVERVIEW.md.

---

## Goal 4: Branch Logging for Consumers

**Status**: ⚠️ PARTIAL

**Summary**: Protocol is thoroughly documented in BRANCH_LOG_PROTOCOL.md, but consumer projects lack "first session" hook. New consumer AIs must discover the protocol by reading two documents. Gap: consumer CLAUDE.md is silent on branch logs. Recommendation: add branch-logging quick-start to consumer CLAUDE.md with format, when-to-log, and INDEX.md maintenance rules.

---

## Goal 5: Uninstalled Package Recommendations

**Status**: ⚠️ PARTIAL

**Summary**: Rule 12 + PACKAGE_OVERVIEW.md form a complete decision protocol, but enforcement is manual. No automated lint rule or diff analyzer flags reimplementation of @luckystack/* features. Gap: depends entirely on AI remembering to cross-check. Recommendation: add Rule 22 ("Before writing cross-cutting logic, check for @luckystack/* packages") with explicit decision-wait checkpoint.

---

## Goal 6: User-Preference Conflict Detection

**Status**: ❌ MISSING

**Summary**: No explicit rule encodes the scenario: user says X (contradicts framework rule Y); AI should flag, explain both sides, ask alignment question, wait for decision. Gap: completely missing behavioral contract. Recommendation: add Rule 23 ("Flag contradictions between user requests and framework conventions") with detailed example showing how to surface contradictions, present both sides, and wait for user decision.

---

## Prioritized Action List

| Priority | Action | Type | Effort |
|---|---|---|---|
| 1 | Add Rule 23: user-preference conflict detection | Doc + example | 30 min |
| 2 | Add Rule 22: package-recommendation safety net | Doc | 20 min |
| 3 | Add branch-logging quick-start to consumer CLAUDE.md | Doc | 15 min |
| 4 | Add "Scaling AI Context" to AI_BOOST_OVERVIEW.md | Doc | 20 min |
| 5 | Clarify in-session vs pre-commit hook in Rule 15 | Doc | 10 min |

All five are documentation-only; no code changes required.

---

## Conclusion

**Strengths**: Entry points clear, auto-generated indexes prevent staleness, pre-commit hook ensures synchronization, per-package CLAUDE.md provides function indexes, bundle shipping eliminates discoverability lag.

**Gaps** (all fixable via documentation): Consumer projects lack branch-logging guidance, AI agents lack safety net for package recommendations, user-preference conflict detection undocumented, graphify upgrade path not surfaced at decision points, hook clarifications needed for mental model accuracy.

**Outcome**: Implement all five actions. Framework will then support the full vision: consumer downloads bundle, AI agent reads contract, agent reliably builds entire app with minimal human code, stays synchronized as features accumulate.