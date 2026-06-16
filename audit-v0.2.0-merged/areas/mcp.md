# mcp — Verified & Merged Audit Findings
Sources: reports/mcp.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
The `review/v0.2.0/*` scan contains **zero** findings for `packages/mcp/` (grep for `mcp`/`MCP`/`pkg-mcp`/`packages/mcp/` across all five dimension files returns nothing), so every finding here originates from `reports/mcp.md` alone — there is no merge to perform and no scan-vs-scan disagreement to resolve. I re-verified all 16 reports/ findings against the current `packages/mcp/src/index.ts` (227 lines, 9 tools), `artifacts.ts` (98 lines), `package.json`, `README.md` and `CLAUDE.md`. **All 16 are CONFIRMED present in current code** — nothing was fixed by commit 302cbf1 or the uncommitted working-tree edits; that commit touched login/wizard/CLI flow, not this package. None are exploitable today (local read-only stdio server, fixed artifact paths). The biggest live issues are all small and well-localized: no extensibility surface (H1 — importing the module side-effectfully boots the server), `who_calls` undocumented in the package's own README + CLAUDE.md (D1), a `test` script that cannot run (Q5 — no `vitest` dep, no test files), and `package.json files` shipping non-existent `LICENSE`/`CHANGELOG.md` (D2). Severities are correctly low — this is a clean package whose gaps are product/polish gaps rather than defects.

## Findings

### S1 — readDocFile joins caller paths with no containment check (latent traversal) · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/src/artifacts.ts:31-38`
- **Original claim:** `readDocFile` does `fs.readFile(path.join(root, relPath))` with no normalize+prefix check, so `../../secret` would escape the project root; not reachable from tool inputs today.
- **Verification (current code):** Exactly as described. `readDocFile` (lines 31-38) has no `path.resolve` + `startsWith(root)` guard. All current callers pass constants (`index.ts:130,176,190,205`, `artifacts.ts:59`) or `docs/decisions/${match}` where `match` comes from `fs.readdir` of the decisions dir (`index.ts:149,154-160`) — so no user input flows in today.
- **Verdict & why:** CONFIRMED as a latent defense-in-depth gap. Not currently exploitable (no tool forwards user input into `readDocFile`), which caps it at low.
- **Recommendation:** Add containment in the exported helper: `const p = path.resolve(root, relPath); if (p !== root && !p.startsWith(root + path.sep)) return null;` — cheap, future-proofs against a new tool that forwards user input.

### S2 — projectRoot walk-up can lock onto an unintended ancestor directory · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/src/artifacts.ts:13-29`
- **Original claim:** If launched with a cwd that has no `package.json`, the loop walks up to 12 levels and caches the first ancestor with a `package.json` (e.g. a stray one in the home dir), then serves that dir's docs.
- **Verification (current code):** Confirmed. Lines 16-26: loop over 12 parents, first `package.json` found becomes `cachedRoot`; no validation that the directory is actually a LuckyStack project, no `LUCKYSTACK_PROJECT_ROOT` override. Falls back to `cwd` after 12 levels (line 27).
- **Verdict & why:** CONFIRMED. Low impact (only fixed doc filenames disclosed; main harm is confidently-wrong answers from the wrong repo). Realistically the cwd is the project root (Claude Code sets it), so this is an edge case.
- **Recommendation:** Validate the candidate root (require `docs/` or a `luckystack`-marked `package.json`), honor an explicit `LUCKYSTACK_PROJECT_ROOT` env override, and log rejected candidates to stderr. Solves S2 + C2 together.

