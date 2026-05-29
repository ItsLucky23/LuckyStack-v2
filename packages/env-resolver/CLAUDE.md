# @luckystack/env-resolver

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

`@luckystack/env-resolver` populates `process.env` from a central remote env server at boot, eliminating per-app `.env` sprawl while keeping traditional `dotenv` loading as an opt-in fallback. The remote server is the source of truth (versioning, audit history, git-checkable exports); apps authenticate with a single `LUCKYSTACK_ENV_TOKEN` and pull their resolved key/value map before any framework code reads `process.env`.

Three modes are supported:

- `source: 'local'` — no remote calls. Existing `dotenv`/shell env keeps working. Used in tests and offline dev.
- `source: 'remote'` — fetch from the remote server. Failure throws (production-hard-stop).
- `source: 'hybrid'` — try remote, fall back to whatever `process.env` already holds on failure. Logs a warning so the operator sees the degradation.

Resolved values are written into `process.env` only when a key is currently `undefined`, so locally-shadowed values always win — developers can debug a single key without affecting their team.

## When to USE this package

- You are wiring a LuckyStack app at boot and want to centralize env management across many environments / many apps behind one token.
- You need versioned, audited env changes instead of `.env` files committed by accident.
- You are running a long-lived process and want the option to hot-refresh env values via `refreshEnvResolver`.
- You are writing an adapter that needs to read the in-memory cached resolution (`getCachedResolution`) for diagnostics.

## When to NOT suggest this (yet)

- Plain local development with a working `.env` file: stay on `source: 'local'` or simply do not call this package — `dotenv` keeps working.
- Reading a single env var inside app code: use `process.env.FOO` directly. This package only initializes; it does not expose a typed accessor.
- Storing secrets that need per-request rotation: this package caches values for `cacheTtlMs` (default 60s). Use a dedicated secret-manager SDK at the call site instead.
- Validating env-key shapes / required-key enforcement: not in scope here. Validate in your config layer (e.g. `@luckystack/core` `projectConfig`) after `initEnvResolver` has populated `process.env`.

## Function Index

| Function / Export | One-liner | Deep doc |
| --- | --- | --- |
| `initEnvResolver(options)` | Boot-time entry point. Reads `LUCKYSTACK_ENV_URL` / `_TOKEN` / `_PROJECT` / `_ENVIRONMENT` (or `options.remote`), fetches the resolved map, writes missing keys into `process.env`. Idempotent within `cacheTtlMs`. | -> docs/resolution-modes.md |
| `refreshEnvResolver(options)` | Clears the in-memory cache and re-runs `initEnvResolver`. Use when env-server admins push a hot change to a long-running process. | -> docs/resolution-modes.md |
| `getCachedResolution()` | Returns the last `{ fetchedAt, values }` resolution, or `null` when source is `'local'` or `initEnvResolver` has not yet succeeded. Read-only diagnostic accessor. | -> docs/resolution-modes.md |
| `resetEnvResolverForTests()` | Test-only helper that clears the module-level cache so integration tests can re-init with different options. | -> docs/resolution-modes.md |
| Type: `InitEnvResolverOptions` | `{ source: 'remote' \| 'local' \| 'hybrid'; remote?: RemoteEnvOptions; fallback?: 'local' \| 'throw' }`. | -> docs/env-key-validation.md |
| Type: `RemoteEnvOptions` | `{ url; authToken; project; environment; cacheTtlMs?; fetchImpl? }`. | -> docs/env-key-validation.md |

### Internal helpers (not exported, listed for AI context)

| Helper | Role |
| --- | --- |
| `buildOptionsFromEnv` | Reads `LUCKYSTACK_ENV_URL` / `_TOKEN` / `_PROJECT` / `_ENVIRONMENT`; returns `null` if any are missing so the caller can decide fallback vs throw. |
| `applyValues` | Writes each `[key, value]` from the resolved map into `process.env`, but only when the key is currently `undefined` (local overrides win). |
| `fetchRemoteEnv` | GET `${url}/projects/{project}/environments/{environment}` with `Authorization: Bearer ${authToken}`. Throws on non-2xx or missing `values` object. Honors injected `fetchImpl` for tests / non-Node-20 hosts. |
| `readEnv` | Single-call wrapper around `process.env[key]` to keep direct env reads centralized. |

## Boot-time contract (authoritative)

The order matters; deviating breaks downstream code that reads `process.env` at module-init time.

1. Call `initEnvResolver(...)` as the very first line of `server.ts` (or your boot file).
2. The resolver short-circuits in `source: 'local'` mode — no network, no writes.
3. In `'remote'` / `'hybrid'` mode it builds options from explicit `remote` or the four `LUCKYSTACK_ENV_*` env keys. Missing options + `fallback !== 'local'` -> throw.
4. If a cached resolution is still fresh (`now - fetchedAt < cacheTtlMs`), it re-applies the cache and returns. No network call.
5. Otherwise it fetches, caches, and applies. On error: `'hybrid'` (or `fallback: 'local'`) warns + returns; otherwise throws.
6. Only after `initEnvResolver` resolves should any other framework code import / read `process.env`.

## Config keys (env vars consumed)

Read directly from `process.env` inside `buildOptionsFromEnv`. All four are required together when `options.remote` is omitted:

- `LUCKYSTACK_ENV_URL` — base URL of the remote env server, no trailing slash.
- `LUCKYSTACK_ENV_TOKEN` — bearer token used in the `Authorization` header.
- `LUCKYSTACK_ENV_PROJECT` — project key on the remote (e.g. `my-app`).
- `LUCKYSTACK_ENV_ENVIRONMENT` — environment slug (`production`, `staging`, `dev`).

Optional behavioural inputs live on `RemoteEnvOptions`:

- `cacheTtlMs` (default `60_000`) — local cache TTL.
- `fetchImpl` (default global `fetch`) — override for non-Node-20 hosts or tests.

No `projectConfig` keys are read by this package; it intentionally runs before `@luckystack/core` config bootstraps.

## Peer dependencies

- **Required (runtime deps)**: `@luckystack/core`.
- **No required peers.** This package speaks plain HTTP via the global `fetch` API.
- **Optional**:
  - Any `fetch` polyfill (e.g. `undici`) when running on a host without global `fetch` — pass via `fetchImpl`.

Node `>= 20` is required because the default code path uses global `fetch`.

## Related

- Concept overview (wiring package + external env-server): `./docs/architecture.md`.
- Consumer quickstart: `./README.md`.
- Resolution modes + refresh flow: `./docs/resolution-modes.md`.
- Bootstrap validation + boot-time guards: `./docs/bootstrap-validation.md`.
- Env-key validation expectations: `./docs/env-key-validation.md`.
- Hosting + secret strategy: `/docs/HOSTING.md`.
- Boot order vs other adapters: `/docs/ARCHITECTURE_PACKAGING.md`.
