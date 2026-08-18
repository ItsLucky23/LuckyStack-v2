---
name: batch-record-capture-to-session-wrap-up
title: Batch the AI record layers to session wrap-up and retire the examples / runbooks / context-budget layers
status: accepted
date: 2026-08-18
deciders: [ItsLucky23]
tags: [ai-context, docs, tooling, protocol]
supersedes: []
relates: [0016, 0001, 0007]
---

# 0048 — Batch the AI record layers to session wrap-up and retire the examples / runbooks / context-budget layers

## Context

Developers on a consumer project (`flexbuddy`) reported the same complaint independently:
the AI documents too much and too early. The concrete failure was that **sparring turned into
artifacts** — options weighed in a discussion, including ones the developer explicitly did not
want, were written to `docs/decisions/` and `docs/findings/` mid-session, as if settled.

The protocols invited exactly this. Their triggers were all immediate and per-event:
branch-logs "after every prompt", decisions "when a choice is settled in a session", lessons and
findings "when it happens". Nothing distinguished *discussing* a choice from *making* one, and
nothing said that exploration is not a recordable event. The result on that project: 124 open
findings across 22 folders, the oldest a month untouched, in a layer whose own protocol forbids
deleting a folder that still has an `open` item — guaranteed permanent growth.

A parallel audit of the same project found the AI-context surface had also grown layers that
carried cost without carrying weight. The canonical example corpus restated shapes already
written out in `CLAUDE.md`; `AI_RUNBOOKS.md` restated `CLAUDE.md` plus the `ARCHITECTURE_*` docs
in a different order; `AI_CONTEXT_BUDGET.md` was a meta-document about how to read the documents,
which itself cost context and was not followed. Rule 15b (`@docs owner` on every new route) had
0 of 232 routes complying after months — a rule nobody follows is not a rule, it is noise in the
linter and an empty table in the index.

## Decision

**1. Record capture is batched to session wrap-up, and stays autonomous.**

`CLAUDE.md` gains a *Session Capture Protocol* that governs all four record layers (branch-logs,
decisions, lessons, findings) and defines three session states:

- *sparring / exploring* — write nothing; a discussed-but-unchosen option never becomes an
  artifact of its own, it becomes a *Rejected alternatives* line if the chosen path later ships;
- *working* — no record-layer writes either; candidates are held in an in-session capture buffer;
- *wrap-up* — write the whole batch at once and report it in one closing line.

The AI does **not** ask permission. What makes capture rare is the bar, not a prompt:

| layer | qualifies only when |
|---|---|
| branch-log | the session produced real code/architecture changes — one entry per session |
| ADR | the choice was implemented this session or confirmed by the user in words, AND a real alternative was rejected |
| lesson | real effort was burned on a non-obvious dead-end that would plausibly repeat |
| findings | the user asked for a scan / audit / sweep |

Findings additionally require triage at creation time: cap the folder at what is worth tracking
and mark the rest `wontfix` immediately, so the ledger cannot become a write-only backlog.

**2. Retire four layers.** `docs/examples/` + `AI_EXAMPLES_INDEX.md`, `AI_RUNBOOKS.md`,
`AI_CONTEXT_BUDGET.md` and their generators, npm scripts, and pre-commit steps are removed from
both the framework and the scaffold template, along with the MCP tools that served them
(`get_runbook`, `list_examples`, `get_example`). Rule 15b is dropped; `@docs owner` survives as
optional route metadata, but the linter no longer demands it and the project index no longer
renders an aggregate ownership table.

**3. Fix the two scaffold defects the audit surfaced.** The consumer `CLAUDE.md` was a byte-identical
copy of the framework's, so its `docs/<X>.md` references pointed at paths that only exist in the
framework repo — ~26 dead paths per scaffolded project, 8 of them in the Rule 28 session-start
sequence. `copyAiDocs` now rewrites framework-doc references to `docs/luckystack/…`, driven by what
the bundle actually contains, skipping lines that deliberately spell out both paths. `ai:index` is
marked framework-repo-only, since no scaffolded project has ever had that script.

**4. Derive `AGENTS.md` from `CLAUDE.md`.** It was a hand-maintained duplicate of the same contract
and had drifted ~3 months and 800+ lines behind, meaning one of the two agents was reading rules
that no longer applied. `npm run ai:agents-md` regenerates it; the pre-commit hook stages it.

## Rejected alternatives

- **Keep writing per-event, and rely on the AI's judgement to be more selective.** This was the
  status quo, and the status quo produced the complaint. Judgement without a stated bar drifts
  toward capturing, because capturing always feels defensible in the moment.
- **Gate every capture behind a user prompt at wrap-up.** Tried first, in this same session, and
  rejected by the user on sight: it makes the developer a gate on their own project's memory, and
  an approval question every session is its own kind of noise. Batching plus a hard bar delivers
  the same reduction without the interruption. The narrow exceptions stay user-gated: a backfill
  sweep over an existing project, and an ADR recording a deviation the user has not agreed to.
- **Keep the examples / runbooks / context-budget layers but stop regenerating them in the hook.**
  Rejected: half-removal leaves stale artifacts that still get read and MCP tools that answer
  "run `npm run ai:runbooks`" for a script that no longer exists.
- **Rewrite doc paths by hand-maintaining a list of framework docs in the scaffolder.** Rejected in
  favour of deriving the list from the bundle at copy time, so the rewrite cannot drift from the
  real doc set the way `AGENTS.md` drifted from `CLAUDE.md`.

## Consequences

- Sessions that only discuss produce zero committed artifacts. A developer can spar freely without
  watching what gets written down.
- `@luckystack/mcp` loses three tools — a breaking change for any agent config that named them,
  recorded in that package's CHANGELOG.
- Existing projects keep whatever `docs/examples/`, `AI_RUNBOOKS.md`, or `AI_CONTEXT_BUDGET.md` they
  already committed; nothing is deleted on upgrade, but the files stop being regenerated. A project
  that wants them gone deletes them itself.
- `flexbuddy` and any other pre-existing project only pick this up via a release plus
  `npx luckystack update` / `--app`; a developer-edited `CLAUDE.md` arrives as a `.new` sidecar to
  merge (ADR 0025).
- This ADR governs the protocol text itself, so changing the capture rules means superseding this
  file rather than editing `CLAUDE.md` alone.
