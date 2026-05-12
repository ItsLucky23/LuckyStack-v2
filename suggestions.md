# Documenter suggestions queue

> Append-only file. Each heading is one suggestion the human user should review. The Documenter does not implement any of these — they are recorded here when they touch package boundaries, framework-level naming, or new package surfaces. Implementation suggestions that fit existing packages are filed as tasks instead.

## Decisions log (2026-05-10 review session)

| # | Suggestion | Decision | Status (2026-05-11) |
|---|---|---|---|
| 1 | Publish `@luckystack/router` as an optional package | **Yes** — router is optional, only needed for dev↔staging fallback or multi-instance deploys. Publish with stable types. | **DONE.** `private: false`, `0.1.0`, `ioredis` as peer dep, `luckystack-router` bin shipped. |
| 2 | Move `runtimeMaps.ts` loader into `@luckystack/server` | **Yes** — framework owns the loader; consumer still generates per-preset maps but no longer copies the loader. | **DONE.** `createProdRuntimeMapsProvider` ships from `@luckystack/server`; consumers pass `loadGeneratedMaps` to `bootstrapLuckyStack`. |
| 3 | Observability naming (`@luckystack/sentry` rename) | **Rename to `@luckystack/error-tracking`** — clearer scope; future `@luckystack/monitoring` reads as orthogonal. | **DONE.** Directory + package + imports + docs renamed. |
| 4 | Move email/sentry config out of core into per-package registries | **Yes — do it before first publish.** Matches what `@luckystack/presence` already does. | **DONE.** `registerEmailConfig` / `registerSentryConfig` live in their packages; `app.publicUrl` moved to core. |
| 5 | Add `luckystack-validate-deploy` CLI | **Yes — build it.** Catches typos in services.config.ts / deploy.config.ts before runtime. | **DONE.** `validateDeploy(...)` + `luckystack-validate-deploy` bin in `@luckystack/devkit`. |
| 6 | `@luckystack/web-vitals` as its own package | **No — collapse into future monitoring.** Web-vitals lives inside `@luckystack/monitoring` as a `/web-vitals` subpath, not as its own package. | Deferred (future monitoring package). |
| 7 | Per-package CHANGELOGs via Changesets | **Defer until after first publish.** Add when shipping 0.2.0+. | Deferred. |

### Additional decision: which packages live outside the framework

Discussed during the same review session. Final position:

- **Nothing extracted from the current codebase today.** Zod emitter (in `@luckystack/devkit`), `@luckystack/test-runner`, and `@luckystack/email` all stay in-tree. Splitting them would couple two standalone libs that always travel together (Zod emitter + fuzz tester) or extract surface too small to justify the maintenance overhead (email).
- **Future `@luckystack/monitoring` is the exception** — it should be built as a thin adapter over a generic, standalone observability library (separate git repo, separate npm package). That way the underlying observability code is reusable outside LuckyStack, while the LuckyStack-specific hook wiring lives in the framework package. Web-vitals belongs inside that monitoring package as a subpath, not as its own thing.

---

## 1. Promote `@luckystack/router` to Tier-A

**Problem.** The package is in the monorepo and builds, but `private: true` and the README explicitly tells consumers to vendor it. That contradicts the framework's "minimal install, opt-in capability" promise: a project that needs multi-instance deployment has no way to `npm install @luckystack/router`. Right now the only legal answer is "fork the framework," which is the failure mode the package split was meant to eliminate.

**Proposed change.** Flip `private: false`, audit `peerDependencies` (currently relies on `socket.io-client` only via the broader workspace), add a `bin/` entry so `npx @luckystack/router` boots a configured router, and write a Tier-A README with deployment recipes.

**Rationale.** Both scan documents (scan-1 §"Other things" and scan-2 §5 "Things I'd reconsider") flag the same gap. The router is one of the most differentiated pieces of the framework — keeping it private leaves a meaningful capability inaccessible to consumers.

**Risk.** Stable public API for `StartRouterInput` / `ResolveTargetInput` is required. Today these types reference `services.config.ts` and `deploy.config.ts` indirectly via app-code paths; that coupling needs to be teased apart before publishing.

---

## 2. Move `server/prod/runtimeMaps.ts` into `@luckystack/server`

**Problem.** Every consumer project today copies `runtimeMaps.ts` into their own `server/prod/` directory. The file reads `LUCKYSTACK_BUNDLE` and `await import`s `generatedApis.<bundle>.ts`. This is framework code masquerading as project code — the moment `@luckystack/server` changes how route maps are loaded, every consumer has to merge the change manually.

**Proposed change.** Move the loader into `@luckystack/server` and expose it via `createLuckyStackServer({ preset: process.env.LUCKYSTACK_BUNDLE })`. The consumer's responsibility shrinks to *generating* the per-preset maps (already handled by `scripts/generateServerRequests.ts`) — loading them at runtime becomes the framework's job.

**Rationale.** scan-2 §5: "every consumer copies this file." Same observation as #1 — anything every consumer copies should not live in app code.

