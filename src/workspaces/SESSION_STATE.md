# Workspaces — session handoff / resume state

> Read this to resume cold. **Status + resume anchor** — the design itself lives in the canonical docs (see "Read first"); this file does not re-spec it. Last updated: 2026-06-04 (end of the documentation phase).

---

## TL;DR (current status)

**Documentation phase is DONE. V1 scope is LOCKED. The `src/workspaces/` folder is a drag-and-drop build package. No app code written yet; nothing committed.**

- Everything discussed is documented in `src/workspaces/_docs/` (~60 docs). The next thing to do is **build in a fresh repo**, not more docs.
- **V1 = Claude CLI (interactive PTY) + GitLab only + one self-hosted server.** Everything multi-* (multi-provider AI, GitHub, built-in git-server, built-in MR/merge/auto-merge, built-in CI, preview-deploy, analytics, voice, semantic-search) is **designed-but-deferred**. `V1_SCOPE.md` is the authority on what ships; the broader docs are the design horizon.
- The prototype UI (`_screens`/`_shell`/`_components`/`_data`/`page.tsx`) already exists (dummy data). The one real backend piece is the dev terminal bridge (`server/hooks/workspacesTerminal.ts` + `_components/XtermTerminal.tsx`).

## Read first (the NEW front-door order)

