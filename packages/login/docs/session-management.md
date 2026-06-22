# Session management

Deep-dive on `saveSession` / `getSession` / `deleteSession`, sliding expiration, single-session enforcement, and the swappable `SessionAdapter`. Canonical sources: [`./src/session.ts`](../src/session.ts) and [`./src/sessionAdapter.ts`](../src/sessionAdapter.ts).

---

## Storage layout (defaults — Redis adapter)

| Key                                                | Type       | Contents                                                                          |
| -------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `${projectName}-session:<token>`                   | string     | JSON-encoded `BaseSessionLayout` (id, email, name, csrfToken, custom fields).     |
| `${projectName}-activeUsers:<userId>`              | set        | Tokens currently associated with this user. Read by single-session enforcement.   |
| `${projectName}-oauth-state:<provider>:<state>`    | string     | `'1'` sentinel + TTL. Consumed atomically on OAuth callback. (See `login.ts`.)    |
| `${projectName}-pwreset:<token>`                   | string     | `userId` bound to the reset token. (See [`./password-reset.md`](./password-reset.md).) |

`projectName` comes from `getProjectName()` in `@luckystack/core` — a single source of truth so the namespace is identical across sessions, activeUsers, OAuth state, password reset, and rate-limit.

The keys are exported as helpers for downstream admin tooling that reads Redis directly:

```ts
import { sessionKeyFor, activeUsersKeyFor } from '@luckystack/login';

// In an admin script:
const raw = await redis.get(sessionKeyFor(token));
const tokens = await redis.smembers(activeUsersKeyFor(userId));
```

For new code, prefer `getSessionAdapter()` so the keys stay encapsulated and a non-Redis adapter doesn't break the tooling.

## API surface

```ts
saveSession(token: string, data: SessionLayout, newUser?: boolean): Promise<void>;
getSession(token: string | null): Promise<SessionLayout | null>;
deleteSession(token: string): Promise<boolean>;
getAllSessions(): Promise<SessionLayout[]>;
revokeUserSessions(userId: string, exceptToken?: string | null): Promise<number>;
sessionKeyFor(token: string): string;
activeUsersKeyFor(userId: string): string;
```

`SessionLayout` is the framework's `BaseSessionLayout` from `@luckystack/core`, augmentable via module declaration — see [`./oauth-providers.md`](./oauth-providers.md) for the `extraSessionFields` pattern.

## `saveSession` — write path

The full sequence on a `newUser: true` save:

1. **`preSessionCreate` dispatch** — `{ token, user, persistent: !session.basedToken }`. A handler can return a stop signal; the warn-log surfaces the `errorCode` and the function returns without writing.
2. **CSRF token mint** — if `data.csrfToken` is not present, mint a fresh 32-byte hex token and write it onto the data. Subsequent writes preserve it so the client doesn't need to re-fetch on every session update. Rotated on logout (via `deleteSession`).
3. **Adapter write** — `adapter.setRaw(token, JSON.stringify(data), ttl)`. TTL = `session.expiryDays * 86400`.
4. **`trackActive`** — `adapter.trackActive(userId, token, ttl)` so the active-tokens set is in sync.
5. **Single-session enforcement** — see the next section.
6. **Broadcast** — if a socket is in the token room (`io.sockets.adapter.rooms.has(token)`), emit `socketEventNames.updateSession` with the new JSON. Drives client-side session refresh without a round-trip.
7. **`postSessionCreate` dispatch** — same payload as the pre-version.

On a `newUser: false` save (used for in-place session edits — admin promoting a user, settings update, etc.), steps 1 / 5 / 7 are skipped. Steps 2, 3, 4, 6 still run.

`saveSession` is wrapped in `tryCatch` end-to-end; errors are logged but never thrown out of the function. A failed save does not block the request that triggered it — but does mean the session is stale, so the next `getSession` will re-read from Redis if it can.

## Sliding expiration — `getSession`

```
preSessionRefresh (can stop the TTL extend) → adapter.expire(token, newTtl) → postSessionRefresh
```

Each authenticated `getSession` call extends the TTL by `session.expiryDays`. That means an active user is never logged out by the framework — only an idle one whose sliding window expires.

