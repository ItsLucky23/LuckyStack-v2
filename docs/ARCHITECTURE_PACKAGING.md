# Packaging Architecture

> Single source of truth for LuckyStack package extraction strategy.

Last updated: 2026-04-21
Status: Active implementation plan

---

## 1) Product Goal

LuckyStack should be installable in a fresh Vite project as small, composable npm packages.

Target developer experience:

1. Install minimal `@luckystack/core`.
2. Add optional feature packages like `@luckystack/login` and `@luckystack/sync`.
3. Build app features without editing framework internals.

This replaces monolithic framework cloning as the default adoption path.

---

## 2) Package Model (Current Direction)

### 2.1 Core

`@luckystack/core`

Responsibilities:

- File-based routing primitives (page + API route contracts)
- API request client/server transport contract
- Shared response/error contracts and utilities
- Core UI/runtime primitives that should exist in every project:
	- template provider
	- middleware support
	- translation provider

Non-responsibilities:

- OAuth/credentials auth logic
- Presence/activity modules
- Sentry-specific logic

### 2.2 Login

`@luckystack/login`

Responsibilities:

- Credentials + OAuth login/logout flows
- Session provider and auth-related lifecycle APIs
- Optional package-provided default functions for login/session

Note:

- Session-aware behavior should come with login by default for most users.

### 2.3 Sync

`@luckystack/sync`

Responsibilities:

- Real-time sync transport
- Room targeting/fanout semantics
- Sync client callback contracts

### 2.4 Presence (sync++)

`@luckystack/presence`

Responsibilities:

- Online/offline/AFK/team activity state
- Socket status provider for multiplayer/team visibility

Dependencies:

- Depends on sync and a generic session contract.
- Must not require `@luckystack/login` directly.
- If login package is installed, presence can consume its session adapter.
- If login package is not installed, projects can provide a custom session adapter.

### 2.5 Sentry (optional)

`@luckystack/sentry`

Responsibilities:

- Register observability hooks for API/sync/auth lifecycle
- Read runtime behavior from a dedicated Sentry config
- Auto-enable only when:
	- Sentry is enabled in config
	- DSN exists in env
- No-op behavior when either condition is missing

Expected configuration contract:

- `sentry.enabled` boolean toggle
- DSN and environment values from env
- Optional release, sample rates, and transport tuning options

### 2.6 Dev Tooling

`@luckystack/devkit` (single dev package)

Reasoning:

- One package is simpler than splitting too early.
- Internally exposes separately toggled tools:
	- type generation
	- template injection
	- hot reload

---

## 3) Functions Injection Model (Current Direction)

### 3.1 Project-level functions folder

When installing `@luckystack/core`, projects should have a root-level `functions/` folder with default function modules.

Example:

```
project/
	functions/
		core/
			logger.ts
			responseNormalizer.ts
```

### 3.2 Package-contributed functions

Feature packages may add function bundles.

Example:

- `@luckystack/login` contributes session/auth functions
- `@luckystack/sync` contributes sync-related helpers

### 3.3 Merge contract

Runtime uses a merged, typed function registry:

1. Project functions (highest priority)
2. Installed package default functions
3. Core fallbacks

This keeps defaults usable while allowing user overrides.

Clarification:

- If project defines `functions/session/getSession`, that implementation overrides login package defaults.
- If project does not define it, and login package is installed, login package implementation is used.
- If neither project nor feature package defines it, core fallback is used.

---

## 4) Hook Contract

Hook model remains required for package extensibility.

Status: Scaffold implemented (2026-04-23). `server/hooks/registry.ts` and `server/hooks/types.ts` are live. `preApiExecute`, `postApiExecute`, `preSyncFanout`, `postSyncFanout` dispatch calls are wired. Auth/session/presence hooks are typed in the payload map but dispatch calls are deferred to their respective package extraction phases.

Stages:

- `pre:*` hooks (validate/transform/short-circuit)
- `post:*` hooks (augment side effects)

Rules:

- Deterministic order
- Typed payloads
- Isolated errors per hook — one failing handler never interrupts the main flow

Full inventory (typed in `server/hooks/types.ts`):

- Auth: postLogin, postRegister, postLogout
- Session: postSessionCreate, postSessionDelete
- API: preApiExecute, postApiExecute
- Sync: preSyncFanout, postSyncFanout
- Presence: prePresenceUpdate, postPresenceUpdate

Hooks not yet in the type map (add when packages need them):

- preLogin, preRegister, preLogout
- preSessionCreate, preSessionDelete, preSessionRefresh, postSessionRefresh
- preApiValidate, postApiValidate, preApiRespond, postApiRespond
- preSyncValidate, postSyncValidate, preSyncAuthorize, postSyncAuthorize
- preRouteResolve, postRouteResolve
- preErrorNormalize, postErrorNormalize

---

## 5) Type Safety and Devkit Strategy

### 5.1 Runtime independence

Runtime packages (`core/login/sync/presence/sentry`) must not require devkit at runtime.

### 5.2 Strict generated typing mode

When devkit typegen is enabled:

- Generate strict API/sync/function maps
- Build/lint should fail when generated artifacts are stale or missing

### 5.3 Relaxed mode

When devkit is not enabled:

- Runtime still works
- Typing is less strict/fallback-safe

Default behavior:

- `strictTypegen = true` by default
- Projects can explicitly disable strict mode when needed

Operational rule:

- Strict mode should be the default for CI and production branches.
- Relaxed mode is an explicit opt-out for early prototyping.

---

## 6) Multi-Service Build and Polyrepo Direction

This is a required target, not optional.

Desired project structure example:

```
src/
	housing/
	vehicles/
	candidates/
```

Build outputs required:

1. Frontend aggregate build
- Scans full `src` and emits one frontend asset output with all pages.

2. Preset-scoped backend builds
- Build inputs are preset names from a dedicated build-routing config file.
- Each preset maps to one or more service keys.
- Backend generation emits one route map file per preset: `generatedApis.PRESETNAME.ts`.
- Running build with no preset arguments builds all presets.
- Running build with preset arguments builds only those presets.

3. Service ownership model
- Root `src/` is the `system` service.
- Service folders are first-level folders inside `src/` (for example `src/vehicles`, `src/candidates`).
- Single-service backend builds are represented as a preset containing exactly one service.
- Services not assigned to any preset are excluded from scoped builds and logged as warnings.

Routing/runtime behavior target:

- In development, engineers should be able to run frontend plus one local service, multiple local services, or a full local server.
- Requests for routes not owned by local service should be forwarded to configured remote environments (for example staging service endpoints).
- Health polling discovers newly started local service servers and routes new traffic to local targets when healthy.
- When a service target changes in development, socket reconnection/switching is acceptable; transient in-memory state loss or in-flight call loss is acceptable in dev mode.
- This enables focused local debugging in large codebases without running every service locally.

Important runtime note:

- Frontend uses one origin in dev (for example localhost), so a dev-side router is required.
- This router can be implemented as built-in LuckyStack load balancer backend, external proxy, or hybrid setup.

Service routing contract:

- API/sync route names must start with service key as first segment:
	- `vehicles/getAll`
	- `system/session`
