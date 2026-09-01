---
name: an-absent-optional-sync-side-is-not-a-fallback
title: An absent optional sync side is not a type-extraction fallback, and leaves no trace in the diagnostics artifact
status: accepted
date: 2026-09-01
deciders: [mathijs]
tags: [devkit, codegen, diagnostics, sync]
supersedes: []
relates: []
---

## Context

`apiTypeDiagnostics.generated.json` exists so a CI gate can fail on
`fallbackCount` and keep route typing honest (DD-DEVKIT-D3). Its detector matched
on the fallback TEXT alone, and the generator defaults a sync side it cannot find
to the same `{ }` a present-but-shapeless side produces. Every sync route without
the optional `_client` handler therefore counted as degraded extraction.

That is not a cosmetic miscount. `_client` is optional precisely because it runs
once PER RECIPIENT, and `ARCHITECTURE_SYNC.md` tells authors to delete a
pass-through one. So the only way to satisfy the gate was to write the handlers
the architecture forbids — the diagnostic was pushing consumers against the
design it is meant to protect. A real consumer project reported 46 fallbacks of
which 44 were this; this repo, 6 of which 5.

The question was not only whether to stop counting them, but whether the artifact
should still say a side is absent.

## Decision

An absent sync side produces no diagnostics entry at all — not a suppressed one,
not a separate reason. `SyncTypeEntry` carries generator-internal provenance
(which sides were found on disk) and the detector skips only the missing side's
own field. The throw check runs first and unconditionally, so a real extraction
failure is always reported and can never hide behind the exception.

## Rejected alternatives

- **A distinct `intentional-default` reason, present in the file but excluded
  from `fallbackCount`** — rejected. It keeps a fact the artifact does not own:
  which sides exist is already in the emitted sync type map, and the diagnostics
  file is a list of things that went WRONG. Adding a reason that means "nothing
  is wrong" widens a contract every downstream CI script has to learn, to
  restate something derivable elsewhere.
- **Suppress per route instead of per field** — rejected. A server-only route
  still owes a typed `serverOutput`; scoping to the whole route would hide a
  genuine default on the side that does exist.
- **Leave it and let consumers filter the artifact** — rejected. Every consumer
  would reimplement the same filter, and the CI gate's default reading
  (non-zero = broken) would stay wrong for correctly written projects.
- **Match on the file list at detection time instead of threading a flag** —
  rejected. The detector runs on the emitter's entries and has no access to
  discovery; re-walking the tree there would duplicate discovery's rules and
  could drift from them.

## Consequences

`fallbackCount` becomes usable as a strict CI gate: for a correctly typed
project it is now genuinely zero, which is what makes failing on non-zero
reasonable to recommend. The cost is that the artifact no longer distinguishes
"no `_client`" from "no route" — read the sync type map for that.

The exception is deliberately narrow and must stay narrow: one field, one text
shape, after the throw check. Widening it (per route, or to API defaults, or
ahead of the throw check) re-opens the DEVKIT-1 blind spot where a lost shape and
an undeclared shape were indistinguishable. A test pins the ordering.
