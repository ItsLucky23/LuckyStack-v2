# Scaffold design

The scaffolder resolves choices before writing into a fresh project directory so invalid combinations do not leave a misleading half-scaffold. In non-interactive environments, require explicit or documented default selections rather than waiting for unavailable prompts. The implementation is the source of truth for sequencing, pruning and generated files; do not copy its conditional branches into this document.

A generated app owns its editable pages and overlay. Framework documentation can be copied for use before dependencies are installed, but it is not the consumer's decision history. The manifest records framework-owned copies so later updates can preserve edits and offer `.new` sidecars. Optional integrations must not leave imports of absent packages in the output. Exercise fresh scaffolds across materially different choices when changing this boundary; see `README.md` for a minimal start.
