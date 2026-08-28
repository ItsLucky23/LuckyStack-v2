---
name: ai-artifacts-are-a-gitignored-cache
title: The generated AI-context artifacts are a gitignored local cache; the pre-commit hook only checks
status: accepted
date: 2026-08-28
deciders: [ItsLucky23]
tags: [ai-context, tooling, git, hooks, ci]
supersedes: []
relates: [0016, 0046]
---

## Context

Nine generated artifacts (`AI_QUICK_INDEX`, `AI_CAPABILITIES`, `AI_PROJECT_INDEX`, `AI_DECISIONS_INDEX`,
`AI_LESSONS_INDEX`, `AI_EXAMPLES_INDEX`, `AI_RUNBOOKS`, `AI_CONTEXT_BUDGET`, `ai-graph.json`) were
committed, and a pre-commit hook regenerated all of them plus `git add`ed them on every commit. Two
distinct problems:

1. **They should not be in git at all.** Every one is derived from the code. A committed copy is a second
   answer to a question the code already answers — and it is the answer that drifts. Measured downstream:
   they changed in **200 of the last 411 commits**, which is merge-conflict surface and review noise for
   information no reviewer reads.
2. **The hook made the commit untrue.** The generators read the whole working tree, not the staging area.
   A commit could therefore carry an index derived from code that was not in that commit. It also made
   every commit slow — and after [[0046]] the graph pass genuinely runs the TypeScript compiler, which puts
   it firmly outside a hook's time budget.

## Decision

Gitignore all nine. Add `npm run ai:refresh` (`scripts/aiRefresh.mjs`), which runs the independent
generators concurrently — wall-clock is the slowest generator (~4s), not the sum — with
`generateContextBudget.mjs` in a second stage because it measures the others' output. Wire
`postinstall: ai:refresh --if-missing` so a fresh clone and a CI runner get working MCP lookups, and so a
generator failure degrades the tooling rather than breaking the install. The pre-commit hook becomes two
pure-Node checks (`ai:check-ids`, `ai:lint`) plus report-only nudges: **no generators, no `git add`, no
write to the working tree**. A new CI job `ai-records` runs the same checks without `npm ci`.

## Rejected alternatives

- **Keep them committed, add a CI drift-gate** — rejected: it polices a copy that should not exist. With
  nothing in git there is nothing to drift from, and the gate, the hook and the conflicts all disappear
  together rather than being replaced by a cheaper version of themselves.
- **Keep the hook but drop only `ai:graph` from it** — rejected: it fixes the slowest generator and keeps
  the correctness bug. Any generator reading the working tree while staging into a commit can produce an
  index for code that is not in that commit.
- **Regenerate from the staging area instead of the tree** — rejected: it means materialising the staged
  tree for every generator on every commit, to keep a committed copy that has no reader.

## Consequences

- A fresh clone has no indexes until `postinstall` runs. Accepted: the MCP tools each report how to
  generate their artifact, and `ai:refresh` takes seconds.
- A reviewer can no longer see from an index diff that a route was added. That diff was noise in 200 of
  411 commits; the route itself is in the same diff.
- `bundleFrameworkDocs.mjs` must not depend on these files existing — it strips them from the tarball
  anyway, see [[0050]].
- `.githooks/pre-commit` is now mode 100755 with an `eol=lf` gitattribute: a hook committed from Windows
  as 100644/CRLF is silently skipped on Linux and macOS, which is how a "green" hook can never have run.
