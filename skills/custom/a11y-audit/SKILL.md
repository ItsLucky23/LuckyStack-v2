---
name: a11y-audit
description: Review accessibility with authorized browser tooling and source-backed findings.
category: audit
---

# Accessibility audit

Automated accessibility checks are useful evidence, not a substitute for keyboard/screen-reader review or proof that an auth redirect tested the intended page.

1. Confirm scope, test environment and explicit browser approval under `AGENTS.md`/the browser policy. Ask before installing a missing tool.
2. Query routes; use the actual runtime URL and dedicated test session. Report protected/redirected/skipped pages honestly.
3. Run the installed accessibility tool using its current help, not a copied option template. Check actual rendered theme contrast and relevant keyboard/focus/name behaviour.
4. Give evidence-backed findings with affected pages, source/DOM pointers, applicable accessibility criterion and a proposed fix. Dynamic styles and state need actual inspection, not just class-name grep.
5. Apply only approved repairs, rerun affected assertions and capture a finite requested-scan ledger at wrap-up.

Keep browser state and raw reports outside committed source unless a deliberate artifact is requested. Never print session cookies or credentials.
