# Branch Log Index

> Maintained automatically. Every time a `branch-logs/<branch>.md` is created or appended to, the corresponding row here MUST be added or updated. Last-updated timestamps are the basis for sprint-end audits ("review tickets DEV-120..DEV-140"). See `docs/BRANCH_LOG_PROTOCOL.md` Section 6.5 for the full enforcement rule.

| Branch | Ticket(s) | Last updated | Status | Entries |
|---|---|---|---|---|
| main | (none) | 2026-07-02 22:55 | active | 24 |
| test/e2e-integration | (none) | 2026-07-11 13:35 | active — **v0.5.0 GEPUBLICEERD naar npm** (ee8100b; 17 packages incl. nieuw @luckystack/cron; multi-instance exactly-once + failover eerst bewezen via verdaccio; provenance-less lokale publish — volgende release via CI; main nog fast-forwarden + taggen) | 2 |
| feat/scaffold-manifest | (none) | 2026-07-09 09:20 | active (fase 0+1a ADR 0021: scaffold-manifest + `luckystack update` [pristine=overwrite, modified=.new-sidecar+AI-merge-rapport, stamp-less=sidecar-only]; 142 cli-tests + kruis-check 132 files hash-agreement; verdaccio-e2e pending) | 2 |
| feat/orm-choice | (none) | 2026-07-09 10:40 | active (fase 1b ADR 0020 + verdaccio-e2e GROEN over cron+manifest/update+ORM [V1 onboarding, V2 orm=none boot database:'skipped', V3 add-cron leadership+stats, V4 update sidecar/add/manifest-refresh]; e2e-fixes: @prisma/client optional peer ×6 + volledig User-placeholder; drizzle + manage-ORM-wissel volgende pass) | 2 |
| feat/cron-package | (none) | 2026-07-09 08:55 | active (@luckystack/cron gebouwd: leader-elected scheduler op core lease; 32 tests + wave-build groen; ADR 0022; verdaccio-e2e pending) | 1 |
| debug/devtools-lag | (none) | 2026-07-08 20:58 | active — devtools-onderzoek AFGEROND (echte-DevTools-meting: fix herstelt vrijwel hele lag, +25% fps); daarna framework-planning: ADR 0020 (ORM-keuze incl. none-hook) + 0021 (scaffold-manifest + luckystack update) gelockt | 14 |
| chore/package-split-prep | (none) | 2026-06-23 | active (wizard+manage verified incl. verdaccio; 5 release-blockers fixed incl. Windows install) | 137 |
| chore/overnight-audit-2026-06-24 | (none) | 2026-06-29 | active (rounds 1-8: audit + verification sweep + ~40 safe fixes + all 7 design-decisions done [+#5 mutation-safety] + NODE_ENV detection unified on resolveEnvKey() across 17 framework sites; consumer-template env-unify [4 files] staged-deferred behind concurrent feat/ai-docs-layers entanglement) | 11 |
| feat/ai-docs-layers-2026-06-29 | (none) | 2026-06-29 | active (7 new AI-context layers: doc-coverage gate, staleness, lessons, example corpus, code→ADR, context budget, eval; CLAUDE.md + consumer propagation + parity test; ADR 0016; verified, not committed) | 1 |

## Columns

- **Branch** — original (un-sanitized) branch name. The sanitized filename is derivable via the rules in `docs/BRANCH_LOG_PROTOCOL.md` Section 5.
- **Ticket(s)** — extracted by matching `[A-Z]{2,}-\d+` against the branch name. `(none)` if no match.
- **Last updated** — `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` matching the latest entry's header timestamp.
- **Status** — `active`, `merged YYYY-MM-DD`, or `abandoned`. Flip to `merged …` when the branch lands in master.
- **Entries** — integer count of `## ` headings in the file.

## Maintenance

- Updated by hand by the AI on every branch-log append. This is non-negotiable.
- `npm run ai:index-branchlogs` (deferred, not yet implemented) will be a drift-repair tool, NOT the primary path.
- If you spot drift between a row here and the actual file, fix the row in the same edit pass.
