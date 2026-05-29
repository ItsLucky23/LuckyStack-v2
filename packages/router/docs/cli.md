# `luckystack-router` CLI

The `luckystack-router` binary boots a standalone HTTP + WebSocket router process. It side-effect imports the consumer's compiled `deploy.config.js` and `services.config.js`, then calls `startRouter()` with the resolved flags.

Source: `packages/router/src/cli.ts`. The CLI is a thin shell over the programmatic `startRouter()` entry exported from `@luckystack/router`.

## Synopsis

```text
luckystack-router --deploy <file> --services <file> [options]
```

## Flag reference

| Flag | Alias | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `--deploy <file>` | `-d` | yes | — | Path to compiled `deploy.config.js`. Imported via `import(pathToFileURL(abs))`. Module is expected to call `registerDeployConfig(...)` from `@luckystack/core` as a side effect of loading. |
| `--services <file>` | `-s` | yes | — | Path to compiled `services.config.js`. Imported the same way; expected to call `registerServicesConfig(...)`. |
| `--env <key>` | `-e` | no | `process.env.NODE_ENV` or `'development'` | Which key inside `deploy.config.ts -> environments` this router instance acts as. |
| `--preset <key>` | `-p` | no | unset (every binding in current env is "owned locally") | Preset key for the locally-running backend bundle. Only services declared under `services.config.ts -> presets[<key>].services` are treated as locally owned by the resolver. |
| `--port <number>` | — | no | `process.env.ROUTER_PORT` or `routing.defaultRouterPort` or `4000` | TCP port the router listens on. |
| `--no-shared-health` | — | no | shared health on | Skip the Redis-backed health store. Ignored in split/fallback mode (when current env declares a `fallback`) — that mode always requires Redis. |
| `--help` | `-h` | no | — | Print usage and exit `0`. |

Unknown flags are silently ignored so wrapper scripts can pass through harmless extras (positional placeholders, shell sigils) without tripping the parser.

## Environment variables

| Variable | Used as | Notes |
| --- | --- | --- |
| `NODE_ENV` | Default for `--env` | Only consulted when `--env` is omitted. |
| `ROUTER_PORT` | Default for `--port` | Only consulted when `--port` is omitted; itself overridden by `routing.defaultRouterPort` only when both are missing. |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Redis connection | Read centrally via `@luckystack/core`'s `getRedisConnectionOptions()`. Same values that drive `@luckystack/core` itself, so one Redis client is shared by the process. |
| Synchronized env keys | Boot handshake | Every variable registered via core's `registerSynchronizedEnvKey(...)` is SHA-256 hashed and compared against the fallback env's hashes during `runBootHandshake`. See `boot-uuid-failover.md`. |

## Side-effect import order

The CLI runs three steps in a fixed order:

1. `await import(deployFile)` — must call `registerDeployConfig(...)`.
2. `await import(servicesFile)` — must call `registerServicesConfig(...)`.
3. `startRouter(...)` — reads both registries via `getDeployConfig()` / `getServicesConfig()`.

Reordering breaks startup: `startRouter` throws if either registry is empty. The order matches the order every LuckyStack backend uses, so the same compiled config files work for both.

When a path is relative, it is resolved against `process.cwd()`. Both `.js` and `.ts` paths work — for `.ts` you must launch the CLI under a TypeScript loader (see Dev-mode usage below).

## Example invocations

### Production (compiled `dist/*.js`)

```bash
luckystack-router \
  --deploy ./dist/deploy.config.js \
  --services ./dist/services.config.js \
  --env production \
  --preset api \
  --port 4000
```

### Production with shared Redis disabled (single-instance, no fallback)

```bash
luckystack-router \
  --deploy ./dist/deploy.config.js \
  --services ./dist/services.config.js \
  --env production \
  --no-shared-health
```

If the configured environment has a `fallback`, `--no-shared-health` is ignored and Redis is still required — the router refuses to start without it.

### Dev mode against TypeScript sources

```bash
npx tsx node_modules/@luckystack/router/dist/cli.js \
  --deploy ./deploy.config.ts \
  --services ./services.config.ts \
  --env development
```

`tsx` (or any other TS loader registered through `--import`) transpiles on demand so `await import(...)` can load the `.ts` files directly. The compiled CLI itself is still loaded from `dist/cli.js`.

### Multi-preset router fronting a single backend

When one backend instance bundles multiple presets (`node dist/server.js billing,vehicles 4001`), point a router at it with no `--preset`:

```bash
luckystack-router \
  --deploy ./dist/deploy.config.js \
  --services ./dist/services.config.js \
  --env staging
```

Without `--preset`, every service declared in `environments.staging.bindings` is treated as locally owned.

## Lifecycle and graceful shutdown

After `startRouter()` resolves, the CLI registers handlers for `SIGINT` and `SIGTERM`. Both call `running.stop()`, which:

1. Stops the health poller (if active).
2. Closes the Redis health store and its pub/sub subscriber.
3. Calls `server.close(...)` on the HTTP server and awaits the callback.
4. `process.exit(0)`.

Active HTTP requests drain naturally — `server.close` does not abort inflight responses. WebSocket connections held open by Socket.io clients are torn down when the upstream backend closes them or when the process exits.

If `startRouter()` throws during boot (missing config, Redis required but unreachable, boot handshake strict failure), the CLI prints `[luckystack-router] fatal: ...` to stderr including the stack trace and exits with code `1`.

## Behavior on missing required flags

The CLI requires both `--deploy` and `--services`. When either is missing:

```text
[luckystack-router] --deploy and --services are required. Run with --help for usage.
```

is written to stderr and the process exits with code `2`. Importing a path that does not exist throws inside `importConfig(...)` and the CLI exits with code `1`.

## When to use the CLI vs `startRouter()` directly

Use the **CLI** when:

- The router runs as its own container or process, separate from any backend.
- You want SIGINT/SIGTERM handling, stderr framing, and exit-code semantics out of the box.
- The config files are compiled artifacts in `dist/`.

Use the programmatic **`startRouter()`** when:

- You embed the router into a larger bootstrap (custom listeners, side-channel admin server, integrated logging).
- You need to await `running` and attach things (extra `server.on(...)` handlers, programmatic stop in tests).
- You construct config objects in memory rather than loading them from files.

Both paths converge on the same `startRouter()` call, so behavior is identical past the initial import + parse stage.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Clean shutdown after SIGINT / SIGTERM. |
| `1` | Fatal during startup (config import failed, `startRouter()` threw, strict boot handshake mismatch). |
| `2` | Missing required flag (`--deploy` or `--services`). |

## Related

- `packages/router/src/cli.ts` — CLI implementation.
- `packages/router/src/startRouter.ts` — what the CLI delegates to.
- `packages/router/CLAUDE.md` — package contract and full function index.
- `packages/router/README.md` — public-facing usage examples.
- `docs/HOSTING.md` — deployment topology and environment sync.
