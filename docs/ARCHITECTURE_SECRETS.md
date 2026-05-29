# Secrets architecture

> **STATUS: Design only — `@luckystack/secrets` is not yet implemented as of 2026-05-29. Implementation tracked separately.**

> See also: future `packages/secrets/README.md` once the package lands.

LuckyStack treats secret values as **rotation-aware pointers**, not as literal strings burned into `.env`. The framework reads pointer names from `.env` at boot, resolves them against a separate secrets server, and keeps the resolved values in an in-memory cache that hot-reloads on rotation. `.env` can be safely committed to git; only the pointer-to-value mapping (on the secrets server) is privileged.

`@luckystack/secrets` is the **thin adapter package** that consumer apps install. The secrets server itself — `luckystack-secrets-server` — lives in its own repository and is BUILT LATER (out of scope for this doc; only its wire contract is captured here so the adapter can be developed against a stable API).

## Why a separate package

- Apps that pin secrets in `.env` directly (or pull them from Vault / AWS Secrets Manager / Doppler) shouldn't pull in the LuckyStack secrets client or its chokidar watcher.
- The adapter follows the same registry pattern as `@luckystack/email` and `@luckystack/error-tracking`: framework code in `@luckystack/core` never imports it directly. Consumer code calls `getEnv(...)` via the package surface, while framework code that needs a secret (e.g. JWT signing key) reads through the registry slot.
- The companion server (`luckystack-secrets-server`) is built in its own repo on its own release cadence. Keeping the client small and stable means rotation-server changes don't ripple through `@luckystack/core`.

## Pointer protocol

Secrets in `.env` are **pointer names**, not values.

```bash
# .env (safe to commit)
OPENAI_API_KEY=OPENAI_API_KEY_V5
STRIPE_SECRET_KEY=STRIPE_SECRET_KEY_V2
JWT_SIGNING_KEY=JWT_SIGNING_KEY_V11
```

At runtime, `getEnv('OPENAI_API_KEY')` reads `process.env.OPENAI_API_KEY`, sees the pointer-shape value (`*_V\d+`), hits the secrets server with the pointer name `OPENAI_API_KEY_V5`, and returns the resolved literal value (`sk-...`).

### Pointer detection

The pattern lives in `SecretsConfig.pointerPattern` (default `/_V\d+$/`). Any env value matching the pattern is treated as a pointer; anything else is treated as a literal and returned as-is. This means non-secret env vars (`NODE_ENV`, `SERVER_PORT`, `PROJECT_NAME`) work without changes — `getEnv('NODE_ENV')` returns `'production'` directly because `production` doesn't match the pattern.

| `.env` value | `getEnv(...)` returns | Reason |
| --- | --- | --- |
| `OPENAI_API_KEY_V5` | resolved value from server | Matches `_V\d+$` |
| `sk-abc123` | `'sk-abc123'` | Literal, no match |
| `production` | `'production'` | Literal, no match |
| `MY_TOKEN_V1` | resolved value from server | Matches |
| `MY_TOKEN_V` | `'MY_TOKEN_V'` | No digit after `V`, treated as literal |

### Rotation

Bumping `V5 → V6` in the secrets server is a **rotation**: the server now serves `OPENAI_API_KEY_V6` with a new value. The adapter polls `GET /poll?since=<unix>` every `pollIntervalMs` (default 5000); when the poll reports `OPENAI_API_KEY_V5` (or the new pointer name from a bumped `.env`) as changed, the adapter re-resolves and updates its in-memory cache.

After cache update, any registered `subscribeEnv(...)` callbacks fire so consumers holding cached references (`const client = new OpenAI({ apiKey: getEnv('OPENAI_API_KEY') })`) can rebuild.

**`.env` git-history is not a leak vector** because the pointer name is opaque — knowing `OPENAI_API_KEY_V5` was the active pointer in March doesn't grant access to the value. Rotation = bump the version; old pointers can be deleted from the server.

## Files (planned)