The hook gate exists for use cases like:

- **Admin freezing a session** — `preSessionRefresh` returns a stop signal while the admin reviews the account; the session keeps its current TTL but is not extended further, so it expires naturally even while the user keeps refreshing the page.
- **Sliding-window analytics** — `postSessionRefresh` receives `{ token, userId, oldTtl, newTtl, applied }` and is the canonical place to track "user is active right now" without re-reading the session.

`applied` reflects whether `adapter.expire` actually extended the TTL (true) or was skipped (false — either because the record was already gone, or because `preSessionRefresh` stopped the extend). Audit handlers should branch on `applied` to distinguish "user is active" from "user has a hold on their session".

Return value: the parsed `SessionLayout` with the `token` re-injected, or `null` when the token is missing / record is gone / the JSON failed to parse.

## `deleteSession` — write path with visible stacktrace

```ts
getLogger().warn('[session] deleteSession invoked', {
  tokenPrefix: token.slice(0, 8),
  stack: new Error('deleteSession invoked').stack,
});
```

The function intentionally warn-logs with a stacktrace BEFORE doing anything — same reasoning as the `logout` warn-log: spurious deletes silently kick users, and the stacktrace is the smoking gun.

After the warn-log:

1. **Read raw** — `adapter.getRaw(token)` to extract `userId` from the JSON. Used as the hook payload's `userId` and to clean up the active-users set.
2. **`preSessionDelete` dispatch** — `{ token, userId: resolvedUserId | null }`. Stop signal warn-logs and returns `false`.
3. **Logout connected sockets** — if `getIoInstance()` is up and there are sockets in the token room, call `logout(...)` for each one with `skipSessionDelete: true` (we're already inside the delete; don't recurse). See [`./logout-flow.md`](./logout-flow.md).
4. **`adapter.untrackActive`** — removes the token from the active-users set.
5. **`adapter.delete`** — removes the session record itself.
6. **`postSessionDelete` dispatch** — same payload as pre.
7. **Return** `true` on success, `false` when stopped or when an error bubbled.

When `getRaw` returned null (the record was already gone), the function still dispatches the pre/post hooks (with `userId: null`) and calls `adapter.delete` for idempotency, but skips the socket-walk and `untrackActive` because there's nothing to clean up.

## `getAllSessions` — graceful degradation

```ts
if (!adapter.listAll) {
  getLogger().warn(`[session] getAllSessions: adapter '${adapter.name}' does not implement listAll — returning empty`);
  return [];
}
```

Some adapters can't enumerate by design — signed-JWT-stateless adapters have no storage to walk; log-only / audit-only adapters might shed reads. Rather than throw, the function warn-logs once and returns `[]`. Admin code should treat the empty result as "this adapter is not scannable" rather than "this user has no sessions".

The Redis adapter implements `listAll` via `SCAN` over `${projectName}-session:*`, collecting `{ token, raw }` pairs. The walk paginates with `COUNT 100` so it doesn't block the event loop on large stores.

## `revokeUserSessions(userId, exceptToken?)`

Pure orchestration on top of `deleteSession`:

```ts
const tokens = await adapter.listActive(userId);
const targets = exceptToken ? tokens.filter((t) => t !== exceptToken) : tokens;
await Promise.all(targets.map((token) => deleteSession(token)));
return targets.length;
```

`exceptToken` is the "keep me signed in" escape hatch:

- After a password change: call with the current request's token so the user stays signed in on the device they just changed it on.
- After account deletion / "sign out everywhere": omit `exceptToken` to revoke every session including the caller's.

The return value is the number of sessions revoked, which lets the caller surface "Signed out of N other devices" in the UI.

## Single-session enforcement

When a `newUser: true` `saveSession` runs, the function decides which (if any) previous sessions to kick. The decision tree:

