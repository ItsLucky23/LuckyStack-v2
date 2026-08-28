// scripts/generateGraph.mjs
//
// Regenerates docs/ai-graph.json — the project's dependency graph, so an AI can
// answer the structural questions a flat index can't: "what (transitively)
// depends on this file?", "what is the blast radius of changing it?", "which
// files are god-nodes everything leans on?".
//
// Two layers:
//   1. FILE/IMPORT level — nodes are source files (classified api/sync/page/
//      helper/component/server/shared/config/other), edges are resolved
//      `import` relations. Regex-based, fast, no compiler.
//   2. SYMBOL level — function-to-function `callEdges` resolved with the
//      TypeScript TypeChecker (`symbols`, `callEdges`), so "what calls THIS
//      function / what breaks if I change it" is answered per function, not
//      just per file. Uses the `typescript` package directly (a consumer
//      devDependency); the program is built from the SCANNED files so the
//      symbol layer covers exactly the same scope as the import layer.
//
// SCOPE: every project root that holds first-party code (src/, server/,
// shared/, functions/, luckystack/) plus the root-level config files. Node ids
// are REPO-relative (`src/foo.ts`, `config.ts`) — graph version 3. Scoping to
// src/ alone made `config.ts` and `shared/` look like files nothing depends on,
// which is worse than absent: a reassuring blind spot exactly where a change is
// most expensive.
//
// NOT emitted: `blastRadius` / `symbolBlastRadius`. Both are transitive closures
// derivable from `edges` / `callEdges` in milliseconds at load time, and they
// grow superlinearly — on a real codebase they were 82% of the file. The MCP
// server derives them in `loadGraph()`; graphs at version <= 2 that still carry
// them keep working.
//
// Edge-coverage honesty (like the Zod emitter's z.any() fallbacks): calls
// routed through the `functions.*` injection proxy resolve to the GENERATED
// type file and are intentionally skipped; dynamic `import()`, calls via
// interface/abstract types, and deeply-aliased re-exports may be missed. Calls
// outside any named scope attribute to a per-file `<module>` caller. The symbol
// pass degrades gracefully to import-level only if the program can't be built,
// or is skipped above SYMBOL_FILE_CAP IN-PROJECT files (declaration files from
// node_modules are NOT counted — counting them made the pass skip itself on
// every non-trivial project, silently). Spec: docs/decisions/0002 + 0004 + 0006.
//
// Deterministic: sorted keys, POSIX paths, NO timestamps and NO commit SHA.
// The artifact is a local cache (gitignored), rebuilt by `npm run ai:refresh`
// and by `postinstall`.
//
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// generateGraph.mjs (byte-for-byte duplicate ships to consumers).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_FILE = path.join(REPO_ROOT, "docs", "ai-graph.json");

//? First-party roots, in the order they appear in a node id. A root that does
//? not exist in this project is skipped, so the same list serves the framework
//? repo and every scaffold variant.
const GRAPH_ROOT_DIRS = ["src", "server", "shared", "functions", "luckystack"];
//? Root-level single files that are real graph nodes (config.ts is routinely
//? the heaviest node in a project).
const GRAPH_ROOT_FILES = ["config.ts", "config.ports.ts", "deploy.config.ts", "services.config.ts"];

const GOD_NODE_LIMIT = 25; // top-N most-depended-upon files surfaced explicitly
const SYMBOL_FILE_CAP = 2500; // skip the TS-compiler pass above this many IN-PROJECT files

const safe = async (promise) => {
  try { return [null, await promise]; } catch (error) { return [error, null]; }
};
const safeSync = (fn) => {
  try { return [null, fn()]; } catch (error) { return [error, null]; }
};

const toPosix = (p) => p.replaceAll("\\", "/");
const relFromRepo = (abs) => toPosix(path.relative(REPO_ROOT, abs));

const walkFiles = async (rootDir, predicate) => {
  const out = [];
  const [statErr, stat] = await safe(fs.stat(rootDir));
  if (statErr || !stat.isDirectory()) return out;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const [readErr, entries] = await safe(fs.readdir(current, { withFileTypes: true }));
    if (readErr) continue;
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile() && predicate(entry.name, abs)) out.push(abs);
    }
  }
  return out.sort();
};

