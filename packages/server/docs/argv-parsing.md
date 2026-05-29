# Argv Parsing (`parseServerArgv` + `applyServerArgv`)

> Deep specs. Bron: `packages/server/src/argv.ts`, `packages/server/src/parseArgv.ts`. Bijgewerkt: 2026-05-20.

## Overview

`@luckystack/server` accepts two positional CLI arguments on boot:

```
npm run server -- <bundle[,bundle...]> [port]
```

- Arg 0 — preset list. Comma-separated; duplicates collapsed; runtime maps from each preset are shallow-merged at boot.
- Arg 1 — listen port. Numeric. Optional.

Argv replaces the legacy `LUCKYSTACK_BUNDLE` + `SERVER_PORT` environment toggles with one shape consumed by `createProdRuntimeMapsProvider` (preset) and `createLuckyStackServer` (port).

The module exposes:

- A pure parser: `parseServerArgv(argv)`.
- A side-effect runner that reads `process.argv.slice(2)` once and caches: `applyServerArgv()`.
- Read accessors: `getParsedBundles()`, `getParsedPort()`.
- A side-effect-only entrypoint `@luckystack/server/parseArgv` that simply imports `applyServerArgv` and runs it.

The side-effect entry MUST be the FIRST import in the consumer's `server.ts` because the parsed port is written back to `process.env.SERVER_PORT`, and downstream modules read that variable at top-level evaluation time:

- `@luckystack/core` env Zod schema
- `@luckystack/core` `bindAddress.ts` fallback
- The consumer's `config.ts` `backendUrl` constant
- `@luckystack/login` `oauthProviders.ts` callback URL builder

Importing anything that pulls one of those four before `parseArgv` runs will lock in the wrong port.

## API Reference

### `parseServerArgv(argv: string[]): ParsedServerArgv`

**Signature:**

```typescript
export interface ParsedServerArgv {
  bundles: string[];
  port: number | null;
}

export const parseServerArgv = (argv: string[]): ParsedServerArgv;
```

**Parameters:**

| Field | Type | Purpose |
| --- | --- | --- |
| `argv` | `string[]` | Positional args (typically `process.argv.slice(2)`). |

**Returns:** `{ bundles, port }`:

- `bundles: string[]` — deduplicated, trimmed, non-empty entries from arg 0. Empty array when arg 0 is missing or empty.
- `port: number | null` — `parseInt(argv[1], 10)` when arg 1 is supplied; `null` otherwise.

**Behavior:**

- Reject more than 2 positional arguments by throwing `Error('[luckystack:argv] unexpected positional argument(s): "<rest>". Usage: npm run server -- <bundle[,bundle...]> [port]')`.
- For arg 0: split on `,`, `trim()` each piece, drop falsy, collapse via `Array.from(new Set(...))`.
- For arg 1: must match `/^\d+$/`. Otherwise throws `Error('[luckystack:argv] port argument must be numeric, got: "<value>". Usage: npm run server -- <bundle[,bundle...]> [port]')`.

**Errors / Edge cases:**

- Whitespace in arg 0 (`"billing, vehicles"`) is supported — trimmed.
- A trailing comma (`"billing,"`) is silently dropped.
- A leading `0` in the port string is accepted (`/^\d+$/`) and parsed normally.
- An empty arg 0 (`""`) yields `bundles: []`; the downstream resolver falls back to `['default']`.

**Example:**

```typescript
parseServerArgv(['billing,vehicles', '4001']);
// => { bundles: ['billing', 'vehicles'], port: 4001 }

parseServerArgv([]);
// => { bundles: [], port: null }

parseServerArgv(['billing', '4001', 'oops']);
// => throws (too many positionals)

parseServerArgv(['billing', 'PORT']);
// => throws (non-numeric port)
```

---

### `applyServerArgv(): void`

**Signature:**

```typescript
export const applyServerArgv = (): void;
```

**Parameters:** none. Reads `process.argv.slice(2)`.

**Returns:** `void`.

**Behavior:**

- Idempotent. Subsequent calls return immediately via the module-level `hasRun` latch.
- First call:
  1. `parseServerArgv(process.argv.slice(2))` (throws on malformed input).
  2. Caches `bundles` + `port` in module state.
  3. When `port !== null`, writes `process.env.SERVER_PORT = String(port)`. This is the writeback that lets the four downstream env-readers (listed in Overview) see the resolved port without per-call refactoring.

