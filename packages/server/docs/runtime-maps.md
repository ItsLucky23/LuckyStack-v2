# Runtime Maps Loader

> Deep specs. Bron: `packages/server/src/runtimeMapsLoader.ts`. Bijgewerkt: 2026-05-20.

## Overview

A `RuntimeMapsProvider` (defined in `@luckystack/core`) is the runtime source of truth for which `apis`, `syncs`, and `functions` exist in the running process. Without one, every `/api/*` and `/sync/*` request silently resolves to `notFound`.

`@luckystack/server` ships two helpers so consumers no longer need to hand-roll their own `server/prod/runtimeMaps.ts`:

- `createProdRuntimeMapsProvider(options)` — builds and returns the provider without registering.
- `registerProdRuntimeMapsProvider(options)` — convenience wrapper: builds AND calls `registerRuntimeMapsProvider(provider)`. Most consumers want this.

In production, the provider loads generated maps via the consumer-supplied `loadGenerated(preset)` callback. In dev it transparently delegates to `@luckystack/devkit`'s in-memory discovery (`devApis` / `devSyncs` / `devFunctions`), which is populated by the devkit watchers.

Why does the consumer supply `loadGenerated`? Dynamic-import path resolution in ESM is module-scoped — the framework cannot resolve a relative path on the consumer's behalf. Passing a function that calls `import(\`./prod/generatedApis.${preset}\`)` lets the consumer-side module own resolution.

Preset list resolution (in `resolvePresets`):

1. `options.preset` if it is a non-empty string -> `[preset]`.
2. `options.preset` if it is a non-empty array -> dedup via `Array.from(new Set(...))`.
3. `getParsedBundles()` from `argv.ts` when non-empty.
4. Final fallback: `['default']`.

Multiple presets are loaded in parallel, normalized to `{ apisObject, syncObject, functionsObject }`, then shallow-merged into a single view. Key collisions across presets throw at boot — services must own exactly one preset (see `docs/ARCHITECTURE_PACKAGING.md` §10).

## API Reference

### `createProdRuntimeMapsProvider(options: ProdRuntimeMapsLoaderOptions): RuntimeMapsProvider`

**Signature:**

```typescript
export interface ProdRuntimeMapsLoaderOptions {
  loadGenerated: (preset: string) => Promise<unknown>;
  preset?: string | string[];
}

export const createProdRuntimeMapsProvider = (
  options: ProdRuntimeMapsLoaderOptions,
): RuntimeMapsProvider;
```

**Parameters:**

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `loadGenerated` | `(preset: string) => Promise<unknown>` | required | Dynamic-import callback that resolves the generated maps module for a given preset. The resolved module must have shape `{ apis, syncs, functions }` (what `scripts/generateServerRequests.ts` emits). Called once per preset per process lifetime; the result is cached. |
| `preset` | `string \| string[]` | argv -> `['default']` | Override for the preset list. String -> single-entry array; array -> deduplicated. Skips the argv lookup. |

**Returns:** a `RuntimeMapsProvider`:

```typescript
interface RuntimeMapsProvider {
  getRuntimeApiMaps: () => Promise<{ apisObject: Record<string, unknown>; functionsObject: Record<string, unknown> }>;
  getRuntimeSyncMaps: () => Promise<{ syncObject: Record<string, unknown>; functionsObject: Record<string, unknown> }>;
}
```

**Behavior:**

- Builds two getters (`getRuntimeApiMaps`, `getRuntimeSyncMaps`) that switch on `process.env.NODE_ENV === 'production'`:
  - **Production:** lazy-loads + caches the prod maps via `loadProdRuntimeMaps`. Subsequent calls await the same `prodMapsPromise`.
  - **Dev:** lazy-imports `@luckystack/devkit` and returns `{ devApis, devSyncs, devFunctions }`. Devkit is excluded from production bundles so this dynamic import is never reached when `NODE_ENV === 'production'`.
- `loadProdRuntimeMaps`:
  1. Resolve presets via `resolvePresets(options)`.
  2. Concurrently `loadGenerated(preset)` for each preset; failures resolve to `null` (caught with `.catch(() => null)`).
  3. For each loaded module, run `normalizeGeneratedModule` (defends against missing or malformed export shape: anything other than an object becomes `{}`).
  4. Merge `apis`, `syncs`, `functions` into the combined view with `mergeInto`, tracking origin per key in three `Map<string, string>`s.
  5. Skipped presets emit `console.warn('[luckystack:runtimeMaps] preset "<name>" failed to load — skipping. ...')`.
  6. If no presets loaded successfully, emit `console.warn('[luckystack:runtimeMaps] no presets resolved (tried: ...). Every api/sync request will return notFound until at least one generated module loads.')` and return empty maps.
- The dev branch caches the devkit module promise so repeated calls share one resolved module.

**Errors / Edge cases:**

- Key collision across presets throws synchronously inside `loadProdRuntimeMaps`:

  ```
  [luckystack:runtimeMaps] <kind> key collision: "<key>" present in both preset "<previous>" and preset "<current>". Services must belong to exactly one preset (see docs/ARCHITECTURE_PACKAGING.md §10).
  ```