const readTextFile = async (absPath) => {
  const [err, content] = await safe(fs.readFile(absPath, "utf8"));
  return err ? null : content;
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const SOURCE_RE = /\.(ts|tsx)$/;
const isSource = (name) => SOURCE_RE.test(name) && !name.endsWith(".d.ts") && !name.endsWith(".generated.ts");

//? `id` is repo-relative (`src/login/_api/x_v1.ts`, `shared/tryCatch.ts`).
const classify = (id, name) => {
  if (/(^|\/)_api\/[A-Za-z0-9_-]+_v\d+\.ts$/.test(id)) return "api";
  if (/(^|\/)_sync\/[A-Za-z0-9_-]+_(server|client)_v\d+\.ts$/.test(id)) return "sync";
  if (name === "page.tsx") return "page";
  if (id.startsWith("src/_functions/")) return "helper";
  if (id.startsWith("src/_components/")) return "component";
  if (id.startsWith("server/")) return "server";
  if (id.startsWith("shared/")) return "shared";
  if (id.startsWith("functions/")) return "helper";
  if (id.startsWith("luckystack/")) return "framework";
  if (!id.includes("/")) return "config";
  return "other";
};

//? Route strings stay src-relative — they are the runtime route, not a path.
//? The page segment is OPTIONAL: `src/_api/session_v1.ts` is a real root route
//? that the scaffold itself ships, and requiring a segment silently dropped it.
const routeOf = (id) => {
  if (!id.startsWith("src/")) return null;
  const relSrc = id.slice("src/".length);
  const a = relSrc.match(/^(?:(.*)\/)?_api\/([A-Za-z0-9_-]+)_v(\d+)\.ts$/);
  if (a) return `api/${a[1] ? `${a[1]}/` : ""}${a[2]}/v${a[3]}`;
  const s = relSrc.match(/^(?:(.*)\/)?_sync\/([A-Za-z0-9_-]+)_(server|client)_v(\d+)\.ts$/);
  if (s) return `sync/${s[1] ? `${s[1]}/` : ""}${s[2]}/v${s[4]}`;
  return null;
};

// ---------------------------------------------------------------------------
// Import extraction + resolution (mirrors generateProjectIndex.mjs)
// ---------------------------------------------------------------------------

const extractImportSources = (src) => {
  const out = new Set();
  const re = /(?:import|export)\s+(?:type\s+)?(?:[^'"\n]*?\s+from\s+)?['"]([^'"\n]+)['"]/g;
  const dyn = /import\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  while ((m = dyn.exec(src)) !== null) out.add(m[1]);
  return [...out];
};

//? The tsconfig path aliases that point at a first-party root. They are already
//? repo-relative, so an aliased specifier IS the node id modulo extension.
const ALIAS_ROOTS = GRAPH_ROOT_DIRS.map((d) => `${d}/`);

// Resolve an import specifier (from `importerRel`, a repo-relative file) to a
// repo-relative file id that exists in `fileSet`, or null when it's external
// (npm package / node builtin). Handles relative (./ ../), the first-party root
// aliases, `@/*` -> src, and the bare `config` alias.
const resolveTarget = (importerRel, spec, fileSet) => {
  let baseNoExt = null;
  if (spec.startsWith(".")) {
    const importerDir = path.posix.dirname(importerRel);
    baseNoExt = toPosix(path.posix.normalize(path.posix.join(importerDir, spec)));
    if (baseNoExt.startsWith("..")) return null;
  } else if (spec === "config") {
    baseNoExt = "config";
  } else if (spec.startsWith("@/")) {
    baseNoExt = `src/${spec.slice("@/".length)}`;
  } else if (ALIAS_ROOTS.some((root) => spec.startsWith(root))) {
    baseNoExt = spec;
  } else {
    return null; // npm package / node builtin — not a first-party node
  }
  baseNoExt = baseNoExt.replace(/\.(tsx?|jsx?|mjs)$/, "");
  for (const cand of [`${baseNoExt}.ts`, `${baseNoExt}.tsx`, `${baseNoExt}/index.ts`, `${baseNoExt}/index.tsx`]) {
    if (fileSet.has(cand)) return cand;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Symbol-level call graph (TypeScript TypeChecker)
// ---------------------------------------------------------------------------

// Build a ts.Program over the files WE scanned, using the compilerOptions from
// tsconfig.json (fallback tsconfig.server.json). Taking the root files from the
// scan instead of the tsconfig `include` keeps the symbol layer's scope exactly
// equal to the import layer's — a consumer's tsconfig.server.json only includes
// server-side src/ paths, which would silently halve the symbol coverage.
// Returns null on any failure so the import-level graph still ships.
const buildProgram = (absFiles) => {
  const configPath =
    ts.findConfigFile(REPO_ROOT, ts.sys.fileExists, "tsconfig.json") ??
    ts.findConfigFile(REPO_ROOT, ts.sys.fileExists, "tsconfig.server.json");
  if (!configPath) return null;
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) return null;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
  if (absFiles.length === 0) return null;
  return ts.createProgram(absFiles, parsed.options);
};

// A source file's path as a repo-relative node id, or null if it lives outside
// the repo (node_modules) or is a generated/declaration file.
const projectIdOf = (fileName) => {
  const rel = toPosix(path.relative(REPO_ROOT, fileName));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  if (rel.includes("node_modules/") || rel.endsWith(".d.ts") || rel.includes(".generated.")) return null;
  return rel;
};

// If `node` introduces a named caller scope, return { name, kind }; else null.
// Covers function declarations, const/let arrow|function expressions, object-
// literal method properties, and named function/method declarations. Calls
// outside any named scope attribute to a synthetic `<module>` caller per file,
// so coverage is complete (every resolvable call edge is recorded, attributed
// to the nearest enclosing name).
const namedScopeOf = (node) => {
  if (ts.isFunctionDeclaration(node) && node.name) return { name: node.name.text, kind: "function" };
  if ((ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)) && node.name && ts.isIdentifier(node.name)) {
    return { name: node.name.text, kind: "method" };
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    return { name: node.name.text, kind: "function" };
  }
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    return { name: node.name.text, kind: "method" };
  }
  return null;
};

// Resolve a call/new callee expression to its declared { file, name }, or null.
const resolveCallee = (expr, checker) => {
  let sym = checker.getSymbolAtLocation(expr);
  if (!sym && ts.isPropertyAccessExpression(expr)) sym = checker.getSymbolAtLocation(expr.name);
  if (!sym) return null;
  if (sym.flags & ts.SymbolFlags.Alias) {
    try { sym = checker.getAliasedSymbol(sym); } catch { /* keep original */ }
  }
  const decl = sym.declarations?.[0];
  if (!decl) return null;
  return { file: decl.getSourceFile().fileName, name: sym.getName() };
};

const collectSymbolGraph = (fileSet, absFiles) => {
  let program;
  try { program = buildProgram(absFiles); } catch { return null; }
  if (!program) return null;
  //? Count IN-PROJECT files only. `program.getSourceFiles()` also returns every
  //? .d.ts the compiler pulled in from node_modules — thousands before a single
  //? line of project code — so comparing that total against the cap made the
  //? pass skip itself on every real project, reporting `symbols: 0` as if the
  //? project simply had none.
  const projectFileCount = program.getSourceFiles().filter((sf) => projectIdOf(sf.fileName) !== null).length;
  if (projectFileCount > SYMBOL_FILE_CAP) {
    console.error(`[ai:graph] symbol pass skipped: ${projectFileCount} in-project files > cap ${SYMBOL_FILE_CAP} (import-level graph still emitted).`);
    return null;
  }
  const checker = program.getTypeChecker();

  const symbols = new Map(); // id -> { id, file, name, kind }
  const addSymbol = (file, name, kind) => {
    const id = `${file}::${name}`;
    if (!symbols.has(id)) symbols.set(id, { id, file, name, kind });
    return id;
  };
  const callEdgeSet = new Set();

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const callerFile = projectIdOf(sf.fileName);
    if (!callerFile || !fileSet.has(callerFile)) continue;
    // Single recursive walk tracking the nearest enclosing named scope; a call
    // outside any named scope attributes to a synthetic `<module>` caller, so
    // every resolvable in-project call edge is captured.
    const walk = (node, callerId) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const target = resolveCallee(node.expression, checker);
        if (target) {
          const calleeFile = projectIdOf(target.file);
          if (calleeFile && fileSet.has(calleeFile)) {
            const calleeId = addSymbol(calleeFile, target.name, "fn");
            //? Join edge endpoints with `\n` (not a raw space): a src id is
            //? `<posix-path>::<symbol-name>` and a path segment or identifier
            //? CAN contain a space (`My Widget.tsx`), which would corrupt a
            //? space-split edge key. `\n` can appear in neither.
            if (calleeId !== callerId) callEdgeSet.add(`${callerId}\n${calleeId}`);
          }
        }
      }
      const named = namedScopeOf(node);
      const childCaller = named ? addSymbol(callerFile, named.name, named.kind) : callerId;
      ts.forEachChild(node, (c) => walk(c, childCaller));
    };
    walk(sf, addSymbol(callerFile, "<module>", "module"));
  }

  const symbolList = [...symbols.values()].sort((a, b) => a.id.localeCompare(b.id));
  const callEdges = [...callEdgeSet].map((k) => {
    const [from, to] = k.split("\n");
    return { from, to };
  }).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  //? The symbol blast-radius (transitive reverse-reachability over callEdges) is
  //? deliberately NOT computed here — the MCP server derives it on load. See the
  //? file header.
  return { symbols: symbolList, callEdges };
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

