# @luckystack/mcp

> AI summary + function INDEX. For deep specs see `docs/` next to this file (when present).

## What this package does

`@luckystack/mcp` is a read-only [MCP](https://modelcontextprotocol.io) server that exposes a LuckyStack project's **AI-context artifacts** to Claude Code as queryable tools. Instead of loading whole index files into context, an agent can ask precise questions: *"what's the blast radius of changing this file?"*, *"why did we decide X?"*, *"which routes touch auth?"*, *"does a helper for Y already exist?"*.

It reads files under the project root — `docs/ai-graph.json`, `docs/decisions/` + `docs/AI_DECISIONS_INDEX.md`, `docs/lessons/` + `docs/AI_LESSONS_INDEX.md`, `docs/examples/` + `docs/AI_EXAMPLES_INDEX.md`, `docs/AI_PROJECT_INDEX.md`, `docs/AI_RUNBOOKS.md`, `docs/AI_CAPABILITIES.md`. No writes, no network, no app dependency. Claude Code launches it over stdio via a `.mcp.json` entry (`npx @luckystack/mcp`) with the working directory set to the project root.

**The generated artifacts are a gitignored LOCAL CACHE** (ADR 0047), not repo content: `npm run ai:refresh` rebuilds them and `postinstall` builds any that are missing, so a fresh clone works. Only the SOURCES are committed — `docs/decisions/`, `docs/lessons/`, `docs/examples/`. Each tool reports how to regenerate its artifact when it is absent, so a cold project degrades gracefully rather than erroring.

It is **separate from** the `playwright` / `chrome-devtools` MCP servers (browser testing): those answer questions about the browser, this one answers questions about the repo. They coexist as distinct entries in the same `.mcp.json`.

## When to USE this package

- You want Claude Code to query repo structure/decisions/blast-radius as tools rather than reading large markdown files into context.
- A LuckyStack project has grown enough that "load the whole index" is wasteful.
- Adding the server to an existing project: add a `luckystack` entry to `.mcp.json` (see below) — no `npm i` required, it runs via `npx`.

## When to NOT suggest this (yet)

- Tiny projects where reading the generated indexes directly is already cheap.
- As a browser-automation tool — that's `@playwright/mcp` / `chrome-devtools-mcp`.
- For WRITING to the repo — this server is strictly read-only by design.

## `.mcp.json` entry

```json
{
  "mcpServers": {
    "luckystack": { "type": "stdio", "command": "npx", "args": ["@luckystack/mcp@latest"] }
  }
}
```

`create-luckystack-app` writes this automatically when AI instructions are enabled.

## Tool Index

| Tool | One-liner | Reads |
| --- | --- | --- |
| `blast_radius(file)` | Files affected by changing `file` (transitive reverse-deps) | `docs/ai-graph.json` |
| `who_imports(file)` | Direct importers of `file` (one hop) | `docs/ai-graph.json` |
| `god_nodes(limit?)` | Most-depended-upon files (risky-to-change hubs) | `docs/ai-graph.json` |
| `who_calls(symbol)` | Functions that transitively call a given function (call-graph blast-radius) | `docs/ai-graph.json` |
| `graph_status()` | Freshness check — compares graph artifact mtime to newest `src/` file; surfaces FRESH / STALE verdict | `docs/ai-graph.json` + filesystem |
| `list_decisions(tag?)` | Recorded ADRs (the committed "why"), optional tag filter | `docs/AI_DECISIONS_INDEX.md` |
| `get_decision(id)` | Full ADR by number or slug | `docs/decisions/NNNN-*.md` |
| `find_route(query)` | API/sync routes matching a query (method/auth/summary) | `docs/AI_PROJECT_INDEX.md` |
| `get_runbook(task?)` | Task-shaped golden path; omit task to list them | `docs/AI_RUNBOOKS.md` |
| `get_capability(name)` | Find existing helpers/components/exports by name | `docs/AI_CAPABILITIES.md` |
| `decision_for_file(file)` | Reverse lookup — which ADR governs a file (`//? @adr NNNN` tags) | `docs/AI_DECISIONS_INDEX.md` |
| `find_lesson(query?)` | Search recorded pitfalls ("what failed + how to avoid") | `docs/AI_LESSONS_INDEX.md` |
| `get_lesson(id)` | Full lesson by number or slug | `docs/lessons/NNNN-*.md` |
| `list_examples()` | List the curated canonical example corpus | `docs/AI_EXAMPLES_INDEX.md` |
| `get_example(pattern)` | Full reviewed reference implementation to copy | `docs/examples/*.md` |

Each tool returns a helpful "generate it with `npm run ai:*`" message when its artifact is absent, so a cold project degrades gracefully.

**Graph shape** (version 3, ADR 0046): node ids are **repo-relative** — `src/_functions/foo.ts`, `shared/tryCatch.ts`, `config.ts` — and the graph covers every first-party root, not just `src/`. `resolveNodeId` still resolves a version-2 (src-relative) id, so an older artifact keeps working. Version 3 does **not store** `blastRadius` / `symbolBlastRadius`; `loadGraph()` derives both from `edges` / `callEdges` at load (milliseconds), because as stored closures they reached 82% of the file on a real codebase.

**Staleness note**: `docs/ai-graph.json` intentionally contains NO embedded timestamp — every regeneration from the same source is byte-identical. Freshness is therefore signalled via filesystem mtime comparison (`graph_status`) rather than a `generatedAt` field. A STALE verdict is not something to report to the user: run `npm run ai:graph`. The `who_calls` tool needs a version ≥ 2 graph (symbol-level edges present).

## Config keys

None. The server reads files relative to the project root (resolved by walking up to the nearest `package.json`). No env vars, no `projectConfig` slots.

## Peer dependencies

- **Runtime deps**: `@modelcontextprotocol/sdk` (the official MCP SDK), `zod` (tool input schemas + graph validation). Both installed automatically when run via `npx`.
- **Optional**: none.

## Related

- The artifacts it serves are produced by `scripts/generateGraph.mjs` (ai:graph), `generateDecisionsIndex.mjs` (ai:decisions), `generateProjectIndex.mjs` (ai:project-index), `generateRunbooks.mjs` (ai:runbooks), `generateAiCapabilities.mjs` (ai:capabilities) — or all of them at once via `npm run ai:refresh`.
- Decision protocol: `docs/DECISION_MEMORY_PROTOCOL.md`. AI-tooling overview: `docs/AI_BOOST_OVERVIEW.md`.
- Call-graph design: `docs/decisions/0002-*` + `0004-*`.