1. **`_docs/BUILD_HANDOFF.md`** — the master entry-point. Point a fresh AI here ("read this"); it routes everything. Starts with **§1b Step 0** (fresh repo + `npm install @luckystack/*` + copy files per PORT_MANIFEST).
2. **`_docs/V1_SCOPE.md`** — ground truth on *what ships* (IN/OUT, the 7 V1 flows, deferred list, the precedence rule "V1_SCOPE wins on conflict").
3. **`_docs/BUILD_ORDER.md`** — the build sequence: Phase 0 (the gating P0 CLI spike + shared contracts) + the **4 non-overlapping lanes** (A engine/orchestrator · B data/tenancy/sync · C frontend/realtime · D editor/changes/config) + checkpoints CP0–CP5.
4. **`_docs/PORT_MANIFEST.md`** — exactly which non-framework files to copy into the fresh repo (the folder + `server/hooks/workspacesTerminal.ts` + the one wiring line + `ui-builder/` as reference + deps; and what NOT to copy because it's the framework).
5. **`_docs/CODE_EDITOR.md`** — Lane D: the real 1:1 VS Code (openvscode-server in the ticket container).
6. **`_docs/README.md`** — the full document map (architecture / build-grade / all-in-one / feature / decision-log layers).
7. Decision history (why things are the way they are): **`_docs/REVIEW_AND_OPEN_QUESTIONS.md`** (68 Q's) + **`_docs/REVIEW_AND_OPEN_QUESTIONS_2_ALLINONE.md`** (50 Q's). Codes resolve via **`_docs/REFERENCE_CODES.md`**; spec-vs-docs precedence via **`_docs/00_SPEC_RECONCILIATION.md`**.
8. Repo rules: root **`CLAUDE.md`** (framework). NEVER read `.env.local`. Persistent memory: `project_workspace_v1_scope`, `project_workspace_allinone_forge`, `project_workspace_multi_provider_ai`.

## What "Workspaces" is (one paragraph)
A self-hosted, AI-driven dev-orchestration app: you write simple tickets; a configurable **pipeline** of stages (Refine → Plan → Code → Test → Review) processes each; the human is a **man-in-the-middle** who only approves and answers questions (ideally from a phone). Everything runs on the user's **Claude Max subscription** (interactive PTY only — the load-bearing billing decision).

---

## The locked architecture in 6 lines (full detail in 01–08 + addenda)
- **Engine = interactive `claude` in a node-pty PTY ONLY**, on the Max subscription. **Never `claude -p` / Agent-SDK** (from 2026-06-15 they bill a separate metered pool). THE load-bearing decision → the **P0 CLI billing-spike** verifies it and **gates the build**.
- **3 roles:** **Assistant** (per-user chat, read/propose) · **Stage-Agent** (worker per (ticket,stage), in a container) · **Conductor** (deterministic Node — ALL coordination + the ONLY writer).
- **B-23 by construction:** AI proposes → user accepts → Conductor executes. No LLM has a write verb.
- **Frozen 7+6 verb surface** + Claude `type:http` hooks + `WorkspaceTrigger` + a `run-command` allow-list. **No new verbs ever** — every user/Workspace-AI write is a **`[control-API]`** request → `preApiExecute` → enqueue → Conductor.
- **Single-instance orchestrator** (owns containers/worktrees/PTYs, Redis-lease-guarded); web-app scales horizontally; real-time multi-client (subscribe → snapshot → merge-on-seq); `runInTenant` multi-tenancy on every path.
- **V1 code editor = openvscode-server inside the ticket container** (1:1 VS Code, account-extensions, multi-language LSP, native git-diff) over a Caddy subdomain (`CODE_EDITOR.md`). The old `ui-builder/` Monaco is a reference + light fallback, NOT the target.

## Decisions — all resolved
- **Feature docs:** D1–D87 locked (`features/INDEX.md`). **Review #1:** 68 questions resolved. **Review #2 (all-in-one):** 50 questions resolved (logs: the two `REVIEW_AND_OPEN_QUESTIONS*.md`, all `→ Keuze` filled).
- **V1 scope OVERRIDES some of those for the v1 build** (they remain as design-horizon): no auto-merge / no built-in MR entity / GitLab-only / Claude-only / no built-in CI. The deferred all-in-one models live in `04b §18` tagged DEFERRED (Lane B does not build them in v1).
- The MR flow in v1: changes page + real editor + changed-files highlighted → user edits locally (not synced) → on "complete" at the last stage, **git push happens then** (incl. user edits) → GitLab returns the create-MR URL → merge on GitLab.

## Hard constraints / gotchas for the next AI
- **NEVER read `.env.local`**. **No new structured-channel verbs** (re-express via existing verbs + WorkspaceTrigger + run-command + control-API).
- **V1_SCOPE wins** where any doc over-describes beyond v1 (banners are on FORGE/BUILTIN_MR/BUILTIN_CI/MULTI_PROVIDER/TRUST).
- The dev terminal (`server/hooks/workspacesTerminal.ts` + `_components/XtermTerminal.tsx`) is the one real piece — node-pty↔Socket.IO, **dev-gated by `WORKSPACES_TERMINAL_ENABLED=1`** (else dev-only); a host-shell bridge that Lane A replaces with the per-container pty-agent (`07b`).
- `src/workspaces/` is **self-contained** (only `@luckystack` + lib imports) — the only loose non-framework file outside it is `server/hooks/workspacesTerminal.ts` (see `PORT_MANIFEST.md`).

## Next steps (pick up here)
1. **Bootstrap the fresh repo (Phase 0.B):** new repo → `npm install @luckystack/*` (per `SETUP_AND_PREREQUISITES.md`/`MIGRATION.md`) → copy files per **`PORT_MANIFEST.md`** → copy `_docs/REPO_CLAUDE.template.md` to the repo root as `CLAUDE.md`.
2. **Phase 0.A — the P0 CLI billing-spike (`P0_CLI_SPIKE.md`) — THE gate.** Verify interactive PTY bills the Max subscription (+ hooks fire, /clear vs /compact, per-turn usage, --resume). Build nothing else until green; if it fails, escalate (do not route to headless).
3. **Then the 4 lanes** (`BUILD_ORDER.md`): B publishes the Prisma schema + A the control-API contracts first, then A/C/D run in parallel in their own dirs. **Advice:** do Phase 0 + one thin vertical slice solo first (e.g. the Assistant chat over the existing terminal bridge, or the board reading real data), THEN spin up the 4 AI sessions so they have contracts to build against.

## Process notes
- Branch: `chore/package-split-prep`. **Nothing committed** (the user commits). Branch log: `branch-logs/chore--package-split-prep.md` (Workspaces entries 2026-06-03 21:00 → 2026-06-04 14:45: architecture docs → feature docs → D72–D87 sweep → review #1 + 14 build docs → all-in-one review #2 + 9 docs → V1-scope lock + 5 setup docs + folds → PORT_MANIFEST). A **concurrent session** does framework publish-prep on the same branch — its entries are unrelated to Workspaces.
- Framework is **published** (npm org live, 14 packages). `handoff/designs` is no longer needed (UI exists) but is **kept** (never delete handoff/).
- The user works in big batches via parallel agents / ultracode (Workflow), wants AI-handoff-grade docs, prefers minimal-but-correct solutions, likes questions framed with context + a recommendation, and works across devices. Keep chat replies short.
