---
name: cli-removals-delete-only-unedited-framework-files
title: CLI removals delete only files proven to be the framework's unedited copy
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [cli, scaffold, updates, dx, safety]
supersedes: []
relates: [0014, 0043]
---

## Context

`luckystack manage` → Auth: none (ADR 0014, D2) recursively deleted whole
folders such as `src/settings`, and `remove router` (ADR 0043, §3) deleted the
topology files that the add message tells users to edit. The CLI defines a
"safe" removal as one that touches no user-owned files, and ADR 0014 requires
the preview to list exactly what will be removed. Both commands could silently
delete user work (sweep findings 018 and 068).

## Decision

A removal deletes a file only when its content matches the CLI's own copy of
that file, or the hash recorded for that path in the scaffold manifest; text
files are compared with line endings normalised, as the manifest does. Every
other file in the removed area is kept and listed, in the preview and in the
command output. A folder is removed only when it ends up empty, and a kept
file that will break the build is marked. The owner chose this option for
018 (a) and "fix the gap" for 068.

## Rejected alternatives

- **Delete everything, but name every file in the preview.** A confirm without
  reading still loses work, and `remove router` has no preview.
- **Keep the wholesale delete.** It breaks the ADR 0014 preview rule and the
  meaning of a "safe" removal.
- **Rename edited files to `.bak`.** It leaves extra files nobody asked for;
  keeping the file and listing it is simpler.
- **Classify the router as a guarded removal.** Unedited copies would then
  never be removed, so a clean removal would no longer be possible.

## Consequences

- A file copied by an older CLI, with no manifest entry and content that
  differs from today's copy, counts as the user's file and is kept. This is the
  safe direction.
- After Auth: none the project can stay unbuildable when a kept file still
  uses login; the output names those files.
- This narrows how ADR 0014 D2 and ADR 0043 §3 delete files; it supersedes
  neither.
