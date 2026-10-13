# @luckystack/devkit — agent guidance

Devkit is development/build tooling, not a production runtime dependency. Use it for type generation, live route reloads, template injection and deployment-config validation; do not import its watchers or TypeScript Program into production bundles. See `README.md` and the focused `docs/` pages for the architectural constraints.

Generated route contracts must preserve transport-safe types. A source file missed by the TypeScript Program deserves a visible diagnostic, not a silently permissive generated contract. Keep generated Zod validation and generated type-map contracts in agreement; do not turn unresolved symbols into invented fields. Development can degrade gracefully when a type cannot be resolved, but production relies on generated schemas and must not silently depend on a dev-only resolver.

The one deliberate diagnostics exception — an absent optional sync side — must stay scoped to that side's own field and run after the thrown-extraction check (ADR 0057). Server-backed sync routes share the API side's auth/rate-limit extractors and schema converter so the test-runner can sweep them (ADR 0064). See `docs/type-map-generation.md`.

Hot reload should not block serving live requests while building developer artifacts. Avoid invalidating the shared Program on initial population without cause; do invalidate when source changes. Consumer-owned template overrides intentionally outlive the installed devkit's bundled defaults; do not overwrite them on upgrade.
