# Lifecycle hooks

Deep-dive on the authentication and session lifecycle hooks that `@luckystack/login` declares, fires, and lets consumers subscribe to. The hook bus itself lives in `@luckystack/core` (`registerHook` / `dispatchHook`); this package extends the core's `HookPayloads` interface via TypeScript module augmentation and dispatches against it from `login.ts`, `logout.ts`, `session.ts`, and `forgotPassword.ts`.

Canonical sources:

- Payload types: [`./src/hookPayloads.ts`](../src/hookPayloads.ts)
- Dispatch sites: [`./src/login.ts`](../src/login.ts), [`./src/logout.ts`](../src/logout.ts), [`./src/session.ts`](../src/session.ts), [`./src/forgotPassword.ts`](../src/forgotPassword.ts)
- Bus implementation: [`@luckystack/core/src/hooks/registry.ts`](../../core/src/hooks/registry.ts)

---

## Module augmentation

`@luckystack/login` does not define a parallel hook bus. It augments the shared `HookPayloads` interface that `@luckystack/core` exposes:

```ts
// packages/login/src/hookPayloads.ts
declare module '@luckystack/core' {
  interface HookPayloads {
    preLogin: PreLoginPayload;
    postLogin: PostLoginPayload;
    preRegister: PreRegisterPayload;
    postRegister: PostRegisterPayload;
    preLogout: PreLogoutPayload;
    postLogout: PostLogoutPayload;
    preSessionCreate: PreSessionCreatePayload;
    postSessionCreate: PostSessionCreatePayload;
    preSessionDelete: PreSessionDeletePayload;
    postSessionDelete: PostSessionDeletePayload;
    passwordResetRequested: PasswordResetRequestedPayload;
    passwordResetCompleted: PasswordResetCompletedPayload;
    passwordChanged: PasswordChangedPayload;
  }
}
```

This module is referenced from `index.ts` as a side-effect import:

```ts
import './hookPayloads';
```

The side-effect import has no runtime cost (the file only contains type declarations) but makes the dependency explicit for readers and ensures the augmentation lands in any TypeScript program that imports `@luckystack/login` — without the side-effect import, projects with strict tree-shaking on type-only imports could lose the declaration.

`preSessionRefresh` / `postSessionRefresh` are owned by `@luckystack/core` (declared in `packages/core/src/hooks/types.ts`) but dispatched from this package's `getSession`. They are listed here because subscribing to them from `@luckystack/login`-aware code is identical to the auth hooks.

## Hook table

| Hook                       | Aborts on stop signal               | Fires from                                                       | Async? |
| -------------------------- | ----------------------------------- | ---------------------------------------------------------------- | ------ |
| `preLogin`                 | Yes — login refused with `errorCode` | `loginWithCredentialsCore`, `loginCallback`                      | Yes    |
| `postLogin`                | No — `void` return                  | `loginWithCredentialsCore` (success), `loginCallback` (success)  | Yes    |
| `preRegister`              | Yes — register refused              | `registerWithCredentials`, `loginCallback` (new OAuth user)      | Yes    |
| `postRegister`             | No                                  | `registerWithCredentials`, `loginCallback` (new OAuth user)      | Yes    |
| `preLogout`                | Yes — logout aborted, socket gets `'error'` | `logout`                                                  | Yes    |
| `postLogout`               | No                                  | `logout` (success)                                               | Yes    |
| `preSessionCreate`         | Yes — save skipped                  | `saveSession(token, user, true)`                                 | Yes    |
| `postSessionCreate`        | No                                  | `saveSession(token, user, true)` (success)                       | Yes    |
| `preSessionDelete`         | Yes — delete refused, returns `false` | `deleteSession`                                                 | Yes    |
| `postSessionDelete`        | No                                  | `deleteSession` (success)                                        | Yes    |
| `preSessionRefresh`        | Yes — TTL extend skipped            | `getSession` (every authenticated read)                          | Yes    |
| `postSessionRefresh`       | No                                  | `getSession` (every authenticated read)                          | Yes    |
| `passwordResetRequested`   | No — fired for matched AND unmatched | `sendPasswordResetEmail`                                         | Yes (fire-and-forget via `void dispatchHook(...)`) |
| `passwordResetCompleted`   | No                                  | The consumer-side reset-password completion API                  | Yes    |
| `passwordChanged`          | No                                  | The consumer-side in-session password-change API                 | Yes    |

