# @luckystack/mcp

A read-only [MCP](https://modelcontextprotocol.io) server for querying a LuckyStack project's local AI context instead of loading entire indexes into an agent's context. The scaffolder configures it when AI instructions are selected. In an existing project, add `@luckystack/mcp` as a stdio command in your MCP client configuration; consult that client's current setup instructions.

Generated indexes and graphs are local caches. If a query reports a missing or stale artifact, run the corresponding project `ai:*` generator rather than trusting old answers. Historical decisions and lessons remain committed sources, not generated snapshots. Keep credentials and database connections in local configuration, never in a committed MCP configuration file.
