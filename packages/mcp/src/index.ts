//? @luckystack/mcp — a read-only MCP server that exposes a LuckyStack project's
//? committed AI-context artifacts (decisions, dependency graph, routes, runbooks,
//? capabilities) to Claude Code as queryable tools, so an agent can ask precise
//? questions ("what's the blast radius of changing X", "why did we decide Y")
//? instead of loading whole files into context.
//?
//? It reads only committed artifacts under the project root — no writes, no
//? network, no app dependency. Claude Code launches it via the .mcp.json entry
//? (`npx @luckystack/mcp`) with cwd = the project root.
//?
//? Distinct from the playwright / chrome-devtools MCP servers (browser testing):
//? this one answers questions about the repo, not the browser. They coexist as
//? separate entries in the same .mcp.json.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  projectRoot,
  readDocFile,
  loadGraph,
  resolveNodeId,
  sectionMatching,
  headings,
  grepLines,
} from './artifacts.js';

//? Standard MCP text result.
const text = (body: string): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: body }],
});

const missing = (artifact: string, regen: string): string =>
  `${artifact} not found in this project. It is a committed artifact — generate it with \`${regen}\` (the pre-commit hook also keeps it fresh).`;

const bulletList = (items: string[]): string => items.map((i) => `  - ${i}`).join('\n');

//? Read the server's own version from package.json (shipped alongside dist/index.js)
//? so it never drifts from the published version on a bump. Falls back to a literal
//? if the read/parse fails, preserving boot on a malformed own package.json.
const serverVersion = ((): string => {
  try {
    const pkg: unknown = createRequire(import.meta.url)('../package.json');
    if (pkg !== null && typeof pkg === 'object' && 'version' in pkg && typeof pkg.version === 'string' && pkg.version.length > 0) {
      return pkg.version;
    }
  } catch {
    //? fall through to the literal below
  }
  return '0.2.0';
})();

const server = new McpServer({ name: 'luckystack', version: serverVersion });

// ---------------------------------------------------------------------------
// Dependency-graph tools (docs/ai-graph.json)
// ---------------------------------------------------------------------------

server.registerTool(
  'blast_radius',
  {
    description: 'List the files that would be affected by changing a given source file (transitive reverse-dependency / change-impact), from the committed dependency graph. Pass a src-relative path like "_functions/foo.ts".',
    inputSchema: { file: z.string().min(1).describe('Source file, src-relative (e.g. "_functions/foo.ts") or with a src/ prefix.') },
  },
  async ({ file }) => {
    const graph = await loadGraph();
    if (!graph) return text(missing('docs/ai-graph.json', 'npm run ai:graph'));
    const id = resolveNodeId(graph, file);
    if (!id) return text(`No graph node matches "${file}". Use a src-relative path (e.g. "_functions/foo.ts"). Run \`npm run ai:graph\` if the file is new.`);
    const affected = graph.blastRadius[id] ?? [];
    if (affected.length === 0) return text(`Nothing imports \`${id}\` (transitively). Changing it has no in-project blast radius.`);
    return text(`Changing \`${id}\` can affect ${affected.length} file(s) (transitive importers):\n${bulletList(affected)}`);
  },
);

server.registerTool(
  'who_imports',
  {
    description: 'List the DIRECT importers of a given source file (one hop), from the committed dependency graph.',
    inputSchema: { file: z.string().min(1).describe('Source file, src-relative or with a src/ prefix.') },
  },
  async ({ file }) => {
    const graph = await loadGraph();
    if (!graph) return text(missing('docs/ai-graph.json', 'npm run ai:graph'));
    const id = resolveNodeId(graph, file);
    if (!id) return text(`No graph node matches "${file}".`);
    const importers = graph.edges.filter((e) => e.to === id).map((e) => e.from).toSorted();
    if (importers.length === 0) return text(`Nothing directly imports \`${id}\`.`);
    return text(`${importers.length} file(s) directly import \`${id}\`:\n${bulletList(importers)}`);
  },
);

