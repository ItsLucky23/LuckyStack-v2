# Changelog

All notable changes to `@luckystack/mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
