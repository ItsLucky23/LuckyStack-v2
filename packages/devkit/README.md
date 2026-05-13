# @luckystack/devkit

> Dev-time tooling for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2): hot reload, route discovery, generated type-map emitter, Zod schema emitter, deep type resolver, plus the `luckystack-validate-deploy` CLI. Install as a `devDependency` in projects that build LuckyStack apps locally.

## Install

```bash
npm install --save-dev @luckystack/devkit
```

This is a build-time tool, not a runtime dependency — your production server bundle doesn't ship it. Project paths and the locale reloader hook in via the registries exported from `@luckystack/core` (`getProjectConfig().paths`, `registerLocaleReloader`), so devkit has no app-side relative imports.

## CLIs

| Bin | What |
| --- | --- |
| `luckystack-validate-deploy` | Reads compiled `deploy.config.js` + `services.config.js` and asserts every service is bound, every preset references real services, env keys resolve. Exits non-zero on errors; `--strict` also fails on warnings. |

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
