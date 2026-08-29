---
name: graph-is-repo-scoped-with-derived-closures
title: The dependency graph covers every first-party root, uses repo-relative ids, and stores no transitive closures
status: accepted
date: 2026-08-28
deciders: [ItsLucky23]
tags: [ai-context, graph, mcp, tooling]
supersedes: []
relates: [0002, 0004, 0006]
---

## Context

Three independent defects in `generateGraph.mjs` were confirmed by measurement, all of them silent — no
error, no warning, green pipeline:

- The symbol pass compared `program.getSourceFiles().length` against a cap of 2500. That count includes
  every `.d.ts` the compiler pulls from `node_modules`. Measured in this repo: 2203 program files of which
  **1526 come from node_modules** — 88% of the cap consumed before a line of project code. Any project with
  a slightly larger dependency tree was already over it, so the pass skipped itself and reported
  `symbols: 0`, which reads as "this project has no functions" rather than "this check did not run".
  `who_calls` had therefore returned an empty answer since it shipped.
- `resolveTarget` returned `null` for anything outside `src/`, so `server/`, `shared/`, `functions/`,
  `luckystack/` and `config.ts` were not nodes. A missing node does not look missing in a graph: it looks
  like *a file nothing depends on*. The blind spot was reassuring, and it sat exactly where a change is
  most expensive. After the fix `config.ts` and `config.ports.ts` are the #2 and #3 god-nodes.
- The route regex required a page segment before `_api/`, dropping the root routes the scaffold itself
  ships (`session_v1`, `logout_v1`). `find_route` reported the session route as non-existent in every
  scaffolded project from day one.

Separately, the artifact stored `blastRadius` and `symbolBlastRadius` — transitive closures, derivable from
`edges`/`callEdges` in milliseconds, growing superlinearly. On a real downstream codebase they were **82%
of a 16 MB file**.

## Decision

Graph version 3: node ids are **repo-relative** and the scan covers every first-party root (`src/`,
`server/`, `shared/`, `functions/`, `luckystack/`) plus the root-level config files. The symbol pass builds
its program from the SCANNED files and caps on **in-project** file count only. Route derivation treats the
page segment as optional. The generator emits `nodes`, `edges`, `godNodes`, `symbols` and `callEdges` and
**no transitive closures**; `@luckystack/mcp` derives `blastRadius` / `symbolBlastRadius` in `loadGraph()`.

## Rejected alternatives

- **Raise the symbol cap** — rejected: it treats the symptom. The number being compared was the wrong
  number; any cap over it is arbitrary and will be crossed again by a dependency, not by the project.
- **Keep ids src-relative and add the other roots under synthetic prefixes** — rejected: two id conventions
  in one artifact, and `resolveNodeId` already had to guess. Repo-relative is the only convention that
  needs no mapping.
- **Keep storing the closures, gzip the artifact** — rejected: it optimises the transport of data that
  should not exist. Reading and parsing the full artifact measured 82ms; recomputing the closure is
  cheaper than the disk it occupies.
- **Make `blastRadius` required in the MCP schema and have the generator keep writing it** — rejected: it
  was the reason a downstream project could not drop the field on its own side. Omitting it validated as
  an empty object, and the tool then answered "no dependencies" — a silent wrong answer, which is worse
  than a large file.

## Consequences

- Graph generation now genuinely runs the TypeScript pass, so it is slower (seconds, not milliseconds).
  That is one of the reasons generation no longer belongs in a pre-commit hook — see [[0053]].
- The artifact is bigger in symbols and smaller in closures; net it is dominated by real data.
- `resolveNodeId` accepts both conventions, so a version-2 graph still resolves. An old MCP against a
  version-3 graph fails to validate and reports the artifact as missing — loud, not silent.
- Any consumer reading `graph.blastRadius` straight from the JSON file (rather than through the MCP) must
  derive it themselves.