### H1 — No programmatic/library surface; importing the module boots the server · severity: medium · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/src/index.ts:216-226` (top-level `main().catch(...)`), `package.json:27-34` (`exports` + `bin` both point at `dist/index.js`)
- **Original claim:** The module exports nothing and runs `main()` at import time, yet `package.json` advertises an importable entry — a consumer cannot add one project-specific tool without forking.
- **Verification (current code):** Confirmed. `index.ts` has no `export` of `server`, `createServer`, or the artifact helpers; `main().catch(...)` executes on import (lines 223-226). `package.json` exposes the same `dist/index.js` as both `exports["."].import` (line 30) and `bin.luckystack-mcp` (line 34), so importing the package starts a stdio server rather than handing back a factory.
- **Verdict & why:** CONFIRMED. This is the most substantive finding — a real extensibility gap. Severity medium (limits adoption/extension, not a security or correctness bug).
- **Recommendation:** Export `createLuckystackMcpServer()` + the `artifacts.ts` readers; move the side-effecting boot into a dedicated `bin` file (`src/bin.ts`) so `import '@luckystack/mcp'` is pure. Optionally load extra tool definitions from a project-local file.

### H2 — Artifact locations hardcoded; luckystack.ai.json ignored · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/src/artifacts.ts:59`; `index.ts:130,146,176,190,205`
- **Original claim:** All doc paths are literals; the package never reads `luckystack.ai.json`, so a project that relocates/restructures its docs cannot redirect the server.
- **Verification (current code):** Confirmed. Every artifact path is a string literal (`docs/ai-graph.json`, `docs/AI_DECISIONS_INDEX.md`, `docs/decisions`, `docs/AI_PROJECT_INDEX.md`, `docs/AI_RUNBOOKS.md`, `docs/AI_CAPABILITIES.md`). No reference to `luckystack.ai.json` anywhere in the package.
- **Verdict & why:** CONFIRMED but currently benign — only `AI_PRODUCT_OVERVIEW.md` shards today and the server doesn't read it, so nothing breaks. The seam is missing for the future. Low.
- **Recommendation:** Read `docs.sharding` / doc paths from `luckystack.ai.json` so doc relocation/sharding can be honored. Becomes a hard block only if index sharding is extended to the files this server reads.

### C1 — grepLines 60-line cap is hardcoded and silently truncates · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/src/artifacts.ts:94-97`; consumers `index.ts:133,178,207`
- **Original claim:** `grepLines(..., limit = 60)` truncates at 60 with no "truncated" indicator, so the agent can't know results were dropped (`find_route`, `get_capability`, `list_decisions(tag)`).
- **Verification (current code):** Confirmed. `artifacts.ts:96` `.slice(0, limit)` with default 60; callers at `index.ts:133` (list_decisions), `:178` (find_route), `:207` (get_capability) never signal truncation. `who_calls`/`blast_radius` use graph data, not grepLines.
- **Verdict & why:** CONFIRMED. Low — a usability/observability gap, not a defect.
- **Recommendation:** Append `(+N more — refine your query)` when the cap is hit, and/or expose a `limit` tool parameter (as `god_nodes` already does).

### C2 — Walk-up depth of 12 is hardcoded · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/src/artifacts.ts:16`
- **Original claim:** `for (let i = 0; i < 12; i++)` — launch dirs 12+ levels below root silently fall back to cwd.
- **Verification (current code):** Confirmed verbatim at line 16. Fallback to `cwd` at line 27.
- **Verdict & why:** CONFIRMED but very minor. An explicit `LUCKYSTACK_PROJECT_ROOT` env override (see S2) makes the depth irrelevant.
- **Recommendation:** Fold into the S2 fix (env override).

### C3 — No tool for the product/intent layer; no forward-dep tool; no full-text ADR-body search · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/src/index.ts` (no `get_product`/`get_intent` tool registered; `list_decisions` greps index rows only, `:133`)
- **Original claim:** Root CLAUDE.md makes `docs/AI_PRODUCT_OVERVIEW.md` / `docs/PRODUCT.md` first-class, yet no `get_product` tool exists; also no forward-dependency tool (only reverse via `who_imports`/`blast_radius`) and no full-text search over ADR bodies.
- **Verification (current code):** Confirmed. The 9 registered tools are blast_radius, who_imports, god_nodes, who_calls, list_decisions, get_decision, find_route, get_runbook, get_capability — no product/intent tool, no `what_imports`-style forward-dep tool. `list_decisions` greps the index file rows (`:133`), not ADR bodies.
- **Verdict & why:** CONFIRMED as a missing-feature gap. Low — these are enhancements, nothing broken.
- **Recommendation:** Add a `get_product`/`get_intent` tool (it reads the one artifact that shards) and consider a forward-dependency tool + ADR-body full-text search.

