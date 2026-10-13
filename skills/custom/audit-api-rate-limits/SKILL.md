# Skill: audit-api-rate-limits

Review abuse exposure, not arbitrary copied limit thresholds. A declared limit can still be ineffective when its identity/window/storage policy is wrong.

## Procedure

1. Enumerate the requested API surface using current route discovery/indexes; exclude test/private files according to source rules.
2. Inspect route overrides **and effective project defaults**. Identify public writes, credential/reset/billing abuse and the requester identity used for enforcement. Do not assume a missing export means unlimited access.
3. Check shared enforcement when multiple processes serve the same surface. Compare HTTP/socket paths where both are supported.
4. Report evidence-backed risks with source pointers, impact and recommended verification. Choose proposed limits from product/load requirements; do not promote a skill's canned number into security policy.
5. Ask before applying remediation outside an already-approved fix scope. Preserve denial tests and legitimate-use acceptance cases.

Capture a finite findings ledger only for a requested scan, at wrap-up under `AGENTS.md`/the findings protocol. Flag uncertainty separately; route naming is a heuristic, not proof of writes or authorization.
