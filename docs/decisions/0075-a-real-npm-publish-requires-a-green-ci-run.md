---
name: a-real-npm-publish-requires-a-green-ci-run
title: A real npm publish requires a green `ci` run for the tagged commit
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [release, ci, packaging]
supersedes: []
relates: []
---

## Context

The `e2e-scaffold` job in the `ci` workflow is the only check of the real
consumer path, from installed packages to a fresh scaffold. The publish
workflow neither ran it nor waited for it, so a tag pushed together with a
packaging regression published while `ci` failed in parallel. Releases relied
on someone waiting for `ci` by hand before tagging (the release flow in the
`main` branch log). The owner chose to gate the publish on `ci` (sweep finding
113).

## Decision

Before any build, a real publish waits for the `ci` runs of the tagged commit
and continues only when one of them succeeded. It fails when every run finished
without success, when no run appears within ten minutes, or after fifty
minutes. Dry runs skip the gate. In the same workflow a tag must equal the
lockstep package version, and a real manual publish must run on a version tag.

## Rejected alternatives

- **Run the end-to-end scaffold test inside the publish workflow.** It repeats
  a 30-minute job for every release and can still disagree with `ci`.
- **Keep waiting by hand.** That is the gap this record closes.

## Consequences

- The tagged commit must have been pushed to a branch or pull request first,
  so that `ci` ran for it. Release flow: push the commit, then tag it.
- `ci` cancels an older run when a newer commit is pushed to the same ref.
  Tagging that older commit then fails the gate until `ci` is re-run for it.
