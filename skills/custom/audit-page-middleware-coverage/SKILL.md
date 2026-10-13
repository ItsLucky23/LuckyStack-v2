# Skill: audit-page-middleware-coverage

Review navigation protection against the application's intended access policy. A matching token in a file does not prove authorization works, and page protection does not secure server operations.

## Procedure

1. Obtain the intended protected areas/roles from product rules or the user. Optional project-specific audit rules belong in `.agents/audits/page-middleware-rules.json`; migrate a known legacy rule file deliberately, not by discarding it.
2. Discover pages using current routing rules. Inspect actual guard code and imported guard implementations; avoid substring-presence verdicts.
3. Check allow, redirect and denial behaviour against current types/source. Independently inspect server authorization for sensitive operations.
4. Report missing/ineffective guards with evidence, impact and an acceptance test. Do not assume folder names define a universal security policy.
5. Ask before applying repairs unless that scope is already authorized; verify logged-out and wrong-role cases as well as allowed access.

Capture requested findings once at wrap-up. A static review limitation must remain visible, not become a green security claim.
