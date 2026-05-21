# Env-key validation

> Contract for the four `LUCKYSTACK_ENV_*` keys consumed by `buildOptionsFromEnv`, the shape requirements for `InitEnvResolverOptions` / `RemoteEnvOptions`, and what validation does (and explicitly does NOT) happen on values returned by the remote server.

For the design context (V-reference workflow + the planned external env-server), read `./architecture.md` first. This file documents how env keys are validated (or not) on the way **in** to the resolver (boot-time options) and on the way **out** (values applied to `process.env`).

## Two distinct key sets

There are two unrelated categories of env keys in this package's flow. Conflating them is the most common mistake when wiring `env-resolver` into a new app.

| Category | Examples | Validated by `env-resolver`? |
| --- | --- | --- |
| **Bootstrap keys** — used to *configure* the resolver itself | `LUCKYSTACK_ENV_URL`, `LUCKYSTACK_ENV_TOKEN`, `LUCKYSTACK_ENV_PROJECT`, `LUCKYSTACK_ENV_ENVIRONMENT` | Yes — presence-only. See `buildOptionsFromEnv`. |
| **App keys** — values fetched FROM the remote server and applied to `process.env` (e.g. `DATABASE_URL`, `SESSION_SECRET`) | Whatever the remote returns | No. The resolver writes them blindly; your app's config layer validates shape. |

Validation of the **app keys** belongs in `@luckystack/core` `projectConfig` (or wherever your app declares its required-env schema). The resolver's job is delivery, not validation.

## Bootstrap-key contract

`buildOptionsFromEnv` is the only place these four keys are read:

```ts
const buildOptionsFromEnv = (): RemoteEnvOptions | null => {
  const url = readEnv('LUCKYSTACK_ENV_URL');
  const authToken = readEnv('LUCKYSTACK_ENV_TOKEN');
  const project = readEnv('LUCKYSTACK_ENV_PROJECT');
  const environment = readEnv('LUCKYSTACK_ENV_ENVIRONMENT');
  if (!url || !authToken || !project || !environment) return null;
  return { url, authToken, project, environment };
};
```

### Required keys

| Key | Expected shape | Example | Failure mode if missing |
| --- | --- | --- | --- |
| `LUCKYSTACK_ENV_URL` | Base URL of the remote env server, no trailing slash. The resolver normalises a trailing slash with `replace(/\/+$/, '')` before appending the path, so `https://env.example.com/` and `https://env.example.com` behave identically. | `https://env.luckystack.io` | `buildOptionsFromEnv` returns `null`. |
| `LUCKYSTACK_ENV_TOKEN` | Opaque bearer token. No format check. Sent verbatim as `Authorization: Bearer ${authToken}`. | `lsk_live_abcd...` | `buildOptionsFromEnv` returns `null`. |
| `LUCKYSTACK_ENV_PROJECT` | Project slug. URL-encoded by `encodeURIComponent` before being appended to the path. Slashes inside the value will be percent-encoded, which the env server should reject. | `my-app` | `buildOptionsFromEnv` returns `null`. |
| `LUCKYSTACK_ENV_ENVIRONMENT` | Environment slug. URL-encoded the same way. Conventional values: `production`, `staging`, `dev`, but the resolver does not enforce any allow-list. | `production` | `buildOptionsFromEnv` returns `null`. |

### All-or-nothing behaviour

`buildOptionsFromEnv` does **not** report which key is missing. The four keys are presence-checked together and coalesce into a single boolean. The downstream error message lists all four:

```
[env-resolver] Remote source selected but no remote options + no LUCKYSTACK_ENV_URL/TOKEN/PROJECT/ENVIRONMENT in env.
```

Operators chasing a missing key should:

1. Print all four with a `node -e "console.log(...)"` one-liner before calling `initEnvResolver`.
2. Or pass `options.remote` explicitly so the bad field is obvious in the call site.

Mixing strategies (e.g. `options.remote = { url }` and the other three from env) is **not** supported. `options.remote` takes precedence wholesale; if it is present, env vars are not consulted.

### What is NOT validated on bootstrap keys

The resolver intentionally skips these checks:

- **URL well-formedness** — `LUCKYSTACK_ENV_URL` is not parsed with `new URL(...)`. A malformed value is allowed through; `fetch` will reject it with `TypeError: Invalid URL`.
- **Scheme allow-list** — `http://` is accepted alongside `https://`. Use `https://` in production; the resolver does not enforce it.
- **Token format** — any non-empty string passes. No length or prefix check.
- **Project / environment allow-list** — any non-empty string passes. Typos like `produciton` will reach the remote server, which should respond with a 4xx.

This is deliberate: the resolver runs **before** any logging/Sentry/config layer is ready, so error messages need to stay simple. The remote server is the authority on which projects/environments exist.

## Programmatic options shape

When passing `options.remote` directly instead of relying on env vars:

```ts
interface RemoteEnvOptions {
  url: string;            // required, non-empty
  authToken: string;      // required, non-empty
  project: string;        // required, non-empty
  environment: string;    // required, non-empty
  cacheTtlMs?: number;    // optional, default 60_000
  fetchImpl?: typeof fetch; // optional, default globalThis.fetch
}
```

TypeScript enforces presence of the four required strings at compile time. The resolver itself does **not** re-validate at runtime (an empty string for `url` will reach `fetch` and fail there).

For `InitEnvResolverOptions`:

```ts
interface InitEnvResolverOptions {
  source: 'remote' | 'local' | 'hybrid';     // required
  remote?: RemoteEnvOptions;                  // optional; falls back to buildOptionsFromEnv()
  fallback?: 'local' | 'throw';               // optional; default 'throw' (implicit)
}
```

Notes:

- `source: 'local'` ignores `remote` and `fallback` entirely. There is no validation that they are absent.
- `source: 'remote'` with `fallback: 'local'` is valid and converts a hard failure into a warning.
- `source: 'hybrid'` already implies soft-failure, so an explicit `fallback` is redundant but not an error.

## Recommended `cacheTtlMs` per environment

The resolver itself has no opinion; this is operator guidance.

| Environment | Suggested `cacheTtlMs` | Rationale |
| --- | --- | --- |
| Local dev | `60_000` (default) or higher | You rarely care about hot-rotation locally; minimise dev-server churn. |
| Staging / canary | `30_000` | Slightly faster pickup of operator-pushed changes during pre-prod testing. |
| Production | `60_000`–`300_000` | Boot-time fetch dominates; in-flight rotation should go through `refreshEnvResolver` triggered by an admin signal, not aggressive TTL polling. |

Polling vs. push: the resolver does not poll. The TTL only matters when something *calls* `initEnvResolver` again (e.g. a fork-restart of a worker). For true hot-rotation, expose an admin endpoint that calls `refreshEnvResolver`.

## App-side validation (after `initEnvResolver` returns)

The resolver writes whatever the remote returns into `process.env` without inspecting the keys. App-side validation is the caller's job and should run **immediately after** `initEnvResolver` resolves:

```ts
await initEnvResolver({ source: 'hybrid' });

// App-side schema check happens here, in your config layer:
import { loadProjectConfig } from '@luckystack/core';
const config = loadProjectConfig(); // throws on missing/mistyped required keys
```

Why this split:

- **Single source of expected keys.** The remote server should not be tightly coupled to your app's schema; it just stores key/value pairs. Your app declares which keys it needs.
- **Composable.** Multiple LuckyStack apps share an env server but each has its own required-key list.
- **Forward-compatible.** If the remote adds new keys (feature flags, integration toggles), your app simply ignores them until its config layer opts in.

## Locally-shadowed keys

`applyValues` only writes keys where `process.env[key] === undefined`. From a validation perspective:

- A locally-set key is treated as authoritative. Validation runs against the local value, not the remote value.
- This is the documented escape hatch for debugging a single key against staging values without changing the whole environment.
- `getCachedResolution()` returns the **remote** values (what would have been applied), which can be diff-ed against `process.env` to detect overrides. Useful for diagnostics endpoints.

## Test recipe

To exercise the validation paths without hitting a real server:

```ts
import { initEnvResolver, resetEnvResolverForTests } from '@luckystack/env-resolver';

resetEnvResolverForTests();
delete process.env.LUCKYSTACK_ENV_URL;
delete process.env.LUCKYSTACK_ENV_TOKEN;
delete process.env.LUCKYSTACK_ENV_PROJECT;
delete process.env.LUCKYSTACK_ENV_ENVIRONMENT;

// Expected: throws "[env-resolver] Remote source selected but no remote options ..."
await expect(initEnvResolver({ source: 'remote' })).rejects.toThrow();

// With fallback, the same input is silent:
await expect(initEnvResolver({ source: 'remote', fallback: 'local' })).resolves.toBeUndefined();
```

For successful-fetch shapes:

```ts
const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
  values: { DATABASE_URL: 'postgres://...', SESSION_SECRET: 'abc' },
}), { status: 200, headers: { 'content-type': 'application/json' } });

await initEnvResolver({
  source: 'remote',
  remote: {
    url: 'https://env.example.com',
    authToken: 'test',
    project: 'app',
    environment: 'dev',
    fetchImpl,
  },
});
// process.env.DATABASE_URL is now populated unless it was already defined.
```

## Related

- Concept overview (wiring + external env-server): `./architecture.md`.
- Source: `packages/env-resolver/src/index.ts` — `buildOptionsFromEnv`, `RemoteEnvOptions`, `InitEnvResolverOptions`, `fetchRemoteEnv`, `applyValues`.
- Mode + cache flow: `./resolution-modes.md`.
- Boot-time guard behaviour: `./bootstrap-validation.md`.
- App-side config validation: `@luckystack/core` `projectConfig`.
- Template-file rule for env additions: root `.claude/CLAUDE.md`, rule 14.