- Transport URLs keep the service key in the segment after `api/` or `sync/` (for example `/api/candidates/getAll/v1` -> `candidates`).
- The load balancer reads that service segment and forwards to configured backend URL for that service.
- If requested service key has no backend assignment, load balancer returns a clear error (`serviceNotAssigned`).
- Service ownership is one-to-one: a service may belong to only one preset.

Load balancer config model:

- Provide a project config file that maps service -> backend URL.
- Provide a load balancer config template in the framework docs/templates.
- Provide a lightweight load balancer backend server implementation in framework tooling.

### 6.2 Dev traffic routing options

Option A: Built-in LuckyStack load balancer backend

- Pros: service-key aware by default, no extra infrastructure dependency.
- Cons: we must own mature proxy behaviors ourselves.

Option B: External reverse proxy (for example Caddy)

- Pros: mature routing/TLS/compression/retry/logging behavior.
- Pros: simple local forwarding from one frontend origin to mixed local/remote service targets.
- Cons: needs extra config generation and sync with service map.

Recommended dev default:

- Use external proxy (Caddy) with generated config from service mapping.
- Keep built-in load balancer backend available as fallback/runtime adapter.

### 6.3 Production edge strategy

Proxy-first in production is valid and recommended.

Recommended production model:

1. Edge proxy handles TLS, HTTP/2/3, compression, websocket upgrade, retries, and access logs.
2. LuckyStack routing contract remains source of truth for service-key resolution.
3. Generated proxy config maps service keys to service upstreams.

This gives operational stability while preserving framework-level routing semantics.

Example mapping:

```
services:
	system: http://localhost:4100
	vehicles: http://localhost:4101
	housing: http://staging-housing.internal
	candidates: http://staging-candidates.internal
```

### 6.4 Name-collision and route-shape validation

Validation rules for template injector and type generation:

1. API/sync file names must not contain `/` in route name segments.
2. Invalid route naming must fail generation with explicit error.
3. Duplicate emitted route keys must fail generation.
4. `system` is reserved for root `src/` and `src/system` is invalid.
5. Preset configuration must fail when a service is assigned to multiple presets.

Example collision scenario to block:

- `src/test/_api/testApi_v1.ts` and a conflicting nested route that emits same final route key.

Bundling behavior:

- Invalid routes are ignored for bundling and reported as errors.
- Build should fail when strict typegen is enabled.

Package impact:

- Core must support first-segment service routing contract.
- Sync/login/presence packages must be service-root aware.
- Devkit typegen must support both aggregate and service-scoped generation modes.

---

## 7) Non-Breaking Extraction Rules

During migration:

1. No route shape changes.
2. No payload contract changes.
3. No mandatory config additions for existing projects.
4. New capabilities default to no-op/disabled.

---

## 8) Execution Order

1. Verify package boundaries and planning with user/team and freeze v1 package map.
2. Build complete pre/post hook inventory and assign ownership per package.
3. Finalize core boundaries and exports.
4. Implement project-level `functions/` contract + merge rules.
5. Extract login package with session provider and login hooks.
6. Extract sync package.
7. Extract presence package.
8. Add optional sentry package.
9. Ship devkit with typegen/template/hot-reload toggles.
10. Add service-scoped backend build target with first-segment service routing.
11. Ship load balancer backend server with service->URL config mapping and error-on-unassigned-service behavior.
12. Add dev forwarding for non-local service roots to staging/remote endpoints.

---

## 9) Required Code Changes Before Package Extraction

This section defines concrete implementation changes that must happen in the current codebase before package split can work reliably.

### 9.1 Route naming contract migration (API + sync)

All API and sync names must follow service-first naming.

Required runtime call shapes:

- `system/session`
- `system/logout`
- `vehicles/getAll`
- `housing/create`

Required migration:

1. Root/global API and sync calls must be renamed to `system/*`.
2. Internal helper usage must stop relying on implicit root names.
3. Existing calls that currently use root names must be updated to `system/*`.

### 9.2 Helper function behavior changes

`apiRequest` and `syncRequest` behavior must align with service-first contract.

Required behavior:

1. Validate that request name contains service segment.
2. Reject invalid names with stable error code (for example `routing.invalidServiceRouteName`).
3. Route parsing must use first segment as service key.

### 9.3 Dev loader and typegen changes

Dev/runtime loaders and generated maps must emit normalized service-first route keys.

Required changes:

1. Dev loader normalizes root/global routes to `system/*`.
2. Type generation emits keys in service-first format only.
3. Generated strict types must reflect service-first route naming in all maps.

### 9.4 Template injector and route validation

Template injector and generation pipeline must block ambiguous/invalid route names.

Required validation:

1. API/sync file names may not include `/` in the route name token.
2. Invalid names fail generation with explicit message and file path.
3. Duplicate normalized route keys fail generation.
4. Strict mode turns these into build failures.

### 9.5 Service-scoped backend build outputs

Build system must support preset-level backend targets.

Required outputs:

1. Frontend aggregate output (all pages).
2. One backend map artifact per preset (`generatedApis.PRESETNAME.ts`).
3. Single-service builds via single-service presets (for example `vehicles-only`).
4. Grouped builds via multi-service presets (for example `platform-core`, `marketplace-domain`).
5. Presetless build invocation should compile all presets.

### 9.6 Load balancer backend output

Framework tooling must produce a load balancer backend output.

Required behavior:

1. Parse first route segment as service key.
2. Forward to configured service backend URL.
3. Return explicit `serviceNotAssigned` error when mapping is missing.
4. Support local + remote target mix for development.
5. In development fallback mode, poll local service targets and switch new traffic to local when healthy.
6. Socket/API routing decisions should use the same service-target resolver.
7. Split/fallback mode requires shared Redis; startup hard-fails when Redis is unavailable.
8. Development mode may reconnect socket targets when local service health changes; this does not need zero-loss guarantees.

### 9.7 Presence package decoupling

Presence must not hard-depend on login package.

Required architecture:

1. Presence depends on sync and session interface.
2. Session interface may be provided by login package or custom adapter.
3. Presence runtime must work without `@luckystack/login` installation.

### 9.8 Functions folder + fallback resolution

Project-level functions must be first-class and override package defaults.

Required behavior:

1. Core installation creates root `functions/` structure.
2. Runtime registry resolution order:
	1. Project functions
	2. Package defaults
	3. Core fallbacks
3. Type generation includes all resolved function sources.
4. Project override must immediately affect runtime behavior.
5. Phase 1 (current target): keep full resolved function registry in scoped builds for runtime safety.
6. Phase 2 (future optimization): optional import-graph-based function pruning after explicit design + validation.

Status: Phase 1 implemented (2026-04-23). `functions/` folder established at project root. `scripts/generateServerRequests.ts` merges `functions/` (project) over `server/functions/` (package defaults) by module name — a file in `functions/session.ts` fully replaces `server/functions/session.ts` in the generated map. Phase 2 pruning remains deferred.

### 9.9 Sentry package activation contract

Sentry integration must be optional and configuration-driven.

Required behavior:

1. `@luckystack/sentry` auto-activates only when config enabled and DSN is present.
2. If disabled/missing DSN, package is no-op.
3. Runtime reads unified sentry config object.

### 9.10 Sentry helper exports

Sentry package should export helper functions so app code can instrument custom locations while reusing same global config.

Required exports:

