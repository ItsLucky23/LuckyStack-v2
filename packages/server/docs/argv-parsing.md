# Argv Parsing (`parseServerArgv` + `applyServerArgv`)

> Deep specs. Bron: `packages/server/src/argv.ts`, `packages/server/src/parseArgv.ts`. Bijgewerkt: 2026-08-16.

## Overview

`@luckystack/server` accepts two positional CLI arguments on boot:

```
npm run server -- <bundle[,bundle...]> [port]
```

- Arg 0 — preset list. Comma-separated; duplicates collapsed; runtime maps from each preset are shallow-merged at boot.
- Arg 1 — listen port. Numeric. Optional.

Argv provides one shape consumed by `createProdRuntimeMapsProvider` (preset), `createLuckyStackServer` (port), and the browser-safe `@luckystack/core/config` port-override registry.

The module exposes:

- A pure parser: `parseServerArgv(argv)`.
- A side-effect runner that reads `process.argv.slice(2)` once and registers the result: `applyServerArgv()`.
- Read accessors: `getParsedBundles()`, `getParsedPort()`.
- A side-effect-only entrypoint `@luckystack/server/parseArgv` that simply imports `applyServerArgv` and runs it.

The side-effect entry MUST be the FIRST import in the consumer's `server.ts` because it registers the parsed port in `@luckystack/core/config`, and the consumer's config reads that override at top-level evaluation time. When no CLI port was supplied, the registry stays empty and `config.ts` uses the consumer-owned `config.ports.ts` backend value.

Importing the consumer config before `parseArgv` runs can lock the static default into its OAuth callback base. The server listen path still reads the same registry through `getParsedPort()`, so both surfaces share one override without an environment writeback.

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
  2. Caches `bundles` in module state.
  3. Calls `registerPortOverride(port)`. A numeric port becomes visible through the browser-safe core/config entry; `null` clears the override.

**Errors / Edge cases:**

- Throwing during this call aborts boot before consumer config evaluates.
- Calling `applyServerArgv` after consumer config has evaluated is too late — that module has already captured its callback base.

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

**Returns:** the port currently held in the core/config override registry. `null` when no positional port was registered.

**Behavior:**

- Read-only; never throws.
- Consumed by `createLuckyStackServer` as one of the port-resolution fallbacks:
  1. `options.port`
  2. `getParsedPort()`
  3. `options.defaultPort` (the scaffold's `config.ports.ts` backend)
  4. `80` (generic final fallback)

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

Consumer `config.ts` MUST be imported below this line because it reads `getPortOverride()` at module evaluation time. Importing core itself first is safe: the registry is mutable and browser-safe. With no CLI port, scaffold config intentionally falls back to its pure-data `config.ports.ts` value.

## Resolution order summary

| Consumer | Source of port |
| --- | --- |
| `createLuckyStackServer` | `options.port` -> `getParsedPort()` -> `options.defaultPort` -> `80` |
| `createLuckyStackServer` IP | `options.ip` -> `SERVER_IP` -> `127.0.0.1` |
| `createProdRuntimeMapsProvider` | `options.preset` (string -> single-entry array; non-empty array -> dedup) -> `getParsedBundles()` -> `['default']` |

## CLI examples

```bash
# Default preset, config.ports.ts backend
npm run server

# Single bundle, config.ports.ts backend
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
