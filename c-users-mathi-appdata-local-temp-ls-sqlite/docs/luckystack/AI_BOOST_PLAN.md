# AI-Boost Implementation Plan — the long route

> Status: **Waves 1–3 SHIPPED** (decision memory + backfill + runbooks + invariant linter; native
> dependency graph `docs/ai-graph.json`; `@luckystack/mcp` query server). Wave 4 (RAG) remains gated —
> see ADR 0003. Date: 2026-06-11.
> Goal: give an AI the best possible, **team-shareable** context over a LuckyStack repo — for this
> project AND every project that installs the framework.
> Constraint chosen by the user: **build it all properly (no half-work), minimal third-party tools.**
> Supersedes the "defer graphify/RAG" stance in `AI_BOOST_ROADMAP.md` §conflicts — see §0.

---

## 0. The key decision: native over third-party

The original synthesis advised deferring Graphify and RAG. The user chose the long route with **minimal
third-party tools**. That single constraint changes one verdict and confirms the rest:

| Capability | External tool needed? | Verdict on the long route |
|---|---|---|
| Decision memory | none (markdown + Node) | build |
| Memory-sync (local → project) | none (Node + AI) | build |
| Runbooks | none (Node) | build |
| Invariant linter | none (reuses `@luckystack/core/eslint`) | build |
| MCP server | only Anthropic's own `@modelcontextprotocol/sdk` | build |
| **Graphify (call-graph)** | **none — rebuilt TS-native on devkit's existing `ts.Program`** | **build (flipped from defer)** |
| RAG (semantic search) | **yes — an embeddings model (Voyage API or local model)** | build LAST, optional rung |

**The flip:** "Graphify" the product is a Python tool. The *capability* (a call-graph / map of which
function calls which) can be rebuilt in TypeScript on the `ts.Program` + `TypeChecker` that
`@luckystack/devkit` already runs. Zero new third-party, full power. So it moves into the plan.

**The honest exception:** RAG (search-by-meaning) is the only capability that genuinely requires an
external embeddings model. It is therefore the final, optional rung — not "half-work", a separate top
floor you add only if steps 1-6 prove insufficient.