- Failed `import()` (e.g. preset module not built) is swallowed and logged as a warning; the provider continues with whatever did load.
- A preset module whose default export is not an object normalizes to `{}` for all three maps — no throw, just empty.
- The dev branch dynamic-imports `'@luckystack/devkit'` even when only one of the two getters is invoked; the module promise is cached.

**Example:**

```typescript
import { createProdRuntimeMapsProvider, registerRuntimeMapsProvider } from '@luckystack/server';

const provider = createProdRuntimeMapsProvider({
  loadGenerated: (preset) => import(`./prod/generatedApis.${preset}`),
  preset: 'billing',
});
registerRuntimeMapsProvider(provider);
```

---

### `registerProdRuntimeMapsProvider(options: ProdRuntimeMapsLoaderOptions): RuntimeMapsProvider`

**Signature:**

```typescript
export const registerProdRuntimeMapsProvider = (
  options: ProdRuntimeMapsLoaderOptions,
): RuntimeMapsProvider;
```

**Parameters:** identical to `createProdRuntimeMapsProvider`.

**Returns:** the same `RuntimeMapsProvider` instance that was registered.

**Behavior:**

- Internally:
  ```typescript
  const provider = createProdRuntimeMapsProvider(options);
  registerRuntimeMapsProvider(provider);
  return provider;
  ```
- Calling twice replaces the active provider (last-write-wins) — `registerRuntimeMapsProvider` is the registry function.

**Errors / Edge cases:** same as `createProdRuntimeMapsProvider`. `registerRuntimeMapsProvider` itself does not throw on duplicate calls.

**Example — direct use:**

```typescript
import { registerProdRuntimeMapsProvider } from '@luckystack/server';

registerProdRuntimeMapsProvider({
  loadGenerated: (preset) => import(`./prod/generatedApis.${preset}`),
});
```

**Example — via `createLuckyStackServer.loadGeneratedMaps`:** when the option is supplied, `createLuckyStackServer` calls `registerProdRuntimeMapsProvider` for you before `verifyBootstrap` runs.

```typescript
import { createLuckyStackServer } from '@luckystack/server';

const server = await createLuckyStackServer({
  serveFile,
  serveFavicon,
  loadGeneratedMaps: (preset) => import(`./prod/generatedApis.${preset}`),
  runtimeMapsPreset: ['billing', 'vehicles'],
});
await server.listen();
```

## Expected module shape

`loadGenerated(preset)` must resolve to a module that has these named exports:

```typescript
export const apis: Record<string, ApiRouteEntry>;
export const syncs: Record<string, SyncRouteEntry>;
export const functions: Record<string, FunctionEntry>;
```

This matches what `scripts/generateServerRequests.ts` emits. Missing exports default to `{}` — useful when a preset has no syncs or functions.

## Merge semantics

`mergeInto(target, source, kind, fromPreset, keyOrigin)`:

- Iterate every key in `source`.
- If `keyOrigin` already records a different preset for that key -> throw the collision error.
- Otherwise record the origin and shallow-assign `target[key] = source[key]`.

Three independent origin maps are used so an api named `users/get` and a sync named `users/get` do not collide.

## Failure modes

| Situation | Behavior |
| --- | --- |
| `loadGenerated(preset)` rejects | Warn (`preset "<name>" failed to load — skipping`); continue with other presets. |
| All presets failed | Warn (`no presets resolved (tried: ...)`); return empty maps; every request returns `notFound`. |
| Preset module has wrong shape | Normalize to `{}`. Same effect: requests for those routes return `notFound`. |
| Key collision across presets | Throw at boot — services must own exactly one preset. |
| Provider is never registered at all | `verifyBootstrap` hard-fails in production, loud-warns in dev. |

## Dev vs prod branch

| Environment | Source of maps |
| --- | --- |
| `NODE_ENV === 'production'` | `loadGenerated(preset)` for each resolved preset; cached `prodMapsPromise`. |
| Anything else | Dynamic import of `'@luckystack/devkit'` -> `{ devApis, devSyncs, devFunctions }`. Devkit watchers keep these maps live. |

The dynamic import to `'@luckystack/devkit'` is intentionally written as `import('@luckystack/devkit')` and not statically referenced, so bundlers tree-shake it out of production builds.

## Config keys

| Source | Key | Effect |
| --- | --- | --- |
| env | `NODE_ENV` | Switches dev (devkit) vs prod (`loadGenerated`) branch. |
| argv | `<bundles>` | Preset list when `options.preset` is omitted. |
| options | `options.preset` | Overrides argv-derived preset list. |
| options | `options.loadGenerated` | Required prod loader callback. |

## Related

- Function INDEX: `packages/server/CLAUDE.md`
- Argv parsing: `packages/server/docs/argv-parsing.md`
- Create server: `packages/server/docs/create-server.md`
- Architecture: `docs/ARCHITECTURE_PACKAGING.md` (§10 preset bundles + multi-service builds)
- README: `packages/server/README.md`
