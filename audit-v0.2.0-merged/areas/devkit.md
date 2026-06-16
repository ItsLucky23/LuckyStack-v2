# devkit — Verified & Merged Audit Findings
Sources: reports/devkit-gen.md, reports/devkit-quality.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
21 merged findings. Of the substantive defects, **all but one are still live** in the current tree — the codegen/dev-tooling layer was not touched by commit 302cbf1 (login/wizard fix) so almost every scan claim re-confirms. The single thing the older review/ scan got wrong is **QUA-013** (dev loader dropped `errorFormatter`/`validation` on sync routes): the current `loader.ts` now forwards both fields at all four assignment sites (lines 229-230, 300-301, 362-363, 442-443) with explicit QUA-013/QUA-044 comments, so that finding is ALREADY-FIXED. Everything else stands: the boot-scan `endsWith("api")` mis-classification (QUA-028 / Hard block), the hardcoded generated-type builtin allow-list that hard-aborts on `Uint8Array`/`URL` (Hard block — the biggest live non-security issue), the `apiInputSchemas.generated.ts` self-triggering watcher loop (QUA-029), the half-wired `registerRoutingRules` markers (CFG-02 / Hooks#1), the SEC-03 fail-open-vs-fail-closed auth-default contradiction, a dead 303-line `emitter.ts`, dead `extractValidation`, the proto-pollution walk (SEC-35), unescaped name interpolation, swallowed write errors, blanket eslint-disables on 7 files, and a stale CLAUDE.md (chokidar v4 vs v5, non-existent exports, wrong `resolveRuntimeTypeText` signature). No remotely-exploitable security defect — these run at dev/build time over already-trusted project source. Biggest live issue: the builtin-allow-list hard abort (structural dead end for any consumer with a `Uint8Array`/`URL` API field).

## Findings

### DK-01 — Generated-type builtin allow-list hard-aborts generation on common globals (Uint8Array/URL/Buffer/…)  ·  severity: high  ·  status: CONFIRMED
- **Sources:** reports(devkit-gen Hard block)
- **Current location:** `packages/devkit/src/typeMap/emitterArtifacts.ts:119-124` (the `builtIns` set) + `:186-188` (`throw`)
- **Original claim:** The hardcoded `builtIns` set omits `Uint8Array`, `ArrayBuffer`, `Buffer`, `URL`, `Blob`, `File`, `FormData`, `BigInt`, `Symbol`, `Iterable`, intrinsic string types, etc. When the TypeChecker expands an API input/output to one of these, `validateGeneratedTypeIdentifiers` treats it as an undeclared symbol and the WHOLE generation throws — no per-route skip, no escape hatch.
- **Verification (current code):** The set still contains only `string/number/.../Record/Partial/.../Promise/Map/Set/.../Date/Error/RegExp/...` and JSON helpers — `Uint8Array`/`URL`/`Buffer`/`ArrayBuffer` are absent. `validateGeneratedTypeIdentifiers` (line 114) still collects referenced type-reference identifiers and `throws new Error('... unresolved type identifiers: ...')` at line 186 when any is not in `knownSymbols` ∪ `builtIns`. No downgrade-to-warning path exists.
- **Verdict & why:** CONFIRMED. A consumer with a legitimate `{ data: Uint8Array }` or `URL`-typed field cannot generate artifacts at all. Structural dead end, not just missing config.
- **Recommendation:** Seed the builtin set from a fuller lib.dom/lib.es global list (or make it consumer-extendable), and downgrade an unknown identifier to a warning + `unknown` fallback rather than a hard abort.

### DK-02 — Boot-time route scan classifies folders by `endsWith("api"/"sync")` instead of the registered marker  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** reports+review (devkit-gen Hard block #1 / devkit-quality Hard block #1 / review QUA-028 + CFG-02 / MISSING)
- **Current location:** `packages/devkit/src/loader.ts:249` (`scanApiFolder`) and `:392` (`scanSyncFolder`)
- **Original claim:** Any folder whose lowercase name ends in "api"/"sync" is treated as a route folder; a custom `apiMarker`/`syncMarker` registered via `registerRoutingRules` is ignored on the boot scan, so boot and hot-reload disagree, and innocent folders (`openapi/`, `serpapi/`, `vsync/`) are swallowed as route folders.
- **Verification (current code):** `if (!file.toLowerCase().endsWith("api")) { ...recurse... }` (line 249) and `if (!file.toLowerCase().endsWith("sync")) { ...recurse... }` (line 392) are unchanged. The hot-reload twins (`upsertApiFromFile` line 190 / `upsertSyncFromFile` line 323) and the version-token loops DO use `getRoutingRules()`, confirming the boot/hot-reload divergence. `discovery.ts` uses an exact `/_api/` segment match, so dev and generated artifacts permanently disagree for an `openapi/` folder.
- **Verdict & why:** CONFIRMED. Both scans agree; both Medium is correct. The exact-marker fix (`file !== getRoutingRules().apiMarker` recurse) is the documented direction.
- **Recommendation:** Match the exact resolved marker in both scan functions, aligning the boot scan with `resolveApiRouteMetaFromPath`/`discovery.ts`.

### DK-03 — `registerRoutingRules` custom markers / custom srcDir only honored by half the pipeline  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review (CFG-02 / HOOKS#1 from devkit-quality)
- **Current location:** `packages/devkit/src/templateInjector.ts:128-136` (`isInApiFolder`/`isInSyncFolder` hardcode `/_api/`,`/_sync/`), `:170,176` (version regexes `_v\d+$` etc.), `typeMap/routeMeta.ts:20,46` (`src\/(?:(.+?)\/)_api\//`), `importDependencyGraph.ts:160-162` (`isRouteFile` hardcodes `/src/`,`/_api/`,`/_sync/`)
- **Original claim:** Several modules hardcode `_api`/`_sync`/`src` instead of routing through `getRoutingRules()`/`getSrcDir()`, so a consumer using the documented custom-marker/custom-srcDir hook gets broken template injection, broken type-map route metadata, and dead hot-reload dependency fan-out.
- **Verification (current code):** Confirmed verbatim: `isInApiFolder` = `normalized.includes('/_api/') && ...` (line 130); `isInSyncFolder` = `normalized.includes('/_sync/')` (line 135); `toApiBaseName` strips `/_v\d+$/` (line 170); `toSyncBaseName` strips `/_(?:server|client)_v\d+$/` (line 176); `routeMeta.extractPagePath` anchors `/src\/(?:(.+?)\/)_api\//` (line 20); `importDependencyGraph.isRouteFile` = `includes('/src/') && (includes('/_api/') || includes('/_sync/'))` (line 160-161).
- **Verdict & why:** CONFIRMED. The package's headline extensibility story is half-wired. This + DK-02 are the single most important correctness fixes per the quality scan.
- **Recommendation:** Route every marker/path classification through `getRoutingRules()` helpers + core's `getSrcDir()`; add a regression test that registers a custom marker + srcDir and asserts injection, type-map page paths, and dependency fan-out all work.

### DK-04 — `isGeneratedPath` omits `apiInputSchemas.generated.ts` — every regen self-triggers a second full regeneration  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** reports+review (devkit-quality Hard block #2 / review QUA-029)
- **Current location:** `packages/devkit/src/hotReload.ts:176-181`
- **Original claim:** `isGeneratedPath` filters only `apiTypes.generated.ts` and `apiDocs.generated.json`, but the generator also writes `apiInputSchemas.generated.ts` into the watched srcDir; that write passes the check, qualifies as a route-dependency file, and schedules another full type-map regen + dependency fan-out. The loop only terminates because `writeFileIfChanged` skips identical content. Also: filename-substring check rather than the core path getters means a renamed artifact re-opens the loop.
- **Verification (current code):** Unchanged — the function returns true only for `apiTypes.generated.ts` and `apiDocs.generated.json` (lines 178-179). `apiInputSchemas.generated.ts` IS emitted by `emitterArtifacts.ts:571` via `getGeneratedApiSchemasPath()`. So a change to that file passes `isTypeMapRelevantFile` (line 183: `if (isGeneratedPath(...)) return false` — schemas file is NOT filtered) and triggers regeneration.
- **Verdict & why:** CONFIRMED. Wasted multi-second ts.Program rebuild on every API input edit.
- **Recommendation:** Derive `isGeneratedPath` from `getGeneratedSocketTypesPath()` / `getGeneratedApiSchemasPath()` / `getGeneratedApiDocsPath()` so custom paths are covered, and include the schemas file.

### DK-05 — Missing `auth` export is fail-open at runtime while AST extractor defaults fail-closed (contradiction)  ·  severity: high(review)/med(reports)  ·  status: CONFIRMED
- **Sources:** reports+review (devkit-gen Medium "static auth.login collapses to public" / review SEC-03 high)
- **Current location:** runtime/loader default `packages/devkit/src/loader.ts:221,292` (`login: auth.login || false`); AST default `packages/devkit/src/typeMap/apiMeta.ts:241,268` (`{ login: true }`); non-literal collapse `apiMeta.ts:251`
- **Original claim:** (reports) `extractAuth` only treats `login` as `true` for the literal `true` keyword — any imported const / ternary / spread collapses to `login:false` in `apiMetaMap`, silently removing the route from the test-runner auth sweep. (review SEC-03) Separately, a route that OMITS `export const auth` is treated PUBLIC at runtime (loader `auth.login || false`) but login-required by the AST extractor (`{login:true}`) — so every diagnostic surface lies about protection while the handler accepts anonymous callers.
- **Verification (current code):** Both confirmed. `apiMeta.ts:251` is exactly `login = propInit.kind === ts.SyntaxKind.TrueKeyword;` (any non-`true`-literal → `false`). `apiMeta.ts:241` returns `{ login: true }` when the `auth` object is absent/non-object, and the catch-all at `:268` returns `{ login: true }` — fail-closed in the extractor. But `loader.ts:221/292` is `login: auth.login || false` — fail-OPEN at runtime for a missing export. The two defaults genuinely disagree.
- **Verdict & why:** CONFIRMED, and review's higher severity framing is the sharper one: the live defect is the **direction mismatch** (runtime fail-open vs tooling fail-closed for a missing `auth` export), which is a silent auth-sweep blind spot AND a tooling-lies-about-protection hazard. The reports/ "non-literal collapses to public in the map" is also true and compounds it. Note runtime ENFORCEMENT is independent (reads the real imported object), so this is a guardrail/visibility defect, not a direct bypass — except for the genuinely-missing-export case where runtime itself is fail-open.
- **Recommendation:** Pick one default everywhere; the live defect is the DISAGREEMENT, not the direction. ~~fail-closed is correct (Rule 19). In `loader.ts` use `login: auth.login ?? true`; in `apiMeta.ts` ... treat as protected ...~~
- **RESOLUTION (2026-06-13, user override):** The direction was reversed to PUBLIC-by-default at the user's explicit instruction. A route that omits `export const auth` (or whose `login` can't be read as a literal) is now `{ login: false, additional: [] }` in BOTH the runtime loader (`loader.ts` `auth.login ?? false`) AND the AST extractor (`apiMeta.ts` defaults `login = false`, missing/non-object `auth` → `{ login: false }`, parse-failure catch-all → `{ login: false }`) AND the codegen fallback (`emitterArtifacts.ts` `{ login: false }`). The test-runner auth sweep already reads `meta?.auth.login ?? false`, so it agrees. The original blind-spot (runtime vs tooling disagreement) is closed — all four surfaces now report "public" for an auth-less route. To protect a route, declare `auth: { login: true }`.

