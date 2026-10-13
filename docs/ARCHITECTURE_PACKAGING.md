# Packaging architecture

<!-- @covers packages/server/src, packages/cli/src, packages/create-luckystack-app/src, scripts/generateServerRequests.ts -->

LuckyStack ships composable packages and a consumer-owned application. A package manifest is authoritative for exports and dependencies; source and tests are authoritative for runtime behavior. Hand-written architecture docs explain boundaries and reasons, not a parallel package or generated-file inventory. See [`PACKAGE_OVERVIEW.md`](./PACKAGE_OVERVIEW.md) for choosing packages.

## Boundary choices

- Server capabilities supplied by optional packages register before consumer overlays; consumers can customize the installed feature without forking it. Missing optional peers should not prevent unrelated capabilities from starting. Secret resolution is explicit because missing credentials require a separate fail-open/fail-closed choice; the router runs as a separate process rather than as a server peer. See [optional package design](./DESIGN_OPTIONAL_SERVER_PACKAGES.md).
- A package install cannot safely invent consumer-owned routes or UI. Use the CLI addition path for features that require those files; compare generated changes with local edits before accepting them. Removing a feature must not silently delete developer-owned pages.
- Keep framework-owned documentation apart from consumer-owned decisions and history. Copying the framework's ADRs or generated project indexes into an app gives convincing answers about the **wrong** project. ADR 0056 records the rationale. A framework-doc update should preserve consumer edits and provide a mergeable sidecar rather than silently replacing them; ignored files must stay opted out, and removed upstream files need review rather than automatic deletion (ADR 0051). Consult [`UPGRADING.md`](./UPGRADING.md) for the current safe update steps.
- File-based route discovery and generated types/maps are derived from source. Never hand-maintain production route maps or type outputs. Generated artifacts are not a substitute for security checks against the live runtime.
- Split topology is opt-in. A service must have one clear owner; socket delivery and typed route invocation have separate routing paths, and a shared Redis adapter cannot execute code absent from a preset. See [multi-instance architecture](./ARCHITECTURE_MULTI_INSTANCE.md).

For current scaffold layout, boot wiring, commands, artifact paths and consumer instructions, consult the package READMEs, `packages/<name>/AGENTS.md`, [`HOSTING.md`](./HOSTING.md), and [`UPGRADING.md`](./UPGRADING.md). Historical choices remain in `docs/decisions/`.
