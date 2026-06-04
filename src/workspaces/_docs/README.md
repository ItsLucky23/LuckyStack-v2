# Workspace-AI — architecture docs (AI handoff)

> **Purpose.** These docs let any AI (or a parallel agent team / ultracode workflow) pick up the **Workspace-AI** build cold. They turn the settled design into an actionable spec. Read this README first, then the numbered docs. Last updated: 2026-06-04.

---

## The one decision everything hangs on (read this first)

**As of 2026-06-15, headless `claude -p` and the Agent SDK draw from a *separate metered credit pool* — NOT the interactive Max subscription.** Only **interactive PTY** `claude` sessions stay on the subscription. The user's hard requirement is *everything runs on the Max subscription*. Therefore:

- **Every Claude session is an interactive `claude` in a node-pty PTY.** Never `claude -p`, never the Agent SDK.
- **Structured output is NOT scraped from the TUI.** It comes from (a) **Claude hooks** (`type:http`) for lifecycle events, and (b) an **agent-initiated structured channel** (a whitelisted CLI/HTTP helper the agent runs via the native Bash tool, or — optionally — an MCP server). Both work *inside* an interactive subscription session.

If you change nothing else from these docs, keep that. Everything downstream depends on it.

---

## What we are building

**Workspaces** is a self-hosted, AI-driven dev-orchestration app: the user writes simple tickets; a configurable **pipeline** of stages refines → plans → implements → tests → reviews them; the human is a **man-in-the-middle** who only approves and answers questions (ideally from a phone). The **Workspace-AI** is the brain that ties it together.

> **Repo context.** Right now this lives as a **UI-only prototype** in `src/workspaces/` (dummy data) inside the LuckyStack monorepo, because LuckyStack is about to publish to npm. The *real* Workspaces will be a fresh repo that installs `@luckystack/*`. These docs target that real build, but every contract is mirrored 1:1 by the prototype's `_data/types.ts` so migration is mechanical. The one already-real piece is the terminal (`server/hooks/workspacesTerminal.ts` + `_components/XtermTerminal.tsx`) — the proven node-pty↔socket pattern the engine extends.

---

## The model in one screen

**Three roles** — only one of which is an LLM-free, always-on process:

| Role | What it is | Count | Bills to | Writes board/git state? |
|---|---|---|---|---|
| **Assistant** | interactive `claude` PTY — the chat *one user* talks to (refine, answer, relay approvals) | **1 per active user, per workspace** (suspended when they disconnect) | subscription | **no** — read/propose only |
| **Stage-Agent** | interactive `claude` PTY doing the actual work for one ticket-stage | one per *(ticket, stage)*, in a container for code stages | subscription | only inside its own container (files, MRs) |
| **Conductor** | deterministic Node code in the orchestrator (no LLM) — **all coordination + the only writer** | 1, always-on | free | **yes — the only writer** |

