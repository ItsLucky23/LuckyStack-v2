---
name: review_branch
description: Review a branch against Git evidence, captured intent and verification gaps.
---

This is read-only. Follow `AGENTS.md`; do not edit, stage, commit or silently fix findings.

1. Determine the actual branch/default base or ask when it is ambiguous. Never assume an old default branch name.
2. Inspect commits, changed-file scope, relevant full diffs and separate working-tree changes. State exclusions/coverage; do not report sampling as a complete audit.
3. Read the branch log using the canonical naming protocol and relevant handoff. Compare captured intent with Git/tool evidence; logs cannot prove tests passed.
4. Flag unsupported claims, risky contract changes, missing business tests and truly unfinished work. An absent log entry for trivial/read-only work is not automatically a documentation defect.
5. Return a concise report with concrete source pointers, needed verification, suggested review focus and a proposed commit message explaining why. No permanent report unless requested or the findings capture bar applies.

If Git/base evidence is unavailable, report the limitation and continue only with conclusions it supports.
