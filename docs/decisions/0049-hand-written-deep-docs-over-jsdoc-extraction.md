---
name: hand-written-deep-docs-over-jsdoc-extraction
title: Deep docs and the per-package function INDEX stay hand-written, not JSDoc-extracted
status: accepted
date: 2026-08-18
deciders: [ItsLucky23]
tags: [docs, tooling, ai-context]
supersedes: []
relates: [0016, 0048]
---

# 0049 — Deep docs and the per-package function INDEX stay hand-written, not JSDoc-extracted

## Context

`packages/<name>/docs/<topic>.md` holds the deep-doc set — roughly 20,500 lines of narrative
across 80+ files — and each `packages/<name>/CLAUDE.md` carries a hand-curated `## Function Index`
table. An auto-extractor that walks TypeScript + JSDoc and emits markdown baselines was considered
for both, and rejected. The rationale lived in a "Tooling Decisions (avoid re-litigating)" section
at the bottom of `docs/AGENT_TEAM_PLAYBOOK.md` — the wrong home: it is not orchestration guidance,
and a section titled "avoid re-litigating" that sits outside the decision memory is exactly the
thing a future session re-litigates. This ADR moves it into the record without changing it.

## Decision

Both layers stay hand-written.

- **Deep docs.** What makes them worth reading is narrative — *when to use this*, edge cases,
  anti-patterns, worked examples. JSDoc extraction produces none of that. The codebase also
  annotates with `//?` inline comments rather than `/** … */` blocks, so an extractor would mostly
  emit empty descriptions. The maintenance cost of a codegen tool is not repaid when a human
  reviews and rewrites the output anyway.
- **Function INDEX.** Hand-curated for now. The real risk is drift between the table and the actual
  exports, mitigated by touching the table in the same change that adds, removes, or renames an
  export, plus periodic sweeps comparing source `export` declarations against the table.

If drift becomes recurring, the escape hatch is a minimal script that regenerates **only** the
Function INDEX table — not the deep docs — reusing `packages/devkit/src/typeMap/extractors.ts`.
Roughly 100 lines, run as a one-shot CLI. Deliberately scoped to the table alone.

## Rejected alternatives

- **A JSDoc auto-extractor covering the deep-doc layer.** Rejected on output quality: it cannot
  produce the narrative that is the reason those docs exist, and against this codebase's `//?`
  comment style it would emit mostly blanks.
- **Migrating the codebase to `/** … *\/` JSDoc so extraction becomes viable.** Rejected as a large
  mechanical change to serve a tool that still would not produce the valuable half of the content.
- **Generating the Function INDEX now, pre-emptively.** Rejected as premature: the drift it would
  prevent has not yet been recurring enough to pay for a generator. Kept as a documented escape
  hatch instead, with a bounded scope so a future session does not widen it to the deep docs.

## Consequences

- Adding, removing, or renaming a package export is expected to touch that package's Function INDEX
  table in the same change. Nothing enforces this automatically — it is a review-time obligation.
- The deep-doc set is only as current as the humans and agents who edit it; `npm run ai:doc-staleness`
  is the report-only nudge for docs that opt in with an `<!-- @covers … -->` marker.
- Unlike the generated indexes, these files are not regenerable — a bad edit is a real loss, so they
  are edited surgically rather than rewritten.