> **No standing "Coordinator" / extra per-workspace CLI.** Coordination between agents is **deterministic** (agents emit JSON to the Conductor; see below) — it never needed an LLM. The *only* residual reason for a non-Assistant LLM is **proactive reasoning while no user is connected** (e.g. a scheduled "board-health briefing", or generating suggestions while you're away). That is a **future, optional, ephemeral one-shot reasoner** the Conductor spawns *only* for a cron/triggered task and then discards — not a persistent instance, and not needed for v1.

The **Conductor** owns all scrum/git/status mutations + coordination; the LLMs only **propose**; **Stage-Agents** do the work. This enforces the spec's autonomy rule **B-23** ("Workspace-AI proposes, the user accepts") *by construction*, and keeps the LLMs on the subscription. The **per-user Assistant** model removes chat contention between users and keeps each session's context lean. Tickets still progress while you're away: the **Stage-Agents** are the workers, the **Conductor** is the always-on plumbing.

```
              browser / phone (real-time, many clients per workspace)
                         │  ws-ai:* socket events (per-user chat)
        ┌────────────────▼─────────────────────────────────────┐
        │  Orchestrator (single-instance Node service)          │
        │   • Conductor  (deterministic: state, coordination,   │
        │                 the signal log, the only writer)      │
        │   • SessionManager (owns every PTY, watchdog, queue)  │
        │   • structured-channel endpoint + hook ingress        │
        │   • scheduler (leased tick) + trigger engine          │
        └─┬──────────────────────────────┬─────────────────────┘
          │ node-pty (per-user)           │ node-pty (in containers)
   ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────────┐ ┌────────────────┐
   │ Assistant   │ │ Assistant   │ │ Stage-Agent     │ │ Stage-Agent    │
   │ user A @ ws │ │ user B @ ws │ │ DEV-1240@impl   │ │ DEV-1249@plan  │
   └─────────────┘ └─────────────┘ └─────────────────┘ └────────────────┘
          ▲ read/propose                  ▲ emit verbs + hooks (JSON → Conductor)
          └───────────────────────────────┘
              structured channel (CLI/HTTP helper, or MCP)
   (optional, future: the Conductor may spawn a one-shot ephemeral reasoner
    for scheduled/proactive LLM tasks when no user is connected — not standing)
```

Ticket-agents **report via structured JSON into an append-only signal log** (not direct AI↔AI chat); the deterministic **Conductor** consumes it. Reasoning-heavy judgement (e.g. "should these be an epic?") is done by a **connected user's Assistant**, or deferred. See [02 §6](./02_PROTOCOL_AND_FLOW.md) and [01 §3](./01_ARCHITECTURE.md).

---

## Document map

| Doc | Covers | Read when… |
|---|---|---|
| **[01_ARCHITECTURE.md](./01_ARCHITECTURE.md)** | engine + billing, two-system topology, the 3 roles, session lifecycle, real-time multi-client + contention, cross-platform & stack-agnostic containers, security | you need the *why* and the runtime shape |
| **[02_PROTOCOL_AND_FLOW.md](./02_PROTOCOL_AND_FLOW.md)** | `ws-ai:*` socket events, the structured-channel verbs, hooks, the ticket state machine, carry-over, QuestionSet, signals/suggestions/notifications, RBAC | you're wiring sessions ↔ orchestrator ↔ UI |
| **[03_AUTOMATION_AND_PLUGINS.md](./03_AUTOMATION_AND_PLUGINS.md)** | triggers + cron, refresh-docs, the AgentRole plugin model, artifact viewers, integrations, the "add a Design stage" walkthrough | you're adding automation or a new stage-type |
| **[04_DATA_MODEL.md](./04_DATA_MODEL.md)** | Prisma models (real repo) ↔ prototype `types.ts` mapping, exact new entity fields | you're touching persistence |
| **[05_BUILD_PLAN.md](./05_BUILD_PLAN.md)** | the parallelism-optimized phased roadmap + per-phase fan-out + verification | you're about to build |
| **[06_TOKEN_OPTIMIZATION.md](./06_TOKEN_OPTIMIZATION.md)** | the context-budget + self-handoff cycle that keeps long-lived sessions lean | you're worried about long sessions filling context |
| **[07_ORCHESTRATOR.md](./07_ORCHESTRATOR.md)** | the single-instance **orchestrator runtime mechanics** the Conductor drives — §A ticket launch/teardown, §B Caddy subdomain proxy, §C GitLab-webhook ingest + board sync, §D RAG delta-indexer + vector store. Architecture-layer companion to 01 (not a feature doc); feature docs cite it as `[07 §A]`…`[07 §D]` | you need the deterministic runtime sequence behind a feature (containers, Caddy routes, webhooks, RAG) |
| **[features/INDEX.md](./features/INDEX.md)** | the **detailed per-feature layer** — now **24 docs** (setup, presets, build phase, integrations, per-session info, voice, code review, codebase editor, questions, automations, AI panel, board, backlog/sprints, terminals, sources, members/RBAC, account/auth, notifications, usage/budget, activity, search, GitLab sync, preview, pause/kill) — extends 01–07, never contradicts | you're designing or building a specific feature |
| **[SETUP_AND_PREREQUISITES.md](./SETUP_AND_PREREQUISITES.md)** | the **operator/human to-do list** — accounts, infra, container image, per-CLI-integration credentials, env vars (each tagged with the build phase it's needed for) | you're about to actually run it |

---

## Glossary

- **Assistant** — the per-user, per-workspace chat session (reasoning/proposing only).
- **Stage-Agent** — the worker Claude session for one ticket at one stage.
- **Conductor** — deterministic orchestrator code; **all coordination** + the sole writer of state; executes what the user approves.
- **(optional, future) background reasoner** — an *ephemeral* one-shot session the Conductor spawns only for proactive/scheduled LLM tasks with no user online (briefings, suggestion synthesis). Not a standing role.
- **Structured channel** — the typed agent→orchestrator path (verbs like `emit_carryover`, `request_input`, `emit_signal`, `emit_handoff`); transport is a whitelisted CLI/HTTP helper or MCP.
- **Carry-over** — the `{summary, changedFiles, openQuestions, commitHash}` envelope a stage emits and the next stage receives (spec **B-O2**).
- **Self-handoff / token-optimization** — when a long session hits its context budget, it writes a detailed handoff, then `/clear`s and reloads it (see [06](./06_TOKEN_OPTIMIZATION.md)).
- **Role (`AgentRole`)** — pluggable stage behavior (`code`, `design`, …): system prompt + default skills/commands/model + output schema + viewer + `needsWorkspace`.
- **Trigger** — a `when (event) → then (action)` automation rule (stage-lifecycle or cron).
- **Signal / Suggestion / Note** — append-only agent observations → proposals → free-form notes (spec **§7 / B-O6 / B-23**).

---

## Source specs these docs distill (authoritative, in `handoff/`)

`DATAMODEL.md` (§7 Workspace-AI, B-23, B-O6) · `CLAUDE_SETTINGS_MAP.md` (B-38 — stage-config → real `.claude` config) · `BESLISSINGEN.md` (B-01…B-O8 decisions) · `IDEE_SPEC.md` (two-system topology, §8 Workspace-AI) · `designs/CLAUDE_DESIGN_FEATURE_COMPLETION.md` (the future Design feature). Where these docs and the specs disagree, the specs win — flag it. (A cold AI should also read the repo's root `CLAUDE.md` for working rules.)

## Status & scope

Design + docs only. **No backend AI is wired yet**; the chat panel is still the dummy `sendChat`/`parseMove`. The first build milestone is the **thin Brain PoC** — one per-user **Assistant** chat (chat-only). Build order and parallel fan-out: **[05_BUILD_PLAN.md](./05_BUILD_PLAN.md)**.
