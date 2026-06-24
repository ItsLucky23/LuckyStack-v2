# @luckystack/secret-manager

> Rotation-aware secret resolver client. Commit `.env` **pointers** instead of real secrets; resolve them against an external secret-manager server at boot. Part of [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2).

`@luckystack/secret-manager` is the thin client that lives inside a LuckyStack app. Your committed `.env` holds pointers like `OPENAI_KEY=OPENAI_AUTHORIZATION_KEY_V5` — never the real secret. At boot the client collects every pointer-shaped value, asks the server to resolve them in one request, and overwrites `process.env` with the real values. Rotating a secret means publishing a new version (`..._V6`) on the server; old git branches that still point at `..._V5` keep booting.

For the full design (pointer model, append-only versioning, the external server's wire contract), read [`docs/architecture.md`](./docs/architecture.md).

## Install

```bash
npm install @luckystack/secret-manager
```

Requires Node `>= 20` (uses global `fetch`). For older Node, inject a polyfill via `fetchImpl`.

## Quickstart

Call `initSecretManager` as the very first line of your `server.ts`, before any other framework code reads `process.env`.

```ts
import { initSecretManager } from '@luckystack/secret-manager';
import { bootstrapLuckyStack } from '@luckystack/server';

await initSecretManager({
  url: process.env.LUCKYSTACK_SECRET_MANAGER_URL!,
  token: { fromFile: '.secret-manager-token' }, // gitignored file, one line = the token
  source: 'hybrid', // try the server, keep local env on failure
});

const server = await bootstrapLuckyStack({ /* ... */ });
await server.listen();
```

In your committed `.env`:

```
OPENAI_KEY=OPENAI_AUTHORIZATION_KEY_V5
STRIPE_KEY=STRIPE_SECRET_KEY_V2
```

After `initSecretManager` resolves, `process.env.OPENAI_KEY` holds the real `sk-...` value.

## Modes

| `source` | Behavior |
| --- | --- |
| `'remote'` (default) | Resolve from the server. A missing pointer or an unreachable server **throws** — production hard-stop. |
| `'local'` | No network. Pointers are left untouched. Use in tests + offline dev. |
| `'hybrid'` | Try the server; on failure warn and leave whatever `process.env` already holds. |

A value that is **not** pointer-shaped (e.g. `NODE_ENV=production`, or a real secret you pasted locally) is treated as a literal and never sent to the server — so local overrides win automatically.

## Dev hot reload (opt-in)

Pass a `dev` object to live-reload while a long-running dev process is up. Ignored when `NODE_ENV === 'production'`.

```ts
await initSecretManager({
  url: process.env.LUCKYSTACK_SECRET_MANAGER_URL!,
  token: { fromFile: '.secret-manager-token' },
  dev: {
    watch: true,          // re-read .env / .env.local on change (default true)
    pollIntervalMs: 5000, // also re-resolve every 5s (default off)
    // envFiles: ['.env', '.env.local'], // override which files are watched
  },
});
```

- **On file change** (`watch`): the env files are re-parsed and applied — plain values (e.g. `ENVIRONMENT=production`, `PORT=123`) are injected straight into `process.env` (live config reload), and pointer-shaped values are re-resolved against the server. A pointer added or bumped after boot is picked up here — no restart.
- **On the poll interval** (`pollIntervalMs`): the current pointers are re-resolved, catching server-side rotations. The interval lives in your `config.ts`, so it's changeable in one place.

So `.env` (plain config) and `.env.local` (pointers/secrets) both live-reload — `.env` values are injected as-is, `.env.local` pointers are resolved from the server.

## Public API

| Export | Purpose |
| --- | --- |
| `initSecretManager(config)` | Boot-time entry point. Resolves pointer-shaped env values and writes the real values into `process.env`. |
| `refreshSecretManager()` | Re-resolve the captured pointers against the server (the poll channel; call manually after an admin rotates a secret). |
| `reloadSecretManagerFromFiles()` | Re-parse the configured env files and apply them — plain values injected, pointers resolved. The file-watch channel; callable manually. |
| `getCachedResolution()` | Returns a shallow copy of the last `{ fetchedAt, values }` resolution (pointer -> value), or `null`. **⚠️ SENSITIVE** — `values` are the RAW resolved secrets; never serialize into an HTTP response, a `/health` payload, or a log line. For a safe diagnostic use `getCachedResolutionMeta()`. |
| `getCachedResolutionMeta()` | Values-free diagnostic view: `{ fetchedAt, pointerNames, pointerCount }` — resolved pointer NAMES only, never the secret values. Safe for logs and `/health` endpoints. |
| `resetSecretManagerForTests()` | Test-only — clears module state and tears down dev watchers / timers. |

## The token file

The shared bearer token is the only real secret on the developer machine. Keep it in a single-line file (e.g. `.secret-manager-token`) that is **gitignored**, and reference it with `token: { fromFile: '.secret-manager-token' }`. CI runners can inject the file from their secret store. You may also pass the token as a literal string if you read it from your own secret source.

## Peer dependencies

- **None.** This package speaks plain HTTP via global `fetch` and reads the token file with Node's built-in `fs`.
- **Optional**: any `fetch` polyfill (e.g. `undici`) for non-Node-20 hosts — pass via `SecretManagerConfig.fetchImpl`.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — pointer model, append-only versioning, the external server's `POST /resolve` wire contract, and what this package does NOT do.

## License

MIT — see [LICENSE](./LICENSE).
