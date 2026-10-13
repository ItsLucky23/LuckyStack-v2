# Branch Log Protocol

## 1. Purpose

A branch log preserves intent, rejected paths and unfinished work across sessions. It is not a diary or a second description of the diff.

## 2. Storage

Keep one committed, append-only file per named branch under `branch-logs/`. New entries go at the bottom. Do not rewrite historical sessions while cleaning current documentation.

## 3. When to log

Follow `AGENTS.md` session capture: write once at wrap-up, before a commit, or when the user requests capture. Log real code/architecture work; omit read-only discussion, formatting, translation-only or trivial comment changes. Keep an in-session buffer while working.

## 4. Entry format

Use an `## YYYY-MM-DD HH:MM — <title>` heading (time optional) and these fields:

- **User prompt (summary)**: the goal, not a pasted conversation.
- **What I did**: concrete actions and their reasons.
- **Files touched**: relative pointers/globs so the reader can find the diff.
- **Notes / decisions**: non-obvious trade-offs, dead-ends, validation evidence and remaining work when relevant.

Describe what happened and why, not the current implementation. Amend only factual errors or same-session revert notes; do not erase history.

## 5. Filename convention

Trim the branch name, replace `/` with `--`, replace illegal Windows filename characters (`: * ? " < > |`) with `_`, truncate the name to 100 characters and append `.md`. Resolve a real collision explicitly rather than silently sharing a log. Detached HEAD has no branch-keyed log.

## 6. Command integration

Use the repository's log/review commands or corresponding skills when explicitly invoked. Routine capture is autonomous once its bar is met; a missing log does not justify inventing past work.

## 6.5. INDEX maintenance

Every append must update `branch-logs/INDEX.md`: the matching branch's entry count, last-updated timestamp and status. Add a missing row in branch-name order; extract tickets from the branch name or use `(none)`. Set merged/abandoned status only with Git evidence. Count actual entry headings rather than guessing.

## 7. Review

Compare the log with Git evidence. The log explains intent but cannot prove completion, test success or a clean diff. Mark previous-branch context as unverified before relying on it.

## 8. Failure modes

Avoid per-prompt noise, duplicated work summaries, missing validation failures and implementation walkthroughs. A significant reusable choice belongs in a decision; a costly repeatable pitfall belongs in a lesson. The branch log links them rather than retelling them.
