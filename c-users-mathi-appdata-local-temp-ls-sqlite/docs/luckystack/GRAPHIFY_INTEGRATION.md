# Graphify Integration (optional)

> Opt-in upgrade path beyond the native consumer-project indexer. Graphify is **not** part of LuckyStack — this guide explains how to add it to a LuckyStack consumer project and how to avoid the staleness pitfalls.

> **First check `docs/AI_PROJECT_INDEX.md`** — the native consumer-project indexer that ships with LuckyStack. It runs via `npm run ai:project-index` (free, no dependencies, TS-native) and covers the AI-needs-to-understand-my-project use case for most teams. Graphify is the **upgrade path** when you also want full call-graph traversal, community detection ("god nodes"), interactive HTML visualization, or MCP-server query mode.

## What graphify adds beyond `AI_PROJECT_INDEX.md`

| Capability | `AI_PROJECT_INDEX.md` (native) | graphify (opt-in) |
|---|---|---|
| Route inventory (API, sync, pages) | ✅ | ✅ |
| Helper / component inventory | ✅ | ✅ |
| Import-based cross-references (per-export usage count) | ✅ | ✅ |
| `@docs owner / tags / deprecated` JSDoc surfacing | ✅ | ❌ (not framework-aware) |
| Unused-export detection | ✅ | ✅ |
| Full call-graph (who calls fooBar transitively?) | ❌ | ✅ |
| Community detection / "god nodes" | ❌ | ✅ |
| Interactive HTML visualization | ❌ | ✅ |
| MCP server mode (`query_graph`, `get_neighbors`, `shortest_path`) | ❌ | ✅ |
| Cost | Free, ~500ms per regen | Free for code (tree-sitter), paid for docs/PDFs/images |
| Dependency | Node (already present) | Python via uv/pipx |
| Update cadence | On `npm run ai:project-index` or pre-commit | On `graphify hook install` post-commit |

**Net**: most LuckyStack projects (< ~50 routes, small/mid team) don't need graphify — the native indexer covers what AI agents ask about. Graphify earns its keep on sprawling codebases where AI agents repeatedly ask "what depends on this?" / "what's the architectural shape?" — questions a markdown inventory can't answer in one read.

This guide is for **consumer projects** (apps built with `create-luckystack-app`) that have decided the upgrade is worth it. The framework itself ships its own indexes (`docs/AI_QUICK_INDEX.md` + `docs/AI_CAPABILITIES.md` + per-package `CLAUDE.md`) for the framework surface, and `docs/AI_PROJECT_INDEX.md` for the consumer's own code. Graphify layers on top of that.

---

## What graphify is

