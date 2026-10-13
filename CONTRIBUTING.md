# Contributing to LuckyStack

## Keep package boundaries useful

Framework packages must not depend on the reference application's directory layout, ORM or route names. Registries and adapters keep application choices outside reusable framework code; reaching across packages with relative source imports bypasses that boundary.

Reuse the existing configuration, routing and adapter contracts rather than creating a second source of defaults or environment parsing. Consult source/types for their exact shape and package `AGENTS.md` for the reason behind constraints.

## Release compatibility

LuckyStack releases packages in lockstep. This avoids asking consumers to solve an internal compatibility matrix for tightly coupled framework contracts. Independent package versioning is not the accepted release model.

The release scripts and package manifests determine which workspaces publish. Do not maintain a second package list here. When introducing a package, examine those sources and the existing package scaffold; verify actual tarball contents, not just a successful workspace build.

## Review expectations

- Keep changes scoped to the requested contract; do not slip in unrelated refactors.
- Prove regressions with tests and preserve transport-equivalent security.
- Keep consumer-editable files separate from library-owned implementation.
- Explain design choices and rejected alternatives, not signatures or execution tours. Use short comments only for non-obvious local rationale.
- Run the feature-boundary gate in [AGENTS.md](AGENTS.md), plus consumer-delivery checks when scaffold assets change.

See [the contributor setup guide](docs/DEVELOPER_GUIDE.md) for getting started.
