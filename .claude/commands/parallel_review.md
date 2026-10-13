---
name: parallel_review
description: Run scoped independent review perspectives and consolidate evidence-backed findings.
---

Read `AGENTS.md` and `docs/AGENT_TEAM_PLAYBOOK.md` before staffing. Use the harness's available delegation tools; do not assume a tool name or always spawn a fixed panel.

1. Establish the requested branch/base, committed diff and separate uncommitted work. Gather a file/contract scope so all reviewers examine the intended artifact.
2. Choose independent perspectives justified by risk: security/trust boundaries, typing/contracts, business tests, performance or consumer delivery. Announce ownership, read-only authority and coverage; extra requested perspectives remain visible.
3. Give each reviewer source pointers, specific assertions, acceptance evidence and a stop condition. Use fresh context for independent review and no mutation authority.
4. Verify material findings against source/tests; deduplicate repeated claims. Distinguish defects from hypotheses and skipped checks. A silent/missing reviewer result is not “no findings”.
5. Report severity, impact, source/evidence pointer and proposed verification/fix. Resolve conflicting conclusions explicitly instead of voting them away.

Do not auto-fix or commit during a review command. Write a finite findings ledger only if this is a requested scan and only at wrap-up; do not suggest a branch-log entry for read-only work.
