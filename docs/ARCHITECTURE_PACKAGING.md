# Packaging Architecture

> Single source of truth for LuckyStack package extraction strategy.

Last updated: 2026-04-16
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

Stages:

- `pre:*` hooks (validate/transform/short-circuit)
- `post:*` hooks (augment side effects)

Initial hook targets:

- `preLogin` / `postLogin`
- `preLogout` / `postLogout`
- API lifecycle hooks
- Sync lifecycle hooks

Rules:

- Deterministic order
- Typed payloads
- Isolated errors per hook

Hook planning requirement before implementation:

1. Validate package boundaries with user/team first.
2. Build an exhaustive pre/post hook inventory before coding hooks.
3. Mark each hook as required/optional and define package ownership.

Minimum first inventory list:

- Auth: preLogin, postLogin, preRegister, postRegister, preLogout, postLogout
- Session: preSessionCreate, postSessionCreate, preSessionRefresh, postSessionRefresh, preSessionDelete, postSessionDelete
- API: preApiValidate, postApiValidate, preApiExecute, postApiExecute, preApiRespond, postApiRespond
- Sync: preSyncValidate, postSyncValidate, preSyncAuthorize, postSyncAuthorize, preSyncFanout, postSyncFanout
- Presence: prePresenceUpdate, postPresenceUpdate
- Routing: preRouteResolve, postRouteResolve
- Error: preErrorNormalize, postErrorNormalize

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

2. Service-scoped backend builds
- Build only API/sync handlers for selected roots.
- Example outputs:
	- `server-vehicles` serves only `src/vehicles/**` APIs/syncs
	- `server-housing-candidates` serves `src/housing/**` and `src/candidates/**`

3. System backend build
- Build a dedicated `system` service for root/global capabilities.
- Example routes:
	- `system/session`
	- `system/logout`
	- `system/health`

Routing/runtime behavior target:

- In development, engineers should be able to run frontend plus one local service.
- Requests for routes not owned by local service should be forwarded to configured remote environments (for example staging service endpoints).
- This enables focused local debugging in large codebases without running every service locally.

Important runtime note:

- Frontend uses one origin in dev (for example localhost), so a dev-side router is required.
- This router can be implemented as built-in LuckyStack load balancer backend, external proxy, or hybrid setup.

Service routing contract:

- API/sync route names must start with service key as first segment:
	- `vehicles/getAll`
	- `system/session`
- The load balancer reads the first segment and forwards to configured backend URL for that service.
- If requested service key has no backend assignment, load balancer returns a clear error (`serviceNotAssigned`).

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

Optional compatibility mode during migration:

- If legacy root name is detected and compatibility mode is on, auto-map to `system/*` with warning.

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

Build system must support service-level backend targets.

Required outputs:

1. Frontend aggregate output (all pages).
2. System backend output.
3. Per-service backend output (for example vehicles only).
4. Grouped backend output (for example system+vehicles, housing+candidates).

### 9.6 Load balancer backend output

Framework tooling must produce a load balancer backend output.

Required behavior:

1. Parse first route segment as service key.
2. Forward to configured service backend URL.
3. Return explicit `serviceNotAssigned` error when mapping is missing.
4. Support local + remote target mix for development.

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

### 10.1 Service routing config

```yaml
services:
	system: http://localhost:4100
	vehicles: http://localhost:4101
	housing: http://staging-housing.internal
	candidates: http://staging-candidates.internal

routing:
	onMissingService: error
	missingServiceErrorCode: serviceNotAssigned
```

### 10.2 Type generation config

```yaml
typegen:
	strictTypegen: true
	failOnInvalidRouteName: true
	failOnDuplicateRouteKey: true
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

Ship one non-breaking routing-contract PR before package extraction.

Goal:

- Enforce service-first route naming (`service/name`) across request helpers and runtime resolution.
- Migrate all root/global route usage to `system/*`.

Implementation scope for this first PR:

1. Add one shared route-name parser/validator used by API and sync request flows.
2. Update `apiRequest` and `syncRequest` to require a service segment in route names.
3. Return stable routing errors for invalid names (for example `routing.invalidServiceRouteName`).
4. Add temporary compatibility mapping from legacy root names to `system/*` behind an explicit config toggle.
5. Update existing root/global call sites to use `system/*` directly.

Out of scope for this first PR:

1. Package extraction work.
2. Load balancer backend generation.
3. Service-scoped build output refactor.

Definition of done:

1. All API/sync request names used by app code are service-first.
2. Invalid route-name shape is rejected with stable routing error code.
3. Legacy route mapping only applies when compatibility toggle is enabled.
4. Runtime route resolution no longer depends on implicit root-level names.
5. This document and routing/API/sync docs are updated to reflect final behavior.

Manual verification checklist:

1. Request `system/session` succeeds.
2. Request with invalid name shape fails with `routing.invalidServiceRouteName`.
3. Legacy root route only succeeds when compatibility toggle is enabled.
4. Disabling compatibility toggle makes legacy root route fail with explicit routing error.
