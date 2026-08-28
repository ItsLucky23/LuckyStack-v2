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
  if (cachedRoot !== null) return cachedRoot;
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
    //? Resolve symlinks via realpath so a symlink inside root that points outside
    //? is caught by the containment check (lexical path.relative alone misses it).
    const real = await fs.realpath(resolved);
    const realRel = path.relative(root, real);
    if (realRel === '' || realRel.startsWith('..') || path.isAbsolute(realRel)) return null;
    return await fs.readFile(real, 'utf8');
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Dependency graph (docs/ai-graph.json) — validated with zod, no casts.
// ---------------------------------------------------------------------------

const EdgeSchema = z.object({ from: z.string(), to: z.string() });

const GraphSchema = z.object({
  version: z.number(),
  nodes: z.array(z.object({ id: z.string(), kind: z.string(), route: z.string().nullable() })),
  edges: z.array(EdgeSchema),
  godNodes: z.array(z.object({ id: z.string(), kind: z.string(), dependents: z.number(), directDependents: z.number() })),
  //? Transitive closures. Graph version <= 2 STORED them; version >= 3 does not,
  //? because they are derivable from edges/callEdges in milliseconds and grew to
  //? 82% of the artifact on a real codebase. Optional here so both shapes load;
  //? `loadGraph` derives whatever is absent, so every caller sees them present.
  blastRadius: z.record(z.string(), z.array(z.string())).optional(),
  symbolBlastRadius: z.record(z.string(), z.array(z.string())).optional(),
  //? Symbol level (graph version >= 2). Optional so older import-only graphs still validate.
  symbols: z.array(z.object({ id: z.string(), file: z.string(), name: z.string(), kind: z.string() })).optional(),
  callEdges: z.array(EdgeSchema).optional(),
});

type StoredGraph = z.infer<typeof GraphSchema>;

//? What callers actually get: the stored graph with both closures guaranteed.
export type Graph = StoredGraph & {
  blastRadius: Record<string, string[]>;
  symbolBlastRadius: Record<string, string[]>;
};

//? Transitive reverse-reachability per node: `out[x]` = everything that
//? (transitively) depends on x. BFS per source with its own visited set, so a
//? dependency cycle yields the correct closure instead of a truncated one.
const reverseClosure = (edges: { from: string; to: string }[]): Record<string, string[]> => {
  const reverse = new Map<string, string[]>();
  for (const edge of edges) {
    const importers = reverse.get(edge.to);
    if (importers) importers.push(edge.from);
    else reverse.set(edge.to, [edge.from]);
  }
  const out: Record<string, string[]> = {};
  for (const id of reverse.keys()) {
    const seen = new Set<string>();
    const queue = [id];
    while (queue.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length>0 guarantees a value
      const current = queue.pop()!;
      for (const importer of reverse.get(current) ?? []) {
        if (importer === id || seen.has(importer)) continue;
        seen.add(importer);
        queue.push(importer);
      }
    }
    if (seen.size > 0) out[id] = [...seen].toSorted();
  }
  return out;
};

export const loadGraph = async (): Promise<Graph | null> => {
  const text = await readDocFile('docs/ai-graph.json');
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // corrupt / torn file — treat the same as missing so callers render the
    // friendly "generate with npm run ai:graph" message
    return null;
  }
  const parsed = GraphSchema.safeParse(raw);
  if (!parsed.success) return null;
  //? No referential-integrity check between closure keys and nodes[] ids: the
  //? generator guarantees consistency at emit time, and a stale/partial graph
  //? simply surfaces fewer results rather than throwing. Callers already handle
  //? empty arrays via `?? []`.
  return {
    ...parsed.data,
    blastRadius: parsed.data.blastRadius ?? reverseClosure(parsed.data.edges),
    symbolBlastRadius: parsed.data.symbolBlastRadius ?? reverseClosure(parsed.data.callEdges ?? []),
  };
};

//? Resolve a user-supplied path to a graph node id. Node ids are repo-relative
//? (`src/_functions/foo.ts`, `config.ts`) since graph version 3; a version-2
//? graph used src-relative ids, so a `src/`-less input is tried as a fallback
//? rather than stripped up front. Returns the unique id, `null` when nothing
//? matches, or a string[] with all matching candidates when a bare basename
//? matches more than one node (so the caller can surface a disambiguation
//? message instead of a bare null).
export const resolveNodeId = (graph: Graph, input: string): string | string[] | null => {
  const norm = input.replaceAll('\\', '/').replace(/^\.?\//, '');
  const has = (id: string): boolean => Object.hasOwn(graph.blastRadius, id) || graph.nodes.some((n) => n.id === id);
  if (has(norm)) return norm;
  //? Accept the other convention in both directions: a v2-style id against a v3
  //? graph, and a `src/`-prefixed path against a v2 graph.
  const prefixed = `src/${norm}`;
  if (has(prefixed)) return prefixed;
  const unprefixed = norm.replace(/^src\//, '');
  if (unprefixed !== norm && has(unprefixed)) return unprefixed;
  const base = path.posix.basename(norm);
  const byBase = graph.nodes.filter((n) => n.id.endsWith(`/${norm}`) || n.id === norm || path.posix.basename(n.id) === base);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length===1 guarantees element exists
  if (byBase.length === 1) return byBase[0]!.id;
  if (byBase.length > 1) return byBase.map((n) => n.id);
  return null;
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

//? Lines containing `needle` (case-insensitive), with a cap. Returns the
//? matching lines (up to `limit`) plus the total count so callers can signal
//? truncation to the agent.
export const grepLines = (text: string, needle: string, limit = 60): { lines: string[]; total: number } => {
  const low = needle.toLowerCase();
  const all = text.split(/\r?\n/).filter((l) => l.toLowerCase().includes(low));
  return { lines: all.slice(0, limit), total: all.length };
};
