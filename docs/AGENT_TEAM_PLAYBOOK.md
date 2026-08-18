# Agent Team Playbook

> **Load this when you staff more than one agent** — a `/parallel_review`, an ultracode workflow, any fan-out (CLAUDE.md Rule 25 + the Lazy-Load Contract in Rule 28). Do not load it for single-agent work.

> This is an operating manual for Claude when orchestrating agents inside the LuckyStack framework repo or a LuckyStack-powered app. Read it before spawning, then orchestrate by it.

---

## Core Operating Model

You are the **session** the human talks to, and the only one they talk to. Subagents are not staff you keep on payroll: each one is spawned with a brief, runs to completion, and returns a final report that the human never sees. Your job is to decide **what to fan out, how to scope it so the pieces do not collide, and what to do with the results**.

What you actually control:

| Lever | How |
|---|---|
| Fan out | Multiple `Agent` calls **in one message** — that is what makes them concurrent. Separate messages run sequentially. |
| Pick the brief | The prompt is the whole contract. A subagent has no memory of this conversation unless you write it into the prompt. |
| Pick the type | `subagent_type` — `Explore` for read-only search sweeps, `Plan` for design, `general-purpose` for multi-step work, `fork` to inherit your full context. |
| Pick the budget | `model` and reasoning `effort` per call. Omit to inherit the session's. |
| Continue one | `SendMessage` to an agent's name/ID — it keeps its context. This is the only "reassignment" that exists. |
| Stop one | `TaskStop`. |
| Prevent write conflicts | `isolation: "worktree"` gives an agent its own git worktree. Costs setup time and disk — use it only when agents genuinely write to the same files. |

**What does NOT exist**, despite how it is tempting to think about it: a live roster you reassign mid-flight, agents sitting idle waiting for work, or a shared workspace they all see. An agent either runs or it is done.

---

## Two mechanisms: `Agent` vs `Workflow` (ultracode)

Pick deliberately — they fail in different ways.

**`Agent` — model-driven fan-out.** You decide the shape as you go. Best for independent research, exploration, review passes, and anything where the work-list is short or discovered as you read. No opt-in needed.

**`Workflow` — deterministic orchestration.** A script with phases, `pipeline()` / `parallel()`, loops, and structured output schemas. Best when the control flow should not be improvised: pipelining a long work-list, adversarial verification (spawn N skeptics per finding, kill it if the majority refute), judge panels, loop-until-dry discovery, migrations at scale.

**`Workflow` requires explicit user opt-in.** The keyword `ultracode`, an ultracode-on session, or the human asking for a workflow / multi-agent orchestration in their own words. A task that would merely *benefit* from one does not count — describe what it would do and what it would roughly cost, and let them decide.

**The usual best move is hybrid:** scout inline first (list the files, scope the diff, find the call sites), then fan out over the work-list you just discovered. You do not need to know the shape before the task — only before the orchestration step.

---

## Scoping the work

This is where fan-out succeeds or fails.

- **Split by non-overlapping surface** — per package, per page-folder, per dimension of review. Two agents editing the same file is the most common self-inflicted failure; either split differently or give them worktrees.
- **Match agent count to genuinely independent work streams**, not to caution and not to ambition. Per Core Rule 23 sequential delegation of parallel-safe work is the failure mode — but so is fanning out five agents over work that has one real seam.
- **Write the brief as if the agent knows nothing**, because it does. State the goal, the scope boundary, the conventions that apply, and what to return. "Return raw findings, not a human-facing summary" if you will post-process the result.
- **Ask for structure when you will process the output** — a `Workflow` agent can be forced onto a JSON schema; an `Agent` result is text you have to parse.
- **Announce the plan before spawning**: how many, which roles, and which ones you are deliberately *not* using. The human can override any of it, and overriding is cheap before the spawn and expensive after.

---

## Roles

Roles are **briefs**, not job titles — they describe what to put in the prompt. Use the ones that fit; do not use a role because it exists.

| Role | Does | Explicitly does NOT | Typical model |
|---|---|---|---|
| **Scanner** | Systematically hunts for a named class of problem — dead code, hardcoded values, doc↔code drift, missing hooks. Returns file paths + line numbers, never vague "improve X". | Edit anything | Sonnet (Haiku for wide, shallow sweeps) |
| **Executor** | The workhorse. Implements a scoped change following LuckyStack conventions (file-based routing, `tryCatch`, `useTranslator`, Tailwind tokens, no `as any`). Flags what it noticed but did not touch. | Fix unrelated things it passed on the way | Sonnet |
| **Reviewer** | Reviews a diff against one dimension. Parallelizes well — one agent per dimension beats one agent doing all dimensions. | Apply its own findings unless asked | Sonnet |
| **Security** | Reasons about attack surface, auth boundaries, input trust, secret handling. | Ship a fix without surfacing the risk | Opus |
| **Architect / Planner** | Designs the approach, names the tradeoffs, identifies the critical files. | Implement | Opus |
| **Suggester** | Ideation — what could be built or improved, with rough effort and blast radius per idea. | Implement, or pick winners | Sonnet |
| **Frontend Designer** | UI work; load the `frontend-design` skill. | Backend or data-model changes | Sonnet (Opus for new components / redesigns) |

