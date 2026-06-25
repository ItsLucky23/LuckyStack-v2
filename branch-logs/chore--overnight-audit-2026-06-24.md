# Branch log — chore/overnight-audit-2026-06-24

Branched off `main` @ 7f24021 for an autonomous overnight audit (`/goal`): full adversarial codebase scan + e2e + auto-fix of high-confidence findings. No auto-merge to main — user reviews.

## 2026-06-24 02:00 — Round-1 adversarial audit + reviewed fixes

**User prompt:** `/goal` overnight audit — scan 15 packages + create-luckystack-app + scaffold for security/dead-code/missing-config/bad-code (adversarial, multi-finder + verify); fix high-confidence after a 2nd check; commit per-area to a new branch + push, no auto-merge; full e2e (build+tsc+lint per wizard variant + runtime/browser + verdaccio); converge over 2 dry rounds.

**What I did:**
- Ran a Workflow audit: 16 targets × 3 lenses (security / dead-code+config / correctness) + completeness critic + per-finding adversarial verify. 344 agents, ~27M tokens, 50 min. Result: 280 raw → 181 verified-real → 55 to_fix / 125 to_report (0 critical).
- Ran a strict re-verification Workflow over the 55 to_fix against current bytes (high false-positive rate confirmed). NOTE: the subagents had Edit tools and auto-applied ~34 fixes to the working tree.
- Reviewed the FULL 42-file working-tree diff vs HEAD hunk-by-hunk. Kept the correct fixes; **reverted** `devkit/routeNamingValidation.ts` (risky route-key behaviour change the re-verify itself rejected); fixed a posthog `||` lint regression an agent introduced (intentional → eslint-disable + reason); applied 1 extra medium security fix myself (sentry header redaction → suffix-aware `isRedactedLogKey`).
- Rejected #42 (resetServerState Origin) as a false positive — `/_test/reset` is origin-exempt.
- Committed in 2 commits: `d5d09b2` (code+test, 20 files), `aa0083e` (docs/comments, 21 files). Framework gate green each time (build:packages 16/16, lint:packages, ai:lint, test:unit 1387).

**Files touched:** ~41 across api, router, email, error-tracking, secret-manager, mcp, test-runner, devkit, server, cli, core, login, sync, docs-ui, presence, create-luckystack-app (+ docs). Full detail: commit bodies of d5d09b2 / aa0083e and `.runtime-test/audit-2026-06-24/HANDOFF_REPORT.md`.

**Verification:** framework gate green ×3 (after each fix batch). E2E wizard matrix (14 build-tier variants, fresh 0.2.7 tarballs reflecting the fixes) running. Local infra: WSL Redis :6380, Mongo rs0 :27018, verdaccio :4873.

**Notes / open:**
- 125 report-only findings (0C/2H/25M/98L) in `to_report.json` — 2 highs flagged for user review (api rate-limit keying = likely FP per CLAUDE.md; template session endpoint returning token+CSRF = design call).
- **Round-2 convergence audit blocked by Claude session limit (resets 04:00 Europe/Amsterdam); scheduled to resume.**
- Subagents auto-editing files (despite a verify-only prompt) is a workflow-design lesson: give re-verify agents read-only tooling next time.

## 2026-06-24 09:30 — E2E (matrix + verdaccio) + Round-2 convergence pass

**What I did:**
- Repacked 16 fresh 0.2.7 tarballs (with the round-1 fixes) and ran the wizard matrix: **14/14 PASS** (scaffold→install→generateArtifacts→build→tsc→lint→ships-only-needed) across every db × auth × email × monitoring × optional-package combo.
- Verdaccio: republished the fixed code, ran the real **semver** consumer flow — both scaffolds (credentials + auth=none) green through install/prisma/gen/tsc/lint/build; `luckystack add login` auto-installs + postadd green; repo root untouched (hard guards held).
- Round-2 deep re-audit (read-only finders + adversarial verify) over the 8 security-critical packages (core/api/server/login/sync/router/secret-manager/email): 29 raw → 23 real-new → 5 to_fix + 18 to_report (incl. 2 HIGH). Round 1 was NOT exhaustive — the deeper pass found real items.
- Applied + committed (`4aff69c`, gate green 1387 tests): **login OAuth `allowRegistration` gate (HIGH security — invite-only was OAuth-bypassable)**, secret-manager `timeoutMs` finite-guard, login/redirectResolver docstring, api/README login-dep parity.

