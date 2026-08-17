# v0.8.4 release security audit — 2026-08-17

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: root production dependency graph and complete npm audit before the v0.8.4 release · Tools: `npm run audit:production`, `npm audit`, `npm explain`, registry version checks · Supersedes: —

Last updated: 2026-08-17

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---|---|---|---|---|---|
| RELSEC-01 | Locked `fast-uri@3.1.4` was vulnerable to host confusion. | HIGH | fixed | 2026-08-17 | 2026-08-17 | Updated to 3.1.5 and broadened the security override. |
| RELSEC-02 | Locked `ip-address@10.2.0` allowed SSRF/trust-boundary classification bypasses. | HIGH | fixed | 2026-08-17 | 2026-08-17 | Updated to 10.5.0 with an explicit override for affected releases. |
| RELSEC-03 | Locked `nanoid@3.3.16` contained a zero-size custom-generator infinite loop. | HIGH | fixed | 2026-08-17 | 2026-08-17 | Updated to 3.3.18 with an explicit affected-range override. |
| RELSEC-04 | Locked `socket.io-parser@4.2.6` allowed zero-attachment memory exhaustion. | HIGH | fixed | 2026-08-17 | 2026-08-17 | Updated to 4.2.7 with an explicit affected-range override. |
| RELSEC-05 | The MCP dependency graph locked vulnerable `@hono/node-server@1.19.14` and `hono@4.12.31`. | MEDIUM | fixed | 2026-08-17 | 2026-08-17 | Updated to 1.19.17 and 4.13.2; affected ranges remain overridden. |
| RELSEC-06 | Locked `js-yaml@4.3.0` contained a quadratic CPU-consumption advisory. | HIGH | fixed | 2026-08-17 | 2026-08-17 | Updated to 4.3.1 and expanded the affected-range override. |
| RELSEC-07 | Locked React Router 7.18.1 matched the RSC-action CSRF advisory previously accepted as unreachable. | HIGH | fixed | 2026-08-17 | 2026-08-17 | Updated `react-router-dom` and its resolved `react-router` to 7.18.2, removing the advisory rather than relying on the narrow exception. |
| RELSEC-08 | Locked `brace-expansion` releases matched current denial-of-service advisories. | HIGH | fixed | 2026-08-17 | 2026-08-17 | Updated 1.x consumers to 1.1.18 and the current tree to 5.0.9. |

## Verification

- `npm audit` reports 0 vulnerabilities across the complete dependency graph.
- `npm run audit:production` passes with critical=0, high=0, moderate=0.
- Package-lock versions were inspected directly after targeted updates; no advisory allowlist is needed for the current lock.
