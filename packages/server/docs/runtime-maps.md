# Runtime maps

Generated route maps are loaded in production so boot does not depend on a development watcher or scan. Bundles must not silently overwrite another bundle's API or sync route: conflicting ownership is a deployment error. Repeated equivalent shared functions are intentionally deduplicated because scoped builds can carry the same registry. Source: `../src/runtimeMapsLoader.ts`, `../src/verifyBootstrap.ts`.

Failing to register a production provider must be visible at boot, not discovered as a missing route by the first user. Runtime map selection does not authorize a caller; each handler still applies its own access policy. See `./argv-parsing.md`, `../../api/docs/auth-flow.md`, `../../sync/docs/room-fanout.md`.