`passwordResetCompleted` and `passwordChanged` are declared by this package but dispatched by the installer-side `reset-password/_api/*` and `settings/_api/changePassword_v1` routes — see the `create-luckystack-app` template. They live here because the payload shape is part of the auth contract.

## Stop-signal contract

`pre*` hooks can abort the operation by returning a `HookStopSignal`:

```ts
import { registerHook } from '@luckystack/core';

registerHook('preLogin', async ({ email, provider }) => {
  if (provider !== 'credentials') return;
  const user = await prisma.user.findFirst({ where: { email } });
  if (user && !user.verified) {
    return { stop: true, errorCode: 'login.notVerified' };
  }
});
```

What "stop" means depends on the hook:

| Hook                | Stop behavior                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `preLogin`          | `loginWithCredentialsCore` / `loginCallback` returns `{ status: false, reason: signal.errorCode }`. No session minted. |
| `preRegister`       | `registerWithCredentials` / `loginCallback` returns the same `{ status: false, reason }`. No user created.             |
| `preLogout`         | `logout` warn-logs, emits `socketEventNames.logout, 'error'` to the socket, and returns. The session is NOT deleted.   |
| `preSessionCreate`  | `saveSession` warn-logs and returns. The session is NOT written. The active-users set is not updated.                  |
| `preSessionDelete`  | `deleteSession` warn-logs and returns `false`. The session record stays in storage; no socket gets logged out.         |
| `preSessionRefresh` | The TTL extend is skipped. `getSession` still returns the session — only the sliding-window refresh is gated.           |

The `errorCode` is propagated to the API caller as the `reason` field (i18n key). For the registers and logins above, custom error codes flow back through the same channel the framework uses for `login.empty` / `login.wrongPassword` / `login.userNotFound`.

Multiple handlers run in registration order; the FIRST stop signal wins. Subsequent handlers in the chain do NOT run after a stop:

```ts
// From core/registry.ts
for (const handler of handlers) {
  const result = await handler(payload);
  if (result && result.stop) {
    return { stopped: true, signal: result };
  }
}
return { stopped: false };
```

If you want every handler to run regardless of stops (audit-only), subscribe to the `post*` variant instead — those don't honor stop signals because the side-effect has already happened.

## Payload shapes

### `PreLoginPayload`

```ts
{ email: string; provider: string }
```

Fired BEFORE the user lookup, password compare, or OAuth find-or-create. `provider` is `'credentials'` for the credentials path or `'google'` / `'github'` / etc. for OAuth. The email is normalized (lowercased + trimmed for credentials; whatever the provider returned for OAuth).

### `PostLoginPayload`

```ts
{ userId: string; provider: string; isNewUser: boolean; token: string }
```

Fired AFTER `saveSession` succeeds. `isNewUser` is `false` for credentials login (registration auto-fires `postRegister` separately) and `true` for first-time OAuth users. `token` is the freshly-minted 64-char hex session token.

### `PreRegisterPayload`

```ts
{ email: string; provider: string; name?: string }
```

Fired BEFORE `userAdapter.create`. `name` is only present for credentials registration; OAuth users get the display name from the provider profile.

### `PostRegisterPayload`

```ts
{ userId: string; provider: string }
```

Fired AFTER `userAdapter.create` succeeds. For OAuth, `postRegister` AND `postLogin` both fire (in that order). For credentials, only `postRegister` fires — the user must follow up with a login call to get `postLogin`.

### `PreLogoutPayload` / `PostLogoutPayload`