| File | Purpose |
| --- | --- |
| `packages/secrets/src/index.ts` | Public surface: `getEnv`, `getEnvAsync`, `subscribeEnv`, `initSecrets`. |
| `packages/secrets/src/cache.ts` | In-memory cache + subscriber dispatch. |
| `packages/secrets/src/resolver.ts` | HTTP client that talks to the secrets server (`/resolve`, `/poll`). |
| `packages/secrets/src/watcher.ts` | Dev-mode chokidar watcher for `.env` / `.env.local`. |
| `packages/secrets/src/pointerPattern.ts` | Pointer-shape regex check (exported for testing). |
| `packages/core/src/secretsRegistry.ts` | Registry slot: `registerSecretsResolver(...)` / `getSecretsResolver()`. Framework code reads through this. |

## Package surface

```ts
import { getEnv, getEnvAsync, subscribeEnv, initSecrets } from '@luckystack/secrets';

// Boot-time init (called from server entry, before bootstrapLuckyStack)
await initSecrets({
  serverUrl: process.env.LUCKYSTACK_SECRETS_SERVER_URL!,
  authToken: { fromFile: '/run/secrets/luckystack-secrets-token' },
  pollIntervalMs: 5000,
  cacheStrategy: 'memory',
});

// Sync read — throws if cache miss + no fallback configured
const openaiKey = getEnv('OPENAI_API_KEY');

// Async read — falls through to server on cache miss
const stripeKey = await getEnvAsync('STRIPE_SECRET_KEY');

// Subscribe for hot-reloadable consumers
const unsubscribe = subscribeEnv('OPENAI_API_KEY', (newValue) => {
  openaiClient = new OpenAI({ apiKey: newValue });
});
```

### `initSecrets(config: SecretsConfig): Promise<void>`

Boot-time init. MUST be called before any `getEnv` call. Performs the initial bulk `POST /resolve` for every pointer-shaped value found in `process.env`, populates the cache, starts the poll timer, and (in dev) starts the chokidar watcher.

### `getEnv(key: string): string`

Synchronous read from the in-memory cache. Throws if:

- `initSecrets` was never called.
- The key is not in `process.env`.
- The value is a pointer but the cache has no resolved entry (and `getEnvAsync` was never invoked to backfill).

For literal (non-pointer) values, returns immediately without touching the cache.

### `getEnvAsync(key: string): Promise<string>`

Same shape as `getEnv` but falls through to a single-pointer `POST /resolve` when the cache misses. Use during cold-start code paths where `initSecrets` may not yet have finished, or for rarely-accessed secrets where pre-fetching everything is wasteful.

### `subscribeEnv(key: string, fn: (newValue: string) => void): () => void`

Register a callback fired on cache update for a specific pointer. Returns an `unsubscribe` function. Use for long-lived clients (`OpenAI`, `Stripe`, `Anthropic`, ...) that hold the key by reference and need to rebuild on rotation.

The callback fires **only on actual value change**, not on every poll. The cache compares the new resolved value against the existing one before dispatching.

## Configuration

```ts
export interface SecretsConfig {
  /** Base URL of the secrets server. e.g. https://secrets.internal.example.com */
  serverUrl: string;
  /**
   * Bearer token for the server. Either a literal string (env var) or
   * `{ fromFile: '/path/to/token' }` to read from a sidecar file on disk —
   * useful when the orchestrator (Kubernetes, Nomad) projects the token as
   * a volume mount instead of an env var.
   */
  authToken: string | { fromFile: string };
  /** How often to poll the server for rotations. Default 5000ms. */
  pollIntervalMs?: number;
  /** Override the pointer-shape regex. Default `/_V\d+$/`. */
  pointerPattern?: RegExp;
  /**
   * Where the resolved cache lives.
   * - `'memory'` (default): per-process Map. Fast, isolated.
   * - `'redis'`: shared Redis hash. Requires `@luckystack/redis` peer dep;
   *   useful when multiple Node processes on the same host should share the
   *   resolved cache to reduce server load.
   */
  cacheStrategy?: 'memory' | 'redis';
}
```

## ProjectConfig integration

`@luckystack/secrets` augments `ProjectConfig` so the slot type-checks even when the package is not installed:

```ts
declare module '@luckystack/core' {
  interface ProjectConfig {
    secrets?: SecretsConfig;
  }
}
```

The consumer's `config.ts` registers it the same way every other LuckyStack package is configured:

