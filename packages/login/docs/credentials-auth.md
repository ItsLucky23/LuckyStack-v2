# Credentials auth

Deep-dive on the email + password authentication flow exposed by `@luckystack/login`. This document covers the dispatcher contract, input normalization, validation, the underlying register / login functions, and the hooks fired along the way. All references point at the canonical implementation in [`./src/login.ts`](../src/login.ts).

---

## The two-in-one dispatcher

The HTTP `/auth/api/credentials` route — wired by `@luckystack/server` — calls a single entry point:

```ts
import { loginWithCredentials } from '@luckystack/login';

const result = await loginWithCredentials({
  email,
  password,
  name,            // present only when the client is registering
  confirmPassword, // present only when the client is registering
});
```

`loginWithCredentials` is a thin dispatcher. It inspects the shape of the body to decide whether the caller is logging in or registering:

```ts
if (creds.name && creds.confirmPassword) {
  return registerWithCredentials({ ... });
}
return loginWithCredentialsCore({ ... });
```

The rule is intentionally minimal: presence of both `name` and `confirmPassword` triggers the register branch; any other shape (just `email` + `password`) triggers the login branch. There is no `mode` parameter, no second route, and no separate URL — one POST handles both flows so the front-end can ship one form component.

When you wire a non-HTTP auth surface (CLI, custom socket event, an admin "impersonate" tool) and you already know which side you want, skip the dispatcher and call `loginWithCredentialsCore` or `registerWithCredentials` directly. The dispatcher is purely a convenience for the unified HTTP route.

## Signatures

```ts
// Dispatcher
const loginWithCredentials = async (params: {
  email?: string;
  password?: string;
  name?: string;
  confirmPassword?: string;
}) => Promise<
  | { status: true;  reason: string; newToken?: string; session: SessionLayout }
  | { status: false; reason: string }
>;

// Login-only entry point
const loginWithCredentialsCore = async (input: {
  email: string;
  password: string;
}) => Promise<
  | { status: true;  reason: 'login.loggedIn'; newToken: string; session: SessionLayout }
  | { status: false; reason: string }
>;

// Register-only entry point
const registerWithCredentials = async (input: {
  email: string;
  password: string;
  name: string;
  confirmPassword: string;
}) => Promise<
  | { status: true;  reason: 'login.userCreated'; session: SessionLayout }
  | { status: false; reason: string }
>;
```

`reason` is always an i18n key — the installer-side translator turns it into a human-readable message. Never render it raw. See [`docs/ARCHITECTURE_AUTH.md`](../../../docs/ARCHITECTURE_AUTH.md) for the full list of canonical reason keys.

## Input normalization

`normalizeCredentials(params)` runs first, producing a `NormalizedCredentials` object that the rest of the flow consumes. Each transformation exists for a specific reason:

| Field             | Transformation                              | Why                                                                                                                                       |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `email`           | `trim().toLowerCase()`                      | Case-insensitive lookup; trailing/leading whitespace stripped so a copy-paste from a chat client doesn't break the find.                  |
| `password`        | Left raw                                    | Bcrypt operates on bytes. The password never reaches HTML, JSON-as-HTML, or a SQL string interpolation, so HTML-escaping it is harmful.   |
| `name`            | `validator.escape(name)` when present       | The name IS surfaced to the UI as text. Pre-escape `<`, `>`, `&`, `"`, `'` to neutralize stored XSS in any consumer that renders it raw.  |
| `confirmPassword` | Left raw                                    | Must be byte-identical to `password` for the `password !== confirmPassword` equality check. Escaping only one half breaks special chars.  |

The "escape `confirmPassword` too" mistake is the subject of a long-standing comment in `normalizeCredentials` — that bug previously made any password containing `&`, `<`, `>`, `"`, or `'` fail registration silently. Don't reintroduce it.

## Shape validation

`validateCredentialsShape(creds)` is the next gate. It returns `{ status: false, reason }` on the first failure, or `null` when every check passes:

1. **Empty check** — `email` and `password` must both be non-empty. Reason: `login.empty`.
2. **Email length** — capped at `auth.emailMaxLength`. Reason: `login.emailCharacterLimit`.
3. **Name length** — only checked when `name` is present (register branch). Capped at `auth.nameMaxLength`. Reason: `login.nameCharacterLimit`.
4. **Email format** — `validator.isEmail(email)` after normalization. Reason: `login.invalidEmailFormat`.
5. **Password policy** — `validatePassword(password)` from [`./src/passwordPolicy.ts`](../src/passwordPolicy.ts). Returns a reason key (`login.passwordCharacterMinimum`, `login.passwordRequiresUppercase`, `login.passwordTooCommon`, etc.) or `null`.

