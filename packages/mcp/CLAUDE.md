# @luckystack/mcp

> AI summary + function INDEX. For deep specs see `docs/` next to this file (when present).

## What this package does

`@luckystack/mcp` is a read-only [MCP](https://modelcontextprotocol.io) server that exposes a LuckyStack project's **committed AI-context artifacts** to Claude Code as queryable tools. Instead of loading whole index files into context, an agent can ask precise questions: *"what's the blast radius of changing this file?"*, *"why did we decide X?"*, *"which routes touch auth?"*, *"does a helper for Y already exist?"*.

It reads only committed artifacts under the project root — `docs/ai-graph.json`, `docs/decisions/` + `docs/AI_DECISIONS_INDEX.md`, `docs/AI_PROJECT_INDEX.md`, `docs/AI_RUNBOOKS.md`, `docs/AI_CAPABILITIES.md`. No writes, no network, no app dependency. Claude Code launches it over stdio via a `.mcp.json` entry (`npx @luckystack/mcp`) with the working directory set to the project root.

It is **separate from** the `playwright` / `chrome-devtools` MCP servers (browser testing): those answer questions about the browser, this one answers questions about the repo. They coexist as distinct entries in the same `.mcp.json`.

## When to USE this package

- You want Claude Code to query repo structure/decisions/blast-radius as tools rather than reading large markdown files into context.
- A LuckyStack project has grown enough that "load the whole index" is wasteful.
- Adding the server to an existing project: add a `luckystack` entry to `.mcp.json` (see below) — no `npm i` required, it runs via `npx`.

## When to NOT suggest this (yet)

- Tiny projects where reading the committed indexes directly is already cheap.
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
| `list_decisions(tag?)` | Recorded ADRs (the committed "why"), optional tag filter | `docs/AI_DECISIONS_INDEX.md` |
| `get_decision(id)` | Full ADR by number or slug | `docs/decisions/NNNN-*.md` |
| `find_route(query)` | API/sync routes matching a query (method/auth/summary) | `docs/AI_PROJECT_INDEX.md` |
| `get_runbook(task?)` | Task-shaped golden path; omit task to list them | `docs/AI_RUNBOOKS.md` |
| `get_capability(name)` | Find existing helpers/components/exports by name | `docs/AI_CAPABILITIES.md` |

Each tool returns a helpful "generate it with `npm run ai:*`" message when its artifact is absent, so a cold project degrades gracefully.

## Config keys

None. The server reads committed files relative to the project root (resolved by walking up to the nearest `package.json`). No env vars, no `projectConfig` slots.

## Peer dependencies

- **Runtime deps**: `@modelcontextprotocol/sdk` (the official MCP SDK), `zod` (tool input schemas + graph validation). Both installed automatically when run via `npx`.
- **Optional**: none.

## Related

- The artifacts it serves are produced by `scripts/generateGraph.mjs` (ai:graph), `generateDecisionsIndex.mjs` (ai:decisions), `generateProjectIndex.mjs` (ai:project-index), `generateRunbooks.mjs` (ai:runbooks), `generateAiCapabilities.mjs` (ai:capabilities).
- Decision protocol: `docs/DECISION_MEMORY_PROTOCOL.md`. AI-tooling overview: `docs/AI_BOOST_OVERVIEW.md`. Roadmap: `docs/AI_BOOST_PLAN.md`.
- Call-graph design: `docs/decisions/0002-*` + `0004-*`.