[Graphify](https://github.com/safishamsi/graphify) is a Python CLI that produces a queryable knowledge graph of a codebase. It writes three files into `graphify-out/`:

- `graph.json` — the queryable graph itself (nodes = symbols/files/concepts; edges = imports/calls/references).
- `graph.html` — interactive browser visualization.
- `GRAPH_REPORT.md` — narrative summary with "god nodes" (highly-connected concepts) and suggested AI queries.

Code extraction runs **locally** via tree-sitter AST parsing — no API calls, no cost. Only docs/PDFs/images optionally go to an LLM backend (Claude / Gemini / OpenAI / Ollama) for semantic extraction.

The whole `graphify-out/` directory is meant to be **committed to git**. That is graphify's team-sharing model: a `git pull` is the synchronization mechanism. There is no server, no daemon, no shared state to broker.

---

## When to add graphify

Reach for it when:

- Your app has grown past ~50 routes / helpers and AI assistants struggle to hold the whole call-graph in context.
- You want a shared "map" of the codebase that lands with every `git pull` so the whole team's AI agents see the same view.
- You want community detection ("which files are god-nodes that everything touches?"), interactive HTML visualization, or MCP-server-backed graph queries — features beyond what LuckyStack's auto-generated indexes provide.

Skip it if:

- Your project is small and `docs/AI_QUICK_INDEX.md` + per-package `CLAUDE.md` already give your AI agents enough context.
- You can't accept a Python tool in your dev workflow (graphify is Python-only).
- You don't want `graphify-out/` (typically 1-10 MB) in git history.

---

## Install

Use either `uv` or `pipx`. Both install graphify as an isolated tool without polluting your project's Python environment:

```bash
# Option 1 (recommended): uv
uv tool install graphifyy

# Option 2: pipx
pipx install graphifyy
```

Verify:

```bash
graphify --version
```

If you don't have `uv` or `pipx`, install one of them first ([uv install](https://docs.astral.sh/uv/getting-started/installation/) / [pipx install](https://pipx.pypa.io/stable/installation/)). Plain `pip install graphifyy` works too but pollutes the system Python.

Document the Python prerequisite in your project's onboarding doc / README so new developers don't get blocked.

---

## First run

From the repository root:

```bash
graphify extract . --backend claude
```

`--backend claude` uses your existing `ANTHROPIC_API_KEY` for the docs/PDFs/images extraction step. Substitute `openai`, `gemini`, or `ollama` (local inference) if you prefer. Code extraction is always local — the backend only kicks in for non-code artifacts.

After the run:

```bash
ls graphify-out/
# graph.html  graph.json  GRAPH_REPORT.md  manifest.json  cost.json
```

Open `graph.html` in a browser to verify the graph rendered.

---

## Recommended `.gitignore`

Commit the artifacts your team uses; ignore the metadata files:

```gitignore
# graphify — commit graph.json + GRAPH_REPORT.md + graph.html
graphify-out/manifest.json
graphify-out/cost.json
```

`manifest.json` and `cost.json` are local bookkeeping (per-developer state, API spend ledger) and produce merge conflicts if committed.

---

## Auto-resync on every commit

Graphify ships a post-commit hook that re-runs AST-only extraction after each commit. AST-only means **zero API cost** per commit:

```bash
graphify hook install
```

This installs `.git/hooks/post-commit` (or merges into an existing one). After every `git commit`, the hook runs `graphify extract --update` and stages the refreshed `graphify-out/graph.json` for the next commit. Within ~2 commits the graph is in sync with the branch's committed state.

Uninstall with `graphify hook uninstall` if you need to revert.

---

## Branch-switching staleness — three-layer mitigation

Graphify has **no native git-branch awareness**. If you generate a graph on `branch-X` (with `fooBar()` added) and switch to `branch-Y` (where `fooBar()` doesn't exist), an AI agent reading `graphify-out/graph.json` will still claim `fooBar()` exists. This is the most important caveat to understand.

Three layers of mitigation, in order of effectiveness:

### Layer 1 — commit `graphify-out/` per branch (default model)

`graphify hook install` (previous section) refreshes `graph.json` on every commit. Combined with committing `graphify-out/graph.json` alongside code, each branch has its own up-to-date graph in its own tree. `git checkout branch-Y` then swaps the graph automatically — no manual step.

**Catch**: this only solves the **committed** state. Your uncommitted working tree (mid-feature, unstaged) can still drift from the last-committed graph. Layer 2 handles that.

### Layer 2 — refresh on `git checkout` (the user's main concern)

Add a `post-checkout` git hook that re-runs `graphify extract --update` after every checkout. AST-only extraction is fast (seconds for a medium project) and free.

Using [Husky](https://typicode.github.io/husky/) (already common in TS projects):

```sh
# .husky/post-checkout
#!/bin/sh
# AST-only refresh after branch / commit checkout. Silent on failure so
# checkouts in repos without graphify installed still succeed.
graphify extract . --update 2>/dev/null || true
```

Or plain `.git/hooks/post-checkout`:

```sh
#!/bin/sh
graphify extract . --update 2>/dev/null || true
```

Make it executable: `chmod +x .git/hooks/post-checkout`.

After this hook is in place, the sequence `git checkout branch-Y` -> graph reflects branch-Y's working state immediately, with no manual `graphify extract` step.

### Layer 3 — SHA-stamp the graph (advanced, for paranoid teams)

Even with Layer 2, there is a small window between "you edit a file" and "you commit / checkout something" where the on-disk `graph.json` is older than your working tree. If that matters to you, stamp the graph with the commit SHA it was generated from, so AI tooling can compare and warn.

Add `scripts/stampGraphify.mjs` to your project:

```javascript
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

execSync('graphify extract . --update', { stdio: 'inherit' });
const graph = JSON.parse(readFileSync('graphify-out/graph.json', 'utf8'));
graph.commit = execSync('git rev-parse HEAD').toString().trim();
graph.stampedAt = new Date().toISOString();
writeFileSync('graphify-out/graph.json', JSON.stringify(graph, null, 2));
console.log(`graphify-out/graph.json stamped with commit ${graph.commit}`);
```

Wire it as `npm run graphify:refresh`. Now AI tooling can read `graph.commit`, compare to `git rev-parse HEAD`, and explicitly mention divergence ("the graph is at commit `abc123`; you have uncommitted changes — run `npm run graphify:refresh`").

For Claude Code specifically, you can add the comparison to a project hook in `.claude/settings.json`.

---

## MCP server mode (Claude Code / Cursor)

For repeated structured queries (instead of having the AI read the whole `graph.json`), run graphify in MCP server mode:

```bash
python -m graphify.serve graphify-out/graph.json
```

Wire into Claude Code via `.claude/mcp_servers.json`:

```json
{
  "mcpServers": {
    "graphify": {
      "command": "python",
      "args": ["-m", "graphify.serve", "graphify-out/graph.json"]
    }
  }
}
```

The AI now has access to `query_graph`, `get_node`, `get_neighbors`, and `shortest_path` tools without consuming context on the full JSON.

---

## How graphify relates to LuckyStack's own indexes

These are complementary — not competing.

| Tool | Scope | Cost | Format |
|---|---|---|---|
| `docs/AI_QUICK_INDEX.md` (LuckyStack, ships with framework) | `@luckystack/*` package surfaces + repo docs | Free | Markdown tables |
| `docs/AI_CAPABILITIES.md` (LuckyStack, ships with framework) | Installed `@luckystack/*` packages + `functions/` shims | Free | Markdown tables |
| Per-package `node_modules/@luckystack/*/CLAUDE.md` | Function index per framework package | Free | Markdown |
| `graphify-out/graph.json` (graphify, opt-in) | **Your** app code — `src/`, `server/`, custom helpers | Free for code, paid for docs/PDFs/images | JSON + interactive HTML |

LuckyStack's auto-generated indexes stay authoritative for **framework** surfaces (so AI agents don't waste context re-discovering them). Graphify covers the **consumer-project** surface that the framework knows nothing about. If you only use the framework indexes, AI agents understand the framework but not your business logic; if you only use graphify, vice versa. Most teams want both.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `graphify: command not found` | Python tool dir not on `PATH` | Run `uv tool update-shell` or `pipx ensurepath`; restart your shell. |
| `ANTHROPIC_API_KEY not set` (or equivalent) | Backend selected but no API key in env | Export the key or pick `--backend ollama` for local inference. |
| `graphify-out/` is many MB and bloats git | Repo size growing past comfort | Use Git LFS for `graphify-out/*`, or run with `--no-html` to skip the HTML viz, or move the team to MCP-server mode (regenerate locally, don't commit). |
| AI mentions symbols that don't exist | Stale graph after branch switch / heavy edits | Run `graphify extract . --update` (or install the Layer 2 / Layer 3 hooks). |
| Hook conflict on `.git/hooks/post-commit` | Existing hook clobbered by `graphify hook install` | Graphify merges into existing hooks; if it didn't, inspect the file and add the graphify command manually below the existing logic. |
| Merge conflicts in `graphify-out/graph.json` on PRs | Two branches both edited the graph | Accept either side, then re-run `graphify extract . --update` to regenerate. Graphify ships a merge driver — see upstream README. |

---

## Related

- Upstream project: [github.com/safishamsi/graphify](https://github.com/safishamsi/graphify)
- LuckyStack's own indexes: [`docs/AI_QUICK_INDEX.md`](./AI_QUICK_INDEX.md), [`docs/AI_CAPABILITIES.md`](./AI_CAPABILITIES.md)
- Framework AI contract (root): [`CLAUDE.md`](../CLAUDE.md)
- Deployment guide (where Git LFS recommendations apply): [`docs/HOSTING.md`](./HOSTING.md)