```ts
import { registerProjectConfig } from '@luckystack/core';

registerProjectConfig({
  secrets: {
    serverUrl: process.env.LUCKYSTACK_SECRETS_SERVER_URL!,
    authToken: { fromFile: '/run/secrets/luckystack-secrets-token' },
  },
});
```

`bootstrapLuckyStack` reads the slot, calls `initSecrets(...)` if a config is present, and registers the resolver into the core slot so framework code (rate-limiter Redis password, session-cookie signing key, OAuth client secrets via the login package) can read secrets uniformly.

## Peer-dep guard

Matches the existing policy from `feedback_peer_dep_guard_policy` — env-key set without the peer-dep installed = **hard boot crash, no silent fallthrough**.

```ts
// In @luckystack/core's bootstrapLuckyStack
if (process.env.LUCKYSTACK_SECRETS_SERVER_URL) {
  try {
    require.resolve('@luckystack/secrets');
  } catch {
    throw new Error(
      '[secrets] LUCKYSTACK_SECRETS_SERVER_URL is set but `@luckystack/secrets` is not installed. ' +
        'Run `npm install @luckystack/secrets` or unset LUCKYSTACK_SECRETS_SERVER_URL.',
    );
  }
}
```

Guard runs during `verifyBootstrap()`, before HTTP listen. The failure is loud and immediate; no requests are accepted before the secrets layer is verified ready.

## Hot reload semantics

| Mode | Behavior |
| --- | --- |
| Development (`NODE_ENV=development`) | Chokidar watches `.env` and `.env.local`. On change, the adapter re-reads `process.env` (via dotenv reload), diffs pointer values, re-resolves changed pointers, updates the cache, and fires `subscribeEnv` callbacks. Server poll also runs. |
| Production | Chokidar disabled (file-watch perf cost is non-trivial under load). Server poll (`GET /poll?since=...`) is the sole rotation channel. |

**`process.env` is NEVER mutated** by the secrets adapter. Code that does `const { OPENAI_API_KEY } = process.env` keeps reading the pointer name, which is intentionally opaque. Real secret access MUST go through `getEnv(...)`. This guarantee avoids race conditions between the cache and any process that destructures `process.env` at module load.

## Wire format (`luckystack-secrets-server`)

The server lives in its own repo. Captured here as a stable contract the adapter is built against — server design / hosting / admin UX are out of scope for this doc.

### Endpoints

All endpoints accept JSON, return JSON, authenticate via `Authorization: Bearer <token>` (the configured `authToken`). Errors return `{ "error": string, "code": string }` with an appropriate HTTP status.

#### `POST /resolve`

Bulk-resolve pointers. Adapter calls this once at boot for every pointer-shaped env value, and on cache miss in `getEnvAsync`.

Request:

```json
{ "pointers": ["OPENAI_API_KEY_V5", "STRIPE_SECRET_KEY_V2"] }
```

Response:

```json
{
  "values": {
    "OPENAI_API_KEY_V5": "sk-...",
    "STRIPE_SECRET_KEY_V2": "sk_live_..."
  }
}
```

Pointers the server doesn't recognize are omitted from `values`. The adapter treats a missing pointer as a hard error on its end (logs + throws).

#### `POST /set`

Admin-only — used by the rotation tooling, never by the adapter. Sets the value for a pointer.

Request:

```json
{ "pointer": "OPENAI_API_KEY_V6", "value": "sk-new..." }
```

Response:

```json
{ "ok": true }
```

#### `GET /poll?since=<unix-timestamp>`

Efficient rotation detection. The adapter calls this every `pollIntervalMs` with the last seen `serverTime`. The server returns which pointers changed since `since`, and the current `serverTime` for the next poll.

Response:

```json
{
  "changed": ["OPENAI_API_KEY_V5"],
  "serverTime": 1748534400
}
```

The adapter then re-resolves the changed pointers via `POST /resolve`, diffs them against the cache, and fires subscribers on actual value change.

### Error codes

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 401 | `unauthorized` | Missing or invalid bearer token. |
| 403 | `forbidden` | Token doesn't have rights for the requested operation (e.g. `POST /set` with a read-only token). |
| 404 | `unknown_pointer` | A pointer in the request doesn't exist on the server. (Only used in single-pointer endpoints; `POST /resolve` silently omits unknowns.) |
| 429 | `rate_limited` | Adapter is polling too frequently or resolving too many pointers per request. |
| 500 | `internal` | Server-side failure; adapter retries with backoff. |

