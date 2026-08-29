# Branch Log Index

> Maintained automatically. Every time a `branch-logs/<branch>.md` is created or appended to, the corresponding row here MUST be added or updated. Last-updated timestamps are the basis for sprint-end audits ("review tickets DEV-120..DEV-140"). See `docs/BRANCH_LOG_PROTOCOL.md` Section 6.5 for the full enforcement rule.

| Branch | Ticket(s) | Last updated | Status | Entries |
|---|---|---|---|---|
| chore/ai-context-contract-2026-08-28 | (none) | 2026-08-29 16:50 | in progress — AI-context-laag herzien (3 generatorbugs, artifacts nu gitignored cache, hook/CI checks-only, feature-grens-gate, ADR 0052–0056) + v0.9.0 release voorbereid: 17 packages lockstep, publish-gate 8/8 groen, flaky test-runner-suite en `bump --dry-run`-footgun gefixt. Daarna `origin/main` erin gemerged (39 conflicten, records hernummerd) en de sinds v0.8.5 rode `e2e-scaffold`-job opgelost: `isCliEntry` vergeleek symlink met realpath, waardoor `npx create-luckystack-app` op macOS/Linux stil niets deed (lesson 0021). | 3 |
| feat/email-code-2fa | (none) | 2026-07-12 16:05 | merged 2026-07-12 — in v0.6.0 (merge 970d051; passwordless email-code login + 2FA TOTP/email-fallback/recovery [ADR 0024]; security-hardened via 5-lens scan + echte-Redis-harness) | 7 |
| fix/unpushed-review-findings | (none) | 2026-07-16 16:10 | merged 2026-07-16 — v0.7.0 release-readiness fixes (merge 3f77de9) | 5 |
| main | (none) | 2026-08-18 18:05 | active — v0.8.6 gepubliceerd; v0.8.7 voorbereid: exacte `_api`/`_sync` marker-match (33 valse loader-warnings → 0), `afterListen` tegen de post-listen crash-loop (ADR 0050), en deny-in-place middleware (`{ success: false, status }`). Twee zelfreviews, vier eigen bugs gevangen. | 83 |
| fix/prod-function-map-divergence | (none) | 2026-08-21 | merged 2026-08-21 in v0.8.5 — function-injection in één registry (ADR 0046), e2e-poort gerepareerd + in CI, testbestanden uitgesloten van elke import-alles-plek (ADR 0047); gerebased op v0.8.4, nog niet gepubliceerd. | 4 |
| fix/routed-http-method-map-bootstrap | (none) | 2026-07-27 23:59 | completed — v0.8.3 met provenance gepubliceerd; registry-scaffold groen. | 3 |
| fix/dropdown-positioning | (none) | 2026-07-22 21:17 | completed — v0.7.5 gepubliceerd via GitHub Actions met npm provenance. | 3 |
| fix/boot-uuid-heartbeat | (none) | 2026-07-23 08:40 | merged — BU-01 uitgebracht in v0.7.6 met npm provenance. | 3 |
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
