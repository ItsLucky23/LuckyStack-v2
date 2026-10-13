# Skill: audit-invalid-page-locations

Find pages whose placement conflicts with current routing rules. Moving a file can change a public URL, so the intended route needs a decision before repair.

## Procedure

1. Discover all pages in the requested scope and use the installed framework's routing validator/rules, not a mirrored reserved-folder list.
2. Compare expected URL intent with discovered routes, including duplicate/missing routes and production inclusion.
3. Report rejected placements and the authoritative validation result with file pointers. Static presence alone does not prove routability.
4. Offer relocation or renaming based on page purpose; ask which URL is intended when ambiguous. Never delete useful code or move pages silently.
5. Verify the chosen URL and navigation after an approved fix, including guarded access and production discovery where relevant.

Follow `AGENTS.md` and the findings protocol for a requested scan's wrap-up ledger.