```ts
{ userId: string | null; token: string | null }
```

Both fields are nullable because `logout` is sometimes invoked on a socket that already lost its session (the cleanup path). Handlers must guard against null:

```ts
registerHook('postLogout', async ({ userId, token }) => {
  if (!userId || !token) return; // cleanup-only call, nothing to do
  await auditLog(userId);
});
```

### `PreSessionCreatePayload` / `PostSessionCreatePayload`

```ts
{ token: string; user: BaseSessionLayout; persistent: boolean }
```

`persistent` is the inverse of `projectConfig.session.basedToken` — `true` means "this session survives a browser restart" (the default), `false` means "session-cookie only". Audit handlers can use this to differentiate a "remember me" login from a one-shot one.

`user` is the freshly-sanitized session layout — password already stripped, avatar already resolved. Hooks should treat it as read-only; mutating it does NOT affect the saved session (the framework writes the original reference, but other hooks expect immutability).

### `PreSessionDeletePayload` / `PostSessionDeletePayload`

```ts
{ token: string; userId: string | null }
```

`userId` is `null` when the session record was already gone by the time `deleteSession` read it (race condition, double-delete, expired-but-not-yet-untracked). Audit handlers that "log every session ending" should use the token prefix as the correlation key and treat a null userId as "we don't know who anymore — log it anyway".

### `PreSessionRefreshPayload` / `PostSessionRefreshPayload`

Declared in `@luckystack/core`:

```ts
{ token: string; userId: string; oldTtl: number; newTtl: number }
// postSessionRefresh additionally has: applied: boolean
```

Fired on every authenticated `getSession` — i.e. every API call with a valid session cookie. Be careful with side-effects here; subscribing a write to a slow store on this hook will slow down every request.

`applied: boolean` on `postSessionRefresh` reflects whether the TTL was actually extended (true) or skipped (false — either because the record was already gone, or because `preSessionRefresh` stopped the extend).

### `PasswordResetRequestedPayload`

```ts
{
  email: string;
  matched: boolean;
  userId?: string;     // only when matched
  token?: string;      // only when matched — DO NOT LOG
  ttlSeconds?: number; // only when matched
}
```

