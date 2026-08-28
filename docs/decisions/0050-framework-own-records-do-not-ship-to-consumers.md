---
name: framework-own-records-do-not-ship-to-consumers
title: The scaffold ships the record CONVENTIONS, never the framework's own record instances
status: accepted
date: 2026-08-28
deciders: [ItsLucky23]
tags: [scaffold, ai-context, docs, packaging]
supersedes: []
relates: [0047, 0049]
---

## Context

`bundleFrameworkDocs.mjs` copied the whole `docs/` tree into the npm tarball with `fs.cpSync(..., {
recursive: true })`, and the scaffolder copied it on into `docs/luckystack/` with no exclusion list. Every
scaffolded project therefore received the framework's own generated artifacts and record instances —
`AI_QUICK_INDEX.md` (138 KB describing THIS repo), `AI_DECISIONS_INDEX.md` plus 46 framework ADRs,
`ai-graph.json` (the graph of the framework's demo `src/`), and the rest — sitting next to the
identically-named files the project generates for itself.

That is the failure mode [[0049]] exists to prevent, shipped by construction: a second, authoritative-looking
answer that is wrong about the reader's codebase. It also explains a defect found downstream. The template
eval scenario `03-why-cors-failclosed.json` expected `citedAdr: "0007"`; a scaffold inherits the scenarios
but not the ADRs, so the number resolved against `docs/luckystack/decisions/` and found a real, unrelated
decision. The scenario scored agreement with an invention. (The same scenario was already wrong in this
repo: ADR 0007 here is the secure-by-default flip and does not mention CORS.)

After [[0047]] there is a second, harder reason: the generated artifacts are gitignored, so on a clean CI
checkout they may not exist at all, and a publish must not depend on them.

## Decision

`FRAMEWORK_OWN_RECORDS` — the generated artifacts plus `decisions/`, `lessons/`, `examples/` — is stripped
in two places: from the tarball by `bundleFrameworkDocs.mjs`, and from `docs/luckystack/` by the scaffolder
(alongside the existing dated-findings strip). The **conventions** all still ship: every protocol, every
`ARCHITECTURE_*` deep-dive, `findings/README.md`, and the empty record folders with their `0000-template.md`
that the template tree provides. Template eval scenarios must not name a concrete ADR number; the shipped
scenario carries a `_note` telling the project to fill in its own.

## Rejected alternatives

- **Ship the framework's ADRs as reference material** — rejected: they are indistinguishable from the
  project's own by number, which is the addressing scheme every tool and tag uses. "Reference material"
  that answers `get_decision(7)` with someone else's decision is not reference material.
- **Ship them under a clearly-labelled prefix** — rejected: it keeps 250 KB of another repo's state in
  every project, still stale from the day it lands, to solve a problem `@luckystack/*/CLAUDE.md` and the
  published docs already solve.
- **Strip only in the scaffolder** — rejected: the tarball would still carry them, and a publish from a
  clean checkout (where the gitignored artifacts are absent) would behave differently from a local one.

## Consequences

- A scaffolded project's `docs/luckystack/` is smaller and contains only conventions.
- The two lists (`bundleFrameworkDocs.mjs` and `src/index.ts`) must stay in step; both carry a comment
  saying so. A parity test would be the natural next step.
- A consumer who wants to read a framework ADR reads it in the framework repo, not in a stale copy.
- The `03-*` eval scenario shipped by the template no longer asserts a `citedAdr`, so it scores one check
  fewer until the project fills its own in — deliberately, since the alternative was scoring a fiction.