1. `captureException`
2. `captureMessage`
3. `setUser`
4. `setTag`
5. `setContext`
6. `startSpan`
7. `withScope`

All helpers must use same package-level initialization and respect enabled/disabled state.

---

## 10) Configuration Examples

Canonical shape is TypeScript, split into two files at project root:

- `services.config.ts` — services + preset grouping. Stable build-time source of truth. Changes when services are added/renamed/regrouped.
- `deploy.config.ts` — resources (named redis/mongo handles) + environments (resource refs, per-service URL bindings, optional typed `fallback`). Changes when infra changes.

Validator (in `server/config/presetLoader.ts`) enforces:

1. `system` service must have `source: 'root'`; `src/system` is reserved.
2. A service belongs to exactly one preset.
3. Every environment `redis` / `mongo` must reference a known resource of the correct type.
4. If `env.fallback` is set, the source and target environments must reference the SAME resource key for both redis and mongo. This makes "two different Redis URLs that both respond" unrepresentable.
5. No fallback cycles.

### 10.1 services.config.ts (sketch)

```ts
export default {
	services: {
		system:   { source: 'root' },
		vehicles: { source: 'vehicles' },
		billing:  { source: 'billing' },
	},
	presets: {
		'core-preset':    { services: ['system'] },
		'fleet-preset':   { services: ['vehicles'] },
		'finance-preset': { services: ['billing'] },
	},
};
```

### 10.2 deploy.config.ts (sketch)

```ts
export default defineDeploy({
	resources: {
		redisShared: { type: 'redis', urlEnvKey: 'REDIS_URL', synchronizedEnvKeys: ['COOKIE_SECRET'] },
		mongoShared: { type: 'mongo', urlEnvKey: 'DATABASE_URL' },
	},
	environments: {
		development: {
			redis: 'redisShared',
			mongo: 'mongoShared',
			fallback: 'staging',                  // typed: keyof environments
			bindings: { system: 'http://localhost:4100', vehicles: 'http://localhost:4101' },
		},
		staging: {
			redis: 'redisShared',
			mongo: 'mongoShared',
			bindings: { system: 'https://staging-api.../system', vehicles: 'https://staging-api.../vehicles' },
		},
	},
	routing: { onMissingService: 'proxy-fallback', missingServiceErrorCode: 'serviceNotAssigned' },
	development: { enableFallbackRouting: true, healthPollMs: 5000, switchNewTrafficToLocalWhenHealthy: true },
});
```

### 10.1a Runtime bundle selection

Which preset's generated route map loads at runtime is controlled by the `LUCKYSTACK_BUNDLE` env var (previously `LUCKY_PRESET`):

- Unset: loads `server/prod/generatedApis.default.ts` (aggregate build).
- Set to a preset key: loads `server/prod/generatedApis.{preset}.ts`.
- The file is emitted by `scripts/generateServerRequests.ts` for every preset defined in `services.config.ts`.

### 10.1b Boot-time shared-resource handshake (recommended)

In addition to the static config check, on startup each bundle should:

1. Generate a boot UUID and write it to Redis at a well-known key (for example `luckystack:boot:{env}`).
2. If the current environment declares a `fallback`, hit the fallback's `/health` endpoint and assert it reports the same UUID.

This catches divergent `redis://...` URLs that both happen to respond. Implementation is out of scope for this doc; it belongs with the load balancer backend (§9.6).

### 10.2 Type generation config

```yaml
typegen:
	strictTypegen: true
	failOnInvalidRouteName: true
	failOnDuplicateRouteKey: true
	failOnReservedServiceFolder: true
	failOnServicePresetCollision: true
```

### 10.3 Sentry config

```yaml
sentry:
	enabled: true
	dsnEnvKey: SENTRY_DSN
	environmentEnvKey: NODE_ENV
	releaseEnvKey: SENTRY_RELEASE
	serverNameEnvKey: SENTRY_SERVER_NAME
	tunnel: null
	orgId: null
	projectId: null
	attachStacktrace: true
	sendDefaultPii: false
	maxBreadcrumbs: 100
	normalizeDepth: 5
	normalizeMaxBreadth: 1000
	debug: false
	enableTracing: true
	tracesSampleRate: 0.2
	tracesSampler: null
	profilesSampleRate: 0.0
	profilesSampler: null
	replaysSessionSampleRate: 0.0
	replaysOnErrorSampleRate: 0.0
	enableLogs: false
	beforeSendEnabled: true
	beforeBreadcrumbEnabled: true
	beforeSendTransactionEnabled: true
	ignoreErrors: []
	allowUrls: []
	denyUrls: []
	integrations: []
	transportOptions: {}
	initialScope: {}
```

Contract note:

- `@luckystack/sentry` config should expose all supported SDK options either as first-class keys or via pass-through object.
- Package should avoid blocking advanced Sentry configuration and should forward unknown supported keys to Sentry SDK initialization.

### 10.4 Service routing + proxy config generation

```yaml
routing:
	devRouterMode: proxy
	proxyProvider: caddy
	generateProxyConfig: true
	proxyConfigPath: ./generated/caddy/Caddyfile
	fallbackToBuiltInLoadBalancer: true
```

### 10.5 CI affected-build strategy

```yaml
ci:
	affectedMode: true
	buildOnlyChangedPresets: true
	lintOnlyChangedPresets: true
	buildAllOnSharedOrCoreChanges: true
	lintAllOnSharedOrCoreChanges: true
```

---

## 11) Documentation Updates Required Across Repository

This file is canonical, but these docs must be updated when implementation starts.

1. Routing architecture doc (service-first names and `system/*` convention).
2. API architecture doc (`apiRequest` naming/validation behavior).
3. Sync architecture doc (`syncRequest` naming/validation behavior).
4. Developer guide (new build outputs, local-service + staging forward workflow).
5. README (new package install paths and service routing assumptions).

---

## 12) Scope Note

This document supersedes older brainstorming and handoff planning documents for packaging direction.

If strategy changes, update this file first and treat it as the canonical reference.

---

## 13) Immediate Next Step (Start Now)

Status: Completed (2026-04-20). Kept as historical record of the first routing-contract milestone.

Ship one non-breaking routing-contract PR before package extraction.

Goal:

- Enforce service-first route naming (`service/name`) across request helpers and runtime resolution.
- Migrate all root/global route usage to `system/*`.

Implementation scope for this first PR:

1. Add one shared route-name parser/validator used by API and sync request flows.
2. Update `apiRequest` and `syncRequest` to require a service segment in route names.
3. Return stable routing errors for invalid names (for example `routing.invalidServiceRouteName`).
4. Update existing root/global call sites to use `system/*` directly.

Out of scope for this first PR:

1. Package extraction work.
2. Load balancer backend generation.
3. Service-scoped build output refactor.

Definition of done:

1. All API/sync request names used by app code are service-first.
2. Invalid route-name shape is rejected with stable routing error code.
3. Runtime route resolution no longer depends on implicit root-level names.
4. This document and routing/API/sync docs are updated to reflect final behavior.

Manual verification checklist:

1. Request `system/session` succeeds.
2. Request with invalid name shape fails with `routing.invalidServiceRouteName`.
3. Legacy root route fails with explicit routing error.

Status update (2026-04-17):