Fires from `sendPasswordResetEmail` once per request — for both matched and unmatched emails. The unmatched case fires with `matched: false` and no `userId` / `token` / `ttlSeconds`. Anti-enumeration: audit handlers MUST NOT differentiate UX between matched and unmatched (don't bounce the email faster on misses).

`token` IS included so that audit code can record the reset-token hash for later forensic correlation, but logging the raw token to disk would defeat the whole point of one-time-use tokens. If you need to record it, hash it first:

```ts
registerHook('passwordResetRequested', async ({ token, userId, matched }) => {
  if (!matched) return;
  await prisma.auditLog.create({
    data: {
      action: 'passwordResetRequested',
      userId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
    },
  });
});
```

### `PasswordResetCompletedPayload`

```ts
{ userId: string; revokedOtherSessions: boolean }
```

Fired from the consumer-side reset-password completion endpoint AFTER the new password is written and (optionally) other sessions are revoked. `revokedOtherSessions` reflects whether the API called `revokeUserSessions(userId)` on completion — the bundled template does this; custom completion endpoints may not.

### `PasswordChangedPayload`

```ts
{ userId: string; verifiedCurrent: boolean; revokedOtherSessions: boolean }
```

Fired from the in-session "change my password" endpoint. `verifiedCurrent` is `true` when the user provided their current password correctly. Some flows allow admins to set a user's password without verification (`verifiedCurrent: false`); audit handlers should branch on this to emit a different log line for admin-initiated changes.

## Dispatch order around a successful login

```
preLogin
  ├─ stop? → return { status: false, reason: signal.errorCode }
  └─ continue
[mint token, build session]
preSessionCreate
  ├─ stop? → return without saving
  └─ continue
[adapter.setRaw + trackActive + single-session enforcement + broadcast]
postSessionCreate
postLogin
```

Around a successful new-OAuth-user signup the sequence is:

```
preLogin
  ├─ stop? → return false
  └─ continue
[provider userinfo fetch]
preRegister
  ├─ stop? → return false
  └─ continue
[userAdapter.create]
preSessionCreate → postSessionCreate (around saveSession)
postRegister
postLogin
```

`postRegister` fires BEFORE `postLogin` for new OAuth users so audit handlers that "send a welcome email" don't race with a "login successful" notification.

## Dispatch order around logout

```
preLogout
  ├─ stop? → warn-log + socket.emit(logout, 'error') + return
  └─ continue
[deleteSession (which fires preSessionDelete / postSessionDelete internally)]
  ├─ stop from preSessionDelete? → warn-log + return false
  └─ continue
[srem activeUsers, socket.leave(token)]
postLogout
[socket.emit(logout, 'success')]
```

The `postLogout` dispatch happens BEFORE the socket emit because subscribers may want to push a final message to the socket before the client clears its sessionStorage. After the emit, the client redirects to `/login` and stops listening.

## Payload-not-mutated rule

Handlers must NOT mutate the payload object. The framework passes the same reference to every handler in the chain — mutating it from handler #1 would surprise handler #2.

If you need to attach extra state during login (a tenant id, a feature flag, an enrichment that another package wants to read), write it into your own key space using ids from the payload:

```ts
// Bad — mutates payload
registerHook('preLogin', async (payload) => {
  payload.email = payload.email.toLowerCase(); // already done!
  (payload as any).tenant = await resolveTenant(payload.email);
});

// Good — write to your own store
registerHook('preLogin', async ({ email }) => {
  const tenant = await resolveTenant(email);
  await redis.set(`tenant-context:${email}`, tenant.id, 'EX', 300);
});

registerHook('postLogin', async ({ userId, token }) => {
  const tenant = await redis.get(`tenant-context:somehow`);
  // ...wire it to the user's session
});
```

For OAuth providers specifically, the dedicated `extraSessionFields` callback (see [`./oauth-providers.md`](./oauth-providers.md)) is the supported way to add per-session extras — it runs after the userinfo fetch and the merged record is broadcast to the client via the session.

## Subscribing — `registerHook` from `@luckystack/core`

```ts
import { registerHook } from '@luckystack/core';

registerHook('postLogin', async ({ userId, provider, isNewUser, token }) => {
  // ...
});
```

Subscriptions are global per Node.js process. Order is registration-order; there is no priority system. Inside a single package, group hook registrations into a single boot file so the order is obvious at a glance.

`registerHook` is fire-and-add: there is no `unregisterHook`. Subscriptions live for the lifetime of the process. For test isolation, call `clearAllHooks()` (exported from `@luckystack/core`) in your test setup.

## Sentinel values to watch

- `PreLogoutPayload.userId` / `.token` are NULLABLE. Cleanup-path logouts (e.g. socket disconnect after a session expired between writes) fire `preLogout` with both fields null. Handlers must guard.
- `PreSessionDeletePayload.userId` is nullable for the same race-condition reason. Handlers that "log every session deletion" should fall back to the token prefix.
- `PasswordResetRequestedPayload.userId` / `.token` are absent when `matched === false`. Use the `matched` flag as the discriminator; do NOT key on truthy `userId` alone.

## Audit handler patterns

```ts
// Per-user "last login" history table (audit-grade vs the best-effort User.lastLogin column)
registerHook('postLogin', async ({ userId, provider, isNewUser, token }) => {
  await prisma.loginEvent.create({
    data: {
      userId,
      provider,
      isNewUser,
      tokenPrefix: token.slice(0, 8),
      timestamp: new Date(),
    },
  });
});

// Notify on suspicious sign-in (IP change)
registerHook('postLogin', async ({ userId }) => {
  const ip = currentRequestIp(); // your own AsyncLocalStorage helper
  const last = await prisma.user.findUnique({ where: { id: userId }, select: { lastIp: true } });
  if (last?.lastIp && last.lastIp !== ip) {
    await notifyAccountOwner(userId, ip);
  }
  await prisma.user.update({ where: { id: userId }, data: { lastIp: ip } });
});

// Block unverified users at the gate
registerHook('preLogin', async ({ email, provider }) => {
  if (provider !== 'credentials') return;
  const user = await prisma.user.findFirst({ where: { email } });
  if (user && !user.verified) {
    return { stop: true, errorCode: 'login.notVerified' };
  }
});

// Tear down per-user caches on logout
registerHook('postLogout', async ({ userId }) => {
  if (!userId) return;
  cache.del(`user-prefs:${userId}`);
  cache.del(`user-feed:${userId}`);
});

// Mirror new OAuth users into a CRM (postRegister fires BEFORE postLogin for new OAuth users)
registerHook('postRegister', async ({ userId, provider }) => {
  await crmClient.createContact({ externalId: userId, source: provider });
});

// Audit every session deletion with full stacktrace correlation
registerHook('postSessionDelete', async ({ token, userId }) => {
  await prisma.auditLog.create({
    data: {
      action: 'sessionDelete',
      userId, // may be null
      tokenPrefix: token.slice(0, 8),
      timestamp: new Date(),
    },
  });
});

// Block logout while a critical operation is in flight
registerHook('preLogout', async ({ userId }) => {
  if (!userId) return;
  const pending = await prisma.pendingTransaction.count({ where: { userId } });
  if (pending > 0) {
    return { stop: true, errorCode: 'login.pendingTransactionsBlocking' };
  }
});

// Audit password resets (token hashed before logging)
registerHook('passwordResetRequested', async ({ email, matched, userId, token }) => {
  if (!matched) {
    await prisma.auditLog.create({
      data: { action: 'passwordResetMissed', email, timestamp: new Date() },
    });
    return;
  }
  await prisma.auditLog.create({
    data: {
      action: 'passwordResetRequested',
      userId,
      tokenHash: createHash('sha256').update(token!).digest('hex'),
      timestamp: new Date(),
    },
  });
});
```

## Why no `preLogin` mutate-payload escape hatch

A common request is "let `preLogin` set the user's tenant on the session before save". The framework deliberately rejects that pattern:

- It would couple the auth contract to every consumer's tenant model.
- It would let a misbehaving handler nuke the session shape (drop the userId, change the email).
- Multiple handlers writing the same field race each other.

Use one of the supported extension points instead:

- **Per-provider OAuth runtime extras** — `extraSessionFields` on the provider definition.
- **Custom session field, hook-populated** — augment `BaseSessionLayout` via module declaration, then write the field inside `postSessionCreate` via `saveSession(token, { ...user, tenantId }, false)`. The framework treats the second write as an update.
- **Out-of-band store** — write to your own Redis namespace and look up by `session.id` on the consumer side.

## Related

- [`./credentials-auth.md`](./credentials-auth.md) — `preLogin` / `postLogin` / `preRegister` / `postRegister` dispatch sites.
- [`./oauth-providers.md`](./oauth-providers.md) — `extraSessionFields` and OAuth-specific lifecycle.
- [`./logout-flow.md`](./logout-flow.md) — `preLogout` / `postLogout` and the spurious-logout warn-log.
- [`./session-management.md`](./session-management.md) — `preSessionCreate` / `postSessionCreate` / `preSessionDelete` / `postSessionDelete` / `preSessionRefresh` / `postSessionRefresh`.
- [`./password-reset.md`](./password-reset.md) — `passwordResetRequested` / `passwordResetCompleted` / `passwordChanged`.
- Core hook bus: [`/packages/core/docs/hooks.md`](../../core/docs/hooks.md).
- Architecture: [`/docs/ARCHITECTURE_AUTH.md`](../../../docs/ARCHITECTURE_AUTH.md).
