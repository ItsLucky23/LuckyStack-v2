---
name: contradictory-scaffold-flags-fail
title: Contradictory scaffold flags fail before anything is written instead of being silently dropped
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [scaffold, cli, dx]
supersedes: []
relates: [0014, 0020, 0021]
---

## Context

The scaffolder's flag documentation said invalid combinations fail before a
partial project is written. In practice choice resolution dropped some passed
flags without a word: `--oauth` without credentials+oauth, `--ai-browser` with
`--no-ai-docs`, and on the interactive path `--auth` with `--orm=none`. Only
two combinations exited with an error. A user who passed
`--oauth=google,github` got a project without auth and exit code 0.

## Decision

A flag the user passed is never dropped silently. The scaffolder lists every
passed flag that the final choices would drop and exits 2 with all of them,
before any file is written. The check runs on the flags alone before the
prompts, and again against defaults and wizard answers afterwards. Values left
to their default are still adjusted quietly. In the same change a monitoring
backend implies the error-tracking layer, which `luckystack manage` already
assumed; ADR 0014 (D3) makes the CLI the reference for such transitions. This
was the owner's choice (option a).

## Rejected alternatives

- **Continue with a printed warning.** A warning is easy to miss in CI, and
  the project still lacks the integration the user asked for.
- **Switch on the missing option automatically** (for example, `--oauth`
  turning on credentials+oauth). It guesses what the user meant and adds a
  whole login surface nobody explicitly asked for.

## Consequences

- Scripts that passed contradictory flags now fail with exit code 2 and a list
  of the conflicts.
- `luckystack update` is unaffected: it replays the recorded choices (ADR
  0021), which were already adjusted before they were saved.
- A recorded monitoring backend without error-tracking, from scaffolds before
  this change, now re-renders with error-tracking.
- ADR 0020 (no ORM forces auth off) still holds; passing both now fails
  instead of dropping the auth flag.