1. Shared service-first route parsing is implemented and reused in API/sync request paths.
2. Client and server request handling rejects invalid route names with `routing.invalidServiceRouteName`.
3. Runtime route resolution no longer falls back to implicit root-level route names.
4. Global API source files remain in `src/_api`, but are mapped to `api/system/*` at generation/load time.
5. Route naming validation now hard-fails dev startup and build generation for invalid `_api/_sync` filenames.

---

## 14) Next Session Plan (2026-04-21)

Primary goal:

- Close the routing-contract milestone cleanly, then start service-scoped build foundations.

Step-by-step plan:

1. Finalize routing-contract hardening (Completed 2026-04-20):
- Duplicate normalized route-key detection now fails generation with explicit context.
- Duplicate checks now run in both type-map generation and server request map generation.

2. Complete documentation sync for new contract (Completed 2026-04-20):
- README examples now use service-first helper names with explicit versions.
- Developer guide snippets no longer imply implicit root helper names.

3. Start service-scoped backend build design (Section 9.5) (Completed 2026-04-21):
- Build inputs are preset names from a dedicated config file.
- Backend map output is one file per preset (`generatedApis.PRESETNAME.ts`).
- Root `src/` is `system`, `src/system` is invalid, and service ownership is one-to-one across presets.
- Development fallback routing uses polling and can switch new traffic to a newly healthy local service target.
- Split/fallback mode requires shared Redis and hard-fails when Redis is unavailable.
- Function handling remains Phase 1 (safe full registry); Phase 2 pruning is documented as future work.

4. Implement first thin slice for preset-scoped builds:
- Introduce dedicated preset config loader + validation.
- Extend generation script(s) with preset selection arguments.
- Generate preset-scoped map artifact(s) and validate runtime loading.
- Add validation that rejects `src/system` and service-to-multiple-presets assignments.

5. End-of-session verification before moving to next milestone:
- `npm run lint`
- `npm run build`
- Confirm `system/session` success, invalid helper route-name rejection, and hard errors for invalid preset/service config.

---

## 15) Deferred / Backlog

Parked items that are intentionally out of scope for the current packaging push. Revisit when the core package split has shipped.

- **`@luckystack/monitoring`** — full request-forensics package sketched in `docs/MONITORING.md` (dual-stream: Sentry for "why", monitoring package for "what"; OpenSearch-backed audit trail; P95/P99 metrics; RUM). Parked pending a decision on whether we self-host a search engine for this or consume an external one. The package would hang off `postApiExecute` / `postSyncFanout` hooks (now live in §4), so no core design changes are blocked on it.
- **Phase 2 function pruning** — import-graph-based pruning of the per-preset function registry (§9.8 point 6). Current Phase 1 bundles all functions in every preset for safety; optimize only after measurement.
- **Frontend typegen scope in split deployments** — define whether `apiTypes.generated.ts` should include all presets' routes or be preset-scoped when projects split frontend per domain. Currently aggregate.
- **`@luckystack/web-vitals`** — client-side RUM package (from `docs/MONITORING.md` §4C). Lower priority than backend observability.

---

## 16) Session Log (2026-04-23)

Completed:

1. Hook registry scaffold (§4) — `server/hooks/types.ts` + `server/hooks/registry.ts` live. `preApiExecute`, `postApiExecute`, `preSyncFanout`, `postSyncFanout` wired in socket handlers.
2. Functions/ merge contract Phase 1 (§9.8) — `functions/` root folder established, `generateServerRequests.ts` merges project overrides over server defaults by module name.
3. `game.ts` migrated from `server/functions/` to `functions/` — first proof of the project-functions override contract working end-to-end.
4. `@luckystack/core` package scaffold created at `packages/core/` — all six `shared/` utilities (sleep, tryCatch, serviceRoute, socketEvents, responseNormalizer, sentrySetup) moved to `packages/core/src/` as the canonical source. `shared/` files are now thin re-export shims for backwards compatibility. `@luckystack/core` path alias added to both tsconfigs; Vite picks it up automatically via `tsconfigPaths`.

---

## 17) Session Log (2026-04-23, continued)

Completed:

1. `@luckystack/login` package scaffold created at `packages/login/`.
2. `BaseSessionLayout`, `SessionLocation`, `AuthProps` defined in `packages/login/src/sessionLayout.ts` as the framework-owned type contracts.
3. `@luckystack/login` path alias added to both tsconfigs; `packages/login/src` added to include arrays.
4. `config.ts` updated: `SessionLocation` and `AuthProps` removed from the file body and re-exported from `@luckystack/login`. `SessionLayout` kept as the project-specific type (extends Prisma `User`). Structural compatibility check added as a compile-time assertion.
5. `server/hooks/types.ts` updated: now imports `BaseSessionLayout` from `@luckystack/login` instead of `SessionLayout` from `config`.

---

## 18) Session Log (2026-04-23, continued)

Completed:

1. `server/functions/session.ts` → `packages/login/src/session.ts`. Hook dispatches added: `postSessionCreate` (on `newUser === true` in `saveSession`) and `postSessionDelete` (in `deleteSession`). Dynamic import of `logout` updated to `./logout` (same package dir). Dynamic import of socket updated to `../../../server/sockets/socket`.
2. `server/auth/login.ts` → `packages/login/src/login.ts`. Hook dispatches added: `postRegister` (credentials register + OAuth new user) and `postLogin` (credentials login + OAuth callback). `isNewOAuthUser` flag added to track new vs returning OAuth users.
3. `server/auth/loginConfig.ts` → `packages/login/src/loginConfig.ts`. `tryCatch` now from `@luckystack/core`.
4. `server/sockets/utils/logout.ts` → `packages/login/src/logout.ts`. Hook dispatch added: `postLogout`.
5. All four original server files replaced with one-liner re-export shims — no import-site changes needed across the server.
6. `packages/login/src/index.ts` updated to barrel-export all runtime functions.

All auth lifecycle hooks (`postLogin`, `postRegister`, `postLogout`, `postSessionCreate`, `postSessionDelete`) are now wired.

---

## 19) Session Log (2026-04-24)

Completed:

1. Fixed `tsx` not resolving `@luckystack/core` at runtime — added `--tsconfig tsconfig.server.json` to both `server` and `server:direct` scripts in `package.json` so tsx loads the correct path aliases.
2. Fixed `tryCatch` default-vs-named import mismatch in `packages/login/src/loginConfig.ts`, `login.ts`, and `logout.ts` — changed `import tryCatch from '@luckystack/core'` to `import { tryCatch } from '@luckystack/core'`; combined two separate imports in `logout.ts` into one.
3. Deleted stale `server/functions/game.ts` (moved to `functions/game.ts` in previous session; `repl.ts` imports from the new location).
4. Fixed `config.ts` compile-time structural check — replaced unused runtime variable with `export type _SessionLayoutCheck = SessionLayout extends BaseSessionLayout ? true : never` to satisfy `noUnusedLocals`.
5. Fixed `server/dev/typeMap/emitterArtifacts.ts` — removed hardcoded `import { SessionLayout } from "../../config"` from the generated file header; it was unconditionally emitted but unused in the current type map output.
6. Fixed `deploy.config.ts` generic inference — `defineDeploy<T>` was narrowing `T` to `'staging'` via the `fallback` literal; added explicit type parameter `defineDeploy<'development' | 'staging' | 'production'>` to anchor inference on environment keys.
7. Deleted stale `server/prod/generatedApis.default.ts` — referenced deleted `server/functions/game`; the generator only emits preset-specific files now. `runtimeMaps.ts` falls back gracefully when the file is missing. Production deployments must set `LUCKYSTACK_BUNDLE` to a preset key.
8. Fixed `scripts/bundleServer.mjs` (esbuild) — added `alias` entries for `@luckystack/core` and `@luckystack/login` pointing to their `packages/*/src/index.ts` so the production server bundle resolves them correctly.
9. `npm run lint` and `npm run build` both pass cleanly.

