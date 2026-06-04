# @luckystack/devkit

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

Dev-time tooling for LuckyStack projects: file-based route discovery + in-memory loaders (`devApis`, `devSyncs`, `devFunctions`), chokidar-driven hot reload, TypeScript-program-backed type-map + Zod schema emission, a route filename validator, a deep runtime type resolver (consumed by `@luckystack/core` in dev), a process supervisor that restarts the server on core file changes, file templates injected on empty API/sync file creation, and the `luckystack-validate-deploy` CLI. Designed to be installed as a `devDependency` only; the production server bundle never imports it.

## When to USE this package

- Running the framework locally (`npm run server` / `npm run dev`) — `setupWatchers` + `initializeAll` are the canonical dev wiring, and the prod runtime maps loader delegates to `devApis` / `devSyncs` when `NODE_ENV !== 'production'`.
- Generating typed artifacts (`apiTypes.generated.ts`, `apiInputSchemas.generated.ts`, `apiDocs.generated.json`) from `_api/` and `_sync/` files — call `generateTypeMapFile()` from a build script.
- Gating a deploy on configuration correctness — `luckystack-validate-deploy` (the package `bin`) confirms every service binding, preset, and env key resolves before shipping a bundle.
- Wrapping the server in a watcher that restarts on `config.ts` / `.env` / `server/bootstrap/**` changes — `supervisor.ts` is the entry point.
- Extending the deep type resolver from `@luckystack/core/src/runtimeTypeValidation.ts` (lazy-imported in dev) without owning the TypeScript-program plumbing.

## When to NOT suggest this (yet)

- **Production runtime.** Devkit is dev-only. Do not import it from code paths reachable in `NODE_ENV=production`; the supervisor, hot-reload watchers, and TypeScript Program have no place in a prod bundle and will not be present in consumer prod tarballs.
- **Bundled / packaged consumer apps (`create-luckystack-app` templates that ship to end users).** Devkit belongs in `devDependencies` of the project, not in any shipped artifact.
- **Replacing the runtime route registry.** `devApis` / `devSyncs` are dev-only maps that mirror the file tree. In production, `@luckystack/server` reads the generated runtime maps; do not call `initializeApis` / `initializeSyncs` from a prod code path.
- **Running tests in CI without a TypeScript Program.** The type-map emitter expects `tsconfig.server.json`; in headless CI test harnesses that do not produce generated types, skip `generateTypeMapFile()` and rely on previously committed artifacts.
- **Hot-reloading non-LuckyStack code.** The watchers know about LuckyStack's marker segments (`_api/`, `_sync/`) and the configured `srcDir` / `sharedDir` / `serverFunctionDirs` (legacy `serverFunctionsDir` singular form still honored when set). Generic file watching belongs in chokidar directly.

## Function Index

