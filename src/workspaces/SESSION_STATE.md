# Workspaces — session handoff / resume state

> Read this to resume cold. It's a **status + session log + next-steps** doc — the *architecture itself* lives in the canonical docs (see "Read first"), this file does NOT re-spec it. Last updated: 2026-06-04.

---

## TL;DR (current status)

**The entire Workspaces project is now documented in detail. No code has been written. Nothing is committed.**

- This is still the **in-repo UI prototype** at `src/workspaces/` (dummy data, no real backend except the dev terminal). The *real* Workspaces will be a fresh repo that installs the published `@luckystack/*` packages; these docs target that build but every contract mirrors the prototype's `_data/types.ts` 1:1 so migration is mechanical.
- The whole design + every feature is captured in **`src/workspaces/_docs/`**. The next step is **building**, or a final micro-decisions sweep (see "Next steps").

## Read first (canonical, in order)
1. **`src/workspaces/_docs/README.md`** — the cold-start entry: the load-bearing decisions + the 3-role model + the document map.
2. **`_docs/01_ARCHITECTURE.md` … `07_ORCHESTRATOR.md`** — the locked architecture (engine, protocol, automation, data model, build plan, token-opt, orchestrator runtime).
3. **`_docs/features/INDEX.md`** — the spine for the 24 feature docs: nav, the new-fields delta table, the **no-new-verbs** assertion, the dependency graph, and **all resolved decisions D1–D71**.
4. **`_docs/features/01–24`** — one detailed doc per feature.
5. **`_docs/SETUP_AND_PREREQUISITES.md`** — the operator/human to-do checklist (container image, infra, per-CLI-integration credentials, env vars), build-phase-tagged.
6. Repo rules: root **`CLAUDE.md`**. Source specs the docs distill: **`handoff/`** (`IDEE_SPEC`, `DATAMODEL`, `BESLISSINGEN` B-01…B-39+B-O1…O8, `CLAUDE_SETTINGS_MAP`, `FRAMEWORK_GAPS` G1…G29, `DESIGN_BRIEF`, `designs/`). Where docs and specs disagree, the specs win — flag it.
7. Persistent memory: `~/.claude/.../memory/project_workspace_ai_architecture.md` + `project_workspaces_prototype.md`.

## What "Workspaces" is (one paragraph)
A self-hosted, AI-driven dev-orchestration app: you write simple tickets on a scrum board; a configurable **pipeline** of stages (Refine → Plan → Code → Test → Review → …) processes each ticket; the human is a **man-in-the-middle** who only approves and answers questions (ideally from a phone). Everything runs on the user's **Claude Max subscription**.

---