server.registerTool(
  'god_nodes',
  {
    description: 'List the most-depended-upon files (highest transitive-dependent count) — the risky-to-change hubs — from the committed dependency graph.',
    inputSchema: { limit: z.number().int().min(1).max(100).optional().describe('How many to return (default 15).') },
  },
  async ({ limit }) => {
    const graph = await loadGraph();
    if (!graph) return text(missing('docs/ai-graph.json', 'npm run ai:graph'));
    const requested = limit ?? 15;
    const top = graph.godNodes.slice(0, requested);
    if (top.length === 0) return text('No god-nodes — nothing has in-project dependents yet.');
    //? The generator caps the stored god-node list (GOD_NODE_LIMIT); if the
    //? caller asked for more than the artifact holds, say so rather than imply
    //? these are the only hubs that exist.
    const capNote = requested > graph.godNodes.length ? `\n\n(Only ${graph.godNodes.length} god-node(s) are stored in the graph; the artifact caps this list. Asking for more returns all of them.)` : '';
    return text(`Most-depended-upon files:\n${bulletList(top.map((n) => `${n.id} (${n.kind}) — ${n.dependents} transitive, ${n.directDependents} direct`))}${capNote}`);
  },
);

server.registerTool(
  'who_calls',
  {
    description: 'Symbol-level change-impact: list the functions that (transitively) CALL a given function, from the committed call graph. Pass "file::fn" (e.g. "_functions/foo.ts::doThing") or just a function name to disambiguate.',
    inputSchema: { symbol: z.string().min(1).describe('A symbol id "file::fn", or a bare function name.') },
  },
  async ({ symbol }) => {
    const graph = await loadGraph();
    if (!graph) return text(missing('docs/ai-graph.json', 'npm run ai:graph'));
    const sbr = graph.symbolBlastRadius ?? {};
    const symbols = graph.symbols ?? [];
    let id: string | null = Object.hasOwn(sbr, symbol) || symbols.some((s) => s.id === symbol) ? symbol : null;
    if (!id) {
      const matches = symbols.filter((s) => s.name === symbol || s.id.endsWith(`::${symbol}`));
      if (matches.length > 1) return text(`"${symbol}" is ambiguous — pick one:\n${bulletList(matches.map((m) => m.id))}`);
      id = matches[0]?.id ?? null;
    }
    if (!id) return text(`No symbol matches "${symbol}". Symbol-level edges exist only where the graph is version >= 2; run \`npm run ai:graph\`.`);
    const callers = Object.hasOwn(sbr, id) ? sbr[id] ?? [] : [];
    if (callers.length === 0) return text(`Nothing calls \`${id}\` (transitively, within the project).`);
    return text(`Changing \`${id}\` can affect ${callers.length} function(s) that transitively call it:\n${bulletList(callers)}`);
  },
);

// ---------------------------------------------------------------------------
// Decision-memory tools (docs/decisions/ + docs/AI_DECISIONS_INDEX.md)
// ---------------------------------------------------------------------------

server.registerTool(
  'list_decisions',
  {
    description: 'List the project\'s recorded decisions (ADRs) — the committed "why" record. Optionally filter by a tag substring.',
    inputSchema: { tag: z.string().optional().describe('Filter to decisions whose row mentions this tag/keyword.') },
  },
  async ({ tag }) => {
    const index = await readDocFile('docs/AI_DECISIONS_INDEX.md');
    if (index === null) return text(missing('docs/AI_DECISIONS_INDEX.md', 'npm run ai:decisions'));
    if (!tag) return text(index);
    const rows = grepLines(index, tag).filter((l) => l.trim().startsWith('|'));
    return text(rows.length > 0 ? `Decisions matching "${tag}":\n${rows.join('\n')}` : `No decisions match "${tag}".`);
  },
);

