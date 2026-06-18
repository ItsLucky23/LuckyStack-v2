# Branch Log Index

> Maintained automatically. Every time a `branch-logs/<branch>.md` is created or appended to, the corresponding row here MUST be added or updated. Last-updated timestamps are the basis for sprint-end audits ("review tickets DEV-120..DEV-140"). See `docs/BRANCH_LOG_PROTOCOL.md` Section 6.5 for the full enforcement rule.

| Branch | Ticket(s) | Last updated | Status | Entries |
|---|---|---|---|---|
| main | (none) | 2026-06-18 | active | 7 |
| chore/package-split-prep | (none) | 2026-06-18 | merged 2026-06-18 → main | 132 |

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