### D1 — who_calls registered but missing from CLAUDE.md and README tool indexes · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** registered at `packages/mcp/src/index.ts:95-117`; absent from `packages/mcp/README.md:24-33` (8-row table) and `packages/mcp/CLAUDE.md` "Tool Index" (8 rows)
- **Original claim:** Server registers 9 tools but the package CLAUDE.md and README list only 8 — `who_calls` is undocumented, despite root CLAUDE.md telling agents to use it.
- **Verification (current code):** Confirmed. `who_calls` is registered (`index.ts:95-117`). README table rows 26-33 list 8 tools, no `who_calls`. CLAUDE.md "Tool Index" table likewise lists 8, no `who_calls`. Root CLAUDE.md (session context) explicitly references `blast_radius / who_imports / who_calls / god_nodes`.
- **Verdict & why:** CONFIRMED. Low (docs gap) but high-value to fix — an AI reading the package docs won't discover symbol-level impact analysis.
- **Recommendation:** Add the `who_calls(symbol)` row to both `README.md` and `CLAUDE.md` (reads `docs/ai-graph.json` v2 symbols, lists transitive callers).

### D2 — package.json `files` lists LICENSE and CHANGELOG.md that do not exist · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/package.json:36-42`
- **Original claim:** `files` includes `LICENSE` and `CHANGELOG.md`, neither present in `packages/mcp/`; npm silently skips them, so the tarball ships without a LICENSE despite `"license": "MIT"`.
- **Verification (current code):** Confirmed. `package.json:40-41` lists `"LICENSE"` and `"CHANGELOG.md"`. Glob of `packages/mcp/**/*` returns only CLAUDE.md, README.md, package.json, src/artifacts.ts, src/index.ts, tsconfig.json, tsup.config.ts — no LICENSE, no CHANGELOG.md.
- **Verdict & why:** CONFIRMED. Low, but a genuine publish-hygiene issue: the MIT-licensed package ships no LICENSE file.
- **Recommendation:** Add a `LICENSE` file (and `CHANGELOG.md`, or drop it from `files`). Relevant to the 0.2.0 publish-readiness goal.

### D3 — CLAUDE.md degradation claim is slightly off for invalid/malformed graph · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/CLAUDE.md` ("Each tool returns a helpful 'generate it' message when its artifact is absent"); contradicted by `artifacts.ts:61-62`
- **Original claim:** The "generate it" message is shown for absent files, but an *invalid* graph yields the same false message (Q2) and a *malformed-JSON* graph throws a raw exception (Q1) — the doc claim is incomplete.
- **Verification (current code):** Confirmed. `loadGraph` returns `null` for both missing and schema-invalid graphs (`artifacts.ts:60,62`), and `JSON.parse` (line 61) is uncaught so malformed JSON throws. CLAUDE.md only describes the absent-file case.
- **Verdict & why:** CONFIRMED (doc accuracy). Low. Tightly coupled to Q1/Q2.
- **Recommendation:** Once Q1/Q2 are fixed, update the sentence to mention corrupt/invalid-graph handling.

### Q1 — loadGraph does not catch JSON.parse failures · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/src/artifacts.ts:61`
- **Original claim:** `GraphSchema.safeParse(JSON.parse(text))` — a truncated/corrupt `docs/ai-graph.json` throws out of `loadGraph`, so all four graph tools surface a raw SDK exception instead of the friendly regenerate message.
- **Verification (current code):** Confirmed. Line 61 calls `JSON.parse(text)` unguarded inside `loadGraph`; `safeParse` only protects against schema mismatch, not a parse throw.
- **Verdict & why:** CONFIRMED. Low (only on a corrupt artifact) but a real degradation-path gap.
- **Recommendation:** Wrap the parse in `tryCatch`/try-catch and return a distinct "artifact is corrupt — regenerate with `npm run ai:graph`" result.

