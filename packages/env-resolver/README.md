# @luckystack/env-resolver

> Wiring client that resolves `process.env` from a central remote env server at boot, with local-`.env` fallback. Part of [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2).

`@luckystack/env-resolver` is a **wiring package**, not a secret manager. It is the thin client that pulls resolved values from a separate, project-independent env-server. Developers commit `.env` / `.env.local` containing only **V-references** (e.g. `OPENAITOKEN=OPENAITOKEN_V4`); the remote server resolves those references to actual values at boot. The external env-server itself is planned as its own git repository (reusable beyond LuckyStack) and is **not yet implemented** — until it ships, `source: 'local'` and `source: 'hybrid'` keep dev / test boxes working.

For the full design (workflow, append-only versioning, auth, what this package does NOT do), read [`docs/architecture.md`](./docs/architecture.md).

## Install

```bash
npm install @luckystack/env-resolver
```

Requires Node `>= 20` (uses global `fetch`). For older Node, inject a polyfill via `fetchImpl`.

## Quickstart

Call `initEnvResolver` as the very first line of your `server.ts`, before any other framework code reads `process.env`.

```ts
import { initEnvResolver } from '@luckystack/env-resolver';
import { createLuckyStackServer } from '@luckystack/server';

await initEnvResolver({
  source: 'hybrid', // try remote, fall back to local on failure
  fallback: 'local',
});

const server = await createLuckyStackServer({ /* ... */ });
await server.listen();
```

With `source: 'hybrid'` the resolver pulls remote values when `LUCKYSTACK_ENV_URL`, `LUCKYSTACK_ENV_TOKEN`, `LUCKYSTACK_ENV_PROJECT`, and `LUCKYSTACK_ENV_ENVIRONMENT` are all set, otherwise it leaves whatever `dotenv` (or the shell) already loaded into `process.env`.

## Modes

| `source` | Behavior |
| --- | --- |
| `'local'` | No remote calls. Existing `dotenv` / shell env keeps working. Use in tests + offline dev. |
| `'remote'` | Fetch from the remote server. Failure throws — production-hard-stop. |
| `'hybrid'` | Try remote, fall back to whatever `process.env` already holds on failure. Logs a warning. |

Locally-set keys always win: `applyValues` only writes a key when `process.env[key]` is currently `undefined`, so you can shadow a single key during debugging without disturbing your team.

## Required env vars (remote mode)

| Key | Purpose |
| --- | --- |
| `LUCKYSTACK_ENV_URL` | Base URL of the remote env server (no trailing slash). |
| `LUCKYSTACK_ENV_TOKEN` | Bearer token used in the `Authorization` header. |
| `LUCKYSTACK_ENV_PROJECT` | Project key (e.g. `my-app`). |
| `LUCKYSTACK_ENV_ENVIRONMENT` | Environment slug (`production`, `staging`, `dev`). |

You can also pass these explicitly via `options.remote` instead of relying on env vars.

## Public API

| Export | Purpose |
| --- | --- |
| `initEnvResolver(options)` | Boot-time entry point. Fetches the resolved map and writes missing keys into `process.env`. Idempotent within `cacheTtlMs`. |
| `refreshEnvResolver(options)` | Clears the cache and re-runs `initEnvResolver`. Use when env-server admins push a hot change. |
| `getCachedResolution()` | Returns the last `{ fetchedAt, values }` resolution for diagnostics, or `null`. |
| `resetEnvResolverForTests()` | Test-only helper to clear the in-memory cache between integration tests. |

## Peer dependencies

- **None required.** This package speaks plain HTTP via global `fetch`.
- **Optional**: any `fetch` polyfill (e.g. `undici`) for non-Node-20 hosts — pass through `RemoteEnvOptions.fetchImpl`.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — concept overview: wiring package + external env-server, V-reference workflow, append-only versioning.
- [`docs/resolution-modes.md`](./docs/resolution-modes.md) — `local` / `remote` / `hybrid` modes, cache lifecycle, write semantics.
- [`docs/bootstrap-validation.md`](./docs/bootstrap-validation.md) — boot-time guards, hard-fail vs soft-fail conditions, test recipes.
- [`docs/env-key-validation.md`](./docs/env-key-validation.md) — bootstrap keys vs app keys, what is and is not validated.

## License

MIT — see [LICENSE](../../LICENSE).
