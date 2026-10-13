---
name: security-audit
description: Review dependencies, secret exposure and application trust boundaries with verified findings.
category: audit
---

# Security audit

A heuristic match is not a vulnerability verdict. Review real trust boundaries and reachability rather than assigning severity from folder names or absent text snippets.

1. Agree on scope and allowed environment. Read `AGENTS.md` and local rules; do not inspect secret files or perform writes against shared data without permission.
2. Run appropriate dependency checks and distinguish production, development and actually reachable code. Never automatically install an advisory's proposed fix.
3. Scan allowed source/history with a secret-aware tool; redact evidence and reports. Never print credentials or include raw sensitive matches in a committed ledger.
4. Inspect server-side auth/ownership, CSRF/origin policy, forwarded-header trust, reset controls and HTTP/socket equivalence. Page guards and security headers may also depend on deployment configuration; verify that boundary instead of guessing.
5. Independently verify high-risk claims and reproduce safely where authorized. Separate confirmed defects, hypotheses and untested assumptions.
6. Report a finite prioritized list with source pointers, impact, verification and proposed remediation. Apply only approved scope; capture the requested-scan ledger once at wrap-up.

Do not claim a static scan or dependency report is a penetration test, nor treat missing evidence as a pass.