server.registerTool(
  'get_decision',
  {
    description: 'Read a full decision record (Context / Decision / Rejected alternatives / Consequences) by ADR number or slug.',
    inputSchema: { id: z.string().min(1).describe('ADR number ("2" or "0002") or slug ("native-callgraph...").') },
  },
  async ({ id }) => {
    const root = await projectRoot();
    const dir = path.join(root, 'docs', 'decisions');
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return text(missing('docs/decisions/', 'the AI records decisions automatically; see docs/DECISION_MEMORY_PROTOCOL.md'));
    }
    const padded = /^\d+$/.test(id) ? id.padStart(4, '0') : null;
    const match = entries.find((f) => {
      if (!f.endsWith('.md') || f === '0000-template.md') return false;
      //? Numeric ids match ONLY the zero-padded prefix (so "2" -> 0002-*, never
      //? every ADR whose number/slug merely contains "2"). Slug ids fall back to
      //? a substring match.
      if (padded !== null) return f.startsWith(`${padded}-`);
      return f.includes(id);
    });
    if (!match) return text(`No decision matches "${id}". Use \`list_decisions\` to see them.`);
    const body = await readDocFile(`docs/decisions/${match}`);
    return text(body ?? `Could not read docs/decisions/${match}.`);
  },
);

// ---------------------------------------------------------------------------
// Route / runbook / capability lookups (committed indexes)
// ---------------------------------------------------------------------------

server.registerTool(
  'find_route',
  {
    description: 'Find API/sync routes matching a query, from the committed project index (method, auth, summary).',
    inputSchema: { query: z.string().min(1).describe('Route name / page / keyword to match.') },
  },
  async ({ query }) => {
    const index = await readDocFile('docs/AI_PROJECT_INDEX.md');
    if (index === null) return text(missing('docs/AI_PROJECT_INDEX.md', 'npm run ai:project-index'));
    const rows = grepLines(index, query).filter((l) => l.trim().startsWith('|') && (l.includes('`api/') || l.includes('`sync/')));
    return text(rows.length > 0 ? `Routes matching "${query}":\n${rows.join('\n')}` : `No routes match "${query}".`);
  },
);

server.registerTool(
  'get_runbook',
  {
    description: 'Get a task-shaped golden-path runbook for THIS project (how to add an API/page/sync/helper, verify, record a decision). Omit task to list available runbooks.',
    inputSchema: { task: z.string().optional().describe('Task keyword, e.g. "API", "page", "sync", "verify".') },
  },
  async ({ task }) => {
    const doc = await readDocFile('docs/AI_RUNBOOKS.md');
    if (doc === null) return text(missing('docs/AI_RUNBOOKS.md', 'npm run ai:runbooks'));
    if (!task) return text(`Available runbooks:\n${bulletList(headings(doc))}`);
    const section = sectionMatching(doc, task);
    return text(section ?? `No runbook matches "${task}". Available:\n${bulletList(headings(doc))}`);
  },
);

server.registerTool(
  'get_capability',
  {
    description: 'Look up existing helpers/components/exports by name in the committed capability snapshot — check BEFORE authoring a new helper (Rule 12).',
    inputSchema: { name: z.string().min(1).describe('Helper / component / export name to search for.') },
  },
  async ({ name }) => {
    const doc = await readDocFile('docs/AI_CAPABILITIES.md');
    if (doc === null) return text(missing('docs/AI_CAPABILITIES.md', 'npm run ai:capabilities'));
    const hits = grepLines(doc, name);
    return text(hits.length > 0 ? `"${name}" found in capabilities:\n${hits.join('\n')}` : `"${name}" not found in docs/AI_CAPABILITIES.md — it may not exist yet.`);
  },
);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  //? stderr is safe for diagnostics (stdout is the MCP protocol channel).
  console.error(`[luckystack-mcp] ready (root: ${await projectRoot()})`);
};

main().catch((error: unknown) => {
  console.error('[luckystack-mcp] fatal:', error);
  process.exitCode = 1;
});
