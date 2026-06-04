# Features — detailed feature layer (INDEX / spine)

> This folder is the **DETAILED feature layer** that sits on top of the locked architecture docs `../README.md` + `../01_ARCHITECTURE.md`…`../06_TOKEN_OPTIMIZATION.md`. The 01–06 docs are the **authoritative, locked architecture** (engine, roles, verbs, data model, build plan, token budget). The 11 docs here zoom into one user-facing feature each and say exactly how it is built **on top of** that architecture — UI, flow, additive data, which existing verbs/triggers it reuses. Last updated: 2026-06-03.
>
> **Operator setup** — the non-code things a human must provide to actually run these features (accounts, infra, container image, per-CLI-integration credentials, env vars, build-phase-tagged) lives in [`../SETUP_AND_PREREQUISITES.md`](../SETUP_AND_PREREQUISITES.md).

---

## How to read this

1. Read `../README.md` + 01–06 first (the locked spine). This INDEX assumes you know the 3 roles (Assistant / Stage-Agent / Conductor), the verb surface (02 §2), the carry-over envelope (02 §4), and the data model (04).
2. Each feature doc here is self-contained (~2–4 dense pages) and uses one **identical section skeleton** (Scope → User flow → Data → Verbs/Events/Hooks → UI → Extends → Open questions). The exact skeleton + locked blocks every lane must copy verbatim are reproduced at the bottom of this file.
3. When a feature doc needs something from the architecture, it **cites up** by section (e.g. `[02 §5]`, `[03 §3.2]`) — it never restates or contradicts 01–06. If a doc seems to contradict the architecture, the architecture wins; flag it.

### Cohesion rules (non-negotiable)