This plan touching `GRAPHIFY_INTEGRATION.md` + `AI_BOOST_OVERVIEW.md` line 125 (the "RAG is the last
rung, framework stays out" stance) is a **conscious deviation** per CLAUDE.md Rule 3b — recorded as the
first two ADRs the new decision log produces (§Wave 1).

---

## 1. Build order (the dependency spine)

```
WAVE 1 — foundation (zero new deps, ships via the existing scaffold copy-block + pre-commit hook).
NO custom slash commands the user is expected to run — all of this is automatic AI behavior driven by
CLAUDE.md, plus pre-commit hooks. The user never runs these by hand.
  1. Decision memory      docs/decisions/ ADRs + AI_DECISIONS_INDEX.md. The AI writes a decision when one
                          is made in-session (like the branch-log protocol) and reads the index when it
                          wonders "why". No command.
  2. Empty-memory backfill  On session start, if the memory is empty AND the project already has history,
                          the AI OFFERS to seed docs/decisions/ from git log + branch-logs (+ optionally
                          the local ~/.claude memory). An offer, not a command, not an auto-bulk-write.
  3. Runbooks             generateRunbooks.mjs -> docs/AI_RUNBOOKS.md (task-shaped ramps; AI-read context)
  4. Invariant linter     lintInvariants.mjs over the staged diff (report-by-default; runs in pre-commit
                          + AI-autonomously, no user command)

WAVE 2 — the integration spine (only new dep: Anthropic's own MCP SDK)
  5. @luckystack/mcp      one read-only MCP server exposing every committed artifact to Claude Code

WAVE 3 — structural power (native, no new deps)
  6. Native call-graph    @luckystack/devkit `graph`: docs/ai-graph.json + graph MCP tools

WAVE 4 — semantic power (the only third-party rung, optional)
  7. @luckystack/rag      embeddings + vector store, MCP-fronted; build only if 1-6 fall short
```

Each wave stands on its own: even if you stop after Wave 1 you have a complete, shareable improvement.
Nothing later reinvents earlier work — Waves 3 and 4 hang their tools off the Wave 2 MCP server.

---

## 2. Wave 1 — foundation (≈ 4.5 days)

All four are pure-Node ESM generators / markdown, shipped to consumers via the existing
`create-luckystack-app` framework-docs copy block, regenerated in the existing `.githooks/pre-commit`
pass. No new package, no peer-deps, no publish-wave change.

### Step 1 — Decision memory  (~2d)

**What ships**
- `docs/decisions/NNNN-slug.md` — one ADR per durable decision, git-committed. Frontmatter mirrors the
  personal-memory schema so migration is mechanical (`name, title, status, date, deciders, tags,
  supersedes, relates`). Body: Context / Decision / Rejected alternatives / Consequences.
- `docs/decisions/0000-template.md` seed.
- `scripts/generateDecisionsIndex.mjs` (reuses `generateProjectIndex.mjs` helpers verbatim) →
  `docs/AI_DECISIONS_INDEX.md` (deterministic, sorted, timestamp-free — clean diffs like the 3 indexes).
- `npm run ai:decisions` + a `.githooks/pre-commit` line (regen + git-add).
- `docs/DECISION_MEMORY_PROTOCOL.md` — spec, mirrors `BRANCH_LOG_PROTOCOL.md`. Capture is **automatic AI
  behavior** described as a CLAUDE.md protocol (NO slash command) — the AI writes a decision when one is
  made, reads the index when wondering "why", and offers to backfill an empty memory from history.
- Add `AI_DECISIONS_INDEX.md` to CLAUDE.md session-start step 6 + the "Decision Memory Protocol" section.

**Distinct from existing surfaces (must be spelled out in the protocol):**

| Surface | Granularity | Answers | Lifetime |
|---|---|---|---|
| `branch-logs/*.md` | per-prompt | *what happened* | per-branch, append-only |
| CLAUDE.md User Project Rules | always-on | *what I MUST always do* | until edited |
| `docs/decisions/` (new) | per durable decision | *why it is this way / why not Y* | until superseded |

**Verifiable goal (Rule 1a):** a decision file with valid frontmatter makes `npm run ai:decisions`
regenerate an index whose rows match the files on disk, deterministically (verified: 2nd run byte-identical).

### Step 2 — Empty-memory backfill (automatic offer, no command)

The AI offers — once, when it detects an empty decision memory on a project that already has history — to
seed `docs/decisions/` from the existing record. Made reusable for any project:
1. Reads the per-dev `~/.claude/.../memory/*.md` for the current project (optional source).
2. Classifies each entry: **team-truth** (architecture/policy — strict-typing, peer-dep-guard,
   packaging north-star, secret-manager fail-open …) vs **personal preference** (time-estimate style,
   inline-questions-in-plans …).
3. Walks the user through it (keep/skip per entry — never auto-import, Rule 27).
4. Writes team-truth as committed ADRs.
5. Stamps the synced local entry with a `synced_to: docs/decisions/NNNN` pointer so it is **in sync** and
   not re-proposed next run.

Because it's framework behavior (a CLAUDE.md protocol, not a command), the same offer fires on **existing
projects** that later install LuckyStack: an empty `docs/decisions/` + real history → the AI proposes a
backfill, the user approves, the shareable subset is written into the repo.

**Verifiable goal:** after a backfill, a later session finds a non-empty memory and does NOT re-offer;
promoted local entries are marked so they aren't proposed again.

### Step 3 — Runbooks  (~1d)

`scripts/generateRunbooks.mjs` → committed `docs/AI_RUNBOOKS.md`: 4-5 task-shaped walkthroughs
("to add an authenticated API: copy *this real route from AI_PROJECT_INDEX*, create these files, run
`scaffold:test`, verify with X"). Grounded in the project's actual routes (reads `AI_PROJECT_INDEX.md`
+ `apiDocs.generated.json` when present), regenerated in the same pre-commit pass. `npm run ai:runbooks`.

**Verifiable goal:** every file path a runbook tells the AI to copy actually exists in
`AI_PROJECT_INDEX.md` (generator asserts; no dangling examples).

### Step 4 — Invariant linter  (~1.5d)

`scripts/lintInvariants.mjs` over the **staged diff**, machine-checkable subset of the contract:

| Rule id | CLAUDE.md rule | Detection (pure-Node regex on added diff lines — matches the generator family) |
|---|---|---|
| `no-as-any` | 21 + strict-typing | `as any` / `as unknown as T` (also flagged distinctly on `apiRequest`/`syncRequest` lines per the unsafe-wrapper concern). eslint also catches it at `npm run lint`; this surfaces it at diff-time |
| `i18n-jsx` | 13 | JSX text nodes with human-readable text not going through `useTranslator` |
| `no-arbitrary-color` | 14 | arbitrary Tailwind color values / hardcoded hex in `className` |

> peer-dep-guard presence is documented as **review-only** in the linter output — not auto-checked (a
> reliable per-line check is too project-structure-specific; honest "no silent cap").

**Report-only by default.** Opt-in blocking via committed `luckystack.invariants.json` (`block`/`warn`
lists). Per-line `// luckystack-allow <rule>: <reason>` for conscious deviations. Wired as a pre-commit
stage; the AI also runs `npm run ai:lint` autonomously per Rule 11 — **no user-run command / skill**
(the `--paths` mode + `--selftest` exist for the AI / CI, not as a user workflow).

**Verifiable goal:** `npm run ai:lint -- --selftest` runs 10 committed fixture cases (as-any flagged,
clean line ok, suppression respected, JSX/color flagged, generated files skipped) — all pass.

---

## 3. Wave 2 — the MCP spine (≈ 1.5d, dep: `@modelcontextprotocol/sdk` only)

`@luckystack/mcp` — one **read-only** stdio MCP server the consumer's Claude Code auto-loads via a
shipped `.mcp.json` (extend create-luckystack-app's existing `.mcp.json` writer; gated behind the
existing `--ai-*` opt-in). It is the single tool surface every later capability plugs into, so it is
built **once** instead of re-invented by graph + RAG. Rung-1/2 only (structured retrieval, no embeddings
— does NOT cross the RAG line).

Initial tools (all over **already-committed** artifacts):
- `find_route(query)` → `apiDocs.generated.json`
- `get_capability(name)` → `AI_CAPABILITIES.md` slice
- `who_uses(export)` → `AI_PROJECT_INDEX.md` cross-refs
- `recent_decisions(tag?)` → `AI_DECISIONS_INDEX.md` + decision files
- `get_runbook(task)` → `AI_RUNBOOKS.md`

Cold-start: if a gitignored input (`apiDocs.generated.json`) is missing, degrade to the committed
`AI_PROJECT_INDEX.md` and trigger `generateArtifacts`.

**Rider (worth doing here):** a build-time assertion that the two hardcoded package lists
(`OPTIONAL_PACKAGES` in server vs `FEATURES` in cli) stay in sync — every new `@luckystack/*` package
(mcp, rag) compounds that drift.

**Verifiable goal:** an integration test starts the server and asserts each tool returns a non-empty,
schema-valid response for a known route/decision in the smoke-test app.

---

## 4. Wave 3 — native call-graph (≈ 5-6d, no new deps)

Inside `@luckystack/devkit` (dev-only, TS already a hard peer — compiler cost is sunk, prod bundle
untouched):
- `packages/devkit/src/callGraph/` — walks `CallExpression`/`NewExpression` on the existing
  `getServerProgram()` + `TypeChecker`, resolves each callee to its declaration, emits symbol-level
  edges. Computes centrality (god-nodes) + reverse-reachability (blast-radius) reusing
  `importDependencyGraph.ts`'s BFS.
- Deterministic committed `docs/ai-graph.json` (sorted, POSIX paths, no timestamps, `commit` SHA stamp).
  New `bin: luckystack-graph` + `npm run ai:graph` + pre-commit regen.
- Graph MCP tools added to the Wave 2 server: `get_callers`, `get_callees`, `blast_radius`,
  `god_nodes`, `shortest_path`. The `commit` stamp drives a `stale:true` warning when the working tree
  drifted, so the AI is told to re-run `ai:graph` instead of trusting an old graph.
- Docs: rewrite `GRAPHIFY_INTEGRATION.md` (native default; external Python demoted to "HTML-viz only")
  + `AI_BOOST_OVERVIEW.md` rung-2 (recorded as an ADR).
- Ship with an explicit edge-coverage statement (interface methods, the `functions.*` injection proxy,
  dynamic import are fuzzy) — same honesty as the Zod emitter's `z.any()` fallbacks.

**Complements, not duplicates, AI_PROJECT_INDEX:** the index is flat single-hop static-import; the graph
adds transitive reach, symbol-level call edges, centrality, blast-radius, and MCP query (no full-file
read).

**Verifiable goal:** on a fixture with `A→B→C`, `blast_radius(C)` returns `{A,B}` and `god_nodes()`
ranks the highest-degree node first (asserted); two runs produce byte-identical `ai-graph.json`.

---

## 5. Wave 4 — RAG (optional, the only third-party rung)

`@luckystack/rag` — embeddings + vector store over code/docs/decisions, fronted by the Wave 2 MCP
server. Build **only if**, after Waves 1-3 ship, grep + graph + decisions prove insufficient for
natural-language recall ("find everywhere we do refund-like things"). Decisions deferred to that point:
- Embedding provider: Voyage AI (free tier, but a `VOYAGE_API_KEY` secret + external call) **vs** a
  local model (no secret, hundreds of MB weights, slower). The "minimal third-party" constraint leans
  local; measure first.
- Shareable index: commit a content-hash **manifest + text chunks**, gitignore the binary vectors,
  rebuild vectors from the manifest on clone/CI (avoids bloating git, stays shareable).
- Reverses `AI_BOOST_OVERVIEW.md` line 125 → requires its own ADR before any code.

---

## 6. Decisions only you can make

1. **Invariant-linter default:** i18n + color-token checks WARN or BLOCK out of the box?
   (Recommend warn-by-default, project opts into block — else devs disable the hook.)
2. **Runbooks shape:** one `AI_RUNBOOKS.md` vs per-task files under `docs/runbooks/`?
   (Recommend single file now; split past ~5 paths.)
3. **MCP server:** forced-on or behind the existing `--ai-*` scaffold gate?
   (Recommend behind the gate — a new always-on tool surface + trust prompt shouldn't be imposed.)
4. **Graphify docs:** keep external Python documented for HTML-viz, or drop it entirely?
   (Recommend keep a short "optional, HTML-viz only" note.)
5. **RAG (Wave 4):** local model vs Voyage — decide only when/if we reach Wave 4.

---

## 7. Cross-cutting invariants (apply to every new artifact)

- Every generated file (`AI_DECISIONS_INDEX.md`, `AI_RUNBOOKS.md`, `ai-graph.json`) **must be sorted,
  timestamp-free, pre-commit-regenerated** — preserves the clean-diff invariant of the existing indexes.
- Every consumer-facing artifact ships via the create-luckystack-app framework-docs copy block, with the
  byte-for-byte `template/` duplicate kept in sync (same contract as `generateProjectIndex.mjs`).
- `docs/decisions/` + the new indexes are committed; resolve the `SESSION_STATE.md` ambiguity (give
  handoff a canonical committed home OR a `.gitignore` entry) as part of Step 1.
