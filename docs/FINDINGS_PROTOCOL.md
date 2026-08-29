# Findings & Dated-Docs Protocol

> How AI-generated **scans, findings, and analyses** are stored so nothing gets
> lost and cleanup is always safe. Automatic AI behavior — there is no command a
> user runs; the AI follows this whenever it produces findings.

Last updated: 2026-07-14

---

## Rule 0 — a findings-set needs a REQUEST and a wrap-up

Before any of the rules below apply, two gates must pass (**Session Capture Protocol**, `CLAUDE.md`):

- **The user asked for it.** A findings-folder is created for a requested scan, audit, or sweep.
  Analysis the AI performed on its own initiative — to answer a question, weigh options, or spar about
  a design — belongs in the reply, not in a tracked backlog. This is the single biggest source of
  findings-bloat: exploration that quietly turns into permanent open items nobody asked to track.
- **It is written at wrap-up, not mid-scan.** Hold findings in the in-session capture buffer and write
  the folder once at the end — autonomously, no permission prompt. The "was it requested" gate above is
  what keeps findings rare, not an approval step.

**Triage is part of writing it.** The ledger only grows, and the protocol forbids deleting a folder that
still has an `open` item — so an untriaged dump becomes a permanent write-only backlog. When proposing
the folder, cap it at the items actually worth tracking and mark the rest `wontfix` immediately.

---

## The three rules

1. **Every requested scan / findings-set goes under a DATE-LED folder.**
   `docs/findings/<YYYY-MM-DD>-<slug>/` where the date is **today** and `<slug>`
   is a short kebab-case topic (e.g. `security`, `bug-sweep`, `perf`,
   `feature-2fa`). One folder per scan-run — never append findings from a new run
   into an old folder; a re-scan gets a fresh dated folder (and may reference the
   old one as `supersedes`).

2. **Every findings-folder has a `README.md` status ledger.** It is the strict,
   per-item status record: what each finding is, its severity, and its current
   status + date. This is what makes a later "clean up the docs" request safe —
   the ledger says exactly which items were processed (`fixed` / `wontfix` /
   `superseded`) and which are still `open`, so nothing open is ever deleted by
   accident.

3. **Dates everywhere.** Date-led folder name, a `Last updated: YYYY-MM-DD` line
   at the top of every ledger, and a date column per item. Use ISO `YYYY-MM-DD`
   (never relative "today"/"yesterday" in a committed file — resolve it to the
   absolute date). This matches the existing dated conventions: `branch-logs/`
   headings, ADR `date:` front-matter, lesson `date:` front-matter.

4. **Triage while WRITING — a findings folder must be finite.** Rule 2 rightly
   forbids throwing away a folder with open items. It does not license an
   `open` list that only ever grows: a scan that emits 40 findings and triages
   none is a write-only backlog, not a record, and the next scan re-finds the
   same 40. So cap the folder as you create it — decide up front how many items
   this run will actually track — and mark everything below the line `wontfix`
   **in the same pass**, with the one-line reason. An item you are not going to
   act on is a decision, and a decision recorded now costs one line; recorded
   never, it costs every future reader a triage they cannot do. Observed in the
   field: 91 findings folders with 146 `open` rows, scanned faster than anyone
   could ever process.

5. **Point, don't paste.** A finding is a claim plus a `file:line` pointer plus a
   status — not a copy of the code. It gets read weeks later, and by then the
   pasted copy is wrong while the pointer is still right (CLAUDE.md rule 15c).

---

## Status vocabulary (per item)

| Status | Meaning |
| --- | --- |
| `open` | Not yet acted on. |
| `in-progress` | Being worked on now. |
| `fixed` | Resolved in code (link the commit / PR when possible). |
| `wontfix` | Deliberately not fixing (record the reason). |
| `superseded` | Replaced by an item in a newer findings-folder (link it). |
| `duplicate` | Same as another item (link it). |
| `false-positive` | Verified not a real issue. |

Only `open` / `in-progress` items are "live". A cleanup may archive or trim a
folder whose items are ALL terminal (`fixed`/`wontfix`/`superseded`/`duplicate`/
`false-positive`) — but never touch a folder with an `open` item without saying so.

---

## Ledger template (`docs/findings/<YYYY-MM-DD>-<slug>/README.md`)

```markdown
# <Topic> — <YYYY-MM-DD>

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: <what was scanned> · Tool/agents: <how> · Supersedes: <older folder or —>

Last updated: <YYYY-MM-DD>

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| 1 | <one-line> | CRITICAL/HIGH/MED/LOW | open | <date> | — | <file, commit> |
| 2 | <one-line> | MED | fixed | <date> | <date> | <commit hash> |

## Detail
Longer write-ups (one file per finding, or inline). Keep the TABLE above authoritative for status.
```

When you change an item's status, update BOTH its row (Status + Resolved date) and
the ledger's `Last updated` line. Add the folder to the parent index
(`docs/findings/README.md`).

---

## Parent index (`docs/findings/README.md`)

A single table of every findings-folder (date, topic, rollup status, link) so you
can see all scans at a glance and which still have open items. Update it whenever
you create a findings-folder or close out the last open item in one.

## What ships to consumers

This protocol + `docs/findings/README.md` ship in a scaffold (the convention). The
framework's own dated finding-sets do NOT ship (they're excluded from the scaffold
docs copy) — a consumer project keeps its OWN `docs/findings/`.
