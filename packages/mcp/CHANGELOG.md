# Changelog

All notable changes to `@luckystack/mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-10-19

### Fixed

- **`blast_radius`, `who_imports` and the other path lookups no longer answer for a different file that only shares the file name** when the given path has folders.
- **`graph_status` compares the graph against every folder and root config file the generator scans**, so edits outside `src/` make the graph show as stale.

## [0.12.0] - 2026-10-15

### Changed

- Requires Node.js 22.13 or newer (was 20). Node 20 stopped receiving security updates in April 2026, and the scaffold's lint toolchain (ESLint 10) needs 22.13.

## [0.11.0] - 2026-10-14

### Changed

- Type declarations are emitted per source file by TypeScript 7 (`tsc -b`) instead of one bundled `.d.ts` per entry, so the framework build no longer runs package by package. The exported types are unchanged; relative imports inside the declarations carry `.js`, so `moduleResolution: "node16"`/`"nodenext"` projects resolve them as before.
- Package design guidance now ships as `AGENTS.md`, not `CLAUDE.md`. Handwritten docs focus on rationale and safety; exact API contracts remain in installed declarations/source.

## [0.10.2] - 2026-10-09

### Security

- `@modelcontextprotocol/sdk` floor raised to `^1.31.0` (GHSA-6qxp-vccf-f47h: below 1.31.0 the SDK's OAuth client could send credentials to an authorization server chosen by the MCP server). Consumers with an older lockfile now resolve a fixed version on their next install.
## [0.9.0] - 2026-08-28

### Changed

- `loadGraph()` accepts a graph without `blastRadius` / `symbolBlastRadius` and **derives** both from
  `edges` / `callEdges` on load. Graph version 3 no longer stores them: they are transitive closures,
  rebuildable in milliseconds, and they grew to 82% of the artifact on a real codebase. Version ≤ 2 graphs
  that still carry them keep working unchanged.
- `resolveNodeId()` no longer strips a `src/` prefix. Node ids are repo-relative since graph version 3
  (`src/_functions/foo.ts`, `shared/tryCatch.ts`, `config.ts`); a `src/`-less input is now tried as a
  fallback instead, so version-2 ids still resolve exactly rather than by basename coincidence.
- Tool descriptions ask for a repo-relative path and no longer describe the graph as a committed artifact
  kept fresh by the pre-commit hook — it is a gitignored local cache rebuilt by `npm run ai:refresh` and by
  `postinstall`. The "artifact not found" message says so.

### Added

- This CHANGELOG. The package shipped without one.

## [0.8.6] - 2026-08-18

### Removed

- The `get_runbook`, `list_examples`, and `get_example` tools. The artifacts they read (`docs/AI_RUNBOOKS.md`, `docs/AI_EXAMPLES_INDEX.md`, `docs/examples/`) are no longer generated or shipped, so the tools could only ever answer "run `npm run ai:runbooks`" for a script that no longer exists. The remaining tools — `blast_radius`, `who_imports`, `who_calls`, `god_nodes`, `graph_status`, `list_decisions`, `get_decision`, `decision_for_file`, `find_route`, `get_capability`, `find_lesson`, `get_lesson` — are unchanged.

## [0.8.4] - 2026-08-17

- Released in lockstep with the rest of the `@luckystack/*` packages.