## Migration path

Existing code keeps working without changes. `.env` literal values (`OPENAI_API_KEY=sk-abc...`) match no pointer pattern, so `getEnv('OPENAI_API_KEY')` returns the literal directly.

Migration is **opt-in per call site**:

1. Install `@luckystack/secrets` and set `LUCKYSTACK_SECRETS_SERVER_URL` + the auth token.
2. Move one secret at a time into the secrets server: bump the version in `.env` from the literal to a pointer (`OPENAI_API_KEY=OPENAI_API_KEY_V1`), upload the literal value to the server under that pointer name, redeploy.
3. Switch the consuming code from `process.env.OPENAI_API_KEY` to `getEnv('OPENAI_API_KEY')` at your own pace. Both paths coexist; rotation only works for code that calls `getEnv(...)`.

No big-bang rewrite. No flag day. The adapter is happy to resolve some secrets and pass through others as literals.

## Sentry interplay

When `@luckystack/error-tracking` is installed and initialized, secrets-server failures (network errors, 5xx responses, auth-token rejection) are auto-reported via `captureExceptionAcrossTrackers` from `@luckystack/core`. When error-tracking isn't installed, the failure is logged via `getLogger()` and the previous cached value is kept until the next successful poll.

## Edge cases

| Scenario | Behavior |
| --- | --- |
| `initSecrets` not called, but `getEnv` is invoked | Throws `[secrets] initSecrets must be called before getEnv(...)`. |
| Pointer in `.env` but server doesn't have it | `initSecrets` throws with the list of unresolved pointers. Boot fails loud. |
| Pointer added to `.env` after boot (dev mode) | Chokidar fires → adapter resolves the new pointer → cache updated → subscribers fire. |
| Pointer added to `.env` after boot (prod mode) | NOT detected by polling (poll only reports rotations, not new pointers). Requires a process restart. |
| Server unreachable at boot | `initSecrets` retries with exponential backoff (default 3 attempts), then throws. Boot fails loud. |
| Server unreachable mid-flight | Poll failure is logged + captured to error-tracker. Cached values keep serving `getEnv` calls. Next successful poll catches up. |
| Two pointers resolve to the same value | Cache treats them as independent entries; no deduplication. |
| `cacheStrategy: 'redis'` but `@luckystack/redis` not installed | Hard boot crash via peer-dep guard. |
| Token file (`authToken.fromFile`) is missing or unreadable | `initSecrets` throws at the read step. Boot fails loud. |

## Self-check before shipping

- All consumer-facing secrets reads moved to `getEnv(...)` — `process.env.OPENAI_API_KEY` etc. should not appear in app code, only in the secrets adapter's bootstrap.
- `.env_template` and `.env.local_template` document the pointer convention (e.g. `OPENAI_API_KEY=OPENAI_API_KEY_V1`) and the `LUCKYSTACK_SECRETS_SERVER_URL` setup vars.
- Pre-commit hook does not block committing `.env` (it should be in git now), but DOES block committing the auth-token sidecar file or any file matching the resolved-value shape (e.g. `sk-...`).
- Operational runbook covers: rotating a secret (bump `V<n>`, upload, watch poll catch up), revoking a leaked secret (set new version, delete old pointer entry on server), recovering from server downtime (fall back to cached values, restart only when server reachable).

## Related

- `docs/ARCHITECTURE_EMAIL.md` — closest analog (peer-dep package, registry pattern, peer-dep guard).
- `docs/ARCHITECTURE_FUNCTION_INJECTION.md` — `getEnv` can be exposed via the function-injection surface as `functions.secrets.getEnv(...)` once the package lands.
- `packages/core/src/projectConfig.ts` — where the `secrets` slot lives once the module-augmentation merges in.
- `packages/core/src/errorTrackerRegistry.ts` — pattern the secrets-resolver slot mirrors.
- `luckystack-secrets-server` (separate repo, BUILT LATER) — the rotation server backing this adapter.