Length limits live in `ProjectConfig.auth` and are resolved at call time, so consumers can override them through `registerProjectConfig` without restarting the framework.

## Register flow

`registerWithCredentials` is the canonical "new user" path:

1. **Confirm-password match** — `password !== confirmPassword` fails with `login.passwordNotMatch`.
2. **`preRegister` hook** — fires with `{ email, provider: 'credentials', name }`. A handler can return a `HookStopSignal` (`{ stop: true, errorCode: '...' }`) to abort; the signal's `errorCode` becomes the `reason`.
3. **Duplicate-email guard** — `userAdapter.findByEmail({ email, provider: 'credentials' })`. A match returns `login.emailExists`.
4. **Hash the password** — `bcrypt.genSalt(auth.bcryptRounds)` → `bcrypt.hash(plaintext, salt)`. The default `bcryptRounds` is 10; tighten it on production deployments behind a sufficient CPU budget.
5. **Create the user** — `userAdapter.create({...})` with the assembled record. `avatarFallback` is a random hex color so the avatar component has something to render until the user uploads an image.
6. **`postRegister` hook** — fires with `{ userId, provider: 'credentials' }`.
7. **Return** — `{ status: true, reason: 'login.userCreated', session: sanitizeUserForSession(user) }`.

Note that registration does NOT auto-login. The dispatcher returns the sanitized user record so the front-end can show a "welcome" screen, but `newToken` is undefined — the user follows the register response with an explicit login (or the front-end posts the same credentials through the login branch). Auto-login on register is something a consumer can layer on top by chaining the two calls.

## Login flow

`loginWithCredentialsCore` is the "existing user" path:

1. **`preLogin` hook** — fires with `{ email, provider: 'credentials' }`. Same stop-signal contract as `preRegister`.
2. **User lookup** — `userAdapter.findByEmail({ email, provider: 'credentials' })`. Missing user returns `login.userNotFound`.
3. **Password check** — `bcrypt.compare(plaintext, user.password)`. Mismatch returns `login.wrongPassword`. (We do not differentiate "no user" from "wrong password" in production — see [`docs/ARCHITECTURE_AUTH.md`](../../../docs/ARCHITECTURE_AUTH.md) for the anti-enumeration design. The two reason keys exist for dev-mode diagnostics only.)
4. **Mint token** — 32 random bytes, hex-encoded, 64 chars total.
5. **Best-effort `lastLogin` update** — `userAdapter.update(id, { lastLogin: new Date() })` wrapped in `tryCatch`. Silently no-ops if the column doesn't exist on the consumer's schema.
6. **Build the session** — `sanitizeUserForSession(user)` strips the password hash, then `token`, `lastLogin`, `previousLogin` are layered on. The avatar resolution step below is run before saving.
7. **Avatar resolution** — if `<uploadsDir>/<userId>.webp` exists, set `session.avatar = '<userId>.webp'`. The path is resolved at call time via `getUploadsDir()` so consumer overrides win.
8. **Save the session** — `saveSession(token, user, true)`. The `true` flag triggers `preSessionCreate` / `postSessionCreate`, runs single-session enforcement, mints a CSRF token, and broadcasts the new session over Socket.io.
9. **`postLogin` hook** — `{ userId, provider: 'credentials', isNewUser: false, token }`.
10. **Return** — `{ status: true, reason: 'login.loggedIn', newToken, session }`.

`isNewUser` is always `false` for credentials login. It exists in the payload because `loginCallback` (OAuth) shares the same `postLogin` hook and DOES distinguish first-time-vs-returning, and we want a single audit hook to handle both.

## Session sanitization

`sanitizeUserForSession<T extends { password?: unknown }>(user)` strips the `password` key via destructuring:

```ts
const sanitizeUserForSession = <T extends { password?: unknown }>(user: T): Omit<T, 'password'> => {
  const { password: _password, ...safeUser } = user;
  return safeUser;
};
```

The bcrypt hash should never leave the server. The session is broadcast to clients (`socketEventNames.updateSession`), so a `password` field on it would be a stored-credential leak. Every login path runs through this helper before `saveSession`.

## `lastLogin` and `previousLogin`

Both fields are surfaced on the session layout so the UI can show "Last signed in 3 days ago" without an extra round-trip:

- `previousLogin` — the value of `user.lastLogin` BEFORE we update it. Equals `null` for the very first login.
- `lastLogin` — the timestamp we just wrote.

Both are best-effort. The framework wraps the adapter update in `tryCatch` so older schemas missing the column won't break login. If your `User` model doesn't have a `lastLogin` column, the fields will be `undefined` on the session and the UI should treat them as optional.

## Reason-key reference (credentials only)

| Reason key                          | Meaning                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `login.empty`                       | Email or password was blank after normalization.                     |
| `login.invalidEmailFormat`          | `validator.isEmail` rejected the address.                            |
| `login.emailCharacterLimit`         | Email exceeded `auth.emailMaxLength`.                                |
| `login.nameCharacterLimit`          | Name exceeded `auth.nameMaxLength`.                                  |
| `login.passwordCharacterMinimum`    | Password shorter than `auth.passwordPolicy.minLength`.               |
| `login.passwordCharacterLimit`      | Password longer than `auth.passwordPolicy.maxLength`.                |
| `login.passwordRequiresUppercase`   | Policy requires `[A-Z]`.                                             |
| `login.passwordRequiresLowercase`   | Policy requires `[a-z]`.                                             |
| `login.passwordRequiresNumber`      | Policy requires `\d`.                                                |
| `login.passwordRequiresSpecial`     | Policy requires a non-alphanumeric character.                        |
| `login.passwordTooCommon`           | Plaintext appears in the bundled common-passwords blocklist.         |
| `login.passwordNotMatch`            | Register branch only — `password !== confirmPassword`.               |
| `login.emailExists`                 | Register branch — `findByEmail` returned an existing user.           |
| `login.createUserFailed`            | Adapter `create` resolved without throwing but returned falsy.       |
| `login.userNotFound`                | Login branch — no user for `{ email, provider: 'credentials' }`.     |
| `login.wrongPassword`               | Login branch — bcrypt compare returned false.                        |
| `login.loggedIn`                    | Success — login.                                                     |
| `login.userCreated`                 | Success — register.                                                  |
| `api.internalServerError`           | Adapter threw or another infrastructure error bubbled up.            |

Custom reason keys can be returned by `preLogin` / `preRegister` handlers via the stop-signal contract.

## When to call `loginWithCredentialsCore` / `registerWithCredentials` directly

The dispatcher only exists because the HTTP route is a single POST endpoint that wants one entry point. Prefer the direct functions whenever you control the call site:

- **Custom CLI** — `lucky user create --email ...` wires `registerWithCredentials` directly. No body-shape inspection needed.
- **Admin "create user" panel** — `registerWithCredentials` from the admin endpoint, gated by an admin guard.
- **Programmatic test setup** — your integration tests likely seed users via `registerWithCredentials` because they know the user doesn't exist yet.
- **Auto-login after register** — call `registerWithCredentials` then `loginWithCredentialsCore` in sequence.

The dispatcher is safe to use from anywhere — it just adds an unnecessary `if/else` when you already know the branch.

## Hook recipes

```ts
// Block unverified users
registerHook('preLogin', async ({ email, provider }) => {
  if (provider !== 'credentials') return;
  const user = await prisma.user.findFirst({ where: { email } });
  if (user && !user.verified) {
    return { stop: true, errorCode: 'login.notVerified' };
  }
});

// Notify on every new registration
registerHook('postRegister', async ({ userId, provider }) => {
  await sendInternalNotification(`new ${provider} user: ${userId}`);
});

// Defer creating ancillary records until after the user is created
registerHook('postRegister', async ({ userId }) => {
  await prisma.userPreferences.create({ data: { userId, theme: 'dark' } });
});
```

See [`./hooks.md`](./hooks.md) for the full hook reference and the stop-signal contract.

## Related

- [`./password-reset.md`](./password-reset.md) — forgot-password + in-session password change.
- [`./user-adapter.md`](./user-adapter.md) — replacing the Prisma-backed user store.
- [`./hooks.md`](./hooks.md) — `preLogin` / `postLogin` / `preRegister` / `postRegister` payload reference.
- [`./session-management.md`](./session-management.md) — what `saveSession(token, user, true)` does after a successful login.
- [`./oauth-providers.md`](./oauth-providers.md) — the OAuth alternative to credentials auth.
- Architecture: [`/docs/ARCHITECTURE_AUTH.md`](../../../docs/ARCHITECTURE_AUTH.md).
