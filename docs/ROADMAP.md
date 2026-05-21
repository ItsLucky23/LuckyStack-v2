# LuckyStack Roadmap

> Future work that is intentionally out of scope for the current `chore/package-split-prep` branch. Grouped by category so an AI agent or contributor can scan it quickly and pick up an item without re-litigating context.

---

## 1. External packages and repositories

These live (or will live) outside the framework monorepo. The framework ships thin adapters or concept docs; the heavy lifting happens in dedicated repos.

### `@luckystack/env-resolver` server-side

- **What**: Standalone HTTP service that resolves env-reference values such as `OPENAITOKEN=OPENAITOKEN_V4` to the actual secret. Append-only versioning so older branches keep working when checked out. Auth via bearer token.
- **Where**: Separate git repo (not yet created). Project-agnostic — reusable outside LuckyStack.
- **Status**: Concept documented in `packages/env-resolver/docs/architecture.md`. Client side (`@luckystack/env-resolver`) is built and ready to talk to this server once it exists.
- **Why deferred**: The framework can ship without it; consumers use plain `.env` for now and switch to the resolver when the server is online.

### `@luckystack/monitoring`

- **What**: Pluggable monitoring/observability layer covering metrics, traces, and dashboards.
- **Where**: Separate git repo (not yet created).
- **Relationship to framework**: The framework ships only a thin adapter surface (similar to how `@luckystack/error-tracking` works); the heavy logic lives in the dedicated repo.
- **Status**: Not started. Memory `[[project_monitoring_separation]]` captures the rationale.

### `@luckystack/web-vitals`

- **What**: Browser-side performance metrics (LCP, FID, CLS, INP) reported to the monitoring backend.
- **Where**: Subpath inside `@luckystack/monitoring`, not a separate package.
- **Status**: Folded into the monitoring repo plan — no standalone package will be published.

### `@luckystack/sync-docs` CLI

- **What**: `npx @luckystack/sync-docs` refreshes a consumer's `docs/luckystack/` snapshot when the framework receives doc updates. Diff-merge aware so consumer-custom edits are preserved.
- **Status**: Not built. For MVP the scaffold-time copy is sufficient. Consumers can manually re-run `npx create-luckystack-app` against a temp dir and copy the deltas if they care about staying in sync.

---

## 2. Pre-`npm publish` blockers

Must-do before the first public release.

- **Flip `private: true` → `false`** on every publishable `@luckystack/*` package. Some packages still ship with `private: true` from the pre-split era. Audit:
  ```bash
  grep -l '"private": true' packages/*/package.json
  ```
- **Register the `@luckystack` npm scope**: `npm org create luckystack` (per memory `[[project_npm_scope_registration]]`). Owner is required before any scoped publish.
- **Staging publish smoke**: `npm publish --dry-run` per package, then scaffold a consumer in `/tmp`, install from a scoped staging registry (Verdaccio or similar), and verify end-to-end install + boot.

---

## 3. Niche edge-cases that still require framework changes

3 of the original 5 niche edge-cases were resolved in `chore/package-split-prep` (socket middleware, CSRF config, Prisma `$extends` docs). The remaining 2 are deeper refactors:

### Redis-key naming convention

- **Status**: Edges of the framework hardcode key prefixes like `session:<token>`, `rateLimit:<key>`, `oauth-state:<id>`, `password-reset:<token>`, `presence:<token>`. Spread across at least 8 source files.
- **Proposed**: Centralise key generation through a `getRedisKey(scope, ...parts)` util in `@luckystack/core`, then add a `registerRedisKeyFormatter(formatter)` registry on top so consumers can swap prefixes for multi-tenancy.
- **Scope**: Refactor across `@luckystack/login`, `@luckystack/core`, `@luckystack/presence`. Estimated 1-2 days of focused work plus migration documentation for early adopters.

### Custom JWT signing as alternative session backend

- **Status**: Sessions are Redis-backed via `sessionAdapter` (registry exists, default reads/writes Redis). There is no JWT mechanism.
- **Proposed**: Add a `JwtSessionAdapter` variant alongside the existing Redis adapter, plus a config slot (`auth.sessionMode: 'redis' | 'jwt'`). New code in `@luckystack/login` for sign/verify, env keys for the signing secret, optional JWKS rotation.
- **Scope**: New module in `@luckystack/login` (~300 lines), updates to login flow, docs, and tests. Apt for a dedicated sprint.

