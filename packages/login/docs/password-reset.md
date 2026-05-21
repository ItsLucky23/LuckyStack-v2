# Password reset

Deep-dive on the password-reset primitives, the framework-mode email orchestrator, and the password-policy validator. Canonical sources: [`./src/passwordReset.ts`](../src/passwordReset.ts), [`./src/forgotPassword.ts`](../src/forgotPassword.ts), [`./src/passwordPolicy.ts`](../src/passwordPolicy.ts).

This is the password lifecycle from "user clicks Forgot password" through "new password landed in the user record". The flow is intentionally split into a small set of primitives that consumers can compose into a fully custom UI, with an opt-in `'framework'` mode that bundles all the pieces into a single end-to-end orchestrator.

---

## Three modes — `auth.forgotPassword`

`ProjectConfig.auth.forgotPassword` selects the operating mode:

| Mode          | Behavior                                                                                                       | Email peer dep |
| ------------- | -------------------------------------------------------------------------------------------------------------- | -------------- |
| `'framework'` | `sendPasswordResetEmail` orchestrates token + email send. Reset URL points at the bundled `/reset-password` page. | `@luckystack/email` REQUIRED — lazy-imported on first call |
| `'custom'`    | `sendPasswordResetEmail` returns `{ ok: false, reason: 'forgotPassword-not-framework' }`. Consumer wires their own email + UI using the primitives. | Not required — install `@luckystack/email` only if you call it yourself |
| `'disabled'`  | Same as `'custom'` from the package's perspective. Convention is "the consumer-side UI does not expose a forgot-password link at all". | Not required |

The mode is read at call time via `getProjectConfig()`, so consumers can toggle it through `registerProjectConfig` without restarting. In practice, switching modes mid-process is uncommon — pick a mode at boot and stick with it.

## Token layout

```ts
const token = randomBytes(32).toString('hex'); // 64 char URL-safe string
const key = `${getProjectName()}-pwreset:${token}`;
await redis.set(key, userId, 'EX', auth.passwordResetTtlSeconds);
```

- **Entropy** — 256 bits via `randomBytes(32)`. Hex-encoded so it can be passed in a URL query string without any escaping.
- **Storage** — Redis. Single key holds the `userId`; one-time use means the redemption deletes the key.
- **Namespace** — `${projectName}-pwreset:<token>`. Shared `getProjectName()` helper means the namespace matches sessions, activeUsers, OAuth state, and rate-limit (no drift between Redis keys).
- **TTL** — `auth.passwordResetTtlSeconds`. Default 3600 (1 hour). Tighten for high-security deployments; loosen if your users frequently check email on a different device than they reset on.

## Primitives

### `createPasswordResetToken(userId)`

```ts
createPasswordResetToken(userId: string): Promise<string>;
```

Mint + store + return. Caller is responsible for getting the token to the user — typically embedded in a `${appPublicUrl}/reset-password?token=<token>` URL inside an email, but custom modes might send it via SMS, push notification, or an in-app banner.

Always succeeds (returns the token string). If Redis is down, the underlying `redis.set` throws and propagates — wrap in `tryCatch` at the call site if you want to surface "email service degraded" rather than 500.

### `consumePasswordResetToken(token)`

```ts
consumePasswordResetToken(token: string): Promise<string | null>;
```

Atomic `GET` + `DEL` in a Redis transaction:

```ts
const txResult = await redis.multi().get(key).del(key).exec();
const [getErr, value] = txResult[0];
if (getErr) return null;
return typeof value === 'string' && value.length > 0 ? value : null;
```

Returns the bound `userId` on success, `null` on:

- Empty or non-string `token` argument.
- Token expired (Redis returns null for the GET).
- Token already consumed (the DEL on a prior call already removed it).
- The transaction failed entirely (Redis network blip).

One-time-use is enforced by the atomic DEL — a second call with the same token returns `null` because the key is already gone. Replay attacks defeated.

### `updatePasswordHash(userId, plaintext)`

