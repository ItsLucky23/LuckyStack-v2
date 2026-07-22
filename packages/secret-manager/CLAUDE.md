# @luckystack/secret-manager

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

`@luckystack/secret-manager` is the **client** half of a rotation-aware secret system. The app commits a `.env` containing **pointers** (`OPENAI_KEY=OPENAI_AUTHORIZATION_KEY_V5`), not real secrets. At boot this client scans `process.env`, collects every pointer-shaped value (`<BASE>_V<n>`), resolves them in ONE `POST /resolve` request against an external append-only secret-manager server, and overwrites each `process.env` entry with the real value — so downstream code reads `process.env.OPENAI_KEY` and gets the resolved secret. The companion server (storage, versioning, admin UI, one shared bearer token) lives in its own repository.

Three modes: `'remote'` (default — missing pointer / unreachable server throws), `'local'` (no network; pointers untouched; tests + offline dev), `'hybrid'` (try server, warn + keep local env on failure). Optional opt-in dev hot reload re-resolves on `.env` change and/or on an interval (no-op in production).

## When to USE this package

- You want to keep `.env` committed (safe, shareable) while real secrets live on a central server.
- You need rotation that doesn't break old branches: bump `..._V5` to `..._V6`, old branches keep resolving their pinned version.
- You are wiring a LuckyStack app at boot and want resolved secrets in `process.env` before any framework code runs.

## When to NOT suggest this (yet)

- Plain local dev with real values in `.env.local`: just use `process.env.FOO` directly — non-pointer values are left untouched, so you don't even need to call this.
- Per-request secret rotation with zero staleness: this resolves at boot (+ optional dev poll). Use a dedicated SDK at the call site for sub-second rotation guarantees.
- Validating env-key shapes / required-key enforcement: out of scope. Validate in your config layer (e.g. `@luckystack/core` `projectConfig`) after `initSecretManager` has populated `process.env`.

## Function Index

| Function / Export | One-liner | Deep doc |
| --- | --- | --- |
| `initSecretManager(config)` | Boot-time entry. Scans `process.env` for pointer-shaped values, `POST /resolve`s them, overwrites `process.env` with real values. No-op in `'local'`. Starts dev hot reload when `config.dev` is set. Starts the production rotation poll when `config.pollIntervalMs` is set. | -> docs/architecture.md |
| `refreshSecretManager()` | Re-resolve the captured pointers against the server (the production rotation poll channel). Call manually after an admin rotates a secret on a long-running process. No-op in `'local'` mode. | -> docs/architecture.md |
| `reloadSecretManagerFromFiles()` | Re-parse the configured env files (`dev.envFiles`, default `.env` + `.env.local`) and apply them: plain values injected into `process.env`, pointer-shaped values re-resolved. File-owned names replace their prior topology (pointer→plain/removal drops the stale pointer), while unrelated inherited shell/CI pointers remain active. The dev **file-watch** channel; callable manually. No-op before init or in `'local'` mode. | -> docs/architecture.md |
| `stopSecretManager()` | Tear down all dev watchers, debounce timers, and rotation-poll intervals started by `initSecretManager`. Call on process shutdown if you need deterministic cleanup; otherwise timers are `unref`'d and won't block exit. | -> docs/architecture.md |
| `getCachedResolution()` | Returns a shallow copy of the last `{ fetchedAt, values }` (pointer -> resolved secret) for diagnostics, or `null`. **Sensitive** — never serialize into HTTP responses, health payloads, or logs. | -> docs/architecture.md |
| `getCachedResolutionMeta()` | Values-free diagnostic view: `{ fetchedAt, pointerNames, pointerCount }` — the resolved pointer names only, never the secret values. Safe for logs and health endpoints. | -> docs/architecture.md |
| `resetSecretManagerForTests()` | Test-only — clears all module state and tears down dev watchers / timers. | -> docs/architecture.md |
| Type `SecretManagerConfig` | `{ url; token; source?; pointerPattern?; envNames?; allowInsecureHttp?; timeoutMs?; retries?; resolvePath?; headers?; onApplied?; onResolveError?; fetchImpl?; pollIntervalMs?; dev? }` where `dev` is `{ watch?; pollIntervalMs?; envFiles? }`. | -> docs/architecture.md |
| Type `SecretManagerToken` | `string \| { fromFile: string }`. | -> docs/architecture.md |
| Type `CachedResolution` | `{ fetchedAt: number; values: Record<string, string> }`. | -> docs/architecture.md |
| Type `CachedResolutionMeta` | `{ fetchedAt: number; pointerNames: string[]; pointerCount: number }`. | -> docs/architecture.md |

### Internal helpers (not exported, listed for AI context)

| Helper | Role |
| --- | --- |
| `capturePointers(pattern)` | Scan `process.env` once, return `{ envName -> pointer }` for every value matching the pointer pattern. Captured once because the first resolve overwrites the value with the real secret (no longer pointer-shaped). |
| `resolveToken(token)` | Return the literal token, or read+trim the `{ fromFile }` file (read at resolve time so file rotation is picked up). |
| `fetchResolve(config, pointers)` | `POST ${url}/resolve` with `{ keys: pointers }` and `Authorization: Bearer <token>`. Throws on non-2xx or a missing `values` object. Honors `fetchImpl`. |
| `applyResolved(map, values, source)` | Overwrite `process.env[envName]` with the resolved value. In `'remote'` mode, fail fast (throw) if any pointer is unresolved BEFORE mutating; in `'hybrid'` warn per missing pointer and leave it as-is. |
| `parseEnvFile(content)` | In-package minimal `.env` parser (KEY=VALUE, full-line + inline comments, quoted values). Keeps the package dependency-free; used by the file-reload path. |
| `startDevReload(config)` | Opt-in (`config.dev` set) + non-production. Starts a debounced `fs.watch` on `dev.envFiles` (-> `reloadSecretManagerFromFiles`) and/or an interval poll (-> `refreshSecretManager`). Both channels swallow + warn on error so a transient failure never crashes dev. |

