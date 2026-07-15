# Findings index

> Every AI scan / findings-set / analysis lives in a date-led subfolder here
> (`<YYYY-MM-DD>-<slug>/`), each with its own `README.md` status ledger. See
> `docs/FINDINGS_PROTOCOL.md` for the rules. This index lists them all so open
> items are never lost during a cleanup.

Last updated: 2026-07-15

| Date | Folder | Topic | Items | Rollup status |
| --- | --- | --- | --- | --- |
| 2026-07-15 | [2026-07-15-scaffold-e2e/](./2026-07-15-scaffold-e2e/) | Real-registry scaffold + install e2e (`npm run e2e:verdaccio`) | 1 | **1 open** |
| 2026-07-15 | [2026-07-15-type-generation/](./2026-07-15-type-generation/) | Wire-type lie (`Date`→`string`) + ORM type degradation (**T14: fixing the crash turns the consumer's build RED**) | 14 | **8 open** · 5 fixed · 1 false-positive |
| 2026-07-15 | [2026-07-15-bun-feasibility/](./2026-07-15-bun-feasibility/) | Bun runtime + PM support; env-loading risk (**B11: every optional package silently off under Bun**) | 12 | **4 open** · 7 fixed · 1 wontfix (2 refuted separately) |
| 2026-07-02 | [2026-07-02-security/](./2026-07-02-security/) | Security & correctness scan (10 agents, full codebase) | 12 | 0 open · 9 fixed · 3 wontfix (all terminal) |

<!--
Add a row per findings-folder, e.g.:
| 2026-07-14 | 2026-07-14-security/ | Security scan | 12 | 3 open · 9 fixed |
Rollup status = a quick tally (open / in-progress / terminal) from that folder's ledger.
-->
