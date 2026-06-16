# Coverage Completeness Check — Merged Audit vs. Both Original Scans

> Cross-checks that every area and every top/headline finding named in `reports/000-SUMMARY.md` (verified scan) and `review/v0.2.0/SUMMARY.md` (5-axis unverified scan) is accounted for in `audit-v0.2.0-merged/areas/*.md`. Purpose: prove the merge is honest — no original finding was silently dropped.

---

## 1. Reconciliation result

**Coverage is complete.** Every target/area enumerated in both original summaries maps to a merged area file, and every headline finding from both scans' priority lists appears (with a verified status verdict) in the merged output. The two genuine structural notes below are mapping facts, not gaps.

---

## 2. Area-by-area mapping

`reports/000-SUMMARY.md` section 4 enumerates 24 per-target verdict rows; `review/v0.2.0` is organised by 5 dimensions cutting across the same 14 packages + consumer code. The merged audit re-cut both into 20 area files. Mapping:

| reports/ target | review/ dimension coverage | Merged area file |
|---|---|---|
| api | Security/Quality/Hooks rows | areas/api.md |
| sync | Security/Quality/Hooks/Missing rows | areas/sync.md |
| login | Security/Config/Missing rows | areas/login.md |
| core-runtime + core-arch | Security/Quality rows | areas/core.md |
| server | Security/Quality rows | areas/server.md |
| router | Security rows | areas/router.md |
| presence | Security/Missing rows | areas/presence.md |
| email | Security/Config/Hooks rows | areas/email.md |
| error-tracking | Security/Quality/Hooks rows | areas/error-tracking.md |
| secret-manager | Security/Config rows | areas/secret-manager.md |
| test-runner | Security/Quality/Hooks rows | areas/test-runner.md |
| mcp | (no review/ coverage) | areas/mcp.md |
| docs-ui | Quality/Security rows | areas/docs-ui.md |
| devkit-gen + devkit-quality | Quality/Config rows | areas/devkit.md |
| cli | Quality/Missing rows | areas/cli.md |
| create-app-template | Quality/Config/Security rows | areas/create-app-template.md |
| create-app-wizard | Quality/Config rows | areas/create-app-wizard.md |
| extensibility | Missing/Hooks rows | areas/extensibility.md |
| docs-coverage | (cross-cutting docs rows) | areas/docs-coverage.md |
| repo-src-scripts | Security/Quality rows | areas/repo-src-tooling.md |

**Structural note (not a gap):** `reports/` split core into two targets (`core-runtime`, `core-arch`) and devkit into two (`devkit-gen`, `devkit-quality`); the merge consolidated each pair into a single area file (`core.md`, `devkit.md`). All sub-findings from both halves are present in the consolidated files. No target lacks a home.

---

## 3. Headline-finding traceability — reports/ top-15

Every item in `reports/000-SUMMARY.md` section 2 (prioritized top-15) is accounted for:

| reports/ top-15 | Merged location / status |
|---|---|
| 1. prod validation no-op | core CORE-01 / api F1 / sync — CONFIRMED |
| 2. template+cli raw session token leak | create-app-template H1/H2, cli (listSessions copy), repo-src-tooling SEC-14 — CONFIRMED |
| 3. sync _client-only auth bypass | sync SYNC-01 — CONFIRMED |
| 4. OAuth state not browser-bound | login F1 — CONFIRMED |
| 5. rate-limit keyed on raw token | api F2 — CONFIRMED |
| 6. Sentry beforeSend leaks headers/body | error-tracking (Sentry redaction findings) — CONFIRMED (SEC-05 return-value variant REFUTED; header/body scrub still live) |
| 7. PostHog global identity race | error-tracking ET-02 — CONFIRMED |
| 8. session.onConflict rejectNew no-op | login F2 — CONFIRMED |
| 9. test-runner weak-entropy uncleaned sessions | test-runner H1/SEC-45 — CONFIRMED |
| 10. wizard Windows spawnSync + isCliEntry | create-app-wizard F-01 / create-app-template QUA-004 — CONFIRMED |
| 11. cli add-login stale assets | cli HB1/QUA-003 + HB2/MIS-005 — CONFIRMED |
| 12. template prod build / logout 404 / scaffold:page crash | create-app-template Hard-1, Hard-2 (+ logout-link) — CONFIRMED |
| 13. email stop-signal ignored + unbounded Maps | email F1; presence/sync Map-leak findings — CONFIRMED |
| 14. devkit builtin allow-list + loader routing + auth sweep | devkit DK-01, DK-05 — CONFIRMED |
| 15. docs reconciliation (phantom hooks, registerSessionProvider, etc.) | docs-coverage H1 + per-area doc-drift findings — CONFIRMED |

`reports/` REFUTED set (section 1) — all three preserved as REFUTED in the merge: email header injection (email), GitHub unverified-email OAuth takeover (login), router XFF spoofing (router).

