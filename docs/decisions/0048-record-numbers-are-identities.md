---
name: record-numbers-are-identities
title: An ADR/lesson number is an identity — never reused, never shifted — and a guard enforces it
status: accepted
date: 2026-08-28
deciders: [ItsLucky23]
tags: [ai-context, decisions, lessons, tooling, ci]
supersedes: []
relates: [0001, 0016]
---

## Context

`docs/DECISION_MEMORY_PROTOCOL.md` §10 previously said: *"the slug-first filename keeps them distinct on
disk; renumber the later one on merge. Rare and cheap."* Both halves are wrong, and the second one is what
does the damage.

Two long-lived branches each allocate the next free number to a different decision. The slugs differ, so
the filenames differ, so git sees two **additions** — not a conflict. The merge is green and there is no
signal anywhere. The tree now holds two `0089-*.md`, while `//? @adr 0089`, `relates: [0089]` and
`get_decision(89)` all address by NUMBER and resolve to whichever file sorts first.

The usual remedy — shifting a block of numbers to clear the collision — is the unrecoverable step: every
reference written under the old scheme now points at a *real but wrong* decision. Nothing is broken, so no
check, review or pipeline can see it. Measured in a downstream project: **13 duplicate ADR numbers, 4
duplicate lessons, 32 shifted numbers, and 6 `relates:` lines silently pointing at the wrong decision.**

## Decision

A record number is an identity: **never reused, never shifted.** On a collision the **unmerged** side moves
to the next free number; the trunk keeps its numbers, because they are published. `scripts/checkRecordIds.mjs`
(`npm run ai:check-ids`) enforces the mechanically checkable half — duplicate numbers, an in-file
number/slug disagreeing with the filename, and a numeric `relates`/`supersedes`/`superseded_by` (and, with
`--backrefs`, an `@adr NNNN` in source) pointing at a record that does not exist. It is **blocking**, in
the pre-commit hook (~125ms) and in CI with `--backrefs` (~430ms). The rule is written into both
DECISION_MEMORY_PROTOCOL.md and LESSONS_PROTOCOL.md.

## Rejected alternatives

- **Date-based or hashed ids (`2026-08-28-slug`)** — genuinely cannot collide, and rejected anyway: it
  breaks `get_decision(7)`, the `//? @adr NNNN` tag format, every `relates:` line, the `decision_for_file`
  reverse map and 46 existing records — to solve a problem a 125ms check already blocks. The collision is
  a branching problem; the fix belongs at the branch, not in the identity scheme.
- **Allocate numbers at merge time from a central counter** — rejected: an ADR must be writable and
  referenceable on the branch where the decision is made, offline, with no coordination step.
- **Warn instead of block** — rejected: this is the one failure in the set that gets *worse* with time and
  cannot be found afterwards. A warning is how the 32 shifted numbers happened.

## Consequences

- The guard fails a merge that produces a collision. That is the intent: the failure is cheap, the silent
  merge is not.
- It cannot detect a reference to an existing-but-wrong number — that is not mechanically knowable. It
  prevents the collision that leads to renumbering, which is the only real remedy.
- Number sequences may now contain gaps (a withdrawn draft leaves its number spent). Accepted: a gap costs
  nothing, a reused number costs correctness.
- Cleaning up an existing collision has a mechanical rule: check whether a reference line already existed
  on the trunk. If yes it meant the trunk's record; if no it meant yours and moves with it.