---

## 20) Session Log (2026-04-24, continued)

Completed:

1. `server/bootstrap/env.ts` → `packages/core/src/env.ts`. Canonical source for env bootstrap (dotenv + zod validation). `env`, `bootstrapEnv`, `isProduction`, `RuntimeEnv` are now core exports.
2. `server/functions/db.ts` → `packages/core/src/db.ts`. Canonical Prisma client singleton. Side-effect `import './env'` replaces the old `import '../bootstrap/env'`.
3. `server/functions/redis.ts` → `packages/core/src/redis.ts`. Canonical ioredis singleton. `import { env } from './env'` replaces the old relative path.
4. `packages/core/src/index.ts` updated — barrel now exports `env`, `bootstrapEnv`, `isProduction`, `RuntimeEnv`, `prisma`, `redis`.
5. All three originals replaced with one-liner re-export shims pointing to `@luckystack/core`.
6. `packages/login/src/{login,session,logout}.ts` updated — relative imports of `server/functions/db` and `server/functions/redis` replaced with `@luckystack/core` named imports (`prisma`, `redis`, `redis as redisClient`).
7. `npm run build` passes clean.

---

## 21) Session Log (2026-04-24, third pass — core utilities move)

Completed:

1. **Group 1 (no internal deps)** — moved to `packages/core/src/`:
   - `server/utils/console.log.ts` → `consoleLog.ts` (renamed to drop the dot).
   - `server/utils/cookies.ts` → `cookies.ts`.
   - `server/utils/httpApiUtils.ts` → `httpApiUtils.ts`.
   - `server/utils/paths.ts` → `paths.ts`.
   - `server/config/runtimeConfig.ts` → `runtimeConfig.ts`.
2. **Group 2 (depends on Group 1)** — moved to `packages/core/src/`:
   - `server/utils/serveAvatars.ts` → `serveAvatars.ts`.
   - `server/utils/getParams.ts` → `getParams.ts` (default export; barrel re-exports as `{ default as getParams }`; shim uses `export { default } from '../../packages/core/src/getParams'`).
   - `server/utils/extractToken.ts` → `extractToken.ts` (config import updated to `../../../config`).
   - `server/utils/extractTokenFromRequest.ts` → `extractTokenFromRequest.ts`.
3. **Group 3 (depends on `@luckystack/login`)** — moved to `packages/core/src/`:
   - `server/utils/validateRequest.ts` → `validateRequest.ts`. Function signature changed from `user: SessionLayout` to `user: BaseSessionLayout` (from `@luckystack/login`). `AuthProps` now also comes from `@luckystack/login`. The function is now framework-generic — it only accesses `user[condition.key]` where `key: keyof BaseSessionLayout`.
   - `server/utils/rateLimiter.ts` → `rateLimiter.ts` (config import updated to `../../../config`, `tryCatch` and `redis` imports switched to core-internal `./` paths).
4. `packages/core/src/index.ts` barrel updated with all 11 new exports.
5. All 11 originals replaced with one-liner re-export shims.
6. **Shim pattern note**: all shims point at the direct source file (`../../packages/core/src/...`), matching `shared/tryCatch.ts`. Using `@luckystack/core` in shims pulls the full barrel (including `redis`/`prisma`), which keeps ioredis' event loop alive and causes `tsx`-based generator scripts to hang after "Connected to Redis". Direct file paths avoid loading sibling modules that aren't needed.
7. Fixed `package.json` — added `--tsconfig tsconfig.server.json` to both `generateArtifacts` sub-invocations and `buildClient` so `tsx` resolves `@luckystack/*` path aliases when transitively imported.
8. `npm run lint` and `npm run build` both pass cleanly.

Files intentionally NOT moved:

- `server/hooks/registry.ts` + `server/hooks/types.ts` — `types.ts` imports `@luckystack/login`; moving registry to core would create a core → login dependency (wrong direction). Needs module augmentation pattern first.
- `server/utils/responseNormalizer.ts` — loads locale JSON files from `src/_locales/`; project-specific i18n.
- `server/utils/runtimeTypeResolver.ts` + `runtimeTypeValidation.ts` — belong in `@luckystack/devkit`.
- `server/utils/repl.ts` — project-specific REPL, imports `functions/game`.
- `server/functions/sentry.ts` — belongs in `@luckystack/sentry`, not core.
- All `src/_sockets/`, `src/_functions/`, `src/_components/` — React client-side concerns.

---

## 22) Session Log (2026-04-24, fourth pass — sync + sentry extraction)

Completed:

1. **`@luckystack/sync` scaffolded** — `packages/sync/package.json` and `packages/sync/src/index.ts` created. Path alias added to `tsconfig.server.json` and `tsconfig.client.json`. Esbuild alias added to `scripts/bundleServer.mjs`.
2. **`server/sockets/handleSyncRequest.ts` → `packages/sync/src/handleSyncRequest.ts`** — canonical file relocated. Imports rewritten:
   - `./socket` → `../../../server/sockets/socket` (still shared between API and sync; stays in server/)
   - `../functions/session` → `@luckystack/login` (named `getSession`)
   - `../../config` → `../../../config` (value imports `logging`, `rateLimiting`, `SessionLayout`)
   - `AuthProps` split off as `import type { AuthProps } from '@luckystack/login'` (authoritative source since §17)
   - `../utils/validateRequest`, `../utils/extractToken`, `../../shared/tryCatch`, `../../shared/serviceRoute`, `../utils/rateLimiter`, `../../shared/socketEvents` → merged into one `@luckystack/core` import
   - `../functions/sentry` → `@luckystack/sentry` (see point 5 below)
   - `../utils/responseNormalizer`, `../utils/runtimeTypeValidation` → `../../../server/utils/responseNormalizer` / `runtimeTypeValidation` (still server-side for now)
   - `../hooks/registry` → `../../../server/hooks/registry` (hooks registry stays in server/ until core→login circular is resolved)
