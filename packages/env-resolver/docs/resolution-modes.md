# Resolution modes — local / remote / hybrid

> Runtime resolution flow inside `initEnvResolver` / `refreshEnvResolver`. Covers the three source modes (`local` / `remote` / `hybrid`), the in-memory TTL cache, the local-overrides-win write semantics, and how additional backends would slot in beside the default HTTP adapter.

For the design context (why a wiring package + external env-server, V-reference workflow), read `./architecture.md` first. This file mirrors the actual code in `src/index.ts` and describes how `@luckystack/env-resolver` resolves which source to read (mode resolution) and how it resolves the cached vs. fresh values it writes back to `process.env`.

## TL;DR

- One module-level `cachedResolution: { fetchedAt, values } | null`.
- `initEnvResolver` is the only entry point that fetches; `refreshEnvResolver` is the only entry point that invalidates.
- `applyValues` is the only writer; it skips keys already defined in `process.env` (locally-shadowed values always win).
- There is **no adapter registry today**. The only seam for non-HTTP backends is `RemoteEnvOptions.fetchImpl`.

## Public API surface (authoritative signatures)

```ts
export interface RemoteEnvOptions {
  url: string;
  authToken: string;
  project: string;
  environment: string;
  cacheTtlMs?: number;          // default 60_000
  fetchImpl?: typeof fetch;     // default globalThis.fetch
}

export interface InitEnvResolverOptions {
  source: 'remote' | 'local' | 'hybrid';
  remote?: RemoteEnvOptions;
  fallback?: 'local' | 'throw';
}

export const initEnvResolver = async (options: InitEnvResolverOptions): Promise<void>;
export const refreshEnvResolver = async (options: InitEnvResolverOptions): Promise<void>;
export const getCachedResolution = (): { fetchedAt: number; values: Record<string, string> } | null;
export const resetEnvResolverForTests = (): void;
```

## Mode resolution

`options.source` is the first branch in `initEnvResolver`. Each mode resolves differently:

| `source` | Behaviour | When the resolver writes to `process.env` |
| --- | --- | --- |
| `'local'` | Early return. No network, no cache read, no writes. | Never. Whatever `dotenv` or the shell loaded stays as-is. |
| `'remote'` | Fetch is required. Missing options or a failed fetch throws unless `fallback: 'local'` is set. | After a successful fetch or a fresh-cache hit. |
| `'hybrid'` | Fetch is attempted. Any failure (missing options OR network error OR non-2xx) logs a warning and returns. | Only when the fetch (or fresh cache) actually produced a values map. |

### Why `fallback` is independent of `source`

`fallback: 'local'` lets a `'remote'` caller opt into soft-failure behaviour identical to `'hybrid'`. The check is `if (options.fallback === 'local' || options.source === 'hybrid')` — both branches converge on a `console.warn` + return. This means:

- `'remote'` + `fallback: 'throw'` (or unset) = production-hard-stop.
- `'remote'` + `fallback: 'local'` = best-effort fetch with a warning instead of a crash (rare; prefer `'hybrid'`).
- `'hybrid'` + `fallback: anything` = `fallback` is effectively ignored on the failure path because `'hybrid'` already triggers the soft branch.

## Options resolution

When `source !== 'local'`, the resolver needs a `RemoteEnvOptions` object. It is resolved in priority order:

1. `options.remote` if the caller passed one explicitly.
2. `buildOptionsFromEnv()` — reads `LUCKYSTACK_ENV_URL`, `LUCKYSTACK_ENV_TOKEN`, `LUCKYSTACK_ENV_PROJECT`, `LUCKYSTACK_ENV_ENVIRONMENT`. Returns `null` if **any** of the four is missing.
3. If neither produced options:
   - `fallback === 'local'` -> return without writing anything.
   - Otherwise -> throw `[env-resolver] Remote source selected but no remote options + no LUCKYSTACK_ENV_URL/TOKEN/PROJECT/ENVIRONMENT in env.`

Note: `buildOptionsFromEnv` is all-or-nothing. Partial coverage (URL + token without project) is treated identically to "no env vars at all." There is no current mechanism to mix explicit options with env-var fallback per-field.

## Cache resolution

The cache is a single module-level binding:

```ts
let cachedResolution: CachedResolution | null = null;
interface CachedResolution { fetchedAt: number; values: Record<string, string> }
```

Lifecycle:

1. **First call** in `'remote'` / `'hybrid'`: `cachedResolution` is `null`, fetch is performed, the response is stored as `{ fetchedAt: Date.now(), values }`, and `applyValues(values)` runs.
2. **Subsequent call within `cacheTtlMs`**: `now - fetchedAt < cacheTtlMs` is true, so the resolver re-applies the **cached** values without a network call. This re-application is intentional — if a downstream process spawned during the same boot reset `process.env`, the re-apply restores it.
3. **Call after TTL expires**: same path as the first call; cache is overwritten on success.
4. **`refreshEnvResolver(options)`**: sets `cachedResolution = null`, then calls `initEnvResolver(options)`. This forces a fetch regardless of TTL.
5. **`resetEnvResolverForTests()`**: also sets `cachedResolution = null`. Tests use this between cases so each `init` re-fetches with the desired mock.

Diagnostics: `getCachedResolution()` returns the current binding without copying. Callers must not mutate the `values` object. In `'local'` mode, `getCachedResolution()` always returns `null` because that branch never writes to the cache.

### Concurrency note

There is currently **no in-flight de-duplication**. Two near-simultaneous `initEnvResolver` calls before any cache exists will both fetch. The second one overwrites the first's `cachedResolution`. This is acceptable because:

- The function is meant to run once at boot, before app code starts.
- Both requests target the same endpoint with the same token; the worst case is one extra HTTP request, not a correctness issue.

If concurrent-coalescing becomes necessary (long-lived processes calling `refreshEnvResolver` from multiple workers), the right fix is a `pendingFetch: Promise<void> | null` guard around the fetch block.

## Write semantics: local overrides win

`applyValues` is the only function that touches `process.env`:

```ts
const applyValues = (values: Record<string, string>): void => {
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};
```

Rationale:

- A developer running `LOG_LEVEL=debug npm run dev` should not have the remote silently overwrite that one key.
- `dotenv` (or whatever already populated `process.env`) is treated as a developer-controlled override layer above the remote.
- A key set to an empty string `""` is **not** `undefined`, so it is preserved. If you want the remote value, `unset` the variable in your shell or remove it from `.env.local`.

Consequence: there is no way for the remote to "un-set" a key that a developer has explicitly defined. This is by design. To force a refresh, the developer must clear their local override first and then call `refreshEnvResolver`.

## Fetch resolution

`fetchRemoteEnv` is the concrete HTTP adapter:

- `fetchFn = opts.fetchImpl ?? globalThis.fetch`. If neither exists (Node < 20 without a polyfill), it throws `[env-resolver] No fetch implementation available. Pass fetchImpl or run on Node 20+.`
- Endpoint: `${opts.url.replace(/\/+$/, '')}/projects/{encodeURIComponent(project)}/environments/{encodeURIComponent(environment)}`.
- Method: `GET`. Headers: `Authorization: Bearer ${authToken}`, `Accept: application/json`.
- A non-`2xx` response throws `[env-resolver] Remote env fetch failed: {status} {statusText}`.
- A `2xx` response is parsed as JSON; the `body.values` field is required to be an object. Missing / non-object -> throws `[env-resolver] Remote env response missing values object.`
- The returned `Record<string, string>` is what gets cached and applied.

## Init vs refresh — when to call which

- **`initEnvResolver`**: call once at the very top of your boot file (typically `server.ts`), before any other framework import that reads `process.env` at module-init time. Idempotent within `cacheTtlMs`, so accidental double-calls are safe.
- **`refreshEnvResolver`**: call from an admin endpoint, a Socket.io event, or a cron job when the env-server admins have pushed a hot change and you want it picked up without a process restart. It is **not** designed to run on every request — that would defeat the cache.

## Future adapter shape (not implemented)

If the project ever needs non-HTTP backends (AWS SSM Parameter Store, HashiCorp Vault, Doppler), the proposed minimal seam is:

```ts
// PROPOSED — not in current code.
interface EnvAdapter {
  fetch(opts: RemoteEnvOptions): Promise<Record<string, string>>;
}

interface InitEnvResolverOptions {
  source: 'remote' | 'local' | 'hybrid';
  remote?: RemoteEnvOptions;
  adapter?: EnvAdapter; // default: built-in HTTP adapter
  fallback?: 'local' | 'throw';
}
```

Today the same effect is achievable by swapping `fetchImpl` with a function that proxies to whatever backend the operator chooses. The proposed `EnvAdapter` interface is a future refactor, not a current API contract.

## Related

- Concept overview (wiring + external env-server): `./architecture.md`.
- Source: `packages/env-resolver/src/index.ts` — `initEnvResolver`, `refreshEnvResolver`, `applyValues`, `fetchRemoteEnv`, `buildOptionsFromEnv`, `getCachedResolution`, `resetEnvResolverForTests`.
- Function index: `packages/env-resolver/CLAUDE.md`.
- Consumer quickstart: `packages/env-resolver/README.md`.
- Env-key contract: `./env-key-validation.md`.
- Boot-time guard behaviour: `./bootstrap-validation.md`.