```ts
updatePasswordHash(userId: string, plaintext: string): Promise<void>;
```

Three-step: validate against policy → bcrypt-hash → write through `UserAdapter.update`.

```ts
const reason = validatePassword(plaintext);
if (reason) throw new PasswordPolicyError(reason);
const salt = await bcrypt.genSalt(getProjectConfig().auth.bcryptRounds);
const hashedPassword = await bcrypt.hash(plaintext, salt);
await getUserAdapter().update(userId, { password: hashedPassword } as never);
```

Throws `PasswordPolicyError` on policy violation. The cast to `never` on the patch tells TypeScript "we know `password` may not be a typed field on `UserRecord`, trust me" — the framework's `UserAdapter` interface is intentionally loose for this kind of optional column.

Note this primitive deliberately does NOT consume a reset token. The reset-password completion API is responsible for the sequence:

```ts
const userId = await consumePasswordResetToken(token);
if (!userId) return { status: false, reason: 'login.invalidResetToken' };
await updatePasswordHash(userId, newPassword);
// optional: dispatch passwordResetCompleted hook
// optional: revokeUserSessions(userId)
```

Splitting these lets consumers compose the same primitive into a "change my password" endpoint (no token, just verify the current password first), an admin-reset endpoint (no token, no verification), or a forced-reset flow.

### `verifyPassword(plaintext, hash)`

```ts
verifyPassword(plaintext: string, hash: string): Promise<boolean>;
```

Bcrypt comparison. Used by the in-session "change my password" endpoint to verify the user's current password before accepting a new one.

### `PasswordPolicyError`

```ts
class PasswordPolicyError extends Error {
  readonly errorCode: string;
  constructor(errorCode: string) {
    super(`Password policy violation: ${errorCode}`);
    this.name = 'PasswordPolicyError';
    this.errorCode = errorCode;
  }
}
```

`errorCode` is an i18n reason key like `login.passwordRequiresUppercase` or `login.passwordTooCommon`. Catch it in the calling API:

```ts
const [error] = await tryCatch(() => updatePasswordHash(userId, newPassword));
if (error instanceof PasswordPolicyError) {
  return { status: false, reason: error.errorCode };
}
if (error) return { status: false, reason: 'api.internalServerError' };
return { status: true, reason: 'login.passwordChanged' };
```

## Password policy — `validatePassword(plaintext)`

```ts
validatePassword(password: string): string | null;
```

Returns `null` when the policy passes, or a reason-key on the FIRST failure. Checks run in order:

| Check                | Reason key                            | Config slot                              |
| -------------------- | ------------------------------------- | ---------------------------------------- |
| `length < minLength` | `'login.passwordCharacterMinimum'`    | `auth.passwordPolicy.minLength`          |
| `length > maxLength` | `'login.passwordCharacterLimit'`      | `auth.passwordPolicy.maxLength`          |
| No `[A-Z]`           | `'login.passwordRequiresUppercase'`   | `auth.passwordPolicy.requireUppercase`   |
| No `[a-z]`           | `'login.passwordRequiresLowercase'`   | `auth.passwordPolicy.requireLowercase`   |
| No `\d`              | `'login.passwordRequiresNumber'`      | `auth.passwordPolicy.requireNumber`      |
| No `[^A-Za-z0-9]`    | `'login.passwordRequiresSpecial'`     | `auth.passwordPolicy.requireSpecial`     |
| In `COMMON_PASSWORDS` | `'login.passwordTooCommon'`          | `auth.passwordPolicy.forbidCommon`       |
| Custom validator     | Whatever `customValidator` returns    | `auth.passwordPolicy.customValidator`    |

The common-passwords blocklist lives in [`./src/data/commonPasswords.ts`](../src/data/commonPasswords.ts) — a `Set<string>` for O(1) lookup. The check is case-insensitive (`password.toLowerCase()`), so `Password123` and `password123` are both rejected if either is in the list.

