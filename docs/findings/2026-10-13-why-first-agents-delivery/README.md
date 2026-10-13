# WHY-first documentation and AGENTS consumer delivery audit

Scan date: 2026-10-13
Last updated: 2026-10-13

## Scope and exclusions

Reviewed current repository guides, architecture, package instructions/deep docs, skills/commands, templates and executable npm/scaffold delivery. Four isolated implementation lanes were integrated, then independent read-only reviews checked design/safety, delivery and parent-owned guidance. Coverage includes every current package documentation surface and both published instruction and scaffold copies.

Historical decisions, lessons, session records, dated audit ledgers and the external workspace handoff archive were preserved rather than rewritten. Active authoring templates were not treated as frozen history. Existing unresolved audit claims were not discarded. The developer's initial installation-script policy was outside this change.

## Status ledger

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Handwritten implementation inventories/execution tours conflicted with the source-of-truth policy | medium | fixed | 2026-10-13 | 2026-10-13 | Current guides rewritten; ADR 0065 supersedes 0049 without changing its substance |
| 2 | Current package/scaffold delivery depended on vendor-specific instructions and reverse generation | medium | fixed | 2026-10-13 | 2026-10-13 | Root/package `AGENTS.md`, bundle/copy/update code and regression coverage; ADR 0066 |
| 3 | Rewritten email guidance incorrectly claimed the pre-send stop signal was ineffective | high | fixed | 2026-10-13 | 2026-10-13 | `packages/email/docs/hooks.md`; source/orchestration tests distinguish stop signals from isolated exceptions |
| 4 | The rewrite removed concrete existing-project 2FA persistence/key prerequisites | high | fixed | 2026-10-13 | 2026-10-13 | `packages/login/README.md` retains opt-in, manual persistence, real sender, primary/legacy key and UI merge checklist |
| 5 | Direct delivery tests depended on an ignored stale bundle; copied config retained an obsolete instruction pointer | medium | fixed | 2026-10-13 | 2026-10-13 | `agentsDelivery.test.ts` isolates source fallback and rejects stale bundles; template config points to AGENTS |
| 6 | Consumer upgrade instructions and cross-root Markdown links could target absent paths | medium | fixed | 2026-10-13 | 2026-10-13 | Real-source upgrade assertion plus packaged/scaffold link checks; portable guide references |
| 7 | Root and consumer decision templates disagreed on permission and record-number semantics | medium | fixed | 2026-10-13 | 2026-10-13 | `recordTemplates.test.ts` guards both record-template copies; consumer protocol path rebased |
| 8 | Removed README inventories broke auth/data-layer scaffold edits | medium | fixed | 2026-10-13 | 2026-10-13 | `index.ts` no longer mutates choice-neutral README prose; auth-none regression and actual auth/non-Prisma scaffolds verified; CLI retains legacy handling |
| 9 | Docker build-context exclusions differed between asset and template | medium | fixed | 2026-10-13 | 2026-10-13 | Both ignore copies include private instruction files; existing asset parity test retained |
| 10 | Framework product/roadmap and findings rollup could become consumer context | medium | fixed | 2026-10-13 | 2026-10-13 | Bundle and fallback exclusions verified against actual tarballs/scaffolds; consumer-owned records preserved |

## Verification and limits

- Full lint/build succeeded; final unit suite succeeded. Build retains the existing Node subprocess deprecation and developer installation-script-policy precedence warnings; it is not a zero-warning result.
- Actual local npm tarballs and no-install scaffold variants verified instruction names, Markdown links, rendered instruction hashes and authoring-template parity. No installation, publication or browser verification was performed.
- Original additional live sweep: 88 passed, 24 failed, 23 skipped. Local MongoDB lacked usable replica-set/transaction availability; reset/auth inputs were unavailable for some checks. This attempt was not a passed runtime gate.
- User-authorized follow-up on 2026-10-13 repaired the stale local replica-set member address after an offline backup. Real transaction/rollback and repeated-start invariance passed; 15 infrastructure tests passed. Final live sweep: **112 passed, 0 failed, 23 skipped**, including all 64 business tests. Reset bookends and the CSRF layer were not run; remaining skips need auth/input fixtures or exceed the existing rate-limit test bound. Final evidence: `/tmp/ls-mongo-repair-live-sweep-final.log` and `/tmp/ls-mongo-readiness-tests.log`. No shared/staging/production database or application schema was changed.
- Evidence artifacts: `/tmp/ls-docs-{lint,build,test-unit,live-sweep}.log`, `/tmp/ls-docs-delivery-receipt.json`; independent reports retained in the session's subagent artifacts. These local artifacts are verification receipts, not committed credentials or a permanent code specification.
