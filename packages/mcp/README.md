# @luckystack/mcp

Read-only [MCP](https://modelcontextprotocol.io) server that exposes a LuckyStack project's committed AI
context to Claude Code as queryable tools — so an agent can ask precise questions instead of loading
whole index files into context.

## Install

Nothing to install in your app — it runs via `npx`. Add it to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "luckystack": { "type": "stdio", "command": "npx", "args": ["@luckystack/mcp@latest"] }
  }
}
```

`create-luckystack-app` adds this automatically when AI instructions are enabled. Claude Code launches the
server with your project root as the working directory.

## Tools

| Tool | Answers |
| --- | --- |
| `blast_radius(file)` | "What breaks if I change this file?" (transitive importers) |
| `who_imports(file)` | "What directly imports this?" |
| `who_calls(symbol)` | "What functions transitively call this one?" (call-graph blast-radius) |
| `god_nodes(limit?)` | "Which files are risky hubs everything depends on?" |
| `graph_status()` | "Is the dependency graph fresh or stale?" (mtime freshness check) |
| `list_decisions(tag?)` | "What did we decide, and about what?" |
| `get_decision(id)` | "Why did we decide X?" (full ADR) |
| `find_route(query)` | "Which API/sync routes match this?" |
| `get_runbook(task?)` | "How do I add an API/page/sync/helper here?" |
| `get_capability(name)` | "Does a helper/component for this already exist?" |

All tools are read-only and read committed artifacts (`docs/ai-graph.json`, `docs/decisions/`,
`docs/AI_*.md`). If an artifact is missing, the tool tells you which `npm run ai:*` command generates it.

It is independent of the `playwright` / `chrome-devtools` browser MCP servers — they coexist as separate
entries in the same `.mcp.json`.

## License

MIT
