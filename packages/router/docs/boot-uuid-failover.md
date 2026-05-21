# Boot-UUID handshake and failover

The boot-UUID handshake is a startup-time guard that catches a specific deployment footgun:

> Two environments both have valid `REDIS_HOST` / `REDIS_URL` configuration, both Redis URLs respond to commands, but they point at different clusters. Without a handshake, the router happily serves traffic on top of a stale topology where session keys, room registrations, and synchronized env values are inconsistent across the system.

`runBootHandshake` writes a fresh UUID into the local Redis, then probes the fallback env's `/_health` endpoint and reads the fallback's UUID **back** through Redis. If the two values disagree, the two envs are talking to different Redis clusters even though both clusters respond.

Source: `packages/router/src/bootHandshake.ts`. Called from `startRouter()` after the Redis health store has been initialized and the resolver has hydrated.

## Problem statement

Common ways the footgun appears:

- A copy/paste error swaps `REDIS_URL` between staging and production.
- Two managed Redis instances (e.g. one per region) accidentally share an env-var name in the deploy YAML.
- A duplicate `.env` file overrides the correct value after CI restages config.

The dangerous part is that **both** Redis instances appear up. `PING` works on either. Sessions minted on one side may have IDs that never collide with the other, so tests pass and dashboards look normal. The drift only surfaces as cryptic "session not found" / "room missing" errors on the hot path.

## Protocol

### Step 1 — Write the local boot UUID

```ts
const bootUuid = randomUUID();
await client.set(`${BOOT_KEY_PREFIX}${envKey}`, bootUuid, 'EX', routing.bootKeyTtlSeconds ?? 3600);
```

`BOOT_KEY_PREFIX` comes from `@luckystack/core` (currently `luckystack:boot:`). TTL defaults to one hour and is configurable via `deploy.config.ts -> routing.bootKeyTtlSeconds`. The TTL refreshes on every restart, so a long-running router keeps the key alive.

If this initial write fails (Redis unreachable, auth failure), the handshake throws:

```text
[router] boot handshake failed to write Redis key: <message>
```

Unlike the later mismatch checks, this is **always fatal** regardless of `strict`. The whole router contract assumes Redis is reachable at boot.

### Step 2 — Probe the fallback env's `/_health`

Only runs when `input.fallbackBaseUrl` is set — i.e. when the current env declares a `fallback` and the fallback's `system` service has a binding URL.

```ts
fetch(`${fallbackBaseUrl}/_health`, { signal: <AbortController, routing.healthProbeTimeoutMs ?? 3000ms> })
```

Expected JSON shape:

```json
{
  "bootUuid": "<the fallback router's own UUID, written by its boot handshake>",
  "synchronizedHashes": {
    "SESSION_SECRET": "<sha256 hex>",
    "ENCRYPTION_KEY": "<sha256 hex>",
    "...": "..."
  }
}
```

The `/_health` endpoint is provided by `@luckystack/server`'s `registerHealthRoutes`. It reads its own boot UUID from Redis (the key its own startup wrote) and hashes every value listed in `collectSynchronizedEnvKeys()` from core.

When the probe fails (network error, timeout, non-200, JSON parse failure), `reportIssue` is called with:

```text
boot handshake: fallback env '<fallbackEnvKey>' /_health unreachable — cannot verify shared Redis
```

`reportIssue` either throws (strict) or logs a warning (non-strict). See "Strict vs non-strict mode" below.

### Step 3 — Read the fallback's UUID back through Redis

```ts
const fallbackClient = new Redis({ ...redisOptions, lazyConnect: true });
const localReadOfFallbackKey = await fallbackClient.get(`${BOOT_KEY_PREFIX}${fallbackEnvKey}`);
```

The router connects to **its own** Redis and reads the key the fallback should have written. If both envs truly share Redis:

```text
fallbackHealth.bootUuid === localReadOfFallbackKey   // verified
```

If they don't match, the two envs are connected to different Redis clusters:

```text
boot handshake MISMATCH: fallback env '<fallbackEnvKey>' is connected to a different Redis
than this router. Expected key luckystack:boot:<fallbackEnvKey> to equal '<expected>' but got '<actual>'.
```

This is the core diagnostic the handshake exists to surface.

When the compare itself fails (network error reading our Redis):

```text
boot handshake: Redis compare failed: <message>
```

### Step 4 — Verify synchronized env-key hashes

After Redis is verified shared, the handshake also checks that any env vars registered via `registerSynchronizedEnvKey(...)` in core match across the two envs. Mismatched values cause subtle breakage — e.g. a session cookie minted by one env can't be decrypted by the other.

```ts
const keys = collectSynchronizedEnvKeys();
for (const key of keys) {
  const localHash = process.env[key] === undefined ? null : hashSynchronizedValue(process.env[key]);
  const remoteHash = fallbackHashes[key] ?? null;
  if (localHash !== remoteHash) {
    report(`synchronized env '<key>' DIFFERS between router and fallback — sessions/cookies will not be portable`);
  }
}
```

Edge cases:

- **`fallbackHashes` undefined.** Older fallback servers may not return the field. The router logs:
  ```text
  synchronized-env check: fallback /_health did not return hashes — cannot verify <N> synchronized key(s)
  ```