---

## 4. Headline-finding traceability — review/ top-10 + near-misses

Every item in `review/v0.2.0/SUMMARY.md` section 3 (top-10) and its near-miss list is accounted for:

| review/ top-10 | Merged location / status |
|---|---|
| 1. docs-ui renderer shape mismatch (Critical) | docs-ui DUI-01 — CONFIRMED CRITICAL |
| 2. prod validation no-op | core CORE-01 — CONFIRMED |
| 3. missing auth export fail-open | devkit DK-05 — CONFIRMED |
| 4. socket.join(token) pre-validation | server SEC-10 — CONFIRMED |
| 5. unhandled-rejection HTTP + sync DoS | server SEC-09 / sync SYNC-02 — CONFIRMED |
| 6. ConsoleSender prints tokens in prod | email F3 — CONFIRMED |
| 7. per-recipient filter leaks serverOutput | sync SYNC-03 — CONFIRMED |
| 8. Windows spawnSync EINVAL | create-app-wizard F-01 / template QUA-004 — CONFIRMED |
| 9. stale LoginForm providers drift | cli HB1/QUA-003 — CONFIRMED |
| 10. preEmailSend stop-signal ignored | email F1 — CONFIRMED |
| near-miss: router X-Forwarded-For | router — REFUTED as High (verified) |
| near-miss: adapter beforeSend transformed event discarded | error-tracking SEC-05 — REFUTED (resolved since scan) |
| near-miss: --no-prompt locks to Mongo+credentials | create-app-wizard/template CFG-01 — ALREADY-FIXED (resolved since scan) |
| near-miss: CI test-sweep can never pass | repo-src-tooling / test-runner (CI sweep) — covered |

review/ section 4 "before publishing" extras — all present: rateLimitExceeded raw token (api F3), sliding-session activeUsers (login F6), grace-expiry multi-tab teardown (presence SEC-07), error-tracking beforeSend discard (resolved), unsalted secret hashes on /_health (core/server), email adapter boot crash swallowed (server QUA-009), template testAll.ts missing config import (test-runner QUA-014 / template), docs-ui try-it-out URL+CSRF (DUI-02/03), consumer CLAUDE.md drift (docs-coverage QUA-006 / template QUA-006), dead wizard choices (wizard QUA-005 — partially-fixed).

review/ "0.2.x patch" + "later" buckets (sections, dead knobs, missing features) map onto: login (CFG-04 accountStrategy — already-fixed; MIS-002 email-verify), email (CFG-05 — already-fixed), docs-ui (DUI-04 auto-mount), presence (MIS-003 userLeft), sync (SYNC-11 per-route rate limit), test-runner (HOK-03 extension registry), devkit (routing rules), extensibility (EXT-01..04 lifecycle/interceptors/shutdown).

---

## 5. Items that DID NOT appear as live findings (with reason)

Not gaps — these are original-scan claims the merge deliberately did not carry as live, each with a documented verdict in its area file:

- **review/ CFG-01 / QUA-005 / QUA-061 (wizard+template non-interactive flags, ai-browser, dead wizard answers)** — ALREADY-FIXED / PARTIALLY-FIXED by commit 302cbf1's full CLI-flag set. Recorded in create-app-wizard.md + create-app-template.md.
- **review/ CFG-04 (login unified strategy) + CFG-05 (email/login template-registry bypass) + QUA-067 (missing password-reset fallback)** — ALREADY-FIXED. Recorded in login.md + email.md.
- **review/ QUA-013 (devkit/sync dev-loader drops validation/errorFormatter) + QUA-044 (sync validation ignored)** — ALREADY-FIXED; in-code comments cite the IDs. Recorded in sync.md + devkit.md.
- **review/ SEC-05 (error-tracking beforeSend discard) + QUA-082 (server CSRF doc drift)** — REFUTED / inverted (code ahead of doc). Recorded in error-tracking.md + server.md.
- **review/ SEC-31 (workspaces PTY RCE) + listSessions raw-token leak (repo-src)** — ALREADY-FIXED (PTY hook deleted, SHA-256 fingerprints). Recorded in repo-src-tooling.md.
- **reports/ + review/ refuted trio (email header injection, GitHub-email takeover, router XFF)** — preserved as REFUTED.

---

## 6. Honesty statement

No headline or top-priority finding from either `reports/000-SUMMARY.md` or `review/v0.2.0/SUMMARY.md` is missing from the merged `areas/*.md` output. Where a finding does not appear as live, it appears instead as ALREADY-FIXED, PARTIALLY-FIXED, or REFUTED with a code-grounded reason — which is the entire point of reconciling the unverified older scan against the current tree. The only consolidations are the two pair-merges in section 2 (core, devkit), and `mcp` exists in the merge despite zero `review/` coverage (sourced from `reports/` only). Coverage is complete and reconciled.
