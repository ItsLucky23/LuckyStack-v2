# Workspaces — build-handoff package

> **What this folder is.** A **self-contained, drop-in build-handoff package** for **Workspaces** — a self-hosted, AI-driven dev-orchestration app. It contains the whole **portable frontend** (real TSX prototype) plus **all the project context** (architecture, V1 scope, 24 feature specs, container runtime, control-API, and a 2026-06-11 round of new-idea specs) needed to build the product from cold. Drop it into a fresh repo that installs `@luckystack/*`, point an AI at [`src/workspaces/_docs/BUILD_HANDOFF.md`](./src/workspaces/_docs/BUILD_HANDOFF.md), and it has everything it needs.
>
> This package was consolidated on **2026-06-11**. The authoritative spec is the `_docs` set (newest-wins); older `handoff/`/`sparring/` layers from the source repo are intentionally **not** included.

---

## What Workspaces is (one paragraph)

A user writes simple tickets; a configurable **pipeline of stages** (refine → plan → implement → test → review) drives each ticket forward; the human is a **man-in-the-middle who only approves and answers questions** — ideally from a phone. Three roles: the **Assistant** (one interactive `claude` PTY per active user — the chat that proposes/relays), the **Stage-Agent** (one interactive `claude` PTY per *(ticket, stage)*, doing the work in a container), and the **Conductor** (deterministic Node — *the only writer* of board/git/status). **V1 in one line: Claude CLI (interactive PTY) + GitLab only + one self-hosted server.** Full detail in the docs below.

---

## How to use this package

1. **Create a fresh repo and install the framework** — `npm install @luckystack/*` (exact set in [`_docs/SETUP_AND_PREREQUISITES.md`](./src/workspaces/_docs/SETUP_AND_PREREQUISITES.md) / [`_docs/MIGRATION.md`](./src/workspaces/_docs/MIGRATION.md)).
2. **Copy `src/workspaces/` into the new repo's `src/`** — it's self-contained (only `@luckystack` + lib imports). The whole frontend ports plug-and-play.
3. **Copy `server/hooks/workspacesTerminal.ts`** into the new repo's server hooks and add its one registration line to the server entry (the dev terminal bridge — see [`_docs/PORT_MANIFEST.md`](./src/workspaces/_docs/PORT_MANIFEST.md)).
4. **Copy `_docs/REPO_CLAUDE.template.md` to the repo root as `CLAUDE.md`**.
5. **Point a fresh AI at [`src/workspaces/_docs/BUILD_HANDOFF.md`](./src/workspaces/_docs/BUILD_HANDOFF.md)** — the single front door. It routes the AI through the reading order, the 4-lane spin-up, and the standing constraints.