`customValidator` is a `(plaintext: string) => string | null` function on the project config. Use it for organization-specific policies (block-list of company-related words, NIST-style breach-database check, regex against the user's email):

```ts
registerProjectConfig({
  auth: {
    passwordPolicy: {
      minLength: 12,
      requireUppercase: true,
      requireDigit: true,
      customValidator: (plaintext) => {
        if (plaintext.toLowerCase().includes('acme')) {
          return 'login.passwordBrandWord';
        }
        return null;
      },
    },
  },
});
```

Reason keys returned from `customValidator` should still be i18n keys — the installer-side translator must have a matching message.

## Framework-mode orchestrator — `sendPasswordResetEmail`

```ts
sendPasswordResetEmail({ email, brand? }: { email: string; brand?: string }): Promise<{ ok: boolean; reason?: string }>;
```

Full sequence in [`./src/forgotPassword.ts`](../src/forgotPassword.ts):

1. **Mode gate** — `if (config.auth.forgotPassword !== 'framework') return { ok: false, reason: 'forgotPassword-not-framework' }`. Non-framework modes short-circuit here.
2. **Brand resolution** — call-site `brand` > `config.auth.passwordResetBrand` > `'LuckyStack'`. The brand shows up in the email subject, the greeting, and the footer.
3. **Lazy import** — `await import('@luckystack/email')`. The `// @ts-expect-error optional peer dep` suppresses the TS error when `@luckystack/email` is not installed; runtime will throw a clear `Cannot find module` if the consumer is in framework-mode without installing the peer. The lazy import means modes other than `'framework'` never touch the email package — letting consumers skip `@luckystack/email` entirely.
4. **User lookup** — `userAdapter.findByEmail({ email, provider: 'credentials' })`. Looking up by the `'credentials'` provider scope means an OAuth-only user (no password set) cannot trigger a reset; the lookup misses, anti-enumeration kicks in.
5. **Anti-enumeration on miss** — fires `passwordResetRequested` with `matched: false`, returns `{ ok: true }`. The caller cannot distinguish "email matched" from "email didn't match" — both look like success. Prevents attackers from harvesting valid emails by polling the reset endpoint.
6. **Mint token** — `createPasswordResetToken(user.id)`.
7. **Hook dispatch** — `void dispatchHook('passwordResetRequested', { email, matched: true, userId, token, ttlSeconds })`. Fire-and-forget so a slow audit-log subscriber doesn't block the email send.
8. **Render the email** — `renderEmailLayout({ brand, title, intro, ctaLabel, ctaUrl, outro, footer })` from `@luckystack/email` produces `{ html, text }`. The reset URL is `${app.publicUrl}/reset-password?token=<urlEncodedToken>` with the trailing slash trimmed from `publicUrl`. `ttlMinutes = Math.round(ttlSeconds / 60)` so the email reads "expires in 60 minutes" without raw seconds.
9. **Send** — `sendEmail({ to, subject, html, text, adapterHint: 'transactional' })`. The `'transactional'` hint routes through the transactional sender when consumers registered separate marketing + transactional adapters via `registerEmailSenders`. Falls back to the default sender when only one is registered. See [`/docs/ARCHITECTURE_EMAIL.md`](../../../docs/ARCHITECTURE_EMAIL.md).
10. **Return** — `result.ok ? { ok: true } : { ok: false, reason: result.reason }`. Note that "send failure" IS surfaced via `ok: false` here — the anti-enumeration guarantee only covers the "user not found" miss, not infrastructure failure. The HTTP layer should still return a 200 to the client to preserve enumeration resistance, but log the `reason` for ops visibility.

### Lazy-import implementation detail

The `@ts-expect-error` is intentional and load-bearing:

```ts
const { sendEmail, renderEmailLayout } = await (
  // @ts-expect-error optional peer dep — installed only when forgotPassword === 'framework'
  import('@luckystack/email') as Promise<EmailModule>
);
```

`@luckystack/email` is in `peerDependenciesMeta` as optional. Projects that pick `'custom'` or `'disabled'` mode never install the peer, and TypeScript would error on the import — the `@ts-expect-error` is the standard escape hatch for optional peers. The shape is asserted at the call site via the local `EmailModule` interface.

## End-to-end reset flow

The framework-mode flow has two HTTP endpoints (wired by `@luckystack/server` via the file-based router):

```
1. POST /api/login/sendReset/v1     → sendPasswordResetEmail({ email })
                                       └ token now in Redis, email on its way
2. POST /api/login/completeReset/v1 → consumePasswordResetToken(token)
                                       └ updatePasswordHash(userId, newPassword)
                                       └ revokeUserSessions(userId, currentToken?)
                                       └ dispatchHook('passwordResetCompleted', { userId, revokedOtherSessions })
```

Both endpoints live in the `create-luckystack-app` template under `src/reset-password/_api/` so consumers can edit them. The package itself only exposes the primitives.

For the in-session "change my password" flow:

```
POST /api/settings/changePassword/v1
  1. verifyPassword(currentPassword, user.password)
  2. updatePasswordHash(userId, newPassword)
  3. revokeUserSessions(userId, currentToken)  // keep this session alive
  4. dispatchHook('passwordChanged', { userId, verifiedCurrent: true, revokedOtherSessions: true })
```

## Recommended pairing: revoke other sessions

After a successful reset OR change, calling `revokeUserSessions(userId, currentToken?)` ensures every other device the user was signed in on gets logged out. The recommended completion endpoint:

```ts
const userId = await consumePasswordResetToken(token);
if (!userId) return { status: false, reason: 'login.invalidResetToken' };

const [updateError] = await tryCatch(() => updatePasswordHash(userId, newPassword));
if (updateError instanceof PasswordPolicyError) {
  return { status: false, reason: updateError.errorCode };
}
if (updateError) return { status: false, reason: 'api.internalServerError' };

const revoked = await revokeUserSessions(userId);
await dispatchHook('passwordResetCompleted', { userId, revokedOtherSessions: revoked > 0 });

return { status: true, reason: 'login.passwordResetSuccess' };
```

For the in-session change flow, pass the current token so the user stays signed in on the device they just changed it on:

```ts
const revoked = await revokeUserSessions(userId, currentToken);
```

The return value of `revokeUserSessions` is the number of sessions kicked, which the UI can surface as "You've been signed out of N other devices" for transparency.

## Custom mode — composing the primitives

When `auth.forgotPassword === 'custom'`, the consumer wires their own UI and email layer using the primitives:

```ts
// Consumer-side custom forgot-password endpoint
import { createPasswordResetToken } from '@luckystack/login';
import { mySmsClient } from './sms';

export const sendResetSms = async ({ phone }: { phone: string }) => {
  const user = await prisma.user.findFirst({ where: { phone, provider: 'credentials' } });
  if (!user) return { ok: true }; // anti-enumeration
  const token = await createPasswordResetToken(user.id);
  await mySmsClient.send(phone, `Reset code: ${token.slice(0, 6).toUpperCase()}`);
  return { ok: true };
};
```

The SMS example uses the first 6 chars as a human-typeable code rather than the full 64-char hex string. The consumer-side completion endpoint then redeems by reconstructing the full token from a lookup table — or by storing a shorter token to begin with via a custom helper. The packaged primitives don't support short tokens directly; if you need them, mint + store in your own Redis namespace and skip `createPasswordResetToken` entirely.

## Disabled mode

`auth.forgotPassword === 'disabled'` is purely a convention — the package functions the same way as `'custom'`. The intent is for the installer-side UI to NOT render a "Forgot password?" link at all. This is appropriate for:

- B2B apps where password resets go through a customer success rep, not a self-serve flow.
- Internal tools where SSO is the only supported auth and the credentials provider is a break-glass admin-only path.
- Apps under a regulatory regime that forbids self-service reset (rare but real).

## Brand customization — `auth.passwordResetBrand`

Sets the default brand label used in the framework-mode email (subject, greeting, footer). Resolution order:

```ts
const resolvedBrand = brand ?? config.auth.passwordResetBrand ?? 'LuckyStack';
```

`'LuckyStack'` is the absolute fallback so a misconfigured project still produces a coherent email. In real deployments, set `auth.passwordResetBrand` in `config.ts` (or pass `brand` at the call site for per-tenant brands in a multi-tenant deployment).

## Hook flow

`passwordResetRequested` fires from `sendPasswordResetEmail` — for both matched and unmatched emails (anti-enumeration). Audit handlers MUST NOT differentiate UX between matched and unmatched. See [`./hooks.md`](./hooks.md) for the full payload shape.

`passwordResetCompleted` fires from the consumer-side completion endpoint AFTER the new password is written and `revokeUserSessions` runs. The package itself does NOT fire this hook — the bundled template does.

`passwordChanged` fires from the in-session change-password endpoint. Same — consumer-side dispatch, not framework-side. Carries `verifiedCurrent: boolean` to distinguish "user verified their old password" from "admin reset without verification".

## Config quick-reference

| Slot                                  | Used by                                                        |
| ------------------------------------- | -------------------------------------------------------------- |
| `auth.bcryptRounds`                   | `updatePasswordHash` (salt rounds for the new hash)            |
| `auth.passwordPolicy.minLength`       | `validatePassword` (lower bound)                               |
| `auth.passwordPolicy.maxLength`       | `validatePassword` (upper bound — anti-DoS on bcrypt)          |
| `auth.passwordPolicy.requireUppercase` | `validatePassword`                                            |
| `auth.passwordPolicy.requireLowercase` | `validatePassword`                                            |
| `auth.passwordPolicy.requireNumber`   | `validatePassword`                                             |
| `auth.passwordPolicy.requireSpecial`  | `validatePassword`                                             |
| `auth.passwordPolicy.forbidCommon`    | `validatePassword` (gate the common-passwords blocklist check) |
| `auth.passwordPolicy.customValidator` | `validatePassword` (final policy gate)                         |
| `auth.passwordResetTtlSeconds`        | `createPasswordResetToken` (Redis EX), `sendPasswordResetEmail` (TTL string in email body) |
| `auth.passwordResetBrand`             | `sendPasswordResetEmail` (fallback brand)                      |
| `auth.forgotPassword`                 | `sendPasswordResetEmail` (mode gate)                           |
| `app.publicUrl`                       | `sendPasswordResetEmail` (reset link host)                     |

## Why bcrypt and not argon2

bcrypt was picked because:

- It's been the industry standard for password hashing for two decades; bugs are well-known and patched.
- `bcryptjs` (the pure-JS port) works in serverless / edge runtimes where native modules are awkward.
- The cost factor (`bcryptRounds`) is tunable — set it higher on production behind sufficient CPU budget.

argon2 is theoretically stronger but the pure-JS implementation is slow and the native module is a deployment headache. If you have a strong opinion, you can register a custom `UserAdapter` whose `update` does an argon2 hash before storing — but you'd also need to swap `verifyPassword` and the credentials login path, which is more friction than the marginal security gain typically justifies.

If you DO want to upgrade, the recommended approach is "hash with argon2, store the result, and migrate users lazily on next login" — too disruptive to do in a one-shot rehash. Out of scope for this package.

## Related

- [`./credentials-auth.md`](./credentials-auth.md) — the login flow that uses `bcrypt.compare` against the same hash.
- [`./hooks.md`](./hooks.md) — `passwordResetRequested` / `passwordResetCompleted` / `passwordChanged` payload shapes.
- [`./user-adapter.md`](./user-adapter.md) — `updatePasswordHash` writes through `UserAdapter.update`.
- [`./session-management.md`](./session-management.md) — `revokeUserSessions` (recommended pairing).
- Architecture — email: [`/docs/ARCHITECTURE_EMAIL.md`](../../../docs/ARCHITECTURE_EMAIL.md).
- Architecture — auth: [`/docs/ARCHITECTURE_AUTH.md`](../../../docs/ARCHITECTURE_AUTH.md).
