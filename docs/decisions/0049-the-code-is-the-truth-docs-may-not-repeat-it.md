---
name: the-code-is-the-truth-docs-may-not-repeat-it
title: A hand-written doc may not repeat any fact derivable from the code
status: accepted
date: 2026-08-28
deciders: [ItsLucky23]
tags: [ai-context, docs, conventions]
supersedes: []
relates: [0016, 0047]
---

## Context

Every hand-written doc surface in the framework and downstream had drifted in the same way, and there was
**no content agreement anywhere** to prevent it — no boundary, no stated reason why a file map should not
be in a context doc. So the drift happened without anyone making a mistake:

- A "what new devs most often get wrong" list taught a rate-limit window of 6s where `config.ts` said 60s.
  Not missing information — confidently wrong information, in the one place a reader goes when unsure.
- A component table in `CLAUDE.md` named three files that do not exist at the path given, plus a template
  that never existed. An agent following it fails to find the file and builds a parallel implementation —
  precisely what the table existed to prevent. This repo ships that table verbatim into every scaffolded
  project, where five of nine paths were wrong.
- A 38 KB `PROJECT_CONTEXT.md`, five months stale, describing four directories that do not exist, whose
  closing line was *"CRITICAL RULE: you MUST update this file to keep it accurate."*

That last line is the whole problem in one sentence: an instruction to keep a copy in sync is a guarantee
of rot, because nothing fails when someone doesn't.

## Decision

CLAUDE.md **rule 15c**: the code is the truth; a hand-written doc may not repeat it. No config values, no
"which files exist" inventories, no paths or signatures, no restatement of what a function does. Write only
what the code cannot say — why it is this way, what it is for, what breaks if you invert it, what you must
know before you start. Need a code fact for a sentence to be true? Name the place instead of copying the
value. The rule ships with a per-doc-type table, and the same content section is added to all four
protocols: ADR (why, not how), lesson (what failed, not the fix), findings (point, don't paste), branch log
(what happened, not what the code now looks like). The maintenance instruction is inverted: **come back to
a doc only when a change makes something in it untrue.**

One explicit exception: a **closed vocabulary you must get right in one pass** (the colour tokens, a status
enum) may be listed, always with a pointer to its source.

## Rejected alternatives

- **Keep the inventories, add a staleness checker** — rejected: `ai:doc-staleness` already exists and is
  report-only by necessity (it cannot know whether a change invalidated a sentence). A checker for content
  that should not be written is a worse fix than not writing it.
- **Generate the inventories into the hand-written docs** — rejected: that is what the generated indexes
  and the MCP tools already are. Duplicating them into prose puts a second, unqueryable copy in the path
  of every reader.
- **No exception at all** — rejected, deliberately. A closed vocabulary genuinely needs to be seen at once,
  and without a stated boundary an unstated one appears anyway — as a habit rather than a rule.

## Consequences

- The `CLAUDE.md` component table is replaced by the rule plus how to ask the code (`get_capability`, the
  generated indexes, grep) and by the things the code cannot say: that primitives are not flat, that some
  live in `@luckystack/core/client` rather than in the project, and that the template union is closed.
- The Templates section no longer names the union members; it says to read the union.
- Rule 15 changes from "update documentation after code changes" to "update the hand-written docs when a
  change makes them untrue".
- Existing docs are not retroactively audited. The rule applies from now on; `ai:doc-staleness` keeps
  nudging on `@covers`-wired docs.
