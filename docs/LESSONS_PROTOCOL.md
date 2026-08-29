# Lessons Protocol

> The committed, project-wide **pitfalls** layer: *what was tried, what failed, and the takeaway*.
> Like the Branch-Log and Decision-Memory protocols, this is **automatic AI behavior — there is no
> command for the user to run.** The AI fills and reads it as a normal part of working.

## Why this exists

`branch-logs/` is a per-branch firehose, and the per-developer `~/.claude` memory is private and never
committed. Neither is a shared, searchable, project-wide record of the dead-ends a team (and every fresh
AI session) keeps rediscovering. The lessons layer is that missing surface — durable, committed, and
queryable via the `@luckystack/mcp` tools `list_lessons` / `find_lesson` / `get_lesson`.

## Keep the four surfaces distinct — do not blur them

- `branch-logs/` = *what happened, per prompt* (the firehose).
- CLAUDE.md User Project Rules = *what you must always do* (the always-on imperative).
- `docs/decisions/` = *why it is this way / why not Y* (durable rationale, until superseded).
- `docs/lessons/` = *what failed and the takeaway* (a pitfall, so it isn't repeated).

A lesson is not a decision: a decision has a rejected alternative and settles a choice; a lesson captures
a non-obvious failure so the next person avoids it. If the right output is a rule, that's a decision (or a
CLAUDE.md rule); if it's "don't do X because it silently breaks Y", that's a lesson.

## AI MUST, on its own

- **Propose a lesson at wrap-up when a non-obvious dead-end was hit.** Qualifying bar: the session burned
  **real effort** on a path that failed for a reason that wasn't obvious up front (a leaky boundary, a
  platform footgun, a "static checks passed but runtime broke" surprise) **and** the trap would plausibly
  repeat. A bug found and fixed in minutes is not a lesson; neither is anything an existing lesson already
  covers. Timing follows the **Session Capture Protocol** (`CLAUDE.md`): hold the candidate in the
  in-session capture buffer and write `docs/lessons/NNNN-slug.md` (What happened / Root cause / How to
  avoid) at wrap-up, then regenerate `npm run ai:lessons`. Autonomous — no permission prompt, like a
  branch-log append. The bar is what keeps lessons rare, not an approval step.
- **Consult it before retrying something hard.** Before re-attempting a tricky integration or a previously
  abandoned approach, `find_lesson` first — don't rediscover a known pitfall.
- **Offer to backfill on an existing project.** If at session start `docs/lessons/` is effectively empty
  (only `0000-template.md`) but the project has substantial history (many commits, populated `branch-logs/`,
  a `~/.claude` memory full of "learned this again" notes), proactively TELL the user and OFFER to seed it —
  from the written history AND a short, resumable interview ("welke dingen heb je al een paar keer opnieuw
  moeten leren in deze codebase?"). Mirror Decision Memory Protocol §8: offer once, early; act only on the
  user's go-ahead; never fabricate — unconfirmed inferences stay out until confirmed.

## What belongs in a lesson (and what does not)

A lesson records **what failed and why it wasn't obvious** — never how the fix works. See CLAUDE.md rule
15c: *the code is the truth; a hand-written doc may not repeat it.*

- **Write:** the symptom as it actually presented, why the obvious diagnosis was wrong, and the signal that
  would have caught it sooner.
- **Do not write:** a walkthrough of the fix. The fix lives in the code and will be refactored; **the
  pitfall outlives the fix**, and a stale fix-description next to a live pitfall is worse than no lesson.
- Point at file:line rather than pasting code — weeks later the paste is wrong and the pointer still works.

## Numbering — a number is an IDENTITY

Same rule as ADRs, same guard: **never reuse a number, never shift one.** On a collision the *unmerged*
side moves to the next free number; published numbers stay put. Distinct slugs mean git merges a collision
as two clean ADDITIONS with no signal, and renumbering afterwards silently repoints every reference written
under the old scheme. `npm run ai:check-ids` blocks the collision. Full reasoning: Decision Memory Protocol
§10.

## File format

Frontmatter: `name` (must equal the filename slug — `ai:check-ids` enforces it), `title`, `severity`
(`low|medium|high|critical`), `area` (a path or subsystem), `date` (absolute), `tags` (inline array). Body
sections: `## What happened`, `## Root cause`, `## How to avoid` (the takeaway the index surfaces). See
`docs/lessons/0000-template.md`.