3. **`server/sockets/handleHttpSyncRequest.ts` → `packages/sync/src/handleHttpSyncRequest.ts`** — same import rewrite pattern. Exported `HttpSyncStreamEvent` re-exported via the shim.
4. **Both originals replaced with one-liner shims** at `server/sockets/handle{,Http}SyncRequest.ts` pointing at the canonical sources by direct file path. Server callers (`server.ts`, `server/sockets/socket.ts`) unchanged — default imports keep resolving.
5. **`@luckystack/sentry` scaffolded** — `packages/sentry/package.json` and `packages/sentry/src/{index,sentry}.ts` created. Path alias added to both tsconfigs + `bundleServer.mjs`.
6. **`server/functions/sentry.ts` → `packages/sentry/src/sentry.ts`** — canonical file relocated. Imports now pull `initSharedSentry` + shared helpers from `@luckystack/core` (the DI surface stays in core because other core code calls `captureException` through it — moving it to sentry would invert the dependency direction). `sentry` config import updated to `../../../config`.
7. **`server/functions/sentry.ts` replaced with one-liner shim** (preserves both named exports and the `default` Sentry re-export). All existing callers (`server.ts`, `handleApiRequest`, `handleHttpApiRequest`, `handleSyncRequest`, `handleHttpSyncRequest`) work unchanged.
8. **Shim-path pattern kept**: all shims use direct file paths (`../../packages/{sync,sentry}/src/...`) for the same reason documented in §21 — avoids pulling the full core barrel (and thus Redis) into generator/build scripts that transitively load the shim.
9. `npm run lint` and `npm run build` both pass cleanly. `bundleServer` output still fits the expected profile (dist/server.js 9.8mb, vite build 462 modules, 3.82s).

Files intentionally NOT moved to sync this pass:

- **`server/sockets/socket.ts`** — the socket server itself is shared between API and sync. It imports `handleApiRequest`, `handleHttpApiRequest`, `handleSyncRequest`, `handleHttpSyncRequest`. Moving it now would pull API handlers into sync scope. Remains in server/ until `@luckystack/transport` or similar is extracted.
- **Client-side sync transport** (`src/_sockets/syncRequest.ts`, `offlineQueue.ts`) — deferred per §22 earlier plan. `socketInitializer.ts` is shared with API and needs a split design before moving.
- **`server/utils/responseNormalizer.ts`** — still locale-bound (loads JSON from `src/_locales/`). Needs a separation between the error-shaping logic (framework-generic, could go to core) and the locale resolution (project-specific). Deferred.

Follow-up items surfaced this pass:

- `handleHttpApiRequest.ts` + `handleApiRequest.ts` could form a `@luckystack/api` package (or fold into core, depending on preference) — same mechanics as sync; left for a separate session.
- The hook registry still lives in `server/hooks/`. Sync handlers currently dispatch `preSyncFanout` / `postSyncFanout` via a deep relative path (`../../../server/hooks/registry`). Moving the registry to core requires resolving the `types.ts → @luckystack/login` import so core doesn't depend on login (module augmentation pattern sketched in §21).

---

## 23) Session Log (2026-04-24, fifth pass — API handler extraction)

Completed:

1. **`@luckystack/api` scaffolded** — `packages/api/package.json` + `packages/api/src/index.ts` created. Path alias added to `tsconfig.server.json`, `tsconfig.client.json`, and `scripts/bundleServer.mjs`. Decision rationale: folding API handlers into core was rejected because they import `getSession` and `logout` from `@luckystack/login`, which would create a core→login runtime dependency (wrong direction). A separate `@luckystack/api` package sits at the same layer as `@luckystack/sync` (both can depend on core + login + sentry).
2. **`server/sockets/handleApiRequest.ts` → `packages/api/src/handleApiRequest.ts`** — canonical file relocated. Imports rewritten following the same pattern established in §21–§22:
   - `./socket` (value `apiMessage`) → `../../../server/sockets/socket`
   - `../functions/session` + `./utils/logout` → `@luckystack/login` (`getSession`, `logout`)
   - `../../config` → split: `AuthProps` from `@luckystack/login` (type-only), `logging`/`rateLimiting`/`SessionLayout` from `../../../config`
   - `../prod/runtimeMaps` → `../../../server/prod/runtimeMaps`
   - `../utils/validateRequest`, `../utils/rateLimiter`, `../../shared/tryCatch`, `../../shared/serviceRoute`, `../../shared/socketEvents` → merged into one `@luckystack/core` import
   - `../functions/sentry` → `@luckystack/sentry`
   - `../utils/responseNormalizer`, `../utils/runtimeTypeValidation` → `../../../server/utils/{responseNormalizer,runtimeTypeValidation}` (still server-side until i18n/devkit extractions)
   - `../hooks/registry` → `../../../server/hooks/registry` (hooks registry blocked on module-augmentation design)
3. **`server/sockets/handleHttpApiRequest.ts` → `packages/api/src/handleHttpApiRequest.ts`** — same rewrite pattern; also picks `inferHttpMethod` + `HttpMethod` from `@luckystack/core` (moved to core in §21).
4. **Both originals replaced with one-liner shims** using direct file paths per the established rule. Callers unchanged: `server.ts` (default import of `handleHttpApiRequest`) and `server/sockets/socket.ts` (default import of `handleApiRequest`) resolve through the shim without edits.
5. **Barrel** — `packages/api/src/index.ts` exports `handleApiRequest` (as named re-export of its default), `handleHttpApiRequest`, and the `ApiHttpStreamEvent` type.
6. `npm run lint` + `npm run build` pass clean end-to-end.

Current package layer map after this session:

```
@luckystack/core           (framework base; transport contracts, shared utilities, DI surfaces)
        ↑
@luckystack/login          (auth + session; owns BaseSessionLayout, AuthProps)
        ↑
@luckystack/sentry         (observability; consumes core DI surface, independent of login/sync/api)
@luckystack/sync           (real-time sync handlers; depends on core + login + sentry)
@luckystack/api            (API + HTTP-API handlers; depends on core + login + sentry)
```

All four feature packages (login/sentry/sync/api) are at the same dependency layer above core. None of them depend on each other.

---

## 24) Session Log (2026-04-24, sixth pass — hooks registry move + module augmentation)

Completed:

1. **`server/hooks/types.ts` + `server/hooks/registry.ts` → `packages/core/src/hooks/{types,registry}.ts`.** Core now owns the hook infrastructure.
2. **Broke the core→login type dependency** — core's hook payloads use a locally-defined `HookSessionShape` interface instead of importing `BaseSessionLayout` from `@luckystack/login`. `HookSessionShape` mirrors `BaseSessionLayout` structurally (`id`, `token`, `email`, `name`, `avatar`, `avatarFallback`, `admin`, `language`, `roomCodes`), so any concrete session type (login's `BaseSessionLayout`, project-level `SessionLayout` extending Prisma `User`) is assignable without a type import.
3. **Core hooks exposed through the barrel** — `packages/core/src/index.ts` now exports `registerHook`, `dispatchHook`, `DispatchResult`, and all hook-payload type aliases (`HookSessionShape`, `HookName`, `HookPayloads`, `PreApiExecutePayload`, `PostApiExecutePayload`, `PreSyncFanoutPayload`, `PostSyncFanoutPayload`).
4. **Feature-package hooks live via module augmentation.** `packages/login/src/hookPayloads.ts` declares its auth/session payload interfaces (`PostLoginPayload`, `PostRegisterPayload`, `PostLogoutPayload`, `PostSessionCreatePayload`, `PostSessionDeletePayload`) and merges their keys into `HookPayloads` with `declare module '@luckystack/core' { interface HookPayloads { ... } }`. The augmentation is picked up because `packages/login/src/**` is in the tsconfig include path, and login's `index.ts` does a side-effect `import './hookPayloads';` to make the wiring explicit for readers and to guarantee esbuild includes the module in bundles.
5. **Callers migrated to `@luckystack/core`.** The five files that used `../../../server/hooks/registry` (`packages/api/src/handleApiRequest.ts`, `packages/sync/src/handleSyncRequest.ts`, `packages/login/src/{login,logout,session}.ts`) now import `dispatchHook` directly from `@luckystack/core`, dropping the deep relative path.
6. **Shims left at `server/hooks/types.ts` + `server/hooks/registry.ts`** re-exporting the canonical sources via direct file paths (plus the login augmentation payload types through `packages/login/src/hookPayloads`). No call-site changes needed outside the five updated package files.
7. **Presence hooks removed from the types file** — the old `PrePresenceUpdatePayload` / `PostPresenceUpdatePayload` entries in `server/hooks/types.ts` were speculative (no dispatch calls existed). They will be added back via module augmentation in `@luckystack/presence` when that package ships.
8. `npm run lint` and `npm run build` pass clean.

