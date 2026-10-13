# Skill: audit-sync-pairing

Find abandoned sync recipients or missing authoritative handlers without creating unnecessary recipient files.

## Procedure

1. Discover sync routes using current source rules and generated maps; exclude test/private files. Consult types rather than copying filename/response rules into this skill.
2. Investigate recipient logic with no authoritative counterpart. Check whether a move, version change or deliberate retirement explains it before proposing repair.
3. A server-only route is valid when no recipient-specific work is needed. Do not infer a missing recipient from a keyword or create a no-op file to satisfy a supposed pair requirement.
4. Review per-recipient filtering/authorization intent and consumer expectations; report source pointers and uncertainty instead of guessed output contracts.
5. Offer an evidence-backed repair and ask before deletion. Verify actual delivery and denial behaviour after an approved change.

See sync architecture rationale and `AGENTS.md` for verification/capture. A green generated type map cannot by itself prove business-level recipient privacy.