```
let effectivePerUser = sessionCfg.perUser;
const cap = sessionCfg.maxConcurrentPerUser;
const previousTokens = (await adapter.listActive(userId)).filter(t => t !== token);

if (effectivePerUser === 'single') {
  tokensToKick = previousTokens;                              // kick all
} else if (
  effectivePerUser === 'multiple' &&
  cap !== null &&
  previousTokens.length + 1 > cap &&
  sessionCfg.onConflict === 'revokeOld'
) {
  const excess = previousTokens.length + 1 - cap;
  tokensToKick = previousTokens.slice(0, excess);             // kick oldest until under cap
}
// else (multiple, no cap; or multiple + 'rejectNew') — nothing to kick here
```

Reading the config:

| Slot                                  | Possible values                | Behavior                                                                                                |
| ------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `session.perUser`                     | `'single'` / `'multiple'`      | `'single'` (default) — only one session at a time. `'multiple'` — pair with `maxConcurrentPerUser`.     |
| `session.maxConcurrentPerUser`        | `number \| null`               | Cap on simultaneous sessions when `perUser === 'multiple'`. `null` = unlimited.                          |
| `session.onConflict`                  | `'revokeOld'` / `'rejectNew'`  | What to do when the cap is reached. `'revokeOld'` kicks oldest; `'rejectNew'` refuses the new login.    |
| `session.notifyOldDeviceOnRevoke`     | `boolean`                      | Emit `socketEventNames.sessionReplaced` to the kicked socket before the disconnect.                     |
| `session.basedToken`                  | `boolean`                      | Used to compute `persistent: !basedToken` for `preSessionCreate` / `postSessionCreate`.                 |
| `session.expiryDays`                  | `number`                       | Multiplied by 86400 to get the TTL in seconds.                                                          |

`onConflict === 'rejectNew'` is enforced at the API layer (the login endpoint refuses the request), not inside `saveSession` — by the time we reach `saveSession` the decision to allow the login has already been made.

For each token in `tokensToKick`:

```ts
const sockets = io.sockets.adapter.rooms.get(previousToken);
if (sockets) {
  if (sessionCfg.notifyOldDeviceOnRevoke) {
    io.to(previousToken).emit(socketEventNames.sessionReplaced, JSON.stringify({
      reason: 'session-replaced',
      userId,
    }));
  }
  for (const socketId of sockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      await logout({ token: previousToken, socket, userId });
    }
  }
} else {
  // No active sockets — just clean up the adapter state.
  await adapter.delete(previousToken);
  await adapter.untrackActive(userId, previousToken);
}
```

The two branches matter: with sockets, the disconnect-flow runs end-to-end. Without sockets (the user was offline), only the storage cleanup runs — there's no socket to emit to and no presence state to tear down.

### Ordering caveat

The single-session-enforcement logic kicks "the oldest" tokens by dropping the head of `previousTokens.slice(0, excess)`. There is no LRU metadata in the adapter contract — adapters return insertion-order for set-like structures, which is good enough for the common case but not a strict guarantee.

If you need precise LRU semantics (e.g. a "kick the device the user hasn't used the most recently" UX), implement a custom `SessionAdapter` that tracks per-token last-touch timestamps in a sorted structure (Redis `ZSET`, Postgres `last_seen DESC`, DynamoDB GSI on `lastSeenAt`).

## `SessionAdapter` contract

```ts
interface SessionAdapter {
  name: string;
  getRaw(token: string): Promise<string | null>;
  setRaw(token: string, value: string, ttlSeconds: number): Promise<void>;
  delete(token: string): Promise<void>;
  expire(token: string, ttlSeconds: number): Promise<boolean>;
  ttl(token: string): Promise<number | null>;
  trackActive(userId: string, token: string, ttlSeconds: number): Promise<void>;
  untrackActive(userId: string, token: string): Promise<void>;
  listActive(userId: string): Promise<string[]>;
  listAll?(): Promise<{ token: string; raw: string }[]>;
}
```

Semantics:

| Method          | Required behavior                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `getRaw`        | Return the stored string for the token, or `null` when missing.                                                            |
| `setRaw`        | Persist the value with the given TTL. Implementations MUST honour the TTL — sessions without one would never expire.        |
| `delete`        | Idempotent removal. No-op when the record is already gone.                                                                 |
| `expire`        | Refresh the TTL only if the record exists. Return `true` when refreshed, `false` otherwise. MUST NOT create on miss.        |
| `ttl`           | Remaining TTL in seconds, or `null` when the record is missing.                                                            |
| `trackActive`   | Add `token` to the per-user set. Set itself MUST have the same TTL (the longest active session keeps the set alive).        |
| `untrackActive` | Remove `token` from the per-user set. Idempotent.                                                                          |
| `listActive`    | Return the current per-user set. Empty array (never throw) when missing.                                                   |
| `listAll`       | Optional admin walk. Omit when the backend cannot enumerate.                                                               |

`name` is a human-readable identifier surfaced in logs. The default Redis adapter is `'redis'`.

## Writing a custom adapter

```ts
import { registerSessionAdapter, type SessionAdapter } from '@luckystack/login';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const dynamoAdapter: SessionAdapter = {
  name: 'dynamodb',
  async getRaw(token) { /* GetItem */ },
  async setRaw(token, value, ttlSeconds) { /* PutItem with TTL attribute */ },
  async delete(token) { /* DeleteItem */ },
  async expire(token, ttlSeconds) { /* UpdateItem with condition exists */ },
  async ttl(token) { /* GetItem read TTL attribute */ },
  async trackActive(userId, token, ttlSeconds) { /* UpdateItem ADD to a SS attribute */ },
  async untrackActive(userId, token) { /* UpdateItem DELETE from SS */ },
  async listActive(userId) { /* GetItem read SS */ },
  // listAll omitted — DynamoDB Scan is too expensive in production
};

registerSessionAdapter(dynamoAdapter);
```

Common adapter shapes consumers have shipped:

- **DynamoDB / Cosmos DB** — serverless / edge deployments where Redis is operationally inconvenient.
- **Postgres `sessions` table** — when you already operate Postgres and don't want a second datastore. Per-token row with `userId`, `data` (JSON column), `expiresAt`.
- **Signed-JWT-stateless** — `getRaw` decodes the JWT, `setRaw` is a no-op (the JWT IS the storage), `trackActive` writes to a small Redis hash so single-session enforcement still works. `listAll` is omitted.
- **In-memory mock** — for integration tests. A `Map<string, { value, expiresAt }>` with a setInterval-based expiration sweep.

Call `registerSessionAdapter(...)` once at boot from `luckystack/server/index.ts`, BEFORE the first login request. Last-write-wins on subsequent calls (you can swap adapters in tests this way).

## `getSessionAdapter`

Reads the currently-active adapter. Defaults to `redisSessionAdapter` when no `registerSessionAdapter` call has happened. The default adapter is exported as `redisSessionAdapter` for cases where consumer code wants to compose around it (e.g. a wrapper adapter that delegates to Redis but also writes to an audit log).

## Why a separate broadcast on `updateSession`

When `saveSession` writes a `newUser: false` update — for instance an admin granting a user the `admin` flag from a settings page — the broadcast pushes the new session JSON to every socket already in the token room. The client-side `SessionProvider` listens for `socketEventNames.updateSession` and merges the payload into its in-memory session state.

This means:

- Permission changes apply instantly across all the user's open tabs.
- Profile updates (name, avatar) reflect in the navbar without a refresh.
- Custom session fields (e.g. `googleCalendarToken` set via `extraSessionFields`) flow to the client the same way.

The broadcast is gated on `io.sockets.adapter.rooms.has(token)` so a save targeting an offline user doesn't waste an emit.

## Related

- [`./logout-flow.md`](./logout-flow.md) — `logout` and `deleteSession`'s socket-walk.
- [`./hooks.md`](./hooks.md) — `preSessionCreate` / `postSessionCreate` / `preSessionDelete` / `postSessionDelete` / `preSessionRefresh` / `postSessionRefresh`.
- [`./credentials-auth.md`](./credentials-auth.md) — what calls `saveSession(token, user, true)`.
- [`./oauth-providers.md`](./oauth-providers.md) — `extraSessionFields` and module-augmentation of `BaseSessionLayout`.
- Architecture: [`/docs/ARCHITECTURE_SESSION.md`](../../../docs/ARCHITECTURE_SESSION.md).