**Errors / Edge cases:**

- Throwing during this call aborts boot before any other module has a chance to read `SERVER_PORT`.
- Calling `applyServerArgv` after another module has already read `SERVER_PORT` is too late — that consumer has already captured the old value.

**Example:**

```typescript
// server.ts — first line
import '@luckystack/server/parseArgv';
// rest of bootstrap...
```

Or call it explicitly when you control the boot timing:

```typescript
import { applyServerArgv } from '@luckystack/server';
applyServerArgv();
```

---

### `getParsedBundles(): string[]`

**Signature:**

```typescript
export const getParsedBundles = (): string[];
```

**Returns:** the cached `bundles` array. Empty until `applyServerArgv()` has run.

**Behavior:**

- Read-only; never throws.
- Used by `createProdRuntimeMapsProvider` to resolve which preset(s) to load when neither `options.preset` nor a literal string is supplied.

**Example:**

```typescript
import { applyServerArgv, getParsedBundles } from '@luckystack/server';

applyServerArgv();
console.log(getParsedBundles()); // e.g. ['billing', 'vehicles']
```

---

### `getParsedPort(): number | null`

**Signature:**

```typescript
export const getParsedPort = (): number | null;
```

**Returns:** the cached `port`. `null` until `applyServerArgv()` has run with a numeric arg 1.

**Behavior:**

- Read-only; never throws.
- Consumed by `createLuckyStackServer` as one of the port-resolution fallbacks:
  1. `options.port`
  2. `getParsedPort()`
  3. `process.env.SERVER_PORT`
  4. `80`

**Example:**

```typescript
import { getParsedPort } from '@luckystack/server';

const port = getParsedPort();
if (port !== null) {
  console.log(`argv supplied port ${port}`);
}
```

---

### Side-effect entrypoint: `@luckystack/server/parseArgv`

**Module body (verbatim):**

```typescript
import { applyServerArgv } from './argv';

applyServerArgv();
```

**Usage:** import as the FIRST line of your `server.ts`:

```typescript
import '@luckystack/server/parseArgv';
```

Anything that depends on `process.env.SERVER_PORT` MUST be imported below this line. Common pitfalls:

- Importing `'./config'` (which evaluates `backendUrl` at top level) before `parseArgv`.
- Importing `@luckystack/core` modules that pull the env Zod schema before `parseArgv`.

Both will freeze the wrong port into module-level constants.

## Resolution order summary

| Consumer | Source of port |
| --- | --- |
| `createLuckyStackServer` | `options.port` -> `getParsedPort()` -> `SERVER_PORT` -> `80` |
| `createLuckyStackServer` IP | `options.ip` -> `SERVER_IP` -> `127.0.0.1` |
| `createProdRuntimeMapsProvider` | `options.preset` (string -> single-entry array; non-empty array -> dedup) -> `getParsedBundles()` -> `['default']` |

## CLI examples

```bash
# Default preset, port 80
npm run server

# Single bundle, port 80
npm run server -- billing

# Two bundles merged, port 4001
npm run server -- billing,vehicles 4001

# Whitespace in bundle list is fine
npm run server -- "billing , vehicles" 4001

# Invalid port — boot aborts with descriptive error
npm run server -- billing PORT
# Error: [luckystack:argv] port argument must be numeric, got: "PORT".

# Extra positional — boot aborts
npm run server -- billing 4001 oops
# Error: [luckystack:argv] unexpected positional argument(s): "oops".
```

## Interaction with runtime maps

`createProdRuntimeMapsProvider({ loadGenerated, preset? })` calls `getParsedBundles()` when `preset` is omitted or empty. Each resolved preset is dynamically imported via the consumer-supplied `loadGenerated` callback, then shallow-merged into one runtime view. Key collisions across presets throw at boot. See `runtime-maps.md` for the merge semantics.

## Related

- Function INDEX: `packages/server/CLAUDE.md`
- Runtime maps: `packages/server/docs/runtime-maps.md`
- Create server: `packages/server/docs/create-server.md`
- Architecture: `docs/ARCHITECTURE_PACKAGING.md` (preset bundles, multi-service builds)
- README: `packages/server/README.md`