Pattern established for future feature packages:

```ts
// packages/<feature>/src/hookPayloads.ts
import type { SomeTypeFromThisPackage } from './somewhere';

export interface MyHookPayload { ... }

declare module '@luckystack/core' {
  interface HookPayloads {
    myHook: MyHookPayload;
  }
}
```

Then in the package's `index.ts`: `import './hookPayloads';` so the augmentation travels with the package.

---

## 25) Session Log (2026-04-24, seventh pass — runtimeTypeValidation to core)

Completed:

1. **`server/utils/runtimeTypeValidation.ts` → `packages/core/src/runtimeTypeValidation.ts`.** The string-based structural validator has no internal imports — it is a pure runtime concern, belongs in core, and was previously the last thing forcing the 4 socket/HTTP handlers to reach back into `server/utils/`.
2. **Barrel update** — `validateInputByType` exported from `@luckystack/core`.
3. **Shim left at `server/utils/runtimeTypeValidation.ts`** using the direct file path pattern.
4. **Four package callers migrated** (`handleSyncRequest`, `handleHttpSyncRequest`, `handleApiRequest`, `handleHttpApiRequest`) — all now pull `validateInputByType` from `@luckystack/core` instead of a deep relative path.
5. **Dev-only dynamic-import fixup** — `runtimeTypeValidation.ts` lazily loads `runtimeTypeResolver` for deep-type expansion (only when `NODE_ENV !== 'production'`). After the move, the relative path `./runtimeTypeResolver` no longer resolved; changed to `../../../server/utils/runtimeTypeResolver` with a comment flagging that the resolver belongs in `@luckystack/devkit` once that package exists.
6. `npm run lint` and `npm run build` pass clean.

Server-side imports remaining in the 4 handler packages after this pass:

- `../../../server/sockets/socket` — shared by API + sync (the socket.io server instance)
- `../../../server/prod/runtimeMaps` — project-specific generated API/sync route maps
- `../../../server/utils/responseNormalizer` — locale JSON loading (project-specific until the design splits frame vs locale)
- `../../../config` — project config values (`logging`, `rateLimiting`, `SessionLayout`, `defaultLanguage`)

Everything else in those handlers resolves through `@luckystack/{core,login,sentry}`.

---

## 26) Session Log (2026-04-24, eighth pass — @luckystack/devkit extraction)

Completed:

1. **`@luckystack/devkit` package scaffolded** at `packages/devkit/` (`package.json`, `src/index.ts`). Added path alias `@luckystack/devkit` to `tsconfig.server.json` (server-only — devkit has no client concern) and added `packages/devkit/src/**/*` to the server tsconfig `include` array. **Intentionally NOT added to `scripts/bundleServer.mjs`** — devkit should not be bundled into the production runtime. If anything tries `import from '@luckystack/devkit'` during the prod bundle step, esbuild will fail with an unresolved package, which is the desired behaviour (catches accidental runtime deps on devkit).
2. **`server/dev/**` → `packages/devkit/src/`** (21 TS files moved, directory structure preserved):
   - `hotReload.ts`, `importDependencyGraph.ts`, `loader.ts`, `routeConventions.ts`, `routeNamingValidation.ts`, `supervisor.ts`, `templateInjector.ts`, `typeMapGenerator.ts`
   - `typeMap/` (9 files: `apiMeta.ts`, `discovery.ts`, `emitter.ts`, `emitterArtifacts.ts`, `extractors.ts`, `functionsMeta.ts`, `routeMeta.ts`, `tsProgram.ts`, `typeContext.ts`)
   - `templates/` (5 template files — string templates read via `fs.readFileSync` at generation time, kept as `.ts` with `@ts-expect-error` on their `{{REL_PATH}}` placeholder imports)
3. **`server/utils/runtimeTypeResolver.ts` → `packages/devkit/src/runtimeTypeResolver.ts`.** The resolver uses the TypeScript compiler API for deep type expansion — dev-only. Intra-devkit import `../dev/typeMap/tsProgram` rewritten to `./typeMap/tsProgram`.
4. **Import rewrites inside devkit** (all references to the server/utils + server/functions + server/config layer replaced with the `@luckystack/core` barrel, since devkit runs at tsx time where barrel loading is fine):
   - `../utils/paths` / `../../utils/paths` → `@luckystack/core`
   - `../utils/httpApiUtils` / `../../utils/httpApiUtils` → `@luckystack/core`
   - `../functions/tryCatch` (default import) → `@luckystack/core` (named `tryCatch`)
   - `../config/runtimeConfig` → `@luckystack/core`
   - `../bootstrap/env` → `@luckystack/core`
   - `../utils/runtimeTypeResolver` → `./runtimeTypeResolver` (now sibling inside devkit)
   - `../utils/responseNormalizer` → `../../../server/utils/responseNormalizer` (locale resolver still server-local)