## Boot-time contract (authoritative)

1. Call `initSecretManager(...)` as the very first line of `server.ts`, before any other framework code reads `process.env`.
2. `'local'` mode short-circuits — no network, no writes, no watchers.
3. Otherwise it captures the pointer map once, `POST /resolve`s the unique pointers, and overwrites `process.env`.
4. `'remote'`: a missing pointer or fetch error throws (hard boot stop). `'hybrid'`: warn and leave `process.env` as-is.
5. When `config.dev` is set and not production, dev hot reload starts: a debounced watch on `dev.envFiles` re-parses the files (plain values injected, pointers re-resolved) and an optional interval poll re-resolves the current pointers. Pointer ownership is tracked by source: file-owned names can transition to plain or be removed without a stale captured pointer resurfacing; inherited pointers absent from the files are preserved.
6. Only after `initSecretManager` resolves should other framework code read `process.env`.

## Config keys

This package reads **no** env vars itself — it consumes `SecretManagerConfig` (typically built in `config.ts` and passed in `server.ts`). The values you commonly source from env / a file:

| Key | Purpose | Notes |
| --- | --- | --- |
| `url` | Base URL of the secret-manager server (trailing slash optional). | Required (except `source:'local'`). |
| `token` | Shared bearer token: literal string or `{ fromFile }` (gitignored single-line file). | Read at resolve time — file rotation picked up on next poll. A `Bearer ` prefix is stripped + warned. |
| `source` | `'remote'` (default) / `'local'` / `'hybrid'`. | `'remote'` = hard boot stop on failure; `'hybrid'` = warn + keep local env. |
| `envNames` | Allowlist of env-var NAMES eligible for resolution: `string[]` or `(name) => boolean`. **Secure default: unset resolves NOTHING off-host** (a boot warning is emitted so the deny-all is never silent). Pass `() => true` to scan every name deliberately. | Required to actually resolve anything. |
| `dev` | Opt-in dev hot reload: `{ watch?, pollIntervalMs?, envFiles? }`. Ignored in production (`NODE_ENV !== 'development'|'test'`). | — |

### Advanced keys (direct-call-only — not needed for typical boot wiring)

| Key | Purpose |
| --- | --- |
| `pointerPattern` | Override the pointer-shape detector (default `/^(.+)_V(\d+)$/`). Stateful `g`/`y` flags are stripped automatically. |
| `allowInsecureHttp` | Permit `http:` to a non-loopback host. A loud warning is still emitted. Loopback is always permitted. |
| `timeoutMs` | Abort a black-hole server after N ms (default `10_000`). Set `0` to disable. |
| `retries` | `{ count, delayMs? }` — retry on transport error / non-2xx before giving up. Default `{ count: 0 }`. |
| `resolvePath` | Override the resolve endpoint path (default `'/resolve'`). |
| `headers` | Extra request headers merged onto every resolve request (cannot override `Authorization`). |
| `onApplied` | Called after secrets are written to `process.env` — receives changed env NAMES only (never the values). Use to re-create pools/SDK clients on rotation. |
| `onResolveError` | Called on resolve failure (alongside the existing `console.warn`). Route to Sentry/metrics; useful for `'hybrid'` where a silent warn is the default. |
| `fetchImpl` | Override the global `fetch`. For non-Node-20 hosts or test injection. |
| `pollIntervalMs` | Production rotation poll interval in ms (re-resolves in ALL environments). Default `0` (disabled). Timers are `unref`'d. |

`process.env` values matching `pointerPattern` (default `/^(.+)_V(\d+)$/`) are the pointers this client resolves and overwrites.

## Design note — single resolver per process

`@luckystack/secret-manager` uses module-level state (`activeConfig`, `pointerMap`, `cachedResolution`, `resolveChain`). This is intentional: there is one canonical view of `process.env`, so a second parallel resolver would race against the first. If you need to resolve different configs separately (e.g. a multi-stage bootstrap), call `stopSecretManager()` + `resetSecretManagerForTests()` between them (the latter is exported but named for test clarity — it is safe to call in non-test bootstrap code too). Running two resolvers concurrently against the same `process.env` is unsupported.

## Peer dependencies

- **None required.** Speaks plain HTTP via global `fetch`; reads the token file with Node's built-in `fs`.
- **Optional**: any `fetch` polyfill (e.g. `undici`) for non-Node-20 hosts — pass via `SecretManagerConfig.fetchImpl`.

Node `>= 20` is required because the default code path uses global `fetch`.

## Related

- Concept overview + external-server wire contract: `./docs/architecture.md`.
- Consumer quickstart: `./README.md`.
- Framework-wide packaging map: `/docs/PACKAGE_OVERVIEW.md`.
- Architecture deep-dive: `/docs/ARCHITECTURE_SECRET_MANAGER.md`.