- **Cite-up, never restate.** Reference 01–06 by section. Don't paraphrase the architecture; link to it.
- **New persistence goes in the delta table here, not into 04.** No feature doc may edit `../04_DATA_MODEL.md`. Every new field/model a doc introduces is declared on its own `**INDEX delta:** …` line (last line of its `## Data` section) and aggregated into the [delta table](#new-fields--models-delta-table) below. The cohesion pass is what finalizes the table from those lines.
- **ZERO new structured-channel verbs.** The verb surface (02 §2) is frozen and complete. Every "API" a feature needs is expressed with the existing verbs + `WorkspaceTrigger` (`when → then`) + the `run-command` allow-list. See the [no-new-verbs assertion](#no-new-verbs-assertion). If a doc thinks it needs a new verb, it's wrong — re-express it.
- **Reuse real names.** Use the exact type/field names from `../../_data/types.ts` and the real components in `../../_components/` and `../../_screens/`.

---

## Navigation — the 11 feature docs

| Doc | Scope (one paragraph) |
|---|---|
| **01_WORKSPACE_SETUP.md** | The workspace-create + project-link flow. Picks a **preset tier** (`Workspace.presetKey`, → 02), links a git repo (`Project.gitUrl`) and declares which files are **GENERATE** (orchestrator-produced docs/skills) vs **LINK** (read live from the repo) via `Project.linkedFiles[]`. Deep-duplicate (**D9**) when copying from an existing workspace: skills/sources/tools/env are cloned for full isolation. Pulls presets (02) + the build phase (03) in as it provisions. |
| **02_PIPELINE_PRESETS.md** | The 3/5/7 **preset tiers** (**D1**), capability-differentiated: `simple` = 3 stages (Refine→Code→Review, Sonnet/medium), `advanced` = 5 (+Plan,+Test), `professional` = 7 (Refinement, Planning, Coding, Reviewer1, Reviewer2, Test, Final — Opus/high + RAG + code-graph + dual review). A preset is a code fixture (`WorkspacePreset`) that instantiates editable `PipelineStageCfg[]`. Documents the **layered system-prompt resolution** (**D2**): `AgentRole.systemPromptTemplate` (base) → preset per-stage override → user per-stage edit, surfacing as `PipelineStageCfg.systemPrompt`. |
| **03_BUILD_PHASE.md** | The "build a workspace" experience after setup: how a chosen preset is realized into a live, editable pipeline; first-ticket walkthrough; the GENERATE-vs-LINK ingestion that produces the initial `InfoDoc` set. Extends 01 (setup hands off here) and 02 (consumes the preset). The Code-stage surface targets the full editor (**D7**), powered by the UI-Builder (**D3**, external). |
| **04_INTEGRATION_TOOLS.md** | Configuring workspace **Integration tools** + **Env vars** and selecting them per-stage with a `ro`/`rw` tier (`StageToolCfg`). **CLI-client-first** (firm): a whitelisted CLI client in the container is the default reach mechanism; MCP only where a CLI client can't (e.g. semantic RAG). Extends 03 §5 (integrations: goal-defined, mechanism-open). |
| **05_PER_SESSION_INFO.md** | Per-session/per-stage telemetry surfaced in the UI: token estimates, cost chips, and the **estimate model** (**D4**) — planning-agent self-estimate (cold-start) **blended** with rolling `SpendRecord` averages, shown as a range + per-model pricing; ticket cost chip = actual-so-far + projected-remaining. Adds `AgentSession.tokenEstimate` surfacing + per-stage `avgTokensPerTurn`. Feeds 02 (per-stage averages). |
| **06_VOICE_INPUT.md** | Voice → ticket / voice → answer. **Documented fully now, BUILD DEFERRED** (**D5**, late tier). Capture → transcript → existing text path (no new ingestion verb). The transcript rides existing surfaces (`TicketEvent.metadata.voiceTranscript?`, `UserPromptSubmit` hook). Falls back to the QuestionSet free-text answer path (→ 09) when used to answer. |
| **07_CODE_CHANGES_REVIEW.md** | Reviewing a stage's code output before promote: the diff/accept surface. Diff **baseline** (**D10**) supports BOTH, **defaults to whole-ticket** (parent/branch-base) with a toggle to per-stage delta; the snapshot is frozen at the stage `commitHash` (carry-over envelope). Shares the **UI-Builder editor** with 08; the existing `FileDiffViewer` is the **optional interim** only (**D3**). |
| **08_CODEBASE_VIEWER.md** | Browsing the ticket's working tree — the **full VSCode-like editor** target (**D7**), powered by the **UI-Builder** (**D3**, external, provided as an in-repo folder later). Defines the mount/props contract (`openFile`, `revealRange`, `setChangedFiles`, `setBaselineCommit`). Shares the editor with 07; reads the snapshot/commit from 03. |
| **09_QUESTIONS_IN_TICKETS.md** | The phone-from-the-beach question/approval UI: rendering a `QuestionSet` as mobile cards (choice = one tap, approve = Approve/Reject, free = short text) inline in chat and on the board banner. Adds `ChatMessage.questionSetId` so a bubble renders a question card. Pure UI over 02 §5 (QuestionSet/Question already in 04) — `request_input` / `draft_questionset` verbs only. Voice (06) is a free-text fallback into here. |
| **10_AUTOMATIONS_SCREEN.md** | The two authoring surfaces for `WorkspaceTrigger` (03 §1): the **stage-scoped "Automation" sub-tab** inside the Pipeline editor and the **workspace-level Automation screen** (cron + workspace-lifecycle). One model, two editors. Pure UI + config over the existing trigger engine — `when → then` rules, `run-command` allow-list, cron strings. No engine change. |
| **11_WORKSPACE_AI_PANEL.md** | The per-user **Assistant** chat panel (the real `AIPanel` in `_shell/Shell.tsx`, replacing dummy `sendChat`): streaming replies, proposing-only, question-card rendering, Compact/Clear controls, suggestion surfacing. Pure UI over the Assistant role (01 §3.2) + Assistant verbs (02 §2) + `ws-ai:*` events (05 P1 contract). The chat home for 09 (question cards) and config-review proposals (03 §4). |

---

## NEW FIELDS / MODELS DELTA TABLE

> **The single place new persistence is aggregated.** No feature doc edits `../04_DATA_MODEL.md`; each declares its additions on its `**INDEX delta:**` line and they roll up here. **Finalized by the cohesion pass** — built by reading every doc's `**INDEX delta:**` line, deduping shared fields, and resolving naming collisions (canonical name picked + noted). All fields are *additive* to the existing prototype types / Prisma models; entities already in 04 (`Handoff`, `QuestionSet`/`Question`, `WorkspaceTrigger`, `CarryOver`, `AgentSession`) are NOT re-introduced here — only deltas on top of them.
>
> **Net-new persisted fields/models: 10** (`Workspace.presetKey`, `WorkspacePreset`, `Project.gitUrl`, `Project.linkedFiles[]`, `Project.generatedDocsPath`, `PipelineStageCfg.systemPrompt`, `AgentSession.durationEstimate`, `PipelineStage.avgTokensPerTurn`, `TicketEvent.metadata.voiceTranscript?`, `ChatMessage.questionSetId`) plus **5 ui-only types** (`DiffBaseline`, `EditorMode`, `CodeRange`, `CodebaseEditorHandle`, `CodebaseEditorProps`) = **15 delta rows** total, **+ 1 already-in-04 surfaced field** (`AgentSession.tokenEstimate`). Docs 04, 10, 11 introduce **no** new persistence (verified — their `INDEX delta:` lines are `(none)`).

| New field / model | Type | On / extends | Owning doc | Notes |
|---|---|---|---|---|
| `Workspace.presetKey` | `'simple' \| 'advanced' \| 'professional'` | `Workspace` | **02** (01 sets it) | which preset tier instantiated this workspace's pipeline. **Dedupe:** declared by both 01 & 02 — canonical owner **02** (defines the enum + semantics); 01 sets it in setup step 4. One field. |
| `WorkspacePreset` | code fixture (registry, not a DB row) | new | 02 | per-tier stage list + per-stage model/effort/skills/prompt fixtures; instantiates `PipelineStageCfg[]` on create (D1/D2) |
| `Project.gitUrl` | `string` | `Project` | **01** (03 consumes) | the linked git repo (alongside existing `gitlabPath`). **Dedupe:** declared by both 01 & 03 — canonical owner **01** (setup creates the `Project`); 03 consumes it for clone/seed. One field. |
| `Project.linkedFiles[]` | `{ path: string; role: 'generate' \| 'link' }[]` | `Project` | **01** (03 consumes) | GENERATE = orchestrator-produced; LINK = read live from repo. **Dedupe:** 01 wrote `Project.linkedFiles`, 03 wrote `Project.linkedFiles[]{path,role}` — same field; canonical name **`Project.linkedFiles[]`**. One field. |
| `Project.generatedDocsPath` | `string` (default `'docs/luckystack/'`) | `Project` | 03 | where GENERATE'd docs are committed (03.q3) |
| `PipelineStageCfg.systemPrompt` | `string` | `PipelineStageCfg` | 02 | resolved per-stage prompt (D2 layering). Note: `customInstructions` + `promptTemplate` **already exist** on `PipelineStageCfg` — `systemPrompt` is the layered-base distinct from those |
| `AgentSession.durationEstimate` | `Int?` (seconds) | `AgentSession` | 05 | cold-start self-estimate parsed by the Conductor from the planning agent's carry-over `summary`; sibling of `tokenEstimate`; `>= 0`, nullable until a planning stage runs (D4) |
| `PipelineStage.avgTokensPerTurn` | `Int?` (prototype: on `PipelineStageCfg`) | `PipelineStage` / `PipelineStageCfg` | 05 | rolling per-stage average feeding the D4 estimate blend. **Collision resolved:** the original seed row named this `AgentSession.avgTokensPerTurn (per-stage)`; doc 05 (owner) is authoritative — it is a **per-stage** average, canonical **`PipelineStage.avgTokensPerTurn`** (added to `PipelineStageCfg` in the prototype), NOT on `AgentSession`. |
| `ChatMessage.questionSetId` | `string?` | `ChatMessage` | 09 | already noted in 02 §5 / 04 — lets a chat bubble render a `QuestionSet` card inline. Surfaced by 11, owned by 09. |
| `TicketEvent.metadata.voiceTranscript?` | `string?` (within `TicketEvent.metadata` JSON) | `TicketEvent` | 06 | optional transcript on the `UserPromptSubmit`-sourced event; audio blob not persisted; build deferred (D5) |
| `DiffBaseline` | `'whole-ticket' \| 'stage-delta'` | new (ui-only) | 07 | per-view diff-baseline toggle; defaults `'whole-ticket'` (D10); not persisted |
| `EditorMode` | `'read-only' \| 'edit'` | new (ui-only) | 08 | UI-Builder mount prop; defaults `'read-only'`; not persisted |
| `CodeRange` | `{ startLine; startCol?; endLine?; endCol? }` | new (ui-only) | 08 | reveal-range arg for the editor contract; not persisted |
| `CodebaseEditorHandle` | imperative handle (`openFile`/`revealRange`/`setChangedFiles`/`setBaselineCommit`) | new (ui-only) | 08 | host→editor contract captured via `onReady`; shared with 07; not persisted |
| `CodebaseEditorProps` | mount props (see 08 §Data) | new (ui-only) | 08 | UI-Builder mount props; not persisted |

**Already in 04 — surfaced, not introduced** (counted separately so it isn't double-counted as net-new): `AgentSession.tokenEstimate` `Int @default(0)` — defined in 04 §2; doc 05 *surfaces* it as the chip's `actual-so-far` source.

Already in 04 (do **not** re-add — listed only to prevent double-counting): `Handoff`, `QuestionSet` + `Question`, `WorkspaceTrigger` (+ `TriggerEventKind`/`TriggerActionKind`), `CarryOver`, `AgentSession` core fields (incl. `tokenEstimate`), `PipelineStageCfg.roleKey`, `StageModelCfg.contextBudgetTokens`, per-workspace AI-budget fields (`SpendRecord`, `WorkspaceBudget`).

---

## NO-NEW-VERBS assertion

The structured-channel verb surface (02 §2) is **frozen and complete**. The full surface, repeated so no lane reinvents it:

- **Stage-Agent (worker) verbs:** `report_status`, `emit_event`, `request_input`, `emit_carryover`, `emit_signal`, `emit_handoff`, `query_context`.
- **Assistant verbs:** `get_ticket`, `list_tickets`, `read_pipeline`, `propose_suggestion`, `draft_questionset`, `refresh_docs`.

**No feature in this folder adds a verb.** Every feature "API" is one of:
1. an **existing verb** above, or
2. a **`WorkspaceTrigger`** (`when (event) → then (action)`, 03 §1) + the **`run-command` allow-list** (`OrchestratorCommandRegistry`, never raw shell), or
3. an **`AgentRole`** registration / per-stage `PipelineStageCfg` config (03 §3).

No LLM has a write verb (B-23 enforced structurally: AI proposes → user accepts → Conductor executes). If a doc's `## Verbs / Events / Hooks` section can't be written from this list, the feature is mis-modeled — re-express it, do not add a verb.

---

## Dependency graph

```
01_WORKSPACE_SETUP ──pulls in──▶ 02_PIPELINE_PRESETS
01_WORKSPACE_SETUP ──pulls in──▶ 03_BUILD_PHASE
        (setup picks a preset + kicks off the build phase)

07_CODE_CHANGES_REVIEW ◀──shared UI-Builder editor──▶ 08_CODEBASE_VIEWER
08_CODEBASE_VIEWER ──reads snapshot/commit──▶ 03_BUILD_PHASE
        (diff/editor baseline frozen at the stage commitHash)

05_PER_SESSION_INFO ──per-stage avgTokensPerTurn──▶ 02_PIPELINE_PRESETS
        (rolling averages feed preset/estimate tuning)

06_VOICE_INPUT ──free-text fallback──▶ 09_QUESTIONS_IN_TICKETS
        (voice answer → QuestionSet free-text path)

09_QUESTIONS_IN_TICKETS ◀──question cards rendered in──── 11_WORKSPACE_AI_PANEL
04_INTEGRATION_TOOLS ──per-stage tool select──▶ 03_BUILD_PHASE
```

---

## Glossary (feature-level terms)

- **Preset tier** — one of the three capability-differentiated pipeline templates (`simple`/`advanced`/`professional`, D1), instantiated as a `WorkspacePreset` code fixture into editable `PipelineStageCfg[]`. Recorded as `Workspace.presetKey`.
- **Build phase** — the post-setup experience that realizes a chosen preset into a live, editable pipeline + ingests the initial docs/sources (03).
- **GENERATE vs LINK** — the two roles a `Project.linkedFiles[]` entry can take: **GENERATE** = the orchestrator produces/owns the file (e.g. `AI_*` docs, skills); **LINK** = the file is read live from the linked repo. (D9 copy-from-workspace deep-duplicates both kinds.)
- **UI-Builder** — the **external** VSCode-like editor component (D3, D7), NOT in the repo yet; the user adds it as an in-repo folder when this feature is built. Hard dependency, provided later. Mount/props contract: `openFile`, `revealRange`, `setChangedFiles`, `setBaselineCommit`. The existing `FileDiffViewer` is an optional interim.
- **Changed-files mode** — the diff **baseline** toggle (D10): **whole-ticket** (parent/branch-base, default) vs **per-stage delta**; snapshot frozen at the stage `commitHash`.
- **Estimate range** — the cost projection (D4): planning-agent self-estimate (cold-start) blended with rolling `SpendRecord` averages, shown as a **range** + per-model pricing; the ticket cost chip = actual-so-far + projected-remaining.

---

## Resolved decisions (this session — baked in, do not re-open)

- **D1** — Presets 3/5/7, capability-differentiated: `simple`=3 (Refine→Code→Review), `advanced`=5 (+Plan,+Test), `professional`=7 (Refinement, Planning, Coding, Reviewer1, Reviewer2, Test, Final). Tiers differ by stage list AND per-stage model/effort/skills (simple=Sonnet/med; professional=Opus/high + RAG + code-graph + dual review).
- **D2** — Default system prompts **layered**: `AgentRole.systemPromptTemplate` (base) → preset per-stage override (code fixtures) → user per-stage edit; instantiated as editable per-stage config on workspace-create. Document the resolution order.
- **D3** — UI-Builder is **EXTERNAL, not in the repo yet**; the user adds it as an in-repo folder when this feature is built (hard dependency, provided later). Mount/props contract: `openFile`, `revealRange`, `setChangedFiles`, `setBaselineCommit`. The existing `FileDiffViewer` is an optional interim only.
- **D4** — Estimates = BOTH: planning-agent self-estimate (cold-start) blended with rolling `SpendRecord` averages; show a range + per-model pricing; ticket cost chip = actual-so-far + projected-remaining.
- **D5** — Voice: documented fully now, **BUILD DEFERRED** (late tier).
- **D6** — Multi-instance / DR: **DEFERRED** to 05 P4 (hardening) — INDEX one-paragraph pointer only, no feature doc.
- **D7** — Code surface: the **full VSCode-like editor** is the target (not a read-only interim), powered by the UI-Builder.
- **D8** — Many small docs (this 11-doc split).
- **D9** — Copy-from-workspace = **deep-duplicate** skills/sources/tools/env (full isolation).
- **D10** — Diff baseline: support BOTH, **default whole-ticket** (parent/branch-base), toggle to per-stage delta; snapshot frozen at the stage `commitHash`.
- *(Integrations)* — CLI-client-first (firm): whitelisted CLI client in the container by default; MCP only where a CLI client can't (e.g. semantic RAG).

---

## Resolved decisions — feature-doc open questions (this session — baked in, do not re-open)

> Every feature doc's `## Open questions` is now resolved and folded here as `D11+`, grouped by owning doc; the original numbering is preserved as `NN.q`. ⚑ marks the four answers that **deviate from the earlier default/proposed** assumption.

**01 — Workspace setup**
- ⚑ **D11 (01.q1)** Slug uniqueness = **per-owner** (two users can each have `my-app`); not global.
- ⚑ **D12 (01.q2)** **One project per workspace** (no project switcher; the seed's 2nd project is legacy); the wizard stays single-project.
- **D13 (01.q3)** Copy-from-workspace = **fresh GitLab connect** (own per-workspace token, B-07); never reuse the source's token.
- **D14 (01.q4)** First-index unlocks when the GENERATE'd project-summary is done; RAG/code-graph keep indexing — show a visible "still indexing in the background" indicator with per-source progress chips (done/indexing) after unlock.

**02 — Pipeline presets**
- **D15 (02.q1)** `WorkspacePreset` fixtures live in a dedicated `_data/presets.ts` (keep `STAGE_CONFIGS` as one preset).
- **D16 (02.q2)** Dual-review (professional) = **serial full carry-over envelopes** (Reviewer1 → injected into Reviewer2).
- **D17 (02.q3)** Keep `systemPrompt` AND `customInstructions` distinct (`systemPrompt` = appended session system prompt / `--append-system-prompt`; `customInstructions` = stage `CLAUDE.md`); do not collapse.
- **D18 (02.q4)** Tiers fully editable post-instantiation; `Workspace.presetKey` is provenance-only.

**03 — Build phase**
- **D19 (03.q1)** GENERATE/LINK split: the Assistant **proposes** it, the user confirms (with sensible fallback defaults).
- **D20 (03.q2)** Re-snapshot on push = an opt-in `stage.on_complete → ai:refresh-docs` `WorkspaceTrigger` (recommended automation; no silent auto-regen by default elsewhere).
- ⚑ **D21 (03.q3)** GENERATE'd docs are **committed into the repo at `docs/luckystack/`** → the build phase needs git **write/commit** (not read-only); the security note reflects build-phase git is write-capable. New field `Project.generatedDocsPath` (default `'docs/luckystack/'`).
- **D22 (03.q4)** Large-repo: ignore junk (`.gitignore`-aware; skip `node_modules`/build/dist/`.git`) + lazy-load tree children.

**04 — Integration tools**
- **D23 (04.q1)** Per-`IntegrationTool.type` allow-pattern map for known types; custom types declare their own `command` + allow pattern. Any wrapper = an allow-listed `run-command`, never a new verb.
- **D24 (04.q2)** Base image bakes common clients (`psql`, `mysql`, `mongosh`, `redis-cli`, `curl`, `git`, `gh`); project-specific clients via per-project `Dockerfile ADD`.
- **D25 (04.q3)** `ro`/`rw` enforced via separate per-tier DB credentials (read-only user + read-write user; tier picks the credential at spawn, B-O8).
- **D26 (04.q4)** Escalate after 3 consecutive failures on the same tool → `needs-input` + notification (configurable); non-blocking signals before that.

**05 — Per-session info**
- **D27 (05.q1)** Estimate emitted as a fenced JSON block inside the planning agent's `emit_carryover` summary (Conductor parses; no envelope/verb change).
- **D28 (05.q2)** Blend = `α·self + (1−α)·rollingAvg`, `α=1` at 0 samples decaying to ~`0.3` by ~10 samples.
- **D29 (05.q3)** Confidence low/med/high by sample count, keyed per (preset, stage, model).
- **D30 (05.q4)** Raise-cap-and-resume = inline editor + a quick `+50%` button; gated on the pipeline/config RBAC capability (not any member).
- **D31 (05.q5)** Per-model pricing = an editable workspace setting with sensible defaults; zero it out to show tokens-only.

**06 — Voice input** *(build deferred, D5)*
- **D32 (06.q1)** Max clip length = 2:00 (single global cap).
- **D33 (06.q2)** Audio deleted immediately after transcription; kept briefly ONLY on STT failure (for re-transcribe).
- **D34 (06.q3)** whisper.cpp = one shared orchestrator-side instance (not per-ticket container).
- **D35 (06.q4)** Transcript used raw as the ticket description in v1 (no Assistant-normalize).
- **D36 (06.q5)** Language = a per-workspace setting reserved; auto-detect off in the first build.

**07 — Code-changes review**
- **D37 (07.q1)** Per-stage-delta baseline = commit-range diff `prevStage.commitHash..thisStage.commitHash`.
- **D38 (07.q2)** v1 accepts the whole stage output at the gate (no per-file/per-hunk staging).
- ⚑ **D39 (07.q3)** Reject payload = free-text note. **Reject re-opens the stage** — the note becomes the `--resume` prompt for the same agent, stage → `busy` (NOT "hold at done"); consistent with 09.q2.
- **D40 (07.q4)** Stepper walks the currently-visible diff's file set (follows the baseline toggle).
- **D41 (07.q5)** Interim `FileDiffViewer` stays minimal + read-only (no backporting the tree/stepper before UI-Builder).

**08 — Codebase viewer**
- **D42 (08.q1)** UI-Builder folder lives co-located at `src/workspaces/_uibuilder/` (mount strategy A: local import; stripped with `src/workspaces` later).
- **D43 (08.q2)** `artifactKind` key = `'code'` (shared by 07 + 08).
- **D44 (08.q3)** Edit mode unlocks ONLY on a live worker container + "work on tickets" RBAC; otherwise read-only. No editing frozen snapshots via scratch worktree in v1.
- **D45 (08.q4)** Theme: UI-Builder consumes the `@theme` tokens directly; a theme map via `CodebaseEditorProps` is the fallback.
- **D46 (08.q5)** Large-repo tree virtualization is UI-Builder's responsibility; the host streams tree/contents via `query_context`, no host pagination.

**09 — Questions in tickets**
- **D47 (09.q1)** Submit all answers at once (Submit enabled once all answered).
- ⚑ **D48 (09.q2)** Reject on an `approve` gate **re-opens the stage** — the agent resumes (`--resume`) with the reject note, stage → `busy` (overrides the earlier "hold at done"; consistent with 07.q3).
- **D49 (09.q3)** Answers immutable after submit; a follow-up creates a new `QuestionSet`.
- **D50 (09.q4)** One `ws-ai:needs-input` push; both the chat card and the board banner subscribe (no double-resolve).
- **D51 (09.q5)** ~6 choices visible before a scroll/"More" affordance on mobile.

**10 — Automations screen**
- **D52 (10.q1)** `'next'` target hidden for non-stage events; resolved at fire-time for `stage.*` events.
- **D53 (10.q2)** `dedupeKey`/`debounceMs` live in an "Advanced" section, server-defaulted.
- **D54 (10.q3)** Recent-fires shows the last 5 inline with a link to the full event-log.
- **D55 (10.q4)** Cron anchored to a workspace timezone (stored on `Workspace`; defaults to the host tz on create).

**11 — Workspace-AI panel**
- **D56 (11.q1)** Signal stream virtualized + low-priority `observation` types collapsed by default; scoped to the user's visible tickets.
- **D57 (11.q2)** `stop` requires a `menuHandler.confirm`; pause/resume/promote act directly (still propose → Conductor executes).
- **D58 (11.q3)** Telemetry for a non-admin Member = their own Assistant + worker sessions on tickets they can see (RBAC read scope).
- **D59 (11.q4)** Compact = AUTO at budget + a manual "Optimize now" button; show an "optimizing context…" state during the round-trip (both paths).
- **D60 (11.q5)** Control buttons show "requested…" then time out ~10s if the Conductor never confirms (e.g. workspace `stopped` on a rate-limit).

All feature-doc open questions are now resolved.

---

## Ops / DR pointer

**Multi-instance and disaster-recovery are NOT a feature doc** (D6). They live in `../05_BUILD_PLAN.md` **P4 (Hardening)**: resume-after-crash (`resumeAll()`), the multi-instance lease (`acquireLease('ws-engine:<wsId>')`), rate-limit → `stopped` + backoff, spend/budget accounting + auto-pause, and presence/catch-up polish. Treat anything operational/recovery-related as an extension of P4, cited up — do not spawn a feature doc for it.

---

# Drafting contract (copy verbatim into every feature doc)

> The drafting lanes MUST use the identical skeleton + locked blocks below. Reproduced here verbatim so all 11 docs share one contract.

## LOCKED ARCHITECTURE (authoritative — cite, never restate or contradict)

LOCKED ARCHITECTURE — authoritative in src/workspaces/_docs/ (README + 01-06). CITE it by section (e.g. "[03 §5]"); NEVER restate or contradict it:
- Engine: interactive Claude CLI in a node-pty PTY ONLY, on the Max subscription (NO headless claude -p, NO Agent SDK — they meter a separate pool from 2026-06-15).
- 3 roles: ASSISTANT (per active user per workspace; chat; read/propose only; suspended on disconnect) · STAGE-AGENT (worker; one per (ticket,stage); in a container for code roles) · CONDUCTOR (deterministic Node; ALL coordination + the ONLY writer of board/git/status). Plus an OPTIONAL FUTURE one-shot ephemeral reasoner (not standing). No LLM has write verbs (B-23 enforced structurally: AI proposes, user accepts, Conductor executes).
- Structured channel = a whitelisted CLI/HTTP helper (verbs) + Claude hooks (type:http). Worker verbs: report_status, emit_event, request_input, emit_carryover, emit_signal, emit_handoff, query_context. Assistant verbs: get_ticket, list_tickets, read_pipeline, propose_suggestion, draft_questionset, refresh_docs. *** NO NEW VERBS *** — every "API" a feature needs MUST be expressed with these existing verbs + WorkspaceTriggers + run-command allow-list. If you think you need a new verb, you're wrong — re-express it.
- Carry-over envelope = {summary, changedFiles, openQuestions, commitHash} (B-O2). Append-only WorkspaceSignal consumed serially by the Conductor (B-O6). Token-optimization = per-stage + per-AI context budget -> self-handoff (emit_handoff -> /clear -> reload), doc 06. Automation = WorkspaceTrigger (when->then) + cron + run-command (allow-listed), doc 03. Pluggable AgentRole (roleKey, needsWorkspace) + ArtifactViewer + OrchestratorCommand registries, doc 03. Containers only for code roles; cross-platform (Docker on Win/WSL2 + Linux); stack-agnostic (.NET/Go/any). Integrations = CLI-client-first.

## LOCKED DECISIONS (this session — bake in, do not re-open)

- D1 Presets 3/5/7, capability-differentiated. simple=3 (Refine->Code->Review); advanced=5 (+Plan,+Test); professional=7 (Refinement, Planning, Coding, Reviewer1, Reviewer2, Test, Final). Tiers differ by stage list AND per-stage model/effort/skills (simple=Sonnet/med; professional=Opus/high + RAG + code-graph + dual review).
- D2 Default system prompts LAYERED: AgentRole.systemPromptTemplate (base) -> preset per-stage override (code fixtures) -> user per-stage edit; instantiated as editable per-stage config on workspace-create. Document the resolution order.
- Integrations CLI-client-first (firm): whitelisted CLI client in the container by default; MCP only where a CLI client can't (e.g. semantic RAG).
- D4 Estimates = BOTH: planning-agent self-estimate (cold-start) blended with rolling SpendRecord averages; show a range + per-model pricing; ticket cost chip = actual-so-far + projected-remaining.
- D5 Voice: documented fully now, BUILD DEFERRED (late tier).
- D7 Code surface: the FULL VSCode-like editor is the target (not a read-only interim), powered by UI-Builder.
- D3 UI-Builder: EXTERNAL, NOT in the repo yet. The user will ADD IT AS AN IN-REPO FOLDER when this feature is built. Docs MUST state this plainly (hard dependency, provided later) and define the mount/props contract (openFile, revealRange, setChangedFiles, setBaselineCommit). The existing FileDiffViewer is an OPTIONAL INTERIM only.
- D9 Copy-from-workspace = DEEP-DUPLICATE skills/sources/tools/env (full isolation).
- D10 Diff baseline: support BOTH, DEFAULT whole-ticket (parent/branch-base), toggle to per-stage delta; snapshot frozen at the stage commitHash.
- D6 Multi-instance/DR: DEFERRED to 05 P4 (hardening) — INDEX one-paragraph pointer only, no feature doc.
- D8 Many small docs.

## SECTION SKELETON (exact — every feature doc uses this, markdown ##/### headers, dense and concrete)

1. `# NN — <Title>` + a one-line `>` blurb naming which 01-06 docs it extends.
2. `## Scope` — in / out / deferred (bullets).
3. `## User flow` — numbered steps; desktop + mobile notes; mockup hints (ASCII or prose).
4. `## Data` — additive fields/models with types + validation. END this section with a line: `**INDEX delta:** <comma-list of the exact new fields/models this doc introduces>` so the cohesion pass can aggregate them. DO NOT edit 04_DATA_MODEL.md.
5. `## Verbs / Events / Hooks` — ONLY existing verbs (list which) + WorkspaceTriggers/hooks used. State "No new verbs." explicitly.
6. `## UI` — new components vs reused (name real ones from _components/_screens where possible), mobile parity notes.
7. `## Extends` — bullet list quoting the specific 01-06 sections this builds on (e.g. "[02 §5] QuestionSet").
8. `## Open questions` — numbered (these roll up into the INDEX decisions list).

Keep ~2-4 dense pages. Friendly, precise, no fluff. Reuse exact type/field names from `src/workspaces/_data/types.ts`.
