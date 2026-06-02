# Handoff — Framework-first remediation (R1–R5 + D-MT)

> **Date:** 2026-06-02 · **Branch:** `chore/package-split-prep` · **Status:** code complete, all gates + live sweep green, **nothing committed** (solo session).
>
> Landed the 5 framework-scope gaps from `sparring/FRAMEWORK_REMEDIATION.md` **before** the npm publish, so the published `@luckystack/*` packages cover the sharp edges every serious product hits (webhooks, graded DB clients, multi-tenant Redis keys, real uploads, single-owner orchestration). The Workspaces project builds against these post-publish.

## What was verified first

A feasibility pass (6 read-only agents + manual reading of `httpHandler.ts` / `getParams.ts` / `clients.ts` / `csrfMiddleware.ts`) confirmed **all 5 gaps are real and solvable within the existing `register*`/hook extension-point philosophy** — no fork, no `as any`/`as unknown` cast, no new runtime dependency, no breaking change. Everything is **additive with opt-in / empty defaults**: existing behavior is byte-for-byte identical until a consumer registers a formatter / exempt path / keyed client.

## The five items

| ID | Package | What shipped | Tests |
|---|---|---|---|
| **R2** | `@luckystack/core` | Keyed client registry | 10 |
| **R3** | `@luckystack/core` | `registerRedisKeyFormatter` + `formatKey` authority + proxy net | 9 |
| **R5** | `@luckystack/core` | Redis lease primitive | 8 |
| **R1+R4** | `@luckystack/server` | Pre-params webhook / streaming-upload seam + origin-exempt registry | 10 |
| **D-MT** | docs | Multi-tenant pattern doc (tenant = Workspace) | — |

### R2 — keyed client registry (`packages/core/src/clients.ts`)
Module singletons → `Map`-keyed slots. New: `registerPrismaClient(client, key?)` + `getPrismaClientFor(key?)` (and the Redis mirror), `getPrismaClientKeys()` / `getRedisClientKeys()`, `resetClientsForTests()`, `DEFAULT_CLIENT_KEY`. `getPrismaClient()` / `getRedisClient()` and the `prisma`/`redis` proxies resolve the `'default'` slot, so framework internals (sessions, rate-limit, presence) are untouched. **A keyed lookup of an unregistered slot throws** — it never silently hands back the privileged default (that would defeat graded credentials).

### R3 — Redis key formatter (`packages/core/src/redisKeyFormatter.ts`)
`formatKey(namespace, suffix)` is the single authority every framework key-site routes through; `registerRedisKeyFormatter(fn)` overrides it (per-tenant prefixing). **The default formatter reproduces the historical key bytes exactly → zero migration.** A namespace with a leading separator (`-session`, `:rate-limit`) is preserved verbatim; a plain namespace (`rag`) is colon-joined for clean app keys. The `redis` proxy additionally runs `applyStrayKeyPrefix` on single-key commands as a best-effort net — it **skips any key containing `:`**, so every framework key and `bootUuid` (`luckystack:boot:`) passes through untouched; only genuinely un-namespaced app keys get the project prefix. The 9 key-sites refactored: `session.ts`, `sessionAdapter.ts`, `passwordReset.ts`, `emailChange.ts`, `login.ts` (oauth-state), `rateLimiter.ts`, `testResetRoute.ts`.

### R5 — lease primitive (`packages/core/src/lease.ts`)
`acquireLease(name, ttlMs) → token|null` (`SET NX PX`), `renewLease`/`releaseLease` (owner-checked compare-and-pexpire / compare-and-delete via Lua). Keys flow through `formatKey('lease', …)`. **Single-Redis best-effort (not Redlock)** — the lease is a primitive; the leader-election renew loop is app code. Prior art: `createOAuthState` (SET NX) + `rateLimiter` (Lua eval).

### R1+R4 — pre-params webhook / upload seam (`packages/server`)
**R1 and R4 turned out to be the same seam.** `getParams` drains the POST body *before* custom routes run, and the framework already had a PRE_PARAMS dispatch phase. So:
- `registerCustomRoute(handler, { phase: 'pre-params' | 'post-params' })` — pre-params handlers run before `getParams`, receiving the **raw, undrained `req`** (webhook HMAC, streaming/multipart upload past the 1 MiB cap). Default `'post-params'` = unchanged.
- `registerOriginExemptPath({ pathPrefix })` — exempts a path prefix from the browser origin gate (`enforceOriginPolicy` now consults it; `routePath` is parsed before the origin check). **Fail-closed / empty by default.**
- **Security model** (`docs/ARCHITECTURE_HTTP.md`): origin exemption ≠ authentication — the handler MUST verify a signature/secret. Keep webhooks on a dedicated prefix (`/webhooks/`), never overlap `/api`·`/auth`·`/sync`. Worked examples: GitLab HMAC webhook + streaming audio upload.

