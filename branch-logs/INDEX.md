# Branch Log Index

> Maintained automatically. Every time a `branch-logs/<branch>.md` is created or appended to, the corresponding row here MUST be added or updated. Last-updated timestamps are the basis for sprint-end audits ("review tickets DEV-120..DEV-140"). See `docs/BRANCH_LOG_PROTOCOL.md` Section 6.5 for the full enforcement rule.

| Branch | Ticket(s) | Last updated | Status | Entries |
|---|---|---|---|---|
| feat/email-code-2fa | (none) | 2026-07-12 16:05 | merged 2026-07-12 — in v0.6.0 (merge 970d051; passwordless email-code login + 2FA TOTP/email-fallback/recovery [ADR 0024]; security-hardened via 5-lens scan + echte-Redis-harness) | 7 |
| fix/unpushed-review-findings | (none) | 2026-07-16 16:10 | merged 2026-07-16 — v0.7.0 release-readiness fixes (merge 3f77de9) | 5 |
| main | (none) | 2026-07-20 06:30 | active — v0.7.3 gepubliceerd: stale-port bugklasse gefixt (CORS + logging + OAuth volgt gebonden poort). | 50 |
| fix/v073-port-oauth-review | (none) | 2026-07-22 10:38 | completed — v0.7.4 gepubliceerd via GitHub Actions met npm provenance. | 6 |
| feat/orm-aware-cli | (none) | 2026-07-11 16:30 | merged 2026-07-11 — in v0.5.1 (b7ee295→61ec674; CLI overal ORM-bewust + bidirectionele ORM-switch als manage-stap 0 + auth kiesbaar op drizzle/mikro-orm [ADR 0023]; rest: settings-routes porten naar UserAdapter) | 3 |
| test/e2e-integration | (none) | 2026-07-11 13:35 | merged 2026-07-11 — v0.5.0 GEPUBLICEERD naar npm (ee8100b; 17 packages incl. nieuw @luckystack/cron; multi-instance exactly-once + failover eerst bewezen via verdaccio; provenance-less lokale publish — volgende release via CI) | 2 |
| feat/scaffold-manifest | (none) | 2026-07-09 09:20 | merged 2026-07-11 (via test/e2e-integration; fase 0+1a ADR 0021: scaffold-manifest + `luckystack update`) | 2 |
| feat/orm-choice | (none) | 2026-07-09 10:40 | merged 2026-07-11 (via test/e2e-integration; fase 1b ADR 0020 + verdaccio-e2e + e2e-fixes) | 2 |
| feat/cron-package | (none) | 2026-07-09 08:55 | merged 2026-07-11 (via test/e2e-integration; @luckystack/cron, ADR 0022) | 1 |
| debug/devtools-lag | (none) | 2026-07-08 20:58 | merged 2026-07-11 (via test/e2e-integration; devtools-fix + prod-overlay-bundling + ADR 0020/0021) | 14 |
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
