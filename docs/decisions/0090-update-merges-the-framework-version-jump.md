---
name: update-merges-the-framework-version-jump
title: luckystack update merges only the framework's own change between two versions into edited files
status: accepted
date: 2026-11-23
deciders: [user, implementation-agent]
tags: [cli, update, scaffold, consumer]
supersedes: []
relates: [0021, 0025, 0051]
---

## Context

ADR 0021 let `luckystack update` write a `<file>.new` copy of the whole new framework file next to every file the project had edited. The edit was detected against the hash recorded when the project last took the file over unedited, and that hash never moved for an edited file. A consumer with about 100 deliberately edited framework files therefore got about 100 `.new` copies on every run. Nearly all of them held changes it had merged months before, and some differed from the local file only in the project's own edit. The noise hid the one real change and made the runbook step look broken.

## Decision

`update` compares the framework with itself. It renders the version recorded by the last update (the base) and the new version, both with the recorded choices. For a file the project edited:

- base equal to new: the framework did not change the file in this version jump, and nothing is written;
- otherwise, a three-way merge with `git merge-file` (local, base, new). A clean merge is written into the file, for review with `git diff`. A conflict writes nothing to the file; only the framework's own change goes into one patch file under `dump/`.

The next update starts from the new version, so a handled change is never offered again. When no base render exists (version not on npm, choices rejected, no git), the 0021 behaviour stays: a full `.new` copy.

## Rejected alternatives

- Keep the `.new` copies, and only skip them when the new render equals the recorded hash: on the measured consumer that removed 30 of 100 copies, because the recorded hash of an edited file was months old.
- Move the recorded hash to the new render whenever a `.new` is written, or once the `.new` is gone: either option stops the repetition, but each `.new` still holds the whole file. The reviewer then has to find the framework's change by comparing against their own edits.
- Report-only, with nothing applied: a clean merge is the work a developer does by hand anyway, and git shows every change.
- A JavaScript merge library: it adds a dependency. `git merge-file` merges the same way the developer's own git does, and every project that reviews updates with `git diff` already has git.

## Consequences

`update` modifies files the project edited when the merge is clean. Local edits stay, but a clean text merge can still break code, so typecheck after `update` stays necessary. Each run renders a second scaffold, unless the recorded version equals the target. A conflict the developer ignores is not offered again by later updates; the patch file in `dump/` keeps it, as long as nobody deletes it. Projects without git, or with an old version that can no longer be rendered, keep the full `.new` copies.
