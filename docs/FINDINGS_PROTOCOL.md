# Findings Protocol

## Why status must be explicit

A scan claim is not a verified defect, and an old report must not become an unbounded write-only backlog. Status/evidence makes later cleanup safe without silently discarding unresolved work.

## Capture gates

Only a **requested scan/audit** creates a findings set. Exploratory analysis belongs in the conversation. Hold candidates in-session; write the triaged batch once at wrap-up according to `AGENTS.md`, autonomously once the bar is met.

Track only claims worth following. Record deliberate non-action with a reason; do not manufacture an enormous `open` list or mark a real defect resolved merely to avoid tracking it.

## Storage and ledger

Use a new `docs/findings/YYYY-MM-DD-slug/README.md` for each scan, with an absolute scan date, scope, `Last updated: YYYY-MM-DD` and a per-item table:

`# | Finding | Severity | Status | Since | Resolved | Notes / link`

Each claim needs a source/evidence pointer and a clear status. Do not paste implementation code. A re-scan gets a new set and may link an older claim as superseded; never blend unrelated scan histories.

## Status vocabulary

- `open`: not acted on.
- `in-progress`: active work.
- `fixed`: resolved with verification evidence.
- `wontfix`: deliberate non-action, with the reason.
- `superseded`: replaced by a linked newer claim.
- `duplicate`: same as another linked item.
- `false-positive`: verified not to be an issue.

Never trim a set with unresolved items without surfacing them. On a status change, update the row, resolved date and ledger timestamp; maintain the parent `docs/findings/README.md` rollup.

## Consumer boundary

Framework scan history belongs to this repository, not a consumer's issue backlog. Ship conventions, not the framework's dated scans or rollup as if they were that application's findings. Preserve consumer-owned records during updates.
