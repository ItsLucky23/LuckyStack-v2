---
name: a-skipped-check-reports-the-same-value-as-a-clean-one
title: A generator that skips itself reports the same value as one that found nothing
severity: high
area: scripts/ (AI-context generators)
date: 2026-08-28
tags: [tooling, ai-context, silent-failure, generators, graph]
---

# 0019 — A generator that skips itself reports the same value as one that found nothing

## What happened

Three defects in the AI-context generators had been live for their entire existence and none of them ever
produced an error, a warning, or a failing test:

- `generateGraph.mjs` compared `program.getSourceFiles().length` against a cap of 2500 to decide whether to
  run the TypeScript symbol pass. That count includes every `.d.ts` the compiler pulls from `node_modules`.
  In this repo: 2203 program files, **1526 of them from node_modules** — 88% of the cap before a line of
  project code. Anything larger silently skipped the pass and wrote `counts.symbols: 0`. The MCP tool
  `who_calls` had returned "nothing found" since it shipped, and read as *this function has no callers*.
- The route regex required a page segment before `_api/`, so `src/_api/session_v1.ts` (which the scaffold
  itself ships) was simply absent from `AI_PROJECT_INDEX.md`. `find_route` answered *that route does not
  exist* for a route that is live in the generated type map.
- The graph resolved only imports under `src/`, so `config.ts` and `shared/` were not nodes at all. In a
  graph, an absent node does not look absent — it looks like *a file nothing depends on*. After the fix
  `config.ts` / `config.ports.ts` jumped straight to the top of the god-node list.

Downstream, the same three bugs had been silently degrading a real project's tooling for months.

## Root cause

Every one of these has the same shape: **the "I did not run" value is identical to the "I ran and found
nothing" value.** `0`, an empty list, an absent key. A reader — human or agent — cannot tell the two apart,
and the reassuring reading is the one they take. That is worse than a crash, because a crash gets fixed.

The cap made it worse by measuring the wrong thing. It was meant to protect commit time on a huge repo, but
the number it read grows with your *dependencies*, not your code, so it trips on a small project with a
normal `node_modules` and never trips on the thing it was guarding against.

## How to avoid

- **Never let a skip be silent, and never let it look like a result.** If a pass declines to run, say so on
  stderr AND make the artifact say so — a `null`/`"skipped"` marker, not `0`. A consumer must be able to
  distinguish "no callers" from "the call graph was not built".
- **Sanity-check a generator against a fact you already know.** Ask it something whose answer you can
  verify by hand: does the index contain the route you can see in `src/`? Is `config.ts` in the graph?
  A generator that runs green for months is not evidence that it works.
- **A threshold must measure the thing it is protecting.** Before comparing a count against a cap, check
  what that count actually includes. Here, filtering to in-project files was the whole fix.
- **A missing node is not neutral.** In any graph or index, absence reads as "safe to change". Scope
  omissions are most dangerous exactly where the omitted files matter most.

Related: `docs/decisions/0052-graph-is-repo-scoped-with-derived-closures.md`.
