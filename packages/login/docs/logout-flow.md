# Logout flow

Deep-dive on `logout` and how it interacts with sockets, sessions, hooks, and presence. Canonical source: [`./src/logout.ts`](../src/logout.ts), with cross-cutting flow in [`./src/session.ts`](../src/session.ts).

---

## Entry point

```ts
logout({
  token: string | null,
  socket: Socket | undefined,
  userId: string | null,
  skipSessionDelete?: boolean,
}): Promise<void>;
```

All four arguments are nullable / optional because `logout` is called from three different contexts that each know about different subsets of state:

1. **The socket's `logout` event handler** — has the socket and token; resolves `userId` from the session lookup.
2. **`deleteSession`** — has the token and (after a session read) the userId; needs `skipSessionDelete: true` to avoid recursion.
3. **Single-session enforcement inside `saveSession`** — has the previous token + socket + userId, calls `logout` to disconnect the old device when the new login arrives.

Missing arguments cause the function to warn-log and return early without mutating state. Specifically:

- No `socket` → `getLogger().warn('logout: invalid socket')` and return. The session is NOT deleted in this case — there's nothing to emit to, but more importantly, "no socket" is an unexpected state and silently destroying the session would hide the bug.
- No `token` → `getLogger().warn('logout: no token provided')` and return.

If you need to programmatically log out a user without a live socket, call `deleteSession(token)` directly. `logout` is the socket-side wrapper.

## Sequence

```
preLogout (can stop) → [deleteSession] → srem activeUsers → socket.leave(token) → postLogout → socket.emit(logout, "success")
```

Step by step, mirroring the source:

### 1. `preLogout` dispatch

```ts
const preLogoutResult = await dispatchHook('preLogout', { userId, token });
if (preLogoutResult.stopped) {
  getLogger().warn('logout: aborted by preLogout hook', {
    errorCode: preLogoutResult.signal.errorCode,
  });
  socket.emit(socketEventNames.logout, 'error');
  return;
}
```

Payload: `{ userId: string | null, token: string | null }`. Both are nullable because logout is sometimes invoked on a socket that already lost its session (cleanup path).

A handler can return `{ stop: true, errorCode: 'someReason' }`. The framework warn-logs the reason and emits `socketEventNames.logout, 'error'` to the socket — the client treats this the same as a network error and stays signed in. Use the stop signal for things like "require an MFA confirmation before logging out" or "block logout while a transaction is still in flight".

### 2. `deleteSession` (skipped when `skipSessionDelete: true`)

```ts
if (!skipSessionDelete) {
  await deleteSession(token);
}
```

`deleteSession` does its own `preSessionDelete` / `postSessionDelete` dispatch (see [`./session-management.md`](./session-management.md)). The `skipSessionDelete` flag exists specifically for the case where `deleteSession` ITSELF called `logout` — if we re-called `deleteSession` from inside, we'd recurse forever (or at least until the second `getRaw` returned null).

### 3. Remove the token from the active-users set

```ts
if (userId) {
  await redisClient.srem(activeUsersKeyFor(userId), token);
}
```

This is the bookkeeping that `revokeUserSessions` / single-session enforcement reads. The set is keyed by user id, with members being currently-valid tokens. Removing the token before the session is gone-from-Redis is fine because `srem` is idempotent and the source of truth for "is this session valid" is the session record, not the set.

The set might already not contain the token (e.g. when `deleteSession` already cleaned up via `adapter.untrackActive`). `srem` is idempotent — extra calls are no-ops, not errors.

### 4. Leave the socket room

```ts
socket.leave(token);
```

Every authenticated socket joins a Socket.io room named after its session token. Broadcasts to that room are what drive `updateSession` and `sessionReplaced` events. After leaving, the socket no longer receives session-scoped broadcasts.

### 5. `postLogout` dispatch

```ts
await dispatchHook('postLogout', { userId, token });
```

Same payload as `preLogout`. Subscribers do their teardown here. Critical example: `@luckystack/presence` registers a `postLogout` handler that cleans up `disconnectTimers` and `tempDisconnectedSockets`. This keeps the login → presence dependency one-way:

- `@luckystack/presence` knows about `@luckystack/login` (uses `getSession` / `deleteSession`).
- `@luckystack/login` does NOT know about `@luckystack/presence`. Presence is just one of many hook subscribers.

### 6. Socket emit (`"success"` or `"error"`)

```ts
socket.emit(socketEventNames.logout, "success");
```

The installer-side `SessionProvider` (in `src/_providers/SessionProvider.tsx`) listens for `socketEventNames.logout` and on `"success"`:

1. Clears `sessionStorage`.
2. Removes any cached avatar data URLs.
3. Redirects to `/login`.

On `"error"`, it does nothing — the user stays signed in. The client treats an error the same as a transient network failure.

## Spurious-logout warn-logging

The success path emits a noisy warn-level log with a stacktrace:

```ts
getLogger().warn('[session] logout success — emitting logout to socket', {
  tokenPrefix: token ? token.slice(0, 8) : null,
  userId,
  socketId: socket.id,
  stack: new Error('logout invoked').stack,
});
```

