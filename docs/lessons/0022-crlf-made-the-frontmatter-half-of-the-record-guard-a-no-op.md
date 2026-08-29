---
name: crlf-made-the-frontmatter-half-of-the-record-guard-a-no-op
title: A trailing \r made every frontmatter field read as absent, disabling half the record guard on Windows
severity: high
area: scripts/ (checkRecordIds.mjs, and any line-wise parser)
date: 2026-08-29
tags: [tooling, crlf, windows, regex, silent-failure, ci]
---

# 0022 — A trailing \r made every frontmatter field read as absent, disabling half the record guard on Windows

## What happened

`npm run ai:check-ids` reported `ok — 79 record(s)` on the developer's machine and failed on the CI
runner, on the identical commit. The two findings CI produced were real and had been true for as long as
the check existed.

The check is the repo's one **blocking** guard: duplicate/dangling ADR and lesson numbers. Half of it —
every rule that reads frontmatter (`name` vs filename slug, `id` vs filename number, dangling
`relates:` / `supersedes:`) — had never once run on the machine where commits are actually made.

## Root cause

The frontmatter parser split the block on `"\n"` and matched each line with:

```js
line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
```

On a CRLF checkout each line keeps a trailing `\r`. `.` does not match `\r`, and a non-multiline `$` is
end-of-input, not end-of-line — so the pattern cannot match, **every** field is silently missing, and the
parser returns `{}`. A record with no frontmatter and a record whose frontmatter could not be parsed are
indistinguishable to the caller, and the second one reads as "nothing to check here".

The direction of the split is what makes this expensive: the platform where the guard was dead is the one
that runs it on every commit (the pre-commit hook), and the platform where it worked only sees the code
after it is already pushed.

## How to avoid

- **Split on `/\r?\n/`, never on `"\n"`.** Or normalise CRLF once at read time. `generateAiIndex.mjs` in
  this repo already had a `splitLines` helper that does exactly that — the knowledge existed, it just
  wasn't reused.
- **`$` is not "end of line" unless the regex has the `m` flag**, and even then `.` still stops at `\r`.
  A per-line regex written against LF input is a platform assumption, not a parser.
- **A parser that returns an empty object on failure has erased the failure.** Same shape as lesson 0019:
  "did not parse" must not produce the same value as "parsed, found nothing". Prefer returning `null` for
  an unparseable block so the caller has to decide.
- **When a check disagrees between your machine and CI on the SAME commit, the check is wrong, not the
  commit.** The finding is a symptom; the divergence is the bug.
- **Sanity-check a parser against a fact you already know**: print the `name` it extracts from a real
  record. That one line would have exposed this on the day it was written.

Related: `docs/lessons/0019-a-skipped-check-reports-the-same-value-as-a-clean-one.md` and
`docs/lessons/0021-a-windows-only-entrypoint-check-made-the-cli-a-silent-no-op.md` — three instances of
the same family in one week, two of them platform-split.