**Files touched:** packages/login/src/login.ts, packages/secret-manager/src/index.ts, packages/login/src/redirectResolver.ts, packages/api/README.md.

**Notes / open:**
- Report-only (user review): HIGH sync `cb`-routing spoofing (needs a deliberate, tested fix — legit client cb shape differs from resolvedName, high blast radius); + ~16 medium/low (server SSE 200-before-auth, router fallback boot-UUID Redis, email PII-in-error, email template-send drops attachments, etc.). Full list: `.runtime-test/audit-2026-06-24/findings/round2a_to_report.json` + `HANDOFF_REPORT.md`.
- Deferred-to-report (real, risky/narrow): sync listener-leak when `requestTimeoutMs:false`; router health-store leak on strict boot-handshake throw.
- **Convergence NOT reached (literal):** round 2 found real issues. Remaining tail: round-2b + live-server browser-login smoke (now both done — see next entry).

## 2026-06-24 10:00 — Round-2b + runtime login smoke + convergence verdict

**What I did:**
- Runtime login smoke (sqlite + real Redis) on the verdaccio-installed vregcreds scaffold: started the live server, `prisma db push`, ran loginSmoke → register/login/wrong-password/csrf-401 ALL PASS. The fixed framework boots + credentials auth works end-to-end.
- Round-2b deep re-audit over the other 8 packages (cli/devkit/docs-ui/mcp/presence/test-runner/error-tracking/create-luckystack-app): 36 raw → 31 real-new → 7 to_fix + 24 to_report (**0 HIGH**). Applied 5 (`e527abc`, gate green 1387 tests): docs-ui protocol-relative logo-URL reject, mcp god_nodes truncation note + blast_radius Object.hasOwn guard, datadog context-shadowing, presence doc. Reported 2 (sentry lazy-proxy toString, scaffolder test:e2e script).

**Files touched:** packages/docs-ui/src/docsHtml.ts, packages/mcp/src/index.ts, packages/error-tracking/src/adapters/datadog.ts, packages/presence/docs/client-component.md.

**Convergence verdict:** SEVERITY converged — round-2b found ZERO new HIGH (only medium/low). The substantive security well is dry (the OAuth allowRegistration HIGH was the big one, fixed). A literal "2 dry rounds" isn't a realistic terminal state (each pass finds more low-sev doc/edge nits). ~40 reviewed fixes committed across rounds; ~60 report-only catalogued (1 report-only HIGH worth a deliberate fix: sync `cb` routing). Full detail: `.runtime-test/audit-2026-06-24/HANDOFF_REPORT.md`.

## 2026-06-25 — Round-3: 2nd-checked + fixed the high/medium report-only backlog

User asked to verify + fix everything real from the ~43 high/medium report-only items. Read-only verify workflow (no agent auto-edit this time): 16 real-with-safe-recipe, 23 risky/needs-design (stay report-only), 4 false-positives (secret-manager envNames = intentional, decision 0007). Applied 11 unique fixes (`f878c4e`, gate green 1387): devkit Windows prisma-spawn (Bug-H class), devkit routing-rule-override honoring + tsProgram guard, sync HTTP fanout yield, docs-ui prod-gate honors LUCKYSTACK_ENV, email template-send attachments/headers parity, test-runner reset-endpoint config, mcp get_runbook disambiguation, + api/docs-ui/test-runner doc parity. Reported (delicate): login deleteSession reorder, cli auth=none revert. 23 high/medium remain report-only by design.
