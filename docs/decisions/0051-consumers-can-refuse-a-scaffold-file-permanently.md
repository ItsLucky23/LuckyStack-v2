---
name: consumers-can-refuse-a-scaffold-file-permanently
title: A project can refuse a scaffold file permanently via `.luckystackignore`
status: accepted
date: 2026-08-19
deciders: [ItsLucky23]
tags: [cli, update, scaffold, consumer]
supersedes: []
relates: [0021, 0025]
---

# 0051 — A project can refuse a scaffold file permanently via `.luckystackignore`

## Context

`luckystack update` classifies every file in the fresh render against the
consumer's copy: missing locally → `add`, hash matches the manifest → `overwrite`,
hash differs → `.new` sidecar. That covers the case where framework and project
disagree about the CONTENT of a file.

It does not cover a project that does not want the file at all. Deleting it is
not an answer, because "missing locally" is precisely the `add` branch: the next
update delivers it again, and the project has to remember to delete it after
every single upgrade or silently regain it.

The gap only becomes dangerous when a project already solves the same job under a
**different name** — because then nothing collides, no sidecar is written, and
the update report shows an ordinary "new framework file delivered". A real
consumer had its own `compose.yml` plus `docker/images/<app>.Dockerfile`, wired
into CI with explicit `-f` flags and governed by four of its own ADRs. Adopting
LuckyStack 0.8.7 delivered the scaffold's `compose.yaml` and `Dockerfile`
alongside them. Docker Compose prefers `compose.yaml` over `compose.yml`, so the
bare `docker compose up` that the project's own runbook prescribes silently
started the framework's stack instead of the project's — and would then have
failed anyway, because the framework compose never sets the process-role variable
the project's `start.sh` requires. Two files nobody asked for, no warning, and a
wrong-but-plausible result.

## Decision

`luckystack update` reads `.luckystackignore` from the project root: a
`.gitignore`-shaped list of scaffold paths this project refuses. One pattern per
line, `#` comments, `*` inside a path segment, `**` across segments, a trailing
`/` for a whole subtree.

A matching path is planned as a new action, `ignored`, which means:

- **nothing is written** — not the file, and not a `.new` sidecar either;
- **it stays out of the scaffold manifest**, so it can never later re-plan as
  `unchanged` or `overwrite`;
- **it gets no `.removed` marker** when the framework eventually stops shipping
  it — the project already said it does not want the framework's opinion here;
- **it is listed in the update report** under "Skipped — this project opted out".

That last point is not decoration. A silent skip is indistinguishable from the
framework having quietly dropped the file, and the whole value of the update
report is that it accounts for every path it considered.

## Rejected alternatives

**A `skip` array inside `.luckystack/scaffold.json`.** The obvious home, since
that file already records the project's scaffold choices. Rejected because
`applyUpdate` rewrites the manifest from the fresh render on every run: anything
hand-added there is destroyed by the first upgrade after it is written. Making
the manifest partly hand-editable and partly generated would also blur what is
attestation (hashes we wrote) and what is configuration.

**Honour `.gitignore`.** Zero new concepts, but wrong meaning: `.gitignore` says
"do not track this", which is true of plenty of files a project genuinely wants
the framework to keep refreshing (`dump/`, generated artifacts). Overloading it
would make one file answer two unrelated questions.

**Sidecar everything instead, including new files.** Delivering `compose.yaml` as
`compose.yaml.new` would have surfaced the collision. Rejected because it inverts
the cost for the common case: every genuinely new framework file would arrive
inert, and every project would have to hand-promote each one. It also would not
have helped here — the reviewer still has to notice that a `.new` for a file they
have never seen is the same job as a file they already have under another name.

**Do nothing and document it.** Considered seriously: the workaround (delete the
files after each upgrade) is one line in a runbook. Rejected because the failure
mode is silent and the recovery is not — nobody notices a regained `compose.yaml`
until a `docker compose up` behaves oddly, and by then it looks like an
infrastructure bug rather than an upgrade artifact.

## Consequences

- Projects get a durable, reviewable, version-controlled way to refuse a scaffold
  file, and the refusal survives every future upgrade.
- The escape hatch is real and therefore abusable: a project that ignores a file
  it actually needs will silently stop receiving fixes for it. The report line is
  the mitigation — every run says what was skipped and why it was skipped.
- `UpdateAction` grew a fifth member; anything switching exhaustively over it
  must handle `ignored`.
- Absence of the file means no patterns, so existing projects are unaffected and
  nothing new is scaffolded by default. An unreadable `.luckystackignore` is
  treated as empty rather than failing the upgrade — a broken optional opt-out
  file must not be able to block a version bump.