| Function / Export | One-liner | Deep doc |
|---|---|---|
| `initializeAll()` | Runs route-naming validation, then `initializeApis` + `initializeSyncs` + `initializeFunctions` in parallel. | -> docs/loader-pipeline.md |
| `initializeApis()` | Clears `devApis`, walks the configured `srcDir`, loads every `_api/<name>_v<n>.ts` via dynamic `import()` with a cachebust query, and populates the dev-side route registry. | -> docs/loader-pipeline.md |
| `initializeSyncs()` | Clears `devSyncs`, walks the configured `srcDir`, loads every `_sync/<name>_server_v<n>.ts` and `<name>_client_v<n>.ts`, and populates the dev-side route registry. | -> docs/loader-pipeline.md |
| `initializeFunctions()` | Clears `devFunctions`, walks every configured `serverFunctionDirs` root (legacy singular `serverFunctionsDir` still honored when set), builds a nested `Record<string, unknown>` mirror of the on-disk tree, and merges named + default exports per file. | -> docs/loader-pipeline.md |
| `upsertApiFromFile(filePath)` | Hot-reload single API: invalidates the TS Program cache + runtime type resolver cache, re-imports the file with a fresh cachebust, and replaces the matching entry in `devApis`. | -> docs/loader-pipeline.md |
| `removeApiFromFile(filePath)` | Hot-reload delete: invalidates caches and deletes the matching entry from `devApis`. | -> docs/loader-pipeline.md |
| `upsertSyncFromFile(filePath)` | Hot-reload single sync: handles both `_server_v<n>` and `_client_v<n>` kinds, invalidates caches, re-imports, replaces the matching entry in `devSyncs`. | -> docs/loader-pipeline.md |
| `removeSyncFromFile(filePath)` | Hot-reload delete: invalidates caches and deletes the matching entry from `devSyncs`. | -> docs/loader-pipeline.md |
| `devApis` | In-memory map of `route key -> { main, auth, rateLimit, httpMethod, schema, inputType, inputTypeFilePath }`. Mirrored by the prod runtime maps loader in dev. | -> docs/loader-pipeline.md |
| `devSyncs` | In-memory map of `route key (with _server / _client suffix) -> server entry record or client callback function`. | -> docs/loader-pipeline.md |
| `devFunctions` | Nested mirror of `serverFunctionsDir`. Each leaf is a module's named + default exports, with later folder scans merging onto existing nodes. | -> docs/loader-pipeline.md |
| `setupWatchers()` | Boots the chokidar watchers for `srcDir` / each `serverFunctionDirs` root / `sharedDir` (legacy singular `serverFunctionsDir` still honored when set), coalesces hot-reload + type-map regenerations, fires initial background type-map generation. No-op when `NODE_ENV === 'production'`. | -> docs/hot-reload.md |
| `generateTypeMapFile(options?)` | Discovers all `_api/` and `_sync/` files, runs the TypeChecker-backed extractors, emits `apiTypes.generated.ts`, `apiInputSchemas.generated.ts`, and `apiDocs.generated.json`. Aborts if any unresolved type symbol is found. | -> docs/type-map-generation.md |
| `getInputTypeFromFile(filePath)` | Public extractor: returns the inline-expanded `data` input type text for one API file. Consumed by the dev loader to drive `runtimeTypeValidation`. | -> docs/type-map-generation.md |
| `getSyncClientDataType(filePath)` | Public extractor: returns the inline-expanded `clientInput` (sync server) or client data (sync client) type text. | -> docs/type-map-generation.md |
| `API_VERSION_TOKEN_REGEX` | Canonical `_v<number>` regex used to parse API filenames. | -> docs/loader-pipeline.md |
| `SYNC_VERSION_TOKEN_REGEX` | Canonical `_(server\|client)_v<number>` regex used to parse sync filenames. | -> docs/loader-pipeline.md |
| `assertValidRouteNaming({ srcDir, context })` | Throws if any `_api/` or `_sync/` file fails naming rules. Called by `initializeAll` and `generateTypeMapFile`. | -> docs/loader-pipeline.md |
| `assertNoDuplicateNormalizedRouteKeys({ srcDir, context })` | Throws on collisions between two files that normalize to the same route key. Called by `generateTypeMapFile`. | -> docs/loader-pipeline.md |
| `registerRoutingRules(rules)` | Override the marker segments (`_api`, `_sync`), version regexes, `privateFolderPrefix`, `scaffoldIgnoredFolders`, and the optional `disableTemplateInjection: (filePath) => boolean` predicate for opting parts of the tree out of scaffold injection. | -> docs/loader-pipeline.md |
| `getRoutingRules()` | Read the current rules (defaults shipped by the package). | -> docs/loader-pipeline.md |
| `registerTemplate(kind, content)` | Override the BODY of a template kind with a string. Content resolution order at injection: consumer file (`.luckystack/templates/<kind>.template.ts(x)`) -> this string override -> bundled disk template. `{{REL_PATH}}` / `{{PAGE_PATH}}` / `{{SYNC_NAME}}` placeholders still apply. | -> docs/template-customization.md |
| `getRegisteredTemplate(kind)` / `clearTemplateOverrides()` / `listRegisteredTemplateKinds()` | Lookup, test-reset, and diagnostic helpers for the content-override registry. | -> docs/template-customization.md |
| `registerTemplateRule({ kind, match, priority? })` | Add a SELECTION rule — decides which kind a classified file gets. Rules evaluate by descending `priority` (ties: newest first); first match wins. `match(ctx)` receives `{ filePath, fileKind: 'api'\|'sync_server'\|'sync_client'\|'page', hasPairedServer, srcRelativePath }`. | -> docs/template-customization.md |
| `registerTemplateKind(kind, { match, content?, priority? })` | Register a brand-new template kind (predicate + optional inline content) in one call. Default priority 100 so custom kinds beat the built-ins. | -> docs/template-customization.md |
| `resolveTemplateKind(ctx)` / `getTemplateRules()` / `clearTemplateRules()` / `registerDefaultTemplateRules()` | Evaluate rules to a kind, read the active rule set, drop all rules (consumer replace), and (re)arm the built-in defaults. | -> docs/template-customization.md |
| `BUILT_IN_TEMPLATE_KINDS` / `BUILT_IN_TEMPLATE_FILENAMES` / `DEFAULT_DASHBOARD_PATH_PATTERN` | The 6 built-in kinds, their bundled filenames, and the page-dashboard heuristic regex (reused by the scaffolded consumer rules file). | -> docs/template-customization.md |
| Consumer overlay: `.luckystack/templates/` | devkit auto-loads `.luckystack/templates/templateRules.ts` in DEV (once, before the first injection) so consumers can edit/remove/add selection rules + kinds as code. Per-kind `*.template.ts(x)` files in the same folder override content. Shipped by `create-luckystack-app`. | -> docs/template-customization.md |
| `assertNoDuplicatePageRoutes({ srcDir, context })` | Build-time validator that throws when two `page.tsx` files compute the same URL after invisible-parent stripping. Called by `generateTypeMapFile`. | -> docs/loader-pipeline.md |
| `collectDuplicatePageRoutes(srcDir)` / `formatDuplicatePageRouteIssues({...})` | Non-throwing pair behind the assert. `initializeAll()` uses these to soft-warn at dev startup. | -> docs/loader-pipeline.md |
| Type: `TemplateKind`, `DuplicatePageRouteIssue` | Public types for the new registry + duplicate-detector. | -> docs/hot-reload.md |
| `apiMarkerSegment` / `syncMarkerSegment` | Resolved marker strings (default `_api` / `_sync`). | -> docs/loader-pipeline.md |
| `isApiFileName(name)` / `isSyncFileName(name)` / `isSyncServerFileName(name)` / `isSyncClientFileName(name)` | Filename predicates that respect `getRoutingRules()`. | -> docs/loader-pipeline.md |
| `Type: RoutingRules` | Shape of the overrideable rules registry. | -> docs/loader-pipeline.md |
| `resolveRuntimeTypeText(typeText)` | Recursively expand a stored TypeScript type text into fully inlined form using the cached server program. Used by `@luckystack/core`'s dev-only runtime validator. | -> docs/runtime-type-resolver.md |
| `clearRuntimeTypeResolverCache()` | Drop the resolver's memoization map. Called on every hot-reload upsert / delete. | -> docs/runtime-type-resolver.md |
| `validateDeploy(input)` | Library form of the deploy validator. Returns a list of `ValidationFinding` records (severity + message + slot). Finding codes include `service-unassigned`, `service-in-multiple-presets`, `preset-references-unknown-service`, `binding-references-unknown-service`, `binding-invalid-url` (error — binding URL doesn't parse), `binding-missing-port` (error — binding URL has no explicit port), `unknown-redis-resource`, `unknown-mongo-resource`, `unknown-fallback-env`, `fallback-redis-mismatch`, `fallback-mongo-mismatch`, `missing-resource-env-var` (warning), `missing-synchronized-env-var` (warning), `service-bound-in-no-environment` (warning). | -> docs/cli.md |
| `Types: ValidateDeployInput`, `ValidateDeployResult`, `ValidationFinding`, `ValidationSeverity` | Public typing for the validator. | -> docs/cli.md |
| `luckystack-validate-deploy` (`bin`) | CLI wrapper that imports the consumer's compiled `services.config.js` + `deploy.config.js`, runs `validateDeploy`, prints findings, exits non-zero on errors (and on warnings under `--strict`). | -> docs/cli.md |
| Supervisor entry (`supervisor.ts`) | Standalone Node entry: watches `config.ts`, `.env`, `.env.local`, `server/server.ts`, `server/bootstrap/**`, `server/auth/**`, and key `server/functions/*.ts` files; debounces restarts; respawns crashed children with a delay; honors SIGINT / SIGTERM. | -> docs/supervisor.md |

Internal modules (not exported from `index.ts`, but live in this package):

| Module | Role | Deep doc |
|---|---|---|
| `typeMap/tsProgram.ts` (`getServerProgram`, `invalidateProgramCache`, `expandType`) | Cached `ts.Program` over `tsconfig.server.json`. Rebuilt on hot reload + before every type-map generation. | -> docs/ts-program-cache.md |
| `typeMap/discovery.ts` | Recursively walks `srcDir` to find `_api/`, `_sync/server`, `_sync/client` files. | -> docs/type-map-generation.md |
| `typeMap/extractors.ts` | TypeChecker-backed extractors for `data` / `serverOutput` / `clientOutput` / stream payload types. | -> docs/type-map-generation.md |
| `typeMap/apiMeta.ts` | Extracts `httpMethod`, `rateLimit`, `auth` from API files. | -> docs/type-map-generation.md |
| `typeMap/routeMeta.ts` | Filename -> `pagePath` / `apiName` / `apiVersion` / `syncName` / `syncVersion`. | -> docs/type-map-generation.md |
| `typeMap/functionsMeta.ts` | Builds the `Functions` interface text emitted into `apiTypes.generated.ts`. | -> docs/type-map-generation.md |
| `typeMap/emitter.ts` + `emitterArtifacts.ts` | Renders generated files to disk via `@luckystack/core`-resolved paths. | -> docs/type-map-generation.md |
| `typeMap/zodEmitter.ts` | Generates the runtime Zod schemas for API inputs. | -> docs/type-map-generation.md |
| `templateInjector.ts` + `templates/*.ts` | Detects empty `_api/`, `_sync/`, AND `page.tsx` files and injects starter content. Sync server/client pairing is auto-resolved. Page files get the `dashboard` template when the path contains `admin\|dashboard\|settings\|billing\|account\|profile`, else the `plain` template. Pages in invalid placements (inside a reserved framework folder, or directly inside an `_<folder>` with no URL segment left) get a commented diagnostic block instead of a usable template so the placement issue is visible at creation time. | -> docs/hot-reload.md |
| `importDependencyGraph.ts` | Tracks which `_api/` / `_sync/` files depend on each shared module so hot reload can fan out. | -> docs/hot-reload.md |
| `runtimeTypeResolver.ts` | Cached recursive expander built on top of `tsProgram`. | -> docs/runtime-type-resolver.md |

## Config keys (env vars + registerProjectConfig slots)

- `NODE_ENV` (env, required for branching) — `setupWatchers()` is a no-op outside dev; `supervisor.ts` only watches files in non-prod mode.
- `LUCKYSTACK_CORE_SUPERVISED` (env, set by the supervisor) — present in the child process so framework code can detect it is running under the supervisor.
- `projectConfig.paths.srcDir` — root for route discovery + watcher subscriptions.
- `projectConfig.paths.sharedDir` — additional watch root for shared modules that feed back into route hot reload via the dependency graph.
- `projectConfig.paths.serverFunctionDirs` (array) — roots for `initializeFunctions()` + the functions watchers. (Legacy `projectConfig.paths.serverFunctionsDir` singular form still honored when set; values are merged into the array at config load.)
- `projectConfig.dev.hotReloadDebounceMs` — debounce window for coalesced reload + type-map regeneration.
- `projectConfig.dev.watcherStabilityThresholdMs` / `projectConfig.dev.watcherPollIntervalMs` — chokidar `awaitWriteFinish` tuning passed to the source watcher.
- Generated artifact paths (`getGeneratedSocketTypesPath()`, `getGeneratedApiDocsPath()`, Zod schema path) — resolved through `@luckystack/core`. Override at the core level, not in devkit.
- `tsconfig.server.json` (file, required) — the `ts.Program` is built from this config; `getServerProgram()` throws if it cannot be located.

## Peer dependencies

- **Required peer (runtime)**: `typescript@~5.7.3` — the type-map emitter and runtime type resolver call into the TypeScript Compiler API. No optional fallback; if the consumer's `typescript` version drifts out of the supported range the emitter may produce different inlined output. Treat as a hard peer.
- **Required peer**: `zod@^4.0.0` — the Zod schema emitter compiles consumer input types into runtime schemas via `zodEmitter.ts`.
- **Required peer**: `@prisma/client@^6.19.0` — type expansion may surface Prisma model types into emitted artifacts; missing the client breaks generation.
- **Direct dependency**: `chokidar@^4.0.3` (the file watcher used by both `hotReload.ts` and `supervisor.ts`).
- **Direct dependency**: `@luckystack/core` (project config, root dir, generated artifact paths, `tryCatch`, locale reloader hook).
- **Optional**: `tsx` — the supervisor spawns the child with `node node_modules/tsx/dist/cli.mjs server/server.ts`. Consumers who run the server differently need to spawn the supervisor's child themselves.

## Related

- Architecture deep-dives: `/docs/ARCHITECTURE_ROUTING.md` (file conventions + version token rules), `/docs/ARCHITECTURE_PACKAGING.md` (generated artifact layout), `/docs/ARCHITECTURE_API.md`, `/docs/ARCHITECTURE_SYNC.md`.
- README (consumer quickstart): `./README.md`.
- Consumed by: `scripts/generate*.ts` in this repo; `server/dev/setupWatchers.ts`; `server/prod/runtimeMaps.ts` (dev branch); `@luckystack/core/src/runtimeTypeValidation.ts` (dev-only lazy import).
