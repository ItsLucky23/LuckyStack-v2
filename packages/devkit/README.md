# @luckystack/devkit

> Tier-B project-glue dev tooling for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2): hot reload, route discovery, generated type-map emitter, Zod schema emitter, template injection, deep type resolver. **Not intended for npm distribution.** Lives in this monorepo so the build pipeline can include it; consumed only by the project's own dev scripts and lazily by `@luckystack/core`'s `runtimeTypeValidation` (via dynamic `import()` to avoid a type cycle).

## Why it's Tier-B

The devkit is tightly coupled to the project's `tsconfig`, file layout, and route conventions. Publishing it would require a stable public API for type extraction across arbitrary TypeScript configurations, which is outside the framework's current scope. Until that changes, projects that need typegen either:

- Use `create-luckystack-app` (which scaffolds a project that re-uses devkit indirectly through generated artifacts), or
- Vendor the parts of devkit they need.

## What it exports

| Group | Exports |
| --- | --- |
| Type generation | `generateTypeMapFile`, `getInputTypeFromFile`, `getSyncClientDataType` |
| Route conventions | `API_VERSION_TOKEN_REGEX`, `SYNC_VERSION_TOKEN_REGEX`, `assertNoDuplicateNormalizedRouteKeys`, `assertValidRouteNaming` |
| Routing rules registry | `registerRoutingRules`, `getRoutingRules`, `apiMarkerSegment`, `syncMarkerSegment`, `isApiFileName`, `isSyncFileName`, `isSyncServerFileName`, `isSyncClientFileName`. Type: `RoutingRules` |
| Dev runtime loaders | `devApis`, `devSyncs`, `devFunctions`, `initializeAll`, `initializeApis`, `initializeSyncs`, `initializeFunctions`, `upsertApiFromFile`, `removeApiFromFile`, `upsertSyncFromFile`, `removeSyncFromFile` |
| Hot reload | `setupWatchers` |
| Deep type resolver | `resolveRuntimeTypeText`, `clearRuntimeTypeResolverCache` (lazy-imported by `@luckystack/core`'s runtime validator in dev) |

## Consumed by

- `scripts/generate*.ts` — type-map + Zod schema emitters.
- `server/dev/setupWatchers.ts` (this repo's own dev server) — hot reload.
- `server/prod/runtimeMaps.ts` — when `NODE_ENV !== 'production'`, loads `devApis` / `devSyncs` for live route resolution.
- `@luckystack/core/src/runtimeTypeValidation.ts` — dev-only deep alias resolution.

## Related architecture docs

- [`docs/ARCHITECTURE_ROUTING.md`](../../docs/ARCHITECTURE_ROUTING.md) — file conventions + version token rules.
- [`docs/ARCHITECTURE_PACKAGING.md`](../../docs/ARCHITECTURE_PACKAGING.md) — generated artifact layout per preset.

## License

MIT — see [LICENSE](../../LICENSE).