### D-MT — multi-tenancy (`docs/ARCHITECTURE_MULTI_TENANCY.md`)
Tenant = Workspace, composing the three new primitives: Prisma `$extends` where-injection on `workspaceId` (row isolation) + R2 keyed clients (graded creds) + R3 formatter (per-tenant Redis keys) + per-workspace secrets. RBAC (Owner/Admin/Member) stays app-domain — the framework stops at `auth={ login: true }`.

## New public API (consumer-facing)

```ts
// @luckystack/core
import {
  registerPrismaClient, getPrismaClientFor, getPrismaClientKeys, DEFAULT_CLIENT_KEY,
  registerRedisClient, getRedisClientFor, getRedisClientKeys,
  registerRedisKeyFormatter, formatKey, getRedisKeyFormatter, applyStrayKeyPrefix,
  acquireLease, renewLease, releaseLease,
} from '@luckystack/core';

// @luckystack/server
import {
  registerCustomRoute,            // now accepts { phase: 'pre-params' | 'post-params' }
  getPreParamsCustomRoutes,
  registerOriginExemptPath, getOriginExemptPaths, isOriginExemptPath,
} from '@luckystack/server';
```

## Files touched

- **core:** `src/clients.ts`, `src/redisKeyFormatter.ts` *(new)*, `src/redis.ts`, `src/rateLimiter.ts`, `src/lease.ts` *(new)*, `src/index.ts` + `clients.test.ts`, `redisKeyFormatter.test.ts`, `lease.test.ts` *(new)*.
- **login:** `src/session.ts`, `sessionAdapter.ts`, `passwordReset.ts`, `emailChange.ts`, `login.ts`, `session.test.ts` (mock).
- **server:** `src/httpHandler.ts`, `customRoutesRegistry.ts` (+ test), `originExemptRegistry.ts` *(new + test)*, `types.ts`, `index.ts`, `httpRoutes/customRoutes.ts`, `httpRoutes/testResetRoute.ts`.
- **docs:** `ARCHITECTURE_HTTP.md` *(new)*, `ARCHITECTURE_MULTI_TENANCY.md` *(new)*, `AI_QUICK_INDEX.md` (regenerated); `packages/{core,server}/CLAUDE.md`; root `CLAUDE.md` docs table.

## Verification

| Gate | Result |
|---|---|
| `npx tsc -b` | 0 |
| `npm run lint:packages` | 0 |
| `npm run test:unit` | **748 passed** (+37) |
| `npm run build:packages` | 14/14 |
| `npm run pack:dry` | 14/14 |
| `TEST_BASE_URL=http://localhost:81 npm run test` (live) | **113 passed · 0 failed · 11 skipped** (baseline — zero regression) |

The live sweep proves R3 byte-preservation end-to-end (`credentials login success` + sessions/rate-limit against real Redis with the new keys) and that R1/R4's pipeline reorder didn't weaken the fail-closed origin/CSRF policy (contract 18/18, auth 9/9).

## Open items (developer actions — not blockers in the code)

- **Optional:** webhook/upload end-to-end via the curl recipe in `docs/ARCHITECTURE_HTTP.md` (`/webhooks/*` → 200 not 403; `/api/*` with no Origin → still 403; >1 MiB upload → no 413).
- **Before publish:** `npm install` (refreshes the stale `@luckystack/env-resolver` symlink) + `npm org create luckystack`.
- **Commit:** the whole session sits uncommitted on `chore/package-split-prep` (plus the earlier secret-manager pile). Commit when ready.

## Notes

- Reminder: the dev `:81` server runs `tsx server/server.ts` resolving `@luckystack/*` to `packages/*/src` via `tsconfig.server.json` paths. The supervisor does **not** restart on `packages/*/src` changes — restart manually to pick up framework-package edits before a live sweep. (A second project, `matchrix`, holds `:80`; always target `:81`.)