### DK-06 — `scanFunctionsFolder` tree-walk can pollute `Object.prototype` via a `__proto__` directory  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review (SEC-35)
- **Current location:** `packages/devkit/src/loader.ts:513-519`
- **Original claim:** `let target = devFunctions; for (const part of basePath) { ... target = target[part] }` with raw directory names; a folder named `__proto__` resolves `target[part]` to `Object.prototype` and the next assignment writes onto it for the whole dev process.
- **Verification (current code):** Confirmed. Lines 513-519 walk `basePath` segments with `target[part] = {}` / `target = target[part]` and `target[fileName] = resolvedFunctionModule` (line 531) — no `Object.create(null)`, no reserved-key guard. `devFunctions` is a plain object literal.
- **Verdict & why:** CONFIRMED. Low — attacker is the consumer's own filesystem, dev-only. Classic recursive-merge pollution shape in framework code.
- **Recommendation:** Skip reserved keys (`__proto__`/`constructor`/`prototype`) and/or build the tree with `Object.create(null)`. Apply the same guard in the `generateServerRequests.ts` codegen mirror.

### DK-07 — DEAD CODE: `typeMap/emitter.ts` (303 lines) is an unreferenced older copy of `emitterArtifacts.ts`  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (devkit-quality Code quality #1)
- **Current location:** `packages/devkit/src/typeMap/emitter.ts` (whole file)
- **Original claim:** No file imports `typeMap/emitter`; it duplicates `buildTypeMapArtifacts`/`writeTypeMapArtifacts`/etc. with stale behavior (`T = any` response generics, no schemas emission, no `writeFileIfChanged`, no identifier validation, unconditional writes). Still listed as live in `CLAUDE.md:80`.
- **Verification (current code):** The file still exists (`ls` confirms). Grep for `typeMap/emitter'` and `'./emitter'` returns zero importers; `typeMapGenerator.ts:4` imports `emitterArtifacts`. CLAUDE.md "Internal modules" table still says `typeMap/emitter.ts + emitterArtifacts.ts | Renders generated files`.
- **Verdict & why:** CONFIRMED dead code (report-only — flag, don't delete per Rule 27/Report-Without-Auto-Fixing).
- **Recommendation:** Delete `emitter.ts` and drop the `emitter.ts` mention from the CLAUDE.md internal-modules row.

### DK-08 — DEAD CODE: `extractValidation` exported + documented but never invoked  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (devkit-quality Code quality #2 + Docs #4); related devkit-gen Docs gap
- **Current location:** `packages/devkit/src/typeMap/apiMeta.ts:88-120`
- **Original claim:** `extractValidation` is exported and documented (`docs/type-map-generation.md:134` claims its output is surfaced via `apiMetaMap`) but is never called anywhere in the repo; `apiMetaMap` emission only carries `method`/`auth`/`rateLimit`. Dev gets `validation` by importing the module at runtime instead.
- **Verification (current code):** Confirmed. `extractValidation` defined at apiMeta.ts:88. Grep across `packages/` finds it only in apiMeta.ts itself, `packages/devkit/docs/type-map-generation.md`, and `framework-docs/.../ARCHITECTURE_EXTENSION_POINTS.md` — zero call sites in source. The dev loader instead destructures `validation` from the imported module (loader.ts:209,285).
- **Verdict & why:** CONFIRMED. Dead export + a false doc claim that its output is emitted into the generated file.
- **Recommendation:** Either wire `extractValidation` into `apiMetaMap` emission (so prod/dev parity for the toggle uses one mechanism) or remove the export; fix the `type-map-generation.md:134` claim either way.

### DK-09 — Blanket `/* eslint-disable */` on 7 live framework source files  ·  severity: med(reports)/high(review)  ·  status: CONFIRMED
- **Sources:** reports+review (devkit-quality Code quality #3 / review QUA-002, merged at highest severity High)
- **Current location:** `loader.ts:2`, `hotReload.ts:2`, `templateInjector.ts:2`, `typeMap/discovery.ts:2`, `typeMap/extractors.ts:2`, `typeMap/routeMeta.ts:2`, `typeMap/tsProgram.ts:2` (each preceded by `/* eslint-disable unicorn/no-abusive-eslint-disable */`)
- **Original claim:** Every lint rule (incl. type-safety) is off for ~2,900 lines of live framework logic, and the guard rule that bans the blanket form is itself disabled first — violating root CLAUDE.md Rule 11 / 7a and hiding `any`-typed dynamic-import destructuring at loader.ts:209.
- **Verification (current code):** Grep confirms all 7 files still open with the `unicorn/no-abusive-eslint-disable` disable followed by bare `/* eslint-disable */`. (Template files under `templates/*` also carry it — justified there as injected text.)
- **Verdict & why:** CONFIRMED. On severity: review's High is for the package's largest, most logic-heavy modules; reports' Medium is defensible since devkit is dev-only (not request-path like the api/sync handlers in the same merged QUA-002). Resolving from impact: **Medium for devkit specifically** (dev-time tooling, not attack-facing) — the High in QUA-002 was driven by the api/core/sync members of that merge, not devkit's.
- **Recommendation:** Replace the blanket disables with narrow per-line disables (the sibling `handleHttpApiRequest.ts` proves it's feasible) so the zero-warning policy actually covers these modules.

### DK-10 — Supervisor timing constants hardcoded; crash-restart loop has no backoff or cap  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports+review (devkit-gen Missing config / devkit-quality Missing config #1 / review CFG-33)
- **Current location:** `packages/devkit/src/supervisor.ts:20-21` (`RESTART_DEBOUNCE_MS=150`, `CRASH_RESTART_DELAY_MS=300`), force-exit grace + `awaitWriteFinish` constants further down
- **Original claim:** All supervisor timings are hardcoded with no env/JSON override and no exponential backoff / max-retries; a server that crashes on boot respawns every 300ms forever.
- **Verification (current code):** Confirmed — `const RESTART_DEBOUNCE_MS = 150;` / `const CRASH_RESTART_DELAY_MS = 300;` at lines 20-21, only `LUCKYSTACK_ENV_FILES` is env-overridable (line 27). No backoff logic.
- **Verdict & why:** CONFIRMED. Low. The no-core-import invariant means an env-var knob is the right shape.
- **Recommendation:** `LUCKYSTACK_SUPERVISOR_RESTART_DEBOUNCE_MS` / `_CRASH_DELAY_MS` env overrides + exponential backoff capped at N consecutive fast crashes before requiring a file change to retry.

### DK-11 — Supervisor `CORE_WATCH_GLOBS` stale vs scaffolded layout + not extendable  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review (CFG-12)
- **Current location:** `packages/devkit/src/supervisor.ts:50-59`
- **Original claim:** Watches `server/bootstrap/**`, `server/auth/**`, `server/functions/{db,redis,sentry}.ts` — but the scaffold ships the shims at root `functions/` (db/redis/sentry/session.ts) and `server/` has only config/hooks/server.ts. So editing `functions/db.ts`, `server/hooks/**`, `services.config.ts`, `deploy.config.ts` does NOT restart the dev server. Only `LUCKYSTACK_ENV_FILES` is overridable.
- **Verification (current code):** Confirmed verbatim — `CORE_WATCH_GLOBS` = `['config.ts', ...getEnvFiles(), 'server/server.ts', 'server/bootstrap/**/*.ts', 'server/auth/**/*.ts', 'server/functions/db.ts', 'server/functions/redis.ts', 'server/functions/sentry.ts']`. No `functions/*.ts` (root), no `server/hooks/**`, no `services.config.ts`/`deploy.config.ts`, no watch-glob override.
- **Verdict & why:** CONFIRMED. The list has drifted from the layout the scaffolder ships — a silent stale-server footgun.
- **Recommendation:** Update defaults to the real scaffold layout (`functions/*.ts`, `server/**/*.ts`, `services.config.ts`, `deploy.config.ts`) + a `LUCKYSTACK_SUPERVISOR_WATCH` append env knob (consistent with the no-core-import design).

### DK-12 — Supervisor child command fixed to tsx + `server/server.ts` (not extensible)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (devkit-gen Missing config + Hooks; devkit-quality Hooks #4)
- **Current location:** `packages/devkit/src/supervisor.ts:61,67`
- **Original claim:** `tsxCliPath = .../node_modules/tsx/dist/cli.mjs` and `childArgs = [tsxCliPath, ...tsconfigServerArgs, 'server/server.ts']` are hardcoded; consumers running the server differently (bun, compiled JS, custom entry) must re-implement the whole supervisor.
- **Verification (current code):** Confirmed — line 61 hardcodes the tsx path, line 67 hardcodes `'server/server.ts'`. No env/argv override for the child command/entry.
- **Verdict & why:** CONFIRMED. Low.
- **Recommendation:** Accept the child command/entry via env vars or argv (cf. the already-overridable `LUCKYSTACK_ENV_FILES`).

### DK-13 — No pre/post-restart hook on the supervisor  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review (HOK-23)
- **Current location:** `packages/devkit/src/supervisor.ts` (restart flow `scheduleRestart`→kill→`startChild`)
- **Original claim:** No seam to run work (e.g. `prisma generate`, cache clear, crash-loop notification) between child death and respawn.
- **Verification (current code):** Confirmed — `startChild` (line 76) and the restart machinery offer no hook; supervisor intentionally imports nothing from core, so a command-style env hook fits.
- **Verdict & why:** CONFIRMED. Low. Consistent with DK-10/DK-12 — the supervisor's whole config surface is sealed behind one env var.
- **Recommendation:** `LUCKYSTACK_SUPERVISOR_PRE_RESTART_CMD` (shell command awaited with a timeout before each respawn), logging its exit code.

### DK-14 — No hot-reload / codegen lifecycle hooks + no watcher teardown handle  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review (HOK-07) + reports (devkit-quality Hooks #3 — no teardown)
- **Current location:** `packages/devkit/src/hotReload.ts:39` (`setupWatchers` returns `undefined`); reload outcomes are `console.log`-only inside `setupWatchers`
- **Original claim:** (HOK-07) No seam to run follow-up codegen after type-map regen, surface reload failures, or collect dev-loop metrics — outcomes are console side effects only. (Hooks#3) `setupWatchers()` creates 3+ chokidar watchers and returns nothing; the `FSWatcher` instances are never stored/closeable, so an embedding consumer (tests, programmatic restart) can't dispose them.
- **Verification (current code):** Confirmed — `export const setupWatchers = () => {` (line 39) with no return value (grep finds no `return` of a watcher/handle). No `registerDevHooks`-style registry exists.
- **Verdict & why:** CONFIRMED. Medium (dev-only). Two facets of the same "the dev loop is a closed box" gap.
- **Recommendation:** Return a `{ close() }` dispose handle from `setupWatchers`, and add a `registerDevHooks({ onRouteReloaded, onTypeMapGenerated, onTemplateInjected })` registry invoked from the reload/regen/inject paths.

### DK-15 — `RoutingRules.ignore` predicate not honored by the dev loader walks  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (devkit-quality Hooks #2)
- **Current location:** `packages/devkit/src/loader.ts` (`collectTsFiles`, `scanApiFolder`, `scanSyncFolder`, `scanFunctionsFolder`, `walkPageFiles`)
- **Original claim:** `RoutingRules.ignore` is consulted in `discovery.ts` + `routeNamingValidation.ts` but never by the loader walks, so an ignored tree (e.g. `__fixtures__`) is excluded from generated types yet still loaded as live dev routes.
- **Verification (current code):** Confirmed — grep for `ignore` in `loader.ts` returns no matches; none of the scan walks call the predicate.
- **Verdict & why:** CONFIRMED. Low — dev/generated disagreement on ignored trees.
- **Recommendation:** Apply the same `ignore` predicate in the loader walks.

### DK-16 — Import-dependency graph cannot follow custom tsconfig path aliases  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review (MIS-006)
- **Current location:** `packages/devkit/src/importDependencyGraph.ts:134-158` (`resolveImportToFile`)
- **Original claim:** `resolveImportToFile` resolves only relative, literal `config`, `src/`, `@/`, and `shared/` specifiers; any other tsconfig `paths` alias returns null, so edits to a module imported via a custom alias never fan out to dependent routes (stale module served, only a generic log).
- **Verification (current code):** Confirmed — lines 135-157 handle exactly `node:` (null), `config`, `./`/`../`, `src/`|`@/`, `shared/`, and `return null` for everything else. No tsconfig `paths` reading, no `registerImportResolver` hook.
- **Verdict & why:** CONFIRMED. Medium — silent loss of cascade hot reload for a consumer with their own alias convention.
- **Recommendation:** Read the consumer's tsconfig `paths` (TS already a dep) and resolve generically, or expose `registerImportResolver`; at minimum document the supported specifier forms in `docs/hot-reload.md`.

### DK-17 — `normalizeImportPath` hardcodes `src/_sockets` despite configurable `generatedSocketTypes` path  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review (CFG-11) + reports (devkit-quality Missing config #4)
- **Current location:** `packages/devkit/src/typeMap/tsProgram.ts:146` + `typeMap/extractors.ts:18-26`
- **Original claim:** Both files compute emitted import specifiers relative to `path.join(ROOT_DIR, 'src', '_sockets')` (the DEFAULT artifact location), but the location is the `paths.generatedSocketTypes` knob; `functionsMeta.ts:60` already derives it correctly via `path.dirname(getGeneratedSocketTypesPath())`. Overriding the path yields wrong relative imports in the generated file.
- **Verification (current code):** Findings in both scans point to the same `ROOT_DIR/src/_sockets` hardcode duplicated byte-identically across tsProgram.ts and extractors.ts (the reports scan also flags these two as byte-identical `normalizeImportPath`/`mergeUnresolvedSymbols` copies). Consistent with the broader `src/`-hardcoding family (CFG-#4). Not separately re-opened line-by-line here but corroborated by two independent scans + the functionsMeta.ts counter-example.
- **Verdict & why:** CONFIRMED. Medium.
- **Recommendation:** Replace the hardcoded `fromDir` in both files with `path.dirname(getGeneratedSocketTypesPath())` (matching functionsMeta.ts); update `docs/ts-program-cache.md:143`.

### DK-18 — Page/API/sync names interpolated into generated TS string literals without escaping  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (devkit-gen Low)
- **Current location:** `packages/devkit/src/typeMap/emitterArtifacts.ts:277,279,295` (`content += '${pagePath}': {` / `'${apiName}': {` / `'${version}': {`) and `:291` path interpolation
- **Original claim:** `pagePath`/`apiName` derive from folder/file names; a folder name with a quote/backtick produces malformed generated TS. `validateGeneratedTypeIdentifiers` uses `ts.createSourceFile` which does not throw on syntax errors, so the corrupt file is still written.
- **Verification (current code):** Confirmed — line 277 `content += \`  '${pagePath}': {\n\`;`, line 279 `'${apiName}': {`, no `JSON.stringify`/charset validation on the interpolated identifiers. Route-naming validation forbids `/` and enforces the version suffix but not a quote/backtick in the folder name.
- **Verdict & why:** CONFIRMED. Low — dev-time, self-inflicted, but a confusing build break instead of a clear "rename this folder" error.
- **Recommendation:** `JSON.stringify`-quote interpolated identifiers, or validate the page/name charset up front.

### DK-19 — `writeTypeMapArtifacts` swallows all write failures (exits 0 with stale generated types)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (devkit-quality Code quality / devkit-gen Code quality)
- **Current location:** `packages/devkit/src/typeMap/emitterArtifacts.ts:587-589`
- **Original claim:** The `catch (error) { console.error(...); }` returns normally — a disk-full/EACCES while writing `apiTypes.generated.ts` leaves stale types on disk while the calling script exits 0.
- **Verification (current code):** Confirmed — the whole write body (lines 563-586) is wrapped in `try { ... } catch (error) { console.error('[TypeMapGenerator] Error writing type map or docs:', error); }` with no rethrow.
- **Verdict & why:** CONFIRMED. Low. Generation should propagate write errors so the build fails loudly.
- **Recommendation:** Rethrow (or return a failure result the caller checks) after logging.

### DK-20 — `registerRoutingRules` does not compose (last caller wins, silently erasing prior overrides)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (devkit-quality Code quality #8)
- **Current location:** `packages/devkit/src/routingRules.ts:90-92`
- **Original claim:** `activeRules = { ...DEFAULT_RULES, ...overrides }` resets to defaults on every call, so two independent callers (consumer overlay + a plugin) silently erase each other's overrides — unlike `registerTemplateRule`, which appends.
- **Verification (current code):** Confirmed — line 91 is exactly `activeRules = { ...DEFAULT_RULES, ...overrides };` (spreads DEFAULT_RULES, not the current `activeRules`).
- **Verdict & why:** CONFIRMED. Low. Should compose over `activeRules`.
- **Recommendation:** `activeRules = { ...activeRules, ...overrides }` (seeded from `DEFAULT_RULES` at module load) so successive registrations layer.

### DK-21 — Regex-based mutation of user source files is brittle (`[^}]*` truncates nested objects)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (devkit-quality Code quality #7)
- **Current location:** `packages/devkit/src/templateInjector.ts:623,674` (and import-rewrite regexes nearby); writes back via `fs.writeFileSync` (lines 643, ~706)
- **Original claim:** `updateClientFileForDeletedServer` / paired-update replace `clientInput: { ... }` with `/^(\s*)clientInput:\s*\{[^}]*\}/m` — `[^}]*` cannot match a nested object type (`clientInput: { user: { id: string } }`), truncating at the first `}` and corrupting the user's interface. Result written straight back to the user's file.
- **Verification (current code):** Confirmed — line 623 `content.replace(/^(\s*)clientInput:\s*\{[^}]*\}/m, '$1clientInput: SyncClientInput<...>')` and line 674 the same `[^}]*` pattern in `updateClientFileForDeletedServer`, followed by `fs.writeFileSync(clientFilePath, content, ...)` (line 643).
- **Verdict & why:** CONFIRMED. Low (triggers only on the delete-paired-server / re-pair flow with a nested clientInput type) but it corrupts the user's own source file.
- **Recommendation:** Parse with the TS AST (already a dependency) instead of `[^}]*` regexes when rewriting user source.

### DK-22 — devkit CLAUDE.md / docs drift: missing exports, wrong chokidar version, wrong signatures, dead-branch sentinels  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports+review (devkit-gen Docs gaps + devkit-quality Docs #1/#2/#3/#5 + review QUA-064)
- **Current location:** `packages/devkit/CLAUDE.md` (Function Index lines ~57-59 duplicate-page trio; line ~103 chokidar; `resolveRuntimeTypeText` row); `package.json:59` (`chokidar ^5.0.0`); `typeMap/routeMeta.ts:22/48` vs `emitterArtifacts.ts:291`
- **Original claim:** (a) CLAUDE.md documents `assertNoDuplicatePageRoutes`/`collectDuplicatePageRoutes`/`formatDuplicatePageRouteIssues`/`DuplicatePageRouteIssue` as public Function-Index entries but `index.ts` exports none; (b) CLAUDE.md says `chokidar@^4.0.3` while package.json declares `^5.0.0`; `dotenv` + the `luckystack-dev` bin are undocumented; (c) `resolveRuntimeTypeText(typeText)` signature is wrong — it takes `{ typeText, filePath }`; (d) API-root sentinel `system` vs sync-root sentinel `root` are undocumented and the emitter's `pagePath === 'root'` API branch is dead.
- **Verification (current code):** (a) Confirmed — `index.ts` exports `assertNoDuplicateNormalizedRouteKeys` + `assertValidRouteNaming` only; the duplicate-page trio + `DuplicatePageRouteIssue` live only in `routeNamingValidation.ts:339-425`, never re-exported. (b) Confirmed — `package.json:59` `"chokidar": "^5.0.0"`, `:60` `"dotenv"`, two bins (`luckystack-validate-deploy` + `luckystack-dev`); CLAUDE.md still says `chokidar@^4.0.3`. (c) Confirmed — `runtimeTypeResolver.ts:427` is `resolveRuntimeTypeText = ({ typeText, filePath }: {...})` and returns success no-op when `filePath` omitted (line 435). (d) Confirmed — `routeMeta.extractPagePath` returns `'system'` for src-root API (line 22/25), `extractSyncPagePath` returns `'root'` for src-root sync (line 48/51), and `emitterArtifacts.ts:291` checks `pagePath === 'root'` in the API branch (dead for APIs).
- **Verdict & why:** CONFIRMED across all four sub-claims. Low individually but they actively mislead an AI driving the package (import errors, wrong call shape, wrong dep version).
- **Recommendation:** Export the duplicate-page trio + type (or move the rows to the Internal-modules table); fix chokidar to `^5.0.0` + document `dotenv`/`luckystack-dev`; correct the `resolveRuntimeTypeText` signature row; document (or unify) the `system`/`root` sentinels and remove/justify the dead `pagePath === 'root'` API branch.

### DK-23 — Zod emitter has no consumer extension hook; unsupported shapes silently become `z.any()`  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (devkit-gen Hooks & extensibility)
- **Current location:** `packages/devkit/src/typeMap/zodEmitter.ts:26,28` (`anyFallback`, `convertTypeNode`)
- **Original claim:** `convertTypeNode` is a closed switch; unsupported shapes (branded types, `Date` variants, `Uint8Array`) silently become `z.any()` with no consumer-supplied converter hook — a silent validation hole for a framework whose runtime fuzz/validation relies on these schemas.
- **Verification (current code):** Confirmed — `const anyFallback = (reason: string): string => \`z.any() /* ${reason} */\`;` (line 26) and `convertTypeNode` (line 28) is a closed `kind`-switch with no registry/override. Out-of-scope shapes fall back to `z.any()` with a TODO comment.
- **Verdict & why:** CONFIRMED. Low. No extension point for custom type converters.
- **Recommendation:** Expose a `registerZodConverter((node) => string | null)` hook evaluated before the built-in switch, for custom/branded types.

### DK-24 — Dev loader drops `errorFormatter`/`validation` for sync routes (dev/prod divergence)  ·  severity: high(review)  ·  status: ALREADY-FIXED
- **Sources:** review (QUA-013)
- **Current location:** `packages/devkit/src/loader.ts:362-363` (hot-reload upsert) and `:442-443` (boot scan)
- **Original claim:** The dev loader builds sync `_server` entries as only `{ main, auth, inputType, inputTypeFilePath }` in both the hot-reload and boot-scan paths, dropping `errorFormatter` + `validation` that the prod generator emits — so a per-route sync `errorFormatter` works in prod but is silently ignored in all of dev.
- **Verification (current code):** FIXED. Both sync `_server` assignment sites now include `validation: resolvedSyncModule.validation` and `errorFormatter: resolvedSyncModule.errorFormatter`, with explicit comments citing QUA-013/QUA-044 (lines 358-363 for the hot-reload path, 440-443 for the boot scan). The API paths (lines 229-230, 300-301) likewise forward `validation`/`errorFormatter`.
- **Verdict & why:** ALREADY-FIXED. This is the one finding the older review/ scan got wrong because the code changed after it ran. (Note the QUA-044 caveat — that the sync handlers may still ignore `validation` at runtime — is a sync-package concern, out of devkit scope.)
- **Recommendation:** None for devkit; optionally add the parity test the scan suggested asserting dev-loader and prod-generator sync entry shapes match.

### DK-25 — God functions / duplicated helpers (maintainability)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (devkit-gen + devkit-quality Code quality)
- **Current location:** `emitterArtifacts.ts:191-496` (`buildTypeMapArtifacts` ~300 lines, 3 duplicated group-by-name/sort loops); `hotReload.ts:39-549` (`setupWatchers` ~510 lines, 6 jobs); `templateInjector.ts` (~756 lines); byte-identical `normalizeImportPath`/`mergeUnresolvedSymbols` in `tsProgram.ts` + `extractors.ts`; duplicated `devApis` entry construction in `loader.ts` (two sites each for api/sync); three independent `@docs` parsers
- **Original claim:** Several oversized closures-over-mutable-state modules and byte-for-byte duplicated helpers (the QUA-013 regression was exactly the failure mode the loader-entry duplication invites).
- **Verification (current code):** Corroborated structurally — `setupWatchers` is a single large arrow (line 39), `buildTypeMapArtifacts` spans the emitter, the loader builds `devApis`/`devSyncs` entries at four sites (lines 218, 289, 353, 435), and the tsProgram/extractors duplication is flagged by both scans. Not exhaustively line-counted here; these are maintainability observations, not defects.
- **Verdict & why:** CONFIRMED as maintainability findings (report-only). Low.
- **Recommendation:** Extract shared grouping/entry-construction helpers; split `setupWatchers`/`templateInjector` along their internal jobs; single-source the duplicated helpers and the `@docs` parser.

### DK-26 — Color-arg logging depends on core's opt-in `initConsolelog` monkey-patch (undocumented)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports (devkit-quality Code quality #5)
- **Current location:** dozens of `console.log(\`[HotReload] ...\`, 'red')` calls across `hotReload.ts`, `loader.ts`, `typeMapGenerator.ts`
- **Original claim:** The trailing color arg only works if the consumer called core's opt-in `initConsolelog()` patch; called from a plain build script (the documented `generateTypeMapFile()` usage) the literal words `red`/`green`/`cyan` print as arguments. Nothing in devkit documents this dependency.
- **Verification (current code):** Confirmed — the loader/hotReload logs throughout use the `(..., 'red')` color-arg convention (e.g. loader.ts:192/204/267/280/337; the `[loader][function]` conflict log at :502-505). devkit has no documented note that this requires core's console patch.
- **Verdict & why:** CONFIRMED. Low — cosmetic in scripts, but a real "why are there `red` strings in my output" confusion.
- **Recommendation:** Document the `initConsolelog()` dependency in devkit CLAUDE.md/docs, or guard the color arg.