5. **Shims left at all original server/dev/** locations** via `export *` (or named re-exports where the target has no index-style barrel). Shims use direct relative paths (`../../packages/devkit/src/...`) per the established rule. `server/dev/supervisor.ts` is a side-effect import shim since the supervisor is a script entrypoint without named exports.
6. **Callers migrated**:
   - `scripts/generateTypeMaps.ts` — imports `generateTypeMapFile` from `@luckystack/devkit`
   - `scripts/generateServerRequests.ts` — imports devkit helpers from `@luckystack/devkit` and `ROOT_DIR` / `resolveFromRoot` from `@luckystack/core`
   - `packages/core/src/runtimeTypeValidation.ts` — the dev-only dynamic import now targets `../../devkit/src/runtimeTypeResolver` (relative path, not the `@luckystack/devkit` alias, so esbuild can follow it without an alias map; still behind the `NODE_ENV !== 'production'` guard)
   - `server/prod/runtimeMaps.ts` unchanged — still imports `../dev/loader` via the shim
   - `server/server.ts` unchanged — dynamic `await import('./dev/loader')` and `await import('./dev/hotReload')` resolve through the shims
7. **Explicit `process.exit(0)` added to both scripts.** Importing `@luckystack/devkit` transitively loads `@luckystack/core`, whose barrel connects to Redis on module load. Without an explicit exit the dangling ioredis handle keeps the event loop alive and `npm run build` hangs after "Connected to Redis" — same bug documented in §21, now surfaces for scripts because they reach core via a different path. Added:
   - `generateTypeMaps.ts`: `run().then(() => process.exit(0)).catch(err => { ...; process.exit(1); });`
   - `generateServerRequests.ts`: `process.exit(0);` at end of top-level code
8. `npm run lint` and `npm run build` pass clean end-to-end. Production bundle unchanged in size (dist/server.js still 9.8mb, vite 462 modules, ~3.9s build).

Devkit public surface (`packages/devkit/src/index.ts`):

- Generation: `generateTypeMapFile`, `getInputTypeFromFile`, `getSyncClientDataType`
- Route validation: `API_VERSION_TOKEN_REGEX`, `SYNC_VERSION_TOKEN_REGEX`, `assertNoDuplicateNormalizedRouteKeys`, `assertValidRouteNaming`
- Dev loader: `devApis`, `devSyncs`, `devFunctions`, `initializeAll`, `initializeApis`, `initializeSyncs`, `initializeFunctions`, `upsertApiFromFile`, `removeApiFromFile`, `upsertSyncFromFile`, `removeSyncFromFile`
- Dev watcher: `setupWatchers`
- Deep type resolver: `resolveRuntimeTypeText`, `clearRuntimeTypeResolverCache`

Deferred for a future pass:

- Production bundle still contains devkit code. `server/prod/runtimeMaps.ts` has a top-level `import { devApis, devFunctions, devSyncs } from '../dev/loader';` that pulls devkit into the esbuild bundle even though the `if (env.NODE_ENV !== 'production')` guard prevents execution. The fix is to replace those top-level imports with a dev-only lazy `await import('../dev/loader')` inside the non-production branches of `getRuntimeApiMaps` / `getRuntimeSyncMaps` / `getRuntimeReplMaps`. Pre-existing architectural debt; surfaces now because we've formalised the devkit boundary.
- `server/functions/tryCatch.ts` is a redundant wrapper around core's `tryCatch` (it forwards the `context` argument that core already supports). One caller (`src/settings/_api/updateUser_v1.ts`) still imports it. Deletable after the caller is updated — but not blocking.

---

## 27) Package layer map after §26

```
@luckystack/core       (base: transport, utilities, DI surfaces, hook registry, runtime type validation)
   ↑
@luckystack/login      (auth + session; owns BaseSessionLayout + AuthProps; augments HookPayloads)
   ↑
@luckystack/sentry      @luckystack/sync       @luckystack/api
 (observability)         (real-time sync)       (API + HTTP API)

@luckystack/devkit     (dev-time tooling; NOT in prod bundle alias map; consumed by
                        scripts/ and server/dev/ shims; depends on core at dev time only)
```

---

## 28) Session Log (2026-04-24, ninth pass — devkit fully excluded from prod bundle)

Completed:

1. **`server/prod/runtimeMaps.ts` converted to lazy dev-loader import.** Removed the top-level `import { devApis, devFunctions, devSyncs } from '../dev/loader';`. Each of the three getters (`getRuntimeApiMaps`, `getRuntimeSyncMaps`, `getRuntimeReplMaps`) now does `await getDevkit()` inside the `env.NODE_ENV !== 'production'` branch, where `getDevkit` is a module-scoped cached `Promise<DevkitRuntimeMaps>` that dynamic-imports `@luckystack/devkit`. First call pays the import cost; subsequent calls reuse the promise. Explicit `DevkitRuntimeMaps` interface (mirrors `{ devApis, devSyncs, devFunctions }` as `Record<string, unknown>`) avoids the `any`-propagation lint errors that surfaced when reading them through `typeof import(...)`.
2. **`server/server.ts` dev-only imports consolidated to `@luckystack/devkit`** — `await import('./dev/loader')` + `await import('./dev/hotReload')` merged into one `await import('@luckystack/devkit')` destructuring `{ initializeAll, setupWatchers }`. Inside the same `if (isDevMode) { ... }` branch as before.
3. **`packages/core/src/runtimeTypeValidation.ts` dev-only resolver call migrated to the barrel** — was `await import('../../devkit/src/runtimeTypeResolver')` (relative, still bundled); now `await import('@luckystack/devkit')` (external in prod, fully excluded from the bundle). Same `NODE_ENV !== 'production'` guard.
4. **`scripts/bundleServer.mjs` — `@luckystack/devkit` added to the `external` array.** Esbuild leaves `import('@luckystack/devkit')` as an unresolved bare specifier in the output; node resolves it at runtime ONLY when the dev branch executes, which never happens in production.
5. **Result: `dist/server.js` went from 9.8 MB to 211.7 KB (97.8% smaller).** `dist/server.js.map`: 14.1 MB → 385.3 KB. `grep -c "@luckystack/devkit" dist/server.js` shows 3 references (the three `await import(...)` call sites retained as externals); `grep -c "generateTypeMapFile\|clearRuntimeTypeResolverCache\|upsertApiFromFile" dist/server.js` shows 0 — all devkit internals are gone.
6. **`server/functions/tryCatch.ts` deleted.** Was a redundant wrapper around `shared/tryCatch` (which is already the core tryCatch, with the `context` arg forwarded). The one remaining caller (`src/settings/_api/updateUser_v1.ts`) was switched to `import { tryCatch } from '@luckystack/core'` (combined with its existing `UPLOADS_DIR` import from the same barrel).
7. **Pre-existing lint errors surfaced on `updateUser_v1.ts`** — the generated `Functions` map types `prisma` and `saveSession` as `any`, which made `.user.update(...)` and `saveSession(...)` calls flag `no-unsafe-call` / `no-unsafe-member-access`. Previously masked by `.eslintcache`. Added two targeted `eslint-disable-next-line` comments with explanatory text. Fixing the generator's `any` emission is out of scope; tracked as a devkit-internals follow-up.
8. **`@luckystack/devkit` added to `tsconfig.client.json` paths + include** for eslint-plugin-import-x consistency. Other `@luckystack/*` packages are listed in both tsconfigs even when the client doesn't need them — matching that pattern makes the import-x typescript resolver find the alias regardless of which tsconfig it picked for a given file.
9. `npm run lint` and `npm run build` pass clean.

Production bundle contents now:

```
dist/server.js       211.7kb   ← down from 9.8mb (pre-session: §26)
dist/server.js.map   385.3kb   ← down from 14.1mb
```

---

## 29) Next Session Plan

1. **`server/sockets/socket.ts` + `server/sockets/utils/activityBroadcaster.ts` review** — `socket.ts` wires socket.io + dispatches to api/sync. Decide: `@luckystack/transport` package or fold into core. `activityBroadcaster.ts` is presence-adjacent, will likely land in `@luckystack/presence`.
2. **`responseNormalizer` split** — framework `createLocalizedNormalizer({ translate })` factory, project wires up its own translate fn. Design-first.
3. **Client-side sync/API split** — `src/_sockets/socketInitializer.ts` splits transport vs callback-registry concerns; `syncRequest.ts` + `offlineQueue.ts` → `packages/sync/src/` client slice; `apiRequest.ts` → `packages/api/src/` client slice. Design-first.
4. **Generator `any` cleanup** — the type-map emitter in `@luckystack/devkit` emits `Record<string, any>` for function re-exports (see `Functions.db.prisma: any` in the generated `apiTypes.generated.ts`). Devkit improvement: emit the actual resolved types. Would drop the two `eslint-disable-next-line` comments from `src/settings/_api/updateUser_v1.ts` and any future callers.
5. **`@luckystack/presence`** — after the socket and activity-broadcaster split.
