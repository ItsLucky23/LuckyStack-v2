# Branch Log Index

> Maintained automatically. Every time a `branch-logs/<branch>.md` is created or appended to, the corresponding row here MUST be added or updated. Last-updated timestamps are the basis for sprint-end audits ("review tickets DEV-120..DEV-140"). See `docs/BRANCH_LOG_PROTOCOL.md` Section 6.5 for the full enforcement rule.

| Branch | Ticket(s) | Last updated | Status | Entries |
|---|---|---|---|---|
| main | (none) | 2026-06-19 19:20 | active | 18 |
| chore/package-split-prep | (none) | 2026-06-23 | active (wizard+manage verified incl. verdaccio; 5 release-blockers fixed incl. Windows install) | 137 |
| chore/overnight-audit-2026-06-24 | (none) | 2026-06-26 | active (rounds 1-4: ~51 reviewed fixes + round-4 verify-and-fix of the 16 to_fix items → 8 new fixes [api#1/#6/#27, sync#1/#2, presence#3/#4, error-tracking#7, router#8, server#5], 11 already-fixed in tree, 1 flagged-fork [devkit routeNamingValidation]; + ADR 0016 single-source ports + opt-in router topology) | 6 |

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