- **Both sides missing the variable.** `localHash === null && remoteHash === null` cannot prove sync (it might be missing everywhere by accident):
  ```text
  synchronized env '<key>' missing on both router and fallback — cannot detect drift
  ```

Each report goes through `reportIssue`, so strict mode escalates each individual mismatch to a throw.

## Strict vs non-strict mode

```ts
const reportIssue = (message: string): void => {
  if (input.strict) {
    throw new Error(`[router] ${message}`);
  }
  getLogger().warn(`[router] ${message}`);
};
```

- **Non-strict** (default, `routing.strictBootHandshake !== true`) — every issue logs a warning, the router continues. Recommended while rolling out `/_health` across an existing fleet.
- **Strict** (`routing.strictBootHandshake === true`) — the first issue throws and `startRouter()` rejects. The CLI then exits with code 1. Recommended once every service in the deployment is known to expose `/_health` with the new payload shape.

Turn on strict mode after you have verified non-strict mode produces no warnings during a normal deploy cycle.

## Failure modes — summary

| Scenario | Log/error text | Strict effect |
| --- | --- | --- |
| Local Redis write fails | `boot handshake failed to write Redis key: <message>` | Always throws (handshake cannot proceed). |
| Fallback `/_health` unreachable / non-200 / bad JSON | `boot handshake: fallback env '<key>' /_health unreachable — cannot verify shared Redis` | Throws in strict, warns otherwise. |
| `bootUuid` missing in fallback `/_health` | `boot handshake: fallback /_health returned no bootUuid — cannot verify shared Redis` | Throws / warns. |
| Local read of fallback Redis key fails | `boot handshake: Redis compare failed: <message>` | Throws / warns. |
| Boot UUIDs don't match | `boot handshake MISMATCH: fallback env '<key>' is connected to a different Redis ...` | Throws / warns. |
| Synchronized env value differs | `synchronized env '<key>' DIFFERS between router and fallback — sessions/cookies will not be portable` | Throws / warns (per key). |
| Synchronized hashes absent from `/_health` | `synchronized-env check: fallback /_health did not return hashes — cannot verify <N> synchronized key(s)` | Throws / warns. |
| Synchronized env missing on both sides | `synchronized env '<key>' missing on both router and fallback — cannot detect drift` | Throws / warns (per key). |
| Successful verification | `boot handshake: shared Redis verified with fallback env '<key>'` | Info log, no escalation. |

## When the handshake runs

The handshake is gated in `startRouter`:

```ts
if (healthStore && currentEnv?.fallback) {
  await runBootHandshake({
    envKey: input.currentEnvKey,
    fallbackEnvKey: currentEnv.fallback,
    fallbackBaseUrl: envMap[currentEnv.fallback]?.bindings['system'],
    strict: deployConfig.routing?.strictBootHandshake ?? false,
  });
}
```

Both conditions must hold:

1. **A Redis health store was successfully initialized** — without Redis the handshake has nowhere to write or compare. Note that in split/fallback mode, `startRouter` already hard-fails earlier if the store init throws, so reaching this point means the store is good.
2. **The current env declares a `fallback`** — there's no remote endpoint to probe otherwise. Single-env routers run the local UUID write only when this branch is skipped entirely.

Ordering in `startRouter`:

```text
createRedisHealthStore -> hydrate -> runBootHandshake -> http.createServer -> server.listen
```

If strict-mode handshake throws, no HTTP listener is opened. The router process exits with the unhandled rejection bubbling out of the CLI's `main()`.

## Failover semantics on the hot path

The boot handshake is **boot-only**. After it passes, request-level fallback is controlled entirely by:

- `resolver.resolve(service)` — picks local binding if owned + healthy, else fallback binding.
- `enableUnhealthyFallback` (default `true` in `deploy.config.ts -> routing`) — when off, unhealthy local services return `null` instead of falling back.
- Health flips from the poller and from Redis pub/sub events propagated via `onExternalChange`.

There is no runtime UUID re-check. A topology drift introduced after boot (someone repoints `REDIS_URL` of a running fallback) will not be caught until the next router restart. That's an accepted trade-off — repointing live Redis is itself a major operational event that should already trigger a redeploy.

## Synchronized env keys

Registered centrally by `@luckystack/core` via `registerSynchronizedEnvKey(name)`. Each framework package can declare keys it cares about — e.g. `@luckystack/login` registers `SESSION_SECRET`, `@luckystack/email` registers email-API credentials that must match across replicas.

Each value is hashed via `hashSynchronizedValue(...)` (SHA-256, hex) before comparison so secrets never leave the process in plaintext. The router only ever compares hashes — actual values are never sent over the wire.

Add new keys from a framework package by calling `registerSynchronizedEnvKey(name)` during the package's bootstrap. The handshake picks them up automatically on the next router restart.

## Related

- `packages/router/src/bootHandshake.ts` — handshake implementation.
- `packages/router/src/redisHealthStore.ts` — Redis client used for the write and the cross-Redis read.
- `packages/router/src/startRouter.ts` — invocation site.
- `packages/core` — `BOOT_KEY_PREFIX`, `collectSynchronizedEnvKeys`, `hashSynchronizedValue`, `getRedisConnectionOptions`.
- `packages/server/src/httpRoutes/healthRoutes.ts` — `/_health` endpoint the handshake probes.
- `docs/HOSTING.md` — environment sync requirements and Redis sharing.
