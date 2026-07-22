# v0.7.4 release audit — 2026-07-22

> Release-gate dependency audit immediately before the v0.7.4 provenance publication. Supersedes: —

Last updated: 2026-07-22

## Status ledger

| ID | Finding | Severity | Status | Found | Resolved | Evidence / resolution |
|---|---|---:|---|---|---|---|
| RA-01 | A newly published `sharp <0.35.0` advisory made the high-severity provenance audit gate fail after the earlier two-week review had passed. | **HIGH** | **fixed** | 2026-07-22 | 2026-07-22 | Root dogfood and the create-app template now require `sharp ^0.35.3`; the refreshed lock resolves 0.35.3. `npm audit --omit=dev --audit-level=high` is green. |

## Notes

The advisory covers inherited libvips vulnerabilities CVE-2026-33327,
CVE-2026-33328, CVE-2026-35590 and CVE-2026-35591. The only remaining audit
output is the already-documented pair of moderate `@hono/node-server` nodes
behind the stdio-only MCP SDK path.