This is deliberate — and the comment in the source explains why:

> Spurious logouts are always a bug — log loudly so the originating caller is identifiable from the stacktrace. The client receives this success-emit and clears sessionStorage + redirects to /login, so any unexpected occurrence here is the smoking gun.

When a production user reports "I keep getting logged out", grepping the logs for this line + correlating the stacktrace tells you whether it was an explicit logout (good), a `revokeUserSessions` call (good but verify), a single-session enforcement kick (good — the user signed in elsewhere), or an unexpected caller (bug). Keep the warn-level — silencing it loses the diagnostic.

Tokens are logged at 8-char prefix length so the full token never lands in a log file.

## `skipSessionDelete: true` — when it's correct

Used by exactly one caller: `deleteSession` itself, when it walks the socket room for the deleted session:

```ts
// inside deleteSession, when sockets are still connected
const { logout } = await import('./logout');
const sockets = ioInstance.sockets.adapter.rooms.get(token);
if (sockets) {
  await Promise.all([...sockets].map(async (socketId) => {
    const socket = ioInstance.sockets.sockets.get(socketId);
    if (!socket) return;
    await logout({
      token,
      socket,
      userId: resolvedUserId,
      skipSessionDelete: true, // we're INSIDE deleteSession; do not recurse
    });
  }));
}
```

Without the flag, each `logout` call would re-invoke `deleteSession`, which would re-discover the same socket(s), which would re-call `logout`, which would re-invoke `deleteSession` — infinite loop until Redis returned `null` for the second `getRaw`.

If you call `logout` directly from anywhere else, leave `skipSessionDelete` undefined / false. The default behavior — `deleteSession` runs inside `logout` — is correct for every other call site.

## How force-logout flows reuse the same chain

`revokeUserSessions(userId, exceptToken?)` is the "sign out everywhere" / "sign out other devices" entry point:

```ts
const revokeUserSessions = async (userId, exceptToken?) => {
  const adapter = getSessionAdapter();
  const tokens = await adapter.listActive(userId);
  const targets = exceptToken ? tokens.filter((t) => t !== exceptToken) : tokens;
  await Promise.all(targets.map((token) => deleteSession(token)));
  return targets.length;
};
```

Each `deleteSession(token)` finds the socket(s) for that token and calls `logout` on them with `skipSessionDelete: true`. The end result for every device is identical to a normal user-initiated logout: `preLogout` fires, `postLogout` fires, sessionStorage is cleared, redirect to `/login`. There is no second code path that "force-logs out" differently — every disconnect goes through the same socket flow.

Use cases:

- **Password change** — `revokeUserSessions(user.id, currentToken)` so every other device is logged out, but the device that just changed the password stays signed in.
- **Account deletion** — `revokeUserSessions(user.id)` (no `exceptToken`) before deleting the user record so no socket is holding onto a stale session.
- **"Sign out everywhere" button** — same as account deletion but without the deletion.
- **Admin "boot user" tool** — `revokeUserSessions(targetUserId)` from an admin endpoint.

## Single-session enforcement

When a user signs in elsewhere and `session.perUser === 'single'`, `saveSession` calls `logout` for each previous token's socket(s). The optional `session.notifyOldDeviceOnRevoke` flag emits `socketEventNames.sessionReplaced` BEFORE the disconnect so the kicked client can show a "you signed in elsewhere" toast:

```ts
if (sessionCfg.notifyOldDeviceOnRevoke) {
  io.to(previousToken).emit(socketEventNames.sessionReplaced, JSON.stringify({
    reason: 'session-replaced',
    userId,
  }));
}
// ...then logout fires, which emits socketEventNames.logout, "success"
```

Both events land on the same socket. The installer-side `SessionProvider` handles `sessionReplaced` first (show the toast), then `logout` (clear sessionStorage, redirect).

## Hook recipes

```ts
// Audit-log every logout
registerHook('postLogout', async ({ userId, token }) => {
  if (!userId || !token) return;
  await prisma.auditLog.create({
    data: {
      action: 'logout',
      userId,
      tokenPrefix: token.slice(0, 8),
      timestamp: new Date(),
    },
  });
});

// Block logout while a critical transaction is pending
registerHook('preLogout', async ({ userId }) => {
  if (!userId) return;
  const pending = await prisma.pendingTransaction.count({ where: { userId } });
  if (pending > 0) {
    return { stop: true, errorCode: 'login.pendingTransactionsBlocking' };
  }
});

// Tear down per-user caches (login does NOT know about this — it's a hook subscriber)
registerHook('postLogout', async ({ userId }) => {
  if (!userId) return;
  cache.del(`user-prefs:${userId}`);
  cache.del(`user-feed:${userId}`);
});
```

## Related

- [`./session-management.md`](./session-management.md) — `deleteSession`, the session adapter, sliding expiration.
- [`./hooks.md`](./hooks.md) — `preLogout` / `postLogout` payloads and the stop-signal contract.
- [`./credentials-auth.md`](./credentials-auth.md) — the corresponding login flow.
- Architecture: [`/docs/ARCHITECTURE_SESSION.md`](../../../docs/ARCHITECTURE_SESSION.md).