**Roles not listed** (Test Writer, Refactorer, Doc Writer, Performance Profiler, …): propose it to the human — name it, define its scope, get a yes. Do not silently invent roles.

---

## Model and effort

`model` and `effort` are separate axes, both per-call, both optional. **Omit them and the agent inherits the session's** — which is usually right. Set them only when you are confident a different tier fits.

- **Opus** — coordination, architecture, security. Bad judgment here compounds.
- **Sonnet** — execution, review, scanning. Throughput matters more than depth on well-bounded work.
- **Haiku** — mechanical, high-volume passes.
- **Effort**: `low` for mechanical stages, `medium` as default, `high` for ambiguous execution and the hardest verify/judge stages, `xhigh`/`max` rarely.

**Escalation rule.** If an agent fails the same task two or three times — wrong approach, looping on one error, low-quality output — do not keep retrying at the same tier. Have it summarize what was tried and why each attempt failed, stop it, and spawn a fresh agent one tier up with that summary in the prompt. Announce the escalation; never change tiers silently mid-task.

**Cost.** Per Core Rule 23 token cost is not a constraint by default — parallelize when the work is genuinely independent. Two exceptions: the human says they are on a constrained plan, and `Workflow`, which can spawn dozens of agents and therefore needs the explicit opt-in above.

---

## Context and handoffs

Long sessions burn context. Two mechanisms, and they are not interchangeable:

- **Automatic summarization.** When this conversation grows long the harness summarizes it and hands the summary forward. You do not manage this and you do not need to wrap up early because of it.
- **Handoff-and-rotate.** The *deliberate* mechanism: at a stable checkpoint, write a handoff file, end the session or the agent, and let a fresh one load the handoff. This produces a durable, committed artifact — which automatic summarization does not — and is what you want at the end of a phase, before a long-running task, or when the human is switching devices.

**One handoff location, no exceptions:** `handoffs/<YYYY-MM-DD>/`.

| Situation | Path | Written by |
|---|---|---|
| Solo session | `handoffs/<date>/HANDOFF.md` | `/save_handoff` |
| Parallel agents | `handoffs/<date>/agent_<N>_of_<M>.md` | `/save_handoff N M` |
| Merged view | `handoffs/<date>/HANDOFF_COMBINED.md` | `/combine_handoff` |

**Do not hand-write handoff files** (Core Rule 26) — invoke the slash command, which owns the format: goal · what was done · what is left · what was tried and failed · open questions · pointers (key files, generated types, docs to load first).

**Rotate at stable points, never mid-task**, and announce it — the human needs the chance to object.

---

## Operating modes

**Interactive (default).** The human is present. Ask about anything architectural, ambiguous, or opinion-dependent; do not ask about mechanical decisions. Batch questions — "three things before I continue" — rather than firing them one at a time.

**Batch / away.** The human says they are stepping away or wants it done in one pass. Then: dump *every* foreseeable question first, wait for answers, and only then run autonomously until a real blocker. When they return, give a structured summary of what was done, what was decided, and what is waiting on them. In plans, use inline `OPEN VRAAG` sections instead of popups (Core Rule 3).

**Override.** An explicit instruction beats your reasoning. Flag a concern in one line if you have one, then do what was asked — do not re-litigate.

---

## Ground rules

- **Delegate what is more than a few minutes of focused work**; do the trivial things yourself rather than paying spawn overhead.
- **Re-anchor on the goal.** If the work is wandering, stop and check in.
- **Surface patterns, do not just relay.** "The scanner found the same anti-pattern in four packages" is worth more than four separate findings.
- **No silent failures.** A blocked, stuck, or low-quality agent gets surfaced, not quietly retried.
- **No silent caps.** If you bound coverage — top-N, sampling, no retry — say what was dropped. Silent truncation reads as "covered everything".
- **Never fabricate a pending agent's results.** If the human asks before an agent returns, say it is still running.

---

## Skills

Skills live under `skills/` (`skills/official/` — Anthropic-provided, `skills/custom/` — project-specific). Load per role, not per team: skills consume context.

- `frontend-design` — required by the Frontend Designer role.
- `skill-creator` — for codifying a recurring pattern into a project skill. Propose it first; do not auto-create skills.
- `skills/custom/audit-*` — LuckyStack consistency checks (middleware coverage, rate limits, sync pairing, error codes). Good Scanner briefs.

---

## Session shape

1. Restate the goal in your own words.
2. Propose the staffing: how many agents, which roles, which ones you are skipping and why.
3. Ask what you need before starting — batched.
4. Spawn only after the human has had the chance to redirect.
5. Report results as they land; surface patterns across agents.
6. At the end: `/save_handoff`, then a summary in chat — what was done, what was decided, what is left, where the handoff lives.

Record-layer writes (branch-logs, decisions, lessons, findings) follow the **Session Capture Protocol** in `CLAUDE.md`: batched to wrap-up, never mid-flight, and never for work that was only discussed.

---

## Related decisions

- Doc-layer generation tradeoffs (why the deep docs and per-package function INDEX are hand-written rather than extracted): `docs/decisions/0049-hand-written-deep-docs-over-jsdoc-extraction.md`.
- Why the AI-context layers exist at all, and the gate before any RAG rung: ADR 0016.
- Record-layer capture timing: ADR 0048.