//? Every first-party file, absolute, deduped and sorted. A root that this
//? project doesn't have contributes nothing.
const collectSourceFiles = async () => {
  const found = [];
  for (const dir of GRAPH_ROOT_DIRS) {
    found.push(...await walkFiles(path.join(REPO_ROOT, dir), (name) => isSource(name)));
  }
  for (const file of GRAPH_ROOT_FILES) {
    const abs = path.join(REPO_ROOT, file);
    const [err, stat] = await safe(fs.stat(abs));
    if (!err && stat.isFile()) found.push(abs);
  }
  return [...new Set(found)].sort();
};

const build = async () => {
  const absFiles = await collectSourceFiles();
  const nodes = absFiles.map((abs) => {
    const rel = relFromRepo(abs);
    return { id: rel, kind: classify(rel, path.basename(abs)), route: routeOf(rel) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const fileSet = new Set(nodes.map((n) => n.id));

  // edges: importer -> imported (both repo-relative ids)
  const edgeSet = new Set();
  const forward = new Map(); // id -> Set(imported)
  const reverse = new Map(); // id -> Set(importers)
  for (const id of fileSet) { forward.set(id, new Set()); reverse.set(id, new Set()); }

  for (const abs of absFiles) {
    const importerRel = relFromRepo(abs);
    const src = await readTextFile(abs);
    if (src === null) continue;
    for (const spec of extractImportSources(src)) {
      const target = resolveTarget(importerRel, spec, fileSet);
      if (!target || target === importerRel) continue;
      //? `\n`-joined edge key (not a raw space): a repo-relative path can
      //? contain a space (`My Widget.tsx`), which a space-split would corrupt.
      const key = `${importerRel}\n${target}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      forward.get(importerRel).add(target);
      reverse.get(target).add(importerRel);
    }
  }

  const edges = [...edgeSet].map((k) => {
    const [from, to] = k.split("\n");
    return { from, to };
  }).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  // Transitive reverse-reachability (everything that would be affected by
  // changing a file). Memoized DFS over the reverse graph. Computed here ONLY to
  // rank god-nodes; the full map is not emitted (the MCP server derives it).
  const memo = new Map();
  const dependentsOf = (id, stack = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return new Set(); // cycle guard
    stack.add(id);
    const acc = new Set();
    for (const importer of reverse.get(id) ?? []) {
      acc.add(importer);
      for (const t of dependentsOf(importer, stack)) acc.add(t);
    }
    stack.delete(id);
    memo.set(id, acc);
    return acc;
  };

  const godNodes = nodes
    .map((n) => ({ id: n.id, kind: n.kind, dependents: dependentsOf(n.id).size, directDependents: (reverse.get(n.id) ?? new Set()).size }))
    .filter((g) => g.dependents > 0)
    .sort((a, b) => b.dependents - a.dependents || a.id.localeCompare(b.id))
    .slice(0, GOD_NODE_LIMIT);

  // Layer 2: symbol-level call graph (degrades to null on compiler failure / cap).
  const symbolGraph = collectSymbolGraph(fileSet, absFiles);

  return {
    version: 3,
    note: "Dependency graph, ids relative to the REPO root (src/, server/, shared/, functions/, luckystack/, config.ts). File level: edges are importer->imported. Symbol level: callEdges are function->function calls; <module> = file top-level scope. Transitive closures (blastRadius, symbolBlastRadius) are NOT stored — @luckystack/mcp derives them from edges/callEdges on load. functions.* injection-proxy / dynamic-import / interface-typed calls are intentionally not resolved. See docs/decisions/0002,0004,0006,0046.",
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      symbols: symbolGraph?.symbols.length ?? 0,
      callEdges: symbolGraph?.callEdges.length ?? 0,
    },
    nodes,
    edges,
    godNodes,
    symbols: symbolGraph?.symbols ?? [],
    callEdges: symbolGraph?.callEdges ?? [],
  };
};

const main = async () => {
  const graph = await build();
  // Stable 2-space JSON. Object key order is deterministic (we control it).
  const json = `${JSON.stringify(graph, null, 2)}\n`;

  const [mkErr] = await safe(fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true }));
  if (mkErr) { console.error(`[ai:graph] failed to ensure docs directory: ${mkErr.message}`); process.exit(1); }
  const [writeErr] = await safe(fs.writeFile(OUTPUT_FILE, json, "utf8"));
  if (writeErr) { console.error(`[ai:graph] failed to write ${OUTPUT_FILE}: ${writeErr.message}`); process.exit(1); }

  console.log(`[ai:graph] generated ${relFromRepo(OUTPUT_FILE)} (${graph.counts.nodes} files, ${graph.counts.edges} import-edges, ${graph.counts.symbols} symbols, ${graph.counts.callEdges} call-edges, ${graph.godNodes.length} god-nodes)`);
};

const [runErr] = await safe(main());
if (runErr) {
  safeSync(() => console.error(`[ai:graph] fatal: ${runErr.stack ?? runErr.message ?? runErr}`));
  process.exit(1);
}
