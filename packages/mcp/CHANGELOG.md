# Changelog

All notable changes to `@luckystack/mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.6] - 2026-08-18

### Removed

- The `get_runbook`, `list_examples`, and `get_example` tools. The artifacts they read (`docs/AI_RUNBOOKS.md`, `docs/AI_EXAMPLES_INDEX.md`, `docs/examples/`) are no longer generated or shipped, so the tools could only ever answer "run `npm run ai:runbooks`" for a script that no longer exists. The remaining tools — `blast_radius`, `who_imports`, `who_calls`, `god_nodes`, `graph_status`, `list_decisions`, `get_decision`, `decision_for_file`, `find_route`, `get_capability`, `find_lesson`, `get_lesson` — are unchanged.
