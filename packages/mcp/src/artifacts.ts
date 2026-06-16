//? Readers for a LuckyStack project's committed AI-context artifacts. The MCP
//? server runs with cwd = the consumer project root (Claude Code launches it
//? there); we still walk up to the nearest package.json so it works if launched
//? from a subdirectory. Everything here is read-only.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

//? Walk up from cwd to the nearest directory containing package.json; fall back
//? to cwd. Cached for the process lifetime.
let cachedRoot: string | null = null;
export const projectRoot = async (): Promise<string> => {
  if (cachedRoot) return cachedRoot;
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    try {
      await fs.access(path.join(dir, 'package.json'));
      cachedRoot = dir;
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  cachedRoot = process.cwd();
  return cachedRoot;
};

export const readDocFile = async (relPath: string): Promise<string | null> => {
  const root = await projectRoot();
  //? Defensive containment: every real caller passes a hardcoded relative path
  //? (or a real `fs.readdir` entry), so all legitimate reads resolve INSIDE root
  //? and behave exactly as before. This only rejects a null byte or a path that
  //? would escape the project root — returning the same `null` any read failure
  //? already yields — so a future caller can't be coaxed into traversal.
  if (relPath.includes('\0')) return null;
  const resolved = path.resolve(root, relPath);
  const rel = path.relative(root, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  try {
    return await fs.readFile(resolved, 'utf8');
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Dependency graph (docs/ai-graph.json) — validated with zod, no casts.
// ---------------------------------------------------------------------------

const GraphSchema = z.object({
  version: z.number(),
  nodes: z.array(z.object({ id: z.string(), kind: z.string(), route: z.string().nullable() })),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
  blastRadius: z.record(z.string(), z.array(z.string())),
  godNodes: z.array(z.object({ id: z.string(), kind: z.string(), dependents: z.number(), directDependents: z.number() })),
  //? Symbol level (graph version >= 2). Optional so older import-only graphs still validate.
  symbols: z.array(z.object({ id: z.string(), file: z.string(), name: z.string(), kind: z.string() })).optional(),
  callEdges: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  symbolBlastRadius: z.record(z.string(), z.array(z.string())).optional(),
});

export type Graph = z.infer<typeof GraphSchema>;

export const loadGraph = async (): Promise<Graph | null> => {
  const text = await readDocFile('docs/ai-graph.json');
  if (text === null) return null;
  const parsed = GraphSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
};

//? Resolve a user-supplied path to a graph node id. Accepts a src-relative id
//? (`_functions/foo.ts`), a `src/`-prefixed path, or a bare basename match.
export const resolveNodeId = (graph: Graph, input: string): string | null => {
  const norm = input.replaceAll('\\', '/').replace(/^\.?\//, '').replace(/^src\//, '');
  if (Object.hasOwn(graph.blastRadius, norm) || graph.nodes.some((n) => n.id === norm)) return norm;
  const base = path.posix.basename(norm);
  const byBase = graph.nodes.filter((n) => n.id.endsWith(`/${norm}`) || n.id === norm || path.posix.basename(n.id) === base);
  const sole = byBase.length === 1 ? byBase[0] : undefined;
  return sole ? sole.id : null;
};

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

//? Return the `## <heading>` section whose title contains `needle` (case-insensitive),
//? including the heading line, up to the next `## ` or EOF.
export const sectionMatching = (markdown: string, needle: string): string | null => {
  const lines = markdown.split(/\r?\n/);
  const low = needle.toLowerCase();
  const start = lines.findIndex((l) => /^##\s+/.test(l) && l.toLowerCase().includes(low));
  if (start === -1) return null;
  const after = lines.slice(start + 1).findIndex((l) => /^##\s+/.test(l));
  const end = after === -1 ? lines.length : start + 1 + after;
  return lines.slice(start, end).join('\n').trim();
};

export const headings = (markdown: string): string[] =>
  markdown.split(/\r?\n/).filter((l) => /^##\s+/.test(l)).map((l) => l.replace(/^##\s+/, '').trim());

//? Lines containing `needle` (case-insensitive), with a cap.
export const grepLines = (text: string, needle: string, limit = 60): string[] => {
  const low = needle.toLowerCase();
  return text.split(/\r?\n/).filter((l) => l.toLowerCase().includes(low)).slice(0, limit);
};