**Risk.** The framework needs a way to find the generated files. Today the path is a relative `./generatedApis.<bundle>.ts` resolved from the consumer's `server/` folder. The framework would need to read it from `ProjectConfig.paths.generatedApis` (already a knob in core) or require the consumer to pass an explicit `loader` callback.

---

## 3. Rename `@luckystack/sentry` → `@luckystack/error-tracking` (or merge into `@luckystack/observability`)

**Problem.** `docs/MONITORING.md` describes a future `@luckystack/monitoring` package that ships the input/output audit trail and Prometheus vitals. Once that lands, consumers will see two packages whose names overlap conceptually:

- `@luckystack/sentry` — error capture, breadcrumbs, spans (the "Why?")
- `@luckystack/monitoring` — audit trail, metrics (the "What?")

Two names for "observability" creates discoverability friction — new users won't know which one they need, or that they need both.

**Proposed change.** Pick one of:

- **Rename** `@luckystack/sentry` to `@luckystack/error-tracking` so its scope is name-evident and `monitoring` reads as the orthogonal piece.
- **Collapse** both into `@luckystack/observability` with subpath exports (`/sentry`, `/monitoring`, `/web-vitals`).

**Rationale.** scan-2 §5 "Things I'd reconsider." Collapsing is more invasive but matches the way the framework already exposes subpath entries (`@luckystack/core/client`, `@luckystack/sync/client`).

**Risk.** Renaming requires either a deprecation shim (`@luckystack/sentry` re-exports from `@luckystack/error-tracking`) or coordinating the change before the first publish — easier today than after.

---

## 4. Per-package config split — move `email`, `presence`, `sentry` config out of `ProjectConfig`

**Problem.** `@luckystack/core`'s `projectConfig.ts` currently holds knobs for packages it doesn't own (`email`, `sentry`, `auth`, etc.). This forces:

- Core to depend on the *type shape* of every feature package's config.
- Every feature package's README to reference core for configuration, breaking the "one stop per package" reading flow.
- Consumers to keep `config.ts` in sync with feature packages they may not even have installed.

`@luckystack/presence` already does this correctly with its own `registerPresenceConfig` / `getPresenceConfig` registry — the pattern works.

**Proposed change.** Move `EmailConfig`, `EmailLoggingConfig`, and `SentryConfig` out of `ProjectConfig` into `registerEmailConfig` / `registerSentryConfig` registries inside their own packages. Keep `auth.*` in core (login is a core-level concern by framework design).

**Rationale.** scan-2 §5 lists this as medium leverage. It also lets each package's README read cleanly without redirecting to core for half the API.

**Risk.** Migration churn for early adopters. Deferring this until after the first publish would be more disruptive — better to do it before flipping `private: false`.

---

## 5. Add a `luckystack-validate-deploy` CLI

**Problem.** `services.config.ts` and `deploy.config.ts` are root files that are imported via relative paths into `packages/core/src/...Registry.ts`. This works at build time but means:

- `@luckystack/core` cannot be tested in isolation without the consumer's deploy config present.
- A misconfigured `bindings` table or a service key that exists in `services.config.ts` but not in any preset only fails at runtime, often silently (empty map served).

**Proposed change.** Ship a small CLI in `@luckystack/server` (or a separate `@luckystack/devkit-cli`) that reads both files and asserts:

- Every service is assigned to at least one preset.
- Every preset references services that exist.
- Every binding's `service` matches an actual service.
- `synchronizedEnvKeys` resolve at config time (no missing env var allowed silently).

**Rationale.** scan-2 §5. This is the same shape of guard the boot UUID handshake provides at runtime — moving the cheap checks earlier makes deploys safer.

---

## 6. New package: `@luckystack/web-vitals`

**Problem.** `docs/MONITORING.md` §C lists front-end RUM as a future package. Today the framework has no story for client-side performance metrics — consumers integrate `web-vitals` themselves, with no opinion on how to ship results to the same observability backend the server uses.

**Proposed change.** New optional package that wraps `web-vitals`, ships LCP/FID/CLS/INP to the configured `notifier` or to a registered HTTP endpoint, and tags events with the same `correlationId` the server emits via the (future) `@luckystack/monitoring` package.

**Rationale.** Closes the audit loop end-to-end. Far future relative to the publish blockers, but worth recording so it doesn't get reinvented.

---

## 7. Documentation suggestion: per-package CHANGELOG.md

**Problem.** Once `@luckystack/*` packages publish on npm, consumers will need to track behavior changes per package. Today there is no CHANGELOG anywhere — the only history is `git log` on the monorepo, which mixes unrelated package changes.

**Proposed change.** Adopt [Changesets](https://github.com/changesets/changesets) (or write a small in-house equivalent) to generate per-package `CHANGELOG.md` files from PR-attached changeset descriptions. Wire it into `npm run build` so the CI fails a release that ships unannounced changes.

**Rationale.** Standard hygiene for any npm-published workspace. Cheaper to add now than after the first release.
