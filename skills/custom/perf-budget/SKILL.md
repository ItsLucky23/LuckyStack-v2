---
name: perf-budget
description: Define and verify a deliberate performance budget without silently accepting regressions.
category: quality
---

# Performance budget

A baseline is a reviewed product trade-off, not a snapshot to overwrite whenever a check fails. Bundle size and runtime performance answer different questions.

1. Agree on the metric, representative build/environment, acceptable change and ownership of baseline updates.
2. Reuse installed project tooling or an appropriate existing capability before proposing a new harness. Inspect actual commands/schema; do not claim a script exists merely because a skill names it.
3. Verify a clean repeated build and a deliberately oversized case before trusting the guard. Ensure new/renamed chunks cannot silently evade it.
4. On a regression, report evidence and likely cause. Do not re-baseline or loosen the threshold to get green without approval.
5. Keep CI integration scoped to the user's request. Preserve customized workflows and state exact measurements/skips.

Exact settings live in the selected implementation. Use `AGENTS.md` for dependency, verification and capture authority.