## The locked architecture in 6 lines (full detail in 01–07)
- **Engine = interactive `claude` in a node-pty PTY ONLY**, on the Max subscription. **Never `claude -p` / Agent-SDK** (from 2026-06-15 they bill a separate metered pool, not the subscription). This is THE load-bearing decision.
- **3 roles:** **Assistant** (per-user chat, read/propose, suspended on disconnect) · **Stage-Agent** (worker, one per (ticket,stage), in a container for code roles) · **Conductor** (deterministic Node — ALL coordination + the ONLY writer of board/git/status). No standing "Coordinator"; optional future one-shot reasoner only.
- **B-23 by construction:** AI proposes → user accepts → Conductor executes. No LLM has write verbs.
- **Structured channel = a FROZEN verb set** (worker: `report_status`/`emit_event`/`request_input`/`emit_carryover`/`emit_signal`/`emit_handoff`/`query_context`; assistant: `get_ticket`/`list_tickets`/`read_pipeline`/`propose_suggestion`/`draft_questionset`/`refresh_docs`) + Claude hooks(`type:http`) + `WorkspaceTrigger` (when→then + cron) + a `run-command` allow-list. **No new verbs, ever** — user levers (move/promote/pause/kill/bulk) are control-API requests, not verbs.
- **Integrations = CLI-client-first** (a whitelisted CLI client in the container; MCP only where a CLI can't, e.g. semantic RAG). **Token-optimization = self-handoff** (per-stage + per-AI context budget → editable handoff instruction → `/clear` → reload).
- **Orchestrator = single-instance** (owns containers/worktrees/PTYs, Redis-lease-guarded); the web-app scales horizontally. Cross-platform (Docker on Win/WSL2 + Linux), stack-agnostic (.NET/Go/any). UI = real-time multi-client (subscribe-first → snapshot → merge-on-seq).

## The full doc map
```
src/workspaces/_docs/
  README.md                      ← start here
  01_ARCHITECTURE.md             engine/billing, topology, 3 roles, sessions, multi-client, cross-platform, security
  02_PROTOCOL_AND_FLOW.md        ws-ai:* events, verbs, hooks, ticket state machine, carry-over, QuestionSet, signals, RBAC
  03_AUTOMATION_AND_PLUGINS.md   WorkspaceTrigger + cron, refresh-docs, AgentRole plugin, artifact viewers, integrations, Design walkthrough
  04_DATA_MODEL.md               Prisma ↔ prototype types.ts mapping
  05_BUILD_PLAN.md               parallelism-optimized phased roadmap P0–P5
  06_TOKEN_OPTIMIZATION.md       context budget + self-handoff
  07_ORCHESTRATOR.md             §A launch/teardown · §B Caddy proxy · §C GitLab webhook+sync · §D RAG delta-indexer
  SETUP_AND_PREREQUISITES.md     operator to-do checklist (build-phase-tagged)
  features/
    INDEX.md                     spine: nav + delta table + no-new-verbs + dep graph + decisions D1–D71
    01_WORKSPACE_SETUP · 02_PIPELINE_PRESETS · 03_BUILD_PHASE · 04_INTEGRATION_TOOLS · 05_PER_SESSION_INFO ·
    06_VOICE_INPUT · 07_CODE_CHANGES_REVIEW · 08_CODEBASE_VIEWER · 09_QUESTIONS_IN_TICKETS ·
    10_AUTOMATIONS_SCREEN · 11_WORKSPACE_AI_PANEL · 12_BOARD_AND_KANBAN · 13_BACKLOG_AND_SPRINTS ·
    14_TERMINALS · 15_SOURCES_MANAGEMENT · 16_MEMBERS_AND_RBAC · 17_ACCOUNT_AND_AUTH ·
    18_NOTIFICATIONS · 19_USAGE_AND_BUDGET · 20_ACTIVITY_AND_EVENT_LOG · 21_SEARCH_AND_COMMAND_PALETTE ·
    22_GITLAB_BOARD_SYNC · 23_PREVIEW_DEPLOYMENT · 24_PAUSE_AND_KILL_CONTROLS
```

## Decisions — all resolved (D1–D71, full text in `features/INDEX.md`)
71 decisions are locked. The ones worth remembering up front:
- **Engine = interactive PTY only** (billing). **Containers only for code stages.** **CLI-client-first integrations.**
- **Presets** simple(3)/advanced(5)/professional(7), capability-differentiated; live in `_data/presets.ts`; layered system prompts.
- **UI-Builder** (the VSCode-like code editor, features/08) is the user's **external project, NOT in the repo** — the user adds it as a folder at `src/workspaces/_uibuilder/` when that feature is built; the doc defines the mount/props contract; `FileDiffViewer` is the interim.
- **Voice** documented but **build-deferred**. **Semantic search** documented but build-deferred (v1 = fuzzy). Global search spans tickets AND Sources/docs (the top search bar isn't wired yet).
- **Preview** = on-demand, non-blocking, 30-min TTL reset-on-open, auto-teardown; new `PreviewDeployment` entity.
- **Pause/kill RBAC:** pause/resume = anyone who works the ticket; kill + workspace pause-all = Admin+.
- **New ticket** = lightweight quick-add with an in-UI expand toggle. **Rewind** = event-replay + carry-over commitHash snapshots.

## Hard constraints / gotchas for the next AI
- **NEVER read `.env.local`** (real secrets). `.env` / `.env_template` are fine.
- **No new structured-channel verbs.** If a feature seems to need one, re-express it via existing verbs + a `WorkspaceTrigger` + the `run-command` allow-list. The INDEX has a no-new-verbs assertion.
- **New persistence goes in the `features/INDEX.md` delta table, not into `04_DATA_MODEL.md`.** Feature docs cite up to 01–07 by section, never restate them.
- **Tailwind colors only from `src/index.css` `@theme` tokens**; the `src/workspaces/**` ESLint override disables jsx-no-literals etc. (prototype only). Desktop-first unless mobile stated.
- The dev terminal (`server/hooks/workspacesTerminal.ts` + `_components/XtermTerminal.tsx`) is the one **real** piece — node-pty↔socket, dev-gated (`WORKSPACE_AI_ENABLED=1`), runs `claude` on the host subscription.
- Verification baseline (when code IS written): `npm run lint:client` + `lint:server` (0/0), `tsc --noEmit -p tsconfig.client.json`, `tsc -b tsconfig.server.json`, `vite build`.

## Residuals (documented, non-blocking)
- Each `features/*` doc keeps a short `## Open questions` list of micro-decisions (e.g. terminal split/pop-out, notification-grouping edge cases). They're documented, not lost — an optional final Q&A sweep can clear them.
- `features/19` notes (report-don't-fix) that a stale `Usage.tsx` comment ("No monetary budget") contradicts B-35 — a code cleanup for build time.
- The prototype's top **search bar is not wired** yet (becomes the global search in features/21).

## Next steps (pick up here)
1. **(optional) Final micro-decisions sweep** — resolve the per-doc `## Open questions` so 100% is nailed down before code.
2. **Build, phased** — `05_BUILD_PLAN.md`. P1 = the **thin per-user Assistant PoC**: `server/hooks/workspaceAi.ts`-style module spawning one interactive `claude` PTY per workspace over the existing terminal-bridge pattern (dev-gated), replacing the dummy `sendChat` in `page.tsx`/`_shell/Shell.tsx`, streaming into the chat panel + a Compact button. Chat-only first; no verbs/Conductor yet.
3. Before any real orchestrator build: walk **`SETUP_AND_PREREQUISITES.md`** (container image, Atlas Local, Caddy, GitLab token, per-integration DB creds, etc.).

## Process notes
- Branch: `chore/package-split-prep`. **Nothing committed this session** (the user commits). Branch log: `branch-logs/chore--package-split-prep.md` (this session's entries: 2026-06-03 21:00 → 2026-06-04 10:00 cover the architecture docs → feature batch 1 → resolved decisions → SETUP doc → feature batch 2). A concurrent session has also been doing framework publish-prep on the same branch — its branch-log entries are unrelated to Workspaces.
- The user works in big batches via parallel agents / the ultracode (Workflow) feature, wants AI-handoff-grade docs, prefers minimal-but-correct solutions, and likes questions framed with context + a recommendation. Keep chat replies short.