### Q2 — loadGraph conflates "missing" and "schema-invalid" · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/src/artifacts.ts:62`; surfaced at `index.ts:54,71,88,103`
- **Original claim:** `return parsed.success ? parsed.data : null;` — a graph that exists but fails validation yields the same `null` as a missing file, so the tool says "docs/ai-graph.json not found", which is false.
- **Verification (current code):** Confirmed. Line 62 returns `null` on schema failure; every graph tool maps `!graph` to the `missing(...)` "not found in this project" message (`index.ts:54,71,88,103`).
- **Verdict & why:** CONFIRMED. Low, but actively misleading — the agent thinks generation failed when the file is present-but-stale.
- **Recommendation:** Distinguish the two: return a sentinel for schema-invalid and surface "graph is present but outdated/invalid — regenerate".

### Q3 — resolveNodeId reports ambiguity as "no match" · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/src/artifacts.ts:70-71`; surfaced at `index.ts:56,73`
- **Original claim:** When a bare basename matches multiple nodes, `resolveNodeId` returns `null` and tools say `No graph node matches`, inconsistent with `who_calls` which lists ambiguous candidates.
- **Verification (current code):** Confirmed. `artifacts.ts:71` `return byBase.length === 1 ? byBase[0].id : null;` collapses both "0 matches" and ">1 match" to `null`. `blast_radius`/`who_imports` then print "No graph node matches" (`index.ts:56,73`). By contrast `who_calls` (`index.ts:108-109`) correctly lists ambiguous candidates.
- **Verdict & why:** CONFIRMED. Low, but a genuine UX inconsistency within the same package.
- **Recommendation:** Return the candidate list (or a discriminated result) so `blast_radius`/`who_imports` can present "ambiguous — pick one", matching `who_calls`.

### Q4 — get_decision picks the first substring match silently · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/src/index.ts:154-158`
- **Original claim:** `entries.find((f) => ... f.includes(id))` — an id like `"auth"` matching several ADR slugs returns whichever sorts first, with no ambiguity warning.
- **Verification (current code):** Confirmed. `index.ts:154-158` uses `entries.find(...)` with `f.includes(id)` as a fallback match (line 157), returning the first hit; no collection of multiple matches, no ambiguity notice.
- **Verdict & why:** CONFIRMED. Low — the agent may read the wrong ADR believing it's the only one.
- **Recommendation:** Collect all matches; if >1, list them (mirror the `who_calls` ambiguity pattern at `index.ts:108-109`).

### Q5 — test script with no tests and no test-runner dependency · severity: low · status: CONFIRMED
- **Sources:** reports
- **Current location:** `packages/mcp/package.json:46`
- **Original claim:** `"test": "vitest run"` but `src/` has only `artifacts.ts` + `index.ts` (no `*.test.ts`) and `vitest` is in no dependency block, so `npm test` fails outright.
- **Verification (current code):** Confirmed. `package.json:46` `"test": "vitest run"`. `dependencies` (lines 48-51) lists only `@modelcontextprotocol/sdk` + `zod`; there is no `devDependencies` block and no `vitest`. Glob of the package shows no `*.test.ts` files. Running `npm test` would fail (vitest not resolvable).
- **Verdict & why:** CONFIRMED. Low (no shipped-code impact) but a real broken script — and the pure helpers (`resolveNodeId`, `sectionMatching`, `grepLines`, `projectRoot`) are trivially testable.
- **Recommendation:** Either add `vitest` (devDep) + a small `*.test.ts` covering the pure helpers, or change `test` to a no-op until tests exist. Relevant to publish-readiness.