---

## 4. Carry-overs from older sessions

Items that surfaced before the publishability sweep and are tracked in `docs/_archive/SESSION_STATE_2026-05-20.md`. None block publish.

- **Microsoft OAuth never end-to-end tested** — requires an Azure AD tenant. Other providers (Google, GitHub, Discord, Facebook) are verified.
- **`npm run server` smoke not re-run since 2026-05-18** — full dev-server boot after the publishability + docs + migration sweeps has not been manually verified yet. Recommended before push.
- **Session-loss diagnostic warn-logs** — waiting on live reproduction in production traffic.
- **3 documented strict-typing exceptions** that were accepted as necessary deviations from the "zero `as unknown`/`as any`" policy:
  - `src/docs/page.tsx:417`
  - `packages/login/src/userAdapter.ts:64`
  - `packages/server/src/httpRoutes/healthRoutes.ts:25`

---

## 5. Tech debt for future sweeps

### Documentation

- **Split `docs/ARCHITECTURE_PACKAGING.md`** — currently 129 KB. Hard to scan and creates merge-conflict hotspots.
- **`packages/server/docs/security-defaults.md` + `http-routes.md`** still mention hardcoded `'x-csrf-token'` — should reference `registerCsrfConfig()` now.
- **Per-package `CHANGELOG.md`** — only useful once there are published versions to track. Wait for the first npm publish, then bootstrap per package.

### Tooling

- **JSDoc-based `AI_INDEX.md` Function INDEX regenerator** — currently hand-curated. Worth building (~100-line Node script reusing `packages/devkit/src/typeMap/extractors.ts`) when drift between source signatures and the INDEX table becomes a recurring chore. Until then, the periodic-review approach is fine.
- **Optional runtime warning in `registerCsrfConfig()`** when `cookieOptions.httpOnly === true` is set (since that would break client-side reads once cookie-issued CSRF mode lands).
- **error-tracking build wave reorder**: `error-tracking` now sits in its own wave after `login` because of a type-only import. Total build time grew ~5 s. Acceptable, but if the wave count keeps growing, switch the build script to a topological scheduler that respects declared dependencies instead of hand-maintained waves.

### Generated files

- **`apiTypes.generated.ts` `session.*` paths** — in the framework repo, TypeScript resolves the workspace dependency to its source folder (`../../packages/login/src/session`). In a consumer repo this resolves to `node_modules/@luckystack/login` and works correctly, so it is only cosmetically odd in the framework. A `tsconfig` paths tweak could normalise this.

---

## 6. Open questions / things I do not know for sure

Items that need a real smoke test or production observation to confirm. Not blockers, but worth verifying before relying on them.

- Does the scaffold-template `functions/` folder copy correctly via `create-luckystack-app`? The shim files (`db.ts`, `redis.ts`, `session.ts`, `sentry.ts`, `sleep.ts`, `example.ts`) need to land in the scaffolded project's `functions/` and be picked up by `initializeFunctions()` on first boot.
- Does the hook-based error-tracking auto-instrumentation behave correctly under concurrent requests (WeakMap span pinning)? Lab-verified, not load-tested.
- Does `npm run ai:index` triggered by the pre-commit hook (`.githooks/pre-commit`) interact correctly with `git commit -a` and partial staging? Manually verified, edge cases unknown.
- Does the consumer-side `postinstall` (`npm run generateArtifacts`) regenerate `apiTypes.generated.ts` correctly on a fresh `npx create-luckystack-app` install?

---

## 7. How to pick up an item from this roadmap

1. **Read the relevant section above** plus any linked memory or doc.
2. **Search `branch-logs/<branch>.md`** in the archive directory for prior context: `docs/_archive/SESSION_STATE_2026-05-20.md` and the active branch log.
3. **Check `docs/AGENT_TEAM_PLAYBOOK.md` § Tooling Decisions** — that section captures the rationale for why some patterns (no JSDoc auto-extractor for deep docs, etc.) were intentionally left as-is.
4. **Start a new branch** named for the work (`feat/redis-key-formatter`, `feat/jwt-session-adapter`, etc.). Do not extend `chore/package-split-prep` — that branch is the publishability prep landing zone.
5. **Update this `docs/ROADMAP.md`** when the item lands or the plan changes. Treat it as a living document, not historical record.
