# codebase-scan-14-06-FINAL

The **complete, reconciled output** of the two-wave LuckyStack codebase audit. This folder is the single authoritative deliverable; everything else (`codebase-scan-14-06`, `...--2` ... `--6`, `codebase-scan-14-06-MERGED`) is upstream input retained for provenance.

## What this is

Two waves of independent codebase scanning, merged and reconciled against the code **as it stands now**:

- **Wave-1** — 6 independent full-repo scans of commit `302cbf1` (`codebase-scan-14-06` through `--6`), synthesized in `codebase-scan-14-06-MERGED/`.
- **Wave-2** — 3 independent reconciliation re-scans of the **current working tree** (HEAD `302cbf1` + ~248 uncommitted "this-week" fixes, branch `chore/package-split-prep`), captured per-area in `per-area-reconciled/`.

Every finding reported in more than one place — across the 6 wave-1 runs, the 3 wave-2 runs, and across areas — is **deduplicated to one row** and assigned a single verified STATUS and severity. **No wave-2 "fixed/present" claim was trusted on faith:** each kept row was re-confirmed by opening the cited file at its current line in the live tree.

## Bottom line (read SUMMARY.md for the full picture)

This week's remediation pass closed the **entire wave-1 CRITICAL + flagship-HIGH cluster** — including both `packages/router` wsProxy CRITICALs (crash + SSRF) and the `/server.js` source-disclosure, all line-verified FIXED. **No end-user/security CRITICAL remains open.** The only surviving critical is **dev-only** (the docs-ui renderer reads the wrong artifact shape — a 0.2.0 publish-blocker for the docs UI, not a breach). What genuinely blocks v0.2.0 now is a small NEW/OPEN HIGH set: two unauth process-crash DoS paths (`serveFile` percent-decode, `getParams` stream error), the router upstream-leg no-timeout, a credential-leak cluster (raw tokens in rate-limit keys / error-tracker context), the `/_health` plain-hash disclosure, two unwired security-control shadow-APIs (`preEmailSend`, `flushErrorTrackers`), the credentials self-delete + Redis-key consumer twin-drift, and the login-lockout DoS — plus the headline 0.2.0 secure-default flip (sync receiver-auth).

## Start here

1. **`SUMMARY.md`** — the executive picture: counts by status + severity, the ordered still-open/NEW shortlist that blocks v0.2.0, the NEW criticals/highs wave-2 caught (incl. the docs-ui renderer/emitter verdict), and what changed since wave-1. **Read this first.**
2. Then the category report for your lens (below).

## How it is organized

| File | Lens | Contents |
|---|---|---|
| `SUMMARY.md` | Executive | One-page top-of-funnel: status/severity counts, v0.2.0 blocker shortlist, NEW-since-wave-1, what changed. |
| `SECURITY.md` | Security posture | Exploitable vulns + insecure-by-default footguns. Includes a FALSE-POSITIVE / verified-safe section (record so they are not re-flagged). |
| `BUGS.md` | Crash / correctness | Functional defects, crashes, races, fail-open / silent-skip, shadow-API wiring gaps (the plug-icon items), data-loss. |
| `CODE_QUALITY.md` | Maintainability | God-functions, duplication, twin-drift seams, dead/misleading surfaces, type-safety. |
| `FEATURES.md` | Capability gaps | AI-drivability gaps (docs/types/indexes/barrels that mislead an AI author into shipping a no-op/cast/hole) + proposed new framework primitives/packages. |
| `REFACTOR_ROADMAP.md` | Unified roadmap | The merged universe of all distinct findings (the closest thing to a single combined list), ranked, with the decomposition program. |
| `per-area-reconciled/*.md` | Tree-verified evidence | The 18 per-area reconciliations (api, sync, router, server, core, login, email, error-tracking, presence, cli, devkit, mcp, docs-ui, test-runner, scaffolder, secret-manager, root-src, root-server). Every FIXED/NEW/FALSE-POSITIVE verdict in the category reports traces back here. |

## STATUS meanings

Each finding carries exactly one status:

- **FIXED** — verified resolved in the current working tree. Each was re-confirmed by opening the cited file at its current line; **no wave-2 "fixed" claim was trusted on faith**. No action.
- **OPEN** — confirmed present / still real, not yet fixed. Actionable. (Known since wave-1 and re-verified still present in wave-2.)
- **NEW** — surfaced only in wave-2 and verified real against the current tree (the 6 wave-1 runs missed it). Often a regression the in-flight fixes themselves introduced. Actionable, usually high-priority.
- **DEFERRED-DECISION** — real, but a conscious policy/severity/contract/ADR call is needed before acting (e.g. flipping an insecure-but-back-compatible default in a major). Parked for the user, not a clear-cut bug.
- **FALSE-POSITIVE** — re-investigation showed the original claim was wrong, phantom (a hallucinated file/symbol), or by-design. Recorded with a one-line reason so it is not re-raised. No action.

## Corroboration columns

- **Wave-1 (n/6)** — how many of the 6 wave-1 runs raised the finding.
- **Wave-2 (n/3)** — how many of the 3 wave-2 runs corroborated it. (Wave-2 run `--2` was an input digest and was ignored; the live runs are `--1`, `--3`, `--4`.)

Where waves/runs disagreed on severity, the merged author-adjusted severity is taken and both noted inline.

---

*Provenance: wave-1 = `codebase-scan-14-06-MERGED/` (synthesis of the 6 raw run folders `codebase-scan-14-06` ... `--6`). Wave-2 = `per-area-reconciled/` (runs `--1`/`--3`/`--4`). All FIXED/NEW/FALSE-POSITIVE verdicts confirmed by opening cited files at current lines in HEAD `302cbf1` + uncommitted, branch `chore/package-split-prep`, 2026-06-15.*