> [`_docs/PORT_MANIFEST.md`](./src/workspaces/_docs/PORT_MANIFEST.md) is the authoritative copy-list (what to bring, where it goes, what NOT to copy because it's the framework).

---

## What's inside

```
workspaces-handoff/
├── README.md                       ← you are here
├── server/
│   ├── README.md                   ← what the hook is + how to port it
│   └── hooks/workspacesTerminal.ts ← the one backend file to port (dev terminal bridge)
├── ui-builder/                     ← Lane-D Monaco editor reference (kept per PORT_MANIFEST; reference, not product code)
└── src/workspaces/                 ← THE PORTABLE FRONTEND (drop into new-repo/src/)
    ├── page.tsx, workspaces.css
    ├── _components/                ← DiffView, FileDiffViewer, SearchPalette, XtermTerminal, primitives…
    ├── _data/                      ← seed.ts + types.ts (the contract mirrored 1:1 by the future Prisma schema)
    ├── _screens/                   ← Board, Pipeline, Backlog, TicketDetail, Terminals, Sources, Usage, Activity, settings…
    ├── _shell/                     ← Shell, MobileChrome, WorkspacesContext
    └── _docs/                      ← ALL PROJECT CONTEXT (the authoritative spec set)
        ├── BUILD_HANDOFF.md        ← THE FRONT DOOR — read first
        ├── V1_SCOPE.md             ← ground truth on WHAT ships
        ├── BUILD_ORDER.md, 00_SPEC_RECONCILIATION.md, REFERENCE_CODES.md
        ├── 01–08 architecture + 02b/04b/07b addenda
        ├── CONTROL_API, GOLDEN_PLAN_STAGE, CODE_EDITOR, P0_CLI_SPIKE, MIGRATION, OBSERVABILITY, DR_RUNBOOK, TESTING_STRATEGY…
        ├── features/01–24          ← per-surface detail
        ├── the all-in-one + decision-log layer (FORGE_ABSTRACTION, BUILTIN_*, GIT_STRATEGY, TRUST_SAFETY_UX, REVIEW_AND_OPEN_QUESTIONS…)
        ├── additions/              ← ★ the 2026-06-11 new-ideas round (read 00_INDEX.md)
        └── design-reference/       ← brand logos + design tokens + screen inventory (salvaged provenance)
```

### The `additions/` set (new — 2026-06-11)

A round of **net-new ideas** generated in an interview-mode sparring session, vetted so none re-litigates a locked decision. Start at **[`_docs/additions/00_INDEX.md`](./src/workspaces/_docs/additions/00_INDEX.md)**:
- **[00_DECISIONS_LEDGER.md](./src/workspaces/_docs/additions/00_DECISIONS_LEDGER.md)** — the full decision trail + the aggregated schema/contract deltas to reconcile.
- **12 V1 additions** (intake co-pilot, collision radar, codebase onboarding, answer-queue, presence/claim, card peek, AI vitals, per-stage commit, edit-as-feedback, quota probe, palette actions, notification prefs) + **4 HORIZON additions** (institutional memory, scheduling/priority, failure forensics, predictive budget).
- **[00_TIER2_HARDENING.md](./src/workspaces/_docs/additions/00_TIER2_HARDENING.md)** — ~17 correctness/robustness fixes mapped to their owning docs.

---

## Reading order for a builder

1. [`_docs/BUILD_HANDOFF.md`](./src/workspaces/_docs/BUILD_HANDOFF.md) — the front door (what/scope/reading-order/lanes/constraints).
2. [`_docs/V1_SCOPE.md`](./src/workspaces/_docs/V1_SCOPE.md) — ground truth on what ships.
3. [`_docs/BUILD_ORDER.md`](./src/workspaces/_docs/BUILD_ORDER.md) — the sequenced build plan.
4. [`_docs/additions/00_INDEX.md`](./src/workspaces/_docs/additions/00_INDEX.md) — the new-ideas round + which lane builds each.
5. Then your lane's docs + the frozen contracts (`CONTROL_API`, `04b`, `02`).

---

## Framework prerequisites

This is a **consumer app** built on the LuckyStack framework — it is **not** a fork of the framework. The build assumes the framework already provides what the docs lean on (file-based `_api`/`_sync` routing, the function-injection system, raw-Node + Socket.io rooms/broadcaster, Prisma + Redis, the strict-typing + i18n + Tailwind-token conventions). **Verify the installed `@luckystack/*` package set covers these at install time** ([`_docs/SETUP_AND_PREREQUISITES.md`](./src/workspaces/_docs/SETUP_AND_PREREQUISITES.md)); the earlier "framework-gap" analyses from the source repo are intentionally omitted because those gaps are considered closed.

---

## Status

**Design + docs + UI-only prototype.** No backend AI is wired yet — the prototype screens run on the dummy `_data/seed.ts`. The first build milestone is the **P0.5 CLI billing spike** ([`_docs/P0_CLI_SPIKE.md`](./src/workspaces/_docs/P0_CLI_SPIKE.md)), which **gates** the container-touching work. Build sequence + the 4 non-overlapping lanes: [`_docs/BUILD_ORDER.md`](./src/workspaces/_docs/BUILD_ORDER.md) + [`_docs/V1_SCOPE.md §6`](./src/workspaces/_docs/V1_SCOPE.md).
