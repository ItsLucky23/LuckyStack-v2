# @luckystack/login

> AI summary + function INDEX (referenced from root /CLAUDE.md as AI_INDEX.md). For deep specs see `docs/` next to this file.
> Defers to the repository root `/CLAUDE.md` for global rules (styling, no-emojis, SOLID, error handling, etc.). This file documents what `@luckystack/login` owns, how to extend it, and where to look first.

---

## What

`@luckystack/login` is the authentication layer of LuckyStack. It provides:

- **Credentials auth** (email + bcrypt-hashed password) with combined login/register dispatcher.
- **OAuth 2.0** via a pluggable provider registry. Built-in helpers for Google, GitHub, Discord, Facebook, Microsoft. Custom providers register as raw `OAuthProvider` objects.
- **Redis-backed sessions** with sliding expiration, CSRF token minting, single-session enforcement, and a swappable `SessionAdapter` (DynamoDB, Postgres, JWT-stateless, etc.).
- **Lifecycle hooks**: `preLogin` / `postLogin`, `preRegister` / `postRegister`, `preLogout` / `postLogout`, `preSessionCreate` / `postSessionCreate`, `preSessionDelete` / `postSessionDelete`, `passwordResetRequested`, `passwordResetCompleted`, `passwordChanged`. All `pre*` hooks support stop-signals (abort the side-effect with a reason key).
- **Pluggable user store** via `UserAdapter` — decouples auth from a specific Prisma `User` schema.
- **Password-reset primitives** (`createPasswordResetToken`, `consumePasswordResetToken`, `updatePasswordHash`, `verifyPassword`) plus the framework-mode `sendPasswordResetEmail` orchestrator (requires the optional `@luckystack/email` peer).
- **Dynamic post-login redirect** resolver registry (per-user / per-tenant / per-provider OAuth landing pages).

OAuth state is stored in Redis under `${projectName}-oauth-state:<provider>:<state>` with TTL `auth.oauthStateTtlSeconds`. Sessions live at `${projectName}-session:<token>`. Active-tokens-per-user set lives at `${projectName}-activeUsers:<userId>`. Password-reset tokens live at `${projectName}-pwreset:<token>`.

---

## When to USE

Reach for `@luckystack/login` when you need to:

- Add or change an authentication entry point (HTTP route, socket handler, CLI).
- Register or extend an OAuth provider (built-in or custom).
- Customize the User model the framework talks to (multi-tenant, soft-delete, alternative ORM).
- Plug in a non-Redis session store (DynamoDB, Postgres, signed-JWT).
- Hook into login / register / logout / session lifecycle for audit, 2FA, notifications, or feature-flagging.
- Implement password reset, password change, or a "sign out everywhere" flow.
- Compute the OAuth callback redirect dynamically.

## When NOT to use

Do NOT use this package for:

- **HTTP routing.** The `/auth/api/credentials` and `/auth/callback/<provider>` routes are wired by `@luckystack/server`. This package only exposes the handler functions.
- **Frontend session state.** The browser session lives in `src/_providers/SessionProvider.tsx` (installer side) — talks to the server via socket events.
- **Email rendering / SMTP.** That is `@luckystack/email`. This package only orchestrates the reset-email send.
- **Presence / online state.** That is `@luckystack/presence`. Login dispatches `postLogin` / `postLogout`; presence subscribes and manages disconnect timers itself.
- **API rate-limiting.** That lives in `@luckystack/api`. Login only calls the framework rate limiter for the credentials endpoint.
- **Storing arbitrary per-user data.** Only session-scoped runtime data (CSRF token, OAuth-provider extras via `extraSessionFields`) should live in the session. Persistent data goes on the user record via the registered `UserAdapter`.

---

## Function Index

### Credentials auth (`./src/login.ts`)

- `loginWithCredentials(params)` — Combined login/register dispatcher. Inspects body shape: when `name` and `confirmPassword` are present it registers; otherwise it logs in. Returns `{ status, reason, newToken?, session? }`. Used by the HTTP `/auth/api/credentials` route.
- `loginWithCredentialsCore({ email, password })` — Login-only entry point. Use when you wire a custom auth surface that bypasses the dispatcher's body-shape branching. Dispatches `preLogin` / `postLogin`.
- `registerWithCredentials({ email, password, name, confirmPassword })` — Register-only entry point. Dispatches `preRegister` / `postRegister`. Returns the freshly-created user (password-sanitized) on success.
- `loginCallback(pathname, req, res, options?)` — OAuth state-exchange handler. Validates `state`, exchanges `code` for an access token, fetches the user profile, finds-or-creates the user via the adapter, mints a session token, dispatches `postLogin` (+ `postRegister` for new users). Returns `{ token, redirectUrl, userId, provider, isNewUser }` or `false`. Wired to `/auth/callback/<provider>` by `@luckystack/server`.
- `createOAuthState(providerName)` — Issue a CSRF state token (Redis, `NX`, TTL from `auth.oauthStateTtlSeconds`). Returns the state string or `null` on collision.

### Logout (`./src/logout.ts`)

- `logout({ token, socket, userId, skipSessionDelete? })` — End a single socket's session. Dispatches `preLogout` (can abort), deletes the session (unless `skipSessionDelete: true`), removes the token from the active-users set, leaves the socket room, and emits `socketEventNames.logout` to the socket. Logs a warn-stacktrace on success so spurious logouts are traceable in production.

### Sessions (`./src/session.ts`)

- `saveSession(token, data, newUser?)` — Persist a session through the active `SessionAdapter`. Mints a CSRF token on first write. When `newUser === true`: dispatches `preSessionCreate` / `postSessionCreate`, runs single-session-enforcement (kicks older sessions per `session.perUser` / `maxConcurrentPerUser` / `onConflict`), and broadcasts `updateSession` to connected sockets in the token room.
- `getSession(token)` — Read a session through the active adapter. Implements sliding expiration: dispatches `preSessionRefresh` (can stop the TTL extend), calls `adapter.expire(...)`, dispatches `postSessionRefresh`.
- `deleteSession(token)` — Hard delete + clean up active-tokens set. Dispatches `preSessionDelete` (can abort) / `postSessionDelete`. Reuses `logout` for connected sockets to keep the disconnect flow consistent. Logs a warn-stacktrace so spurious deletes are traceable.
- `getAllSessions()` — Admin walk (uses `adapter.listAll()`; returns `[]` for non-scannable adapters with a warn-log).
- `revokeUserSessions(userId, exceptToken?)` — Force-logout every active session for a user, optionally keeping the caller's own token alive. Returns the count revoked.
- `sessionKeyFor(token)` / `activeUsersKeyFor(userId)` — Legacy key-builders for downstream code that reads Redis directly. Prefer the adapter for new code.

### Session adapter (`./src/sessionAdapter.ts`)

- `registerSessionAdapter(adapter)` — Swap out the storage backend (call once at boot, before the first login request).
- `getSessionAdapter()` — Read the active adapter (defaults to `redisSessionAdapter`).
- `redisSessionAdapter` — The default Redis-backed implementation. Re-registering it explicitly is equivalent to not registering anything.
- `SessionAdapter` (type) — Required surface: `getRaw`, `setRaw`, `delete`, `expire`, `ttl`, `trackActive`, `untrackActive`, `listActive`. Optional: `listAll`.

### OAuth providers (`./src/oauthProviders.ts`)

- `registerOAuthProviders(providers)` — Replace the active provider list. Default list contains only `{ name: 'credentials' }`.
- `getOAuthProviders()` — Read the active list.
- `isFullOAuthProvider(provider)` — Type guard separating credentials from full OAuth.
- `asOAuthUserData(value)` — Safe cast helper used inside provider `getAvatar` / `extraSessionFields` callbacks.
- `credentialsProvider()` — Returns `{ name: 'credentials' }`. Register this entry to enable the credentials endpoint.
- `googleProvider(input)` / `githubProvider(input)` / `discordProvider(input)` / `facebookProvider(input)` / `microsoftProvider(input)` — Built-in factories. Each takes `{ clientId, clientSecret, callbackUrl, endpoints?, extraScopes?, extraSessionFields? }`. `facebookProvider` also accepts `apiVersion`; `microsoftProvider` also accepts `tenant`, `apiVersion`, `graphApiVersion`.

### User adapter (`./src/userAdapter.ts`)

- `registerUserAdapter(adapter)` — Plug in your own user store.
- `getUserAdapter()` — Read the active adapter; falls back to `defaultPrismaUserAdapter()` lazily on first call.
- `isUserAdapterRegistered()` — `true` iff a custom adapter was registered.
- `defaultPrismaUserAdapter()` — The framework default. Talks to `prisma.user` with the documented schema (`id`, `email`, `password?`, `provider`, `name`, `avatar`, `avatarFallback`, `language`).
- `UserAdapter` / `UserAdapterCreateInput` / `UserRecord` (types) — Implement these to bind auth flows to a different table.

### Post-login redirect (`./src/redirectResolver.ts`)

- `registerPostLoginRedirect(resolver)` — Register a `({ userId, provider, isNewUser, defaultUrl }) => string | Promise<string>` resolver.
- `getPostLoginRedirect()` — Read the active resolver (or `null`).
- The resolver's returned URL is validated against `http.cors.allowedOrigins` before use; invalid URLs fall back to `defaultUrl`.

### Password reset (`./src/passwordReset.ts`, `./src/forgotPassword.ts`, `./src/passwordPolicy.ts`)

- `createPasswordResetToken(userId)` — Mint a 64-char hex token, store under `${projectName}-pwreset:<token>` with `auth.passwordResetTtlSeconds`.
- `consumePasswordResetToken(token)` — One-time-use redemption. Returns the bound `userId` or `null`.
- `updatePasswordHash(userId, plaintext)` — Validate against the active password policy, bcrypt-hash, write via `getUserAdapter().update`. Throws `PasswordPolicyError` on policy violation.
- `verifyPassword(plaintext, hash)` — Bcrypt comparison helper.
- `PasswordPolicyError` — Thrown by `updatePasswordHash`; carries `errorCode` matching the i18n reason keys used by the rest of the login flow.
- `validatePassword(plaintext)` — Returns `null` when the policy passes, or a reason key when it fails (length, complexity, common-list, custom validator).
- `sendPasswordResetEmail({ email, brand? })` — Framework-mode orchestrator. Looks up the user (credentials provider only), mints a token, lazy-imports `@luckystack/email`, and sends a transactional reset email. Always resolves "ok" when the email is not found (anti-enumeration). No-op when `auth.forgotPassword !== 'framework'`.

### Hook payloads (`./src/hookPayloads.ts`)

Type-only module that augments `@luckystack/core`'s `HookPayloads` interface. Exported payload types: `PreLoginPayload`, `PostLoginPayload`, `PreRegisterPayload`, `PostRegisterPayload`, `PreLogoutPayload`, `PostLogoutPayload`, `PreSessionCreatePayload`, `PostSessionCreatePayload`, `PreSessionDeletePayload`, `PostSessionDeletePayload`, `PasswordResetRequestedPayload`, `PasswordResetCompletedPayload`, `PasswordChangedPayload`.

---

## Config keys

All config keys live on `ProjectConfig` (from `@luckystack/core`). Resolved at call time via `getProjectConfig()` — no module-load capture.

### Env-driven (read by the installer / consumer, surfaced through `registerProjectConfig`)

| Env var | Used by | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `googleProvider` | OAuth app credentials. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | `githubProvider` | OAuth app credentials. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | `discordProvider` | OAuth app credentials. |
| `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` | `facebookProvider` | OAuth app credentials. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | `microsoftProvider` | OAuth app credentials. |
| `MICROSOFT_TENANT_ID` | `microsoftProvider` (optional) | Single-tenant Azure AD. Defaults to `'common'`. |
| `DNS` | All OAuth `callbackUrl` builders | Base URL prepended to `/auth/callback/<provider>`. |
| `BCRYPT_ROUNDS` | `auth.bcryptRounds` | Surfaced through project config; salt rounds for credentials hashing. |

> Env-key set without the matching package installed = hard boot crash (see peer-dep guard policy). `@luckystack/email` is the optional case — login lazy-imports it and gracefully fails when `forgotPassword !== 'framework'`.

### `ProjectConfig` slots consumed

| Slot | Used by | Notes |
| --- | --- | --- |
| `session.expiryDays` | `getSessionTtl` in `session.ts` | TTL multiplier (days → seconds). |
| `session.perUser` (`'single' \| 'multiple'`) | `saveSession` | Enforcement mode. Legacy `allowMultiple: false` collapses to `'single'`. |
| `session.maxConcurrentPerUser` | `saveSession` | Cap when `perUser === 'multiple'`. `null` = unlimited. |
| `session.onConflict` (`'revokeOld' \| 'rejectNew'`) | `saveSession` | What to do when cap is reached. `rejectNew` is enforced at the API layer; `revokeOld` kicks the oldest. |
| `session.basedToken` | `saveSession` | Inverted into `persistent` for `preSessionCreate` / `postSessionCreate` payloads. |
| `session.notifyOldDeviceOnRevoke` | `saveSession` | Emits `socketEventNames.sessionReplaced` to the kicked socket before disconnect. |
| `auth.bcryptRounds` | Register, password change/reset | Bcrypt salt-rounds value. |
| `auth.emailMaxLength` / `auth.nameMaxLength` | `validateCredentialsShape` | Reject oversized inputs. |
| `auth.passwordPolicy.*` | `validatePassword` | minLength, maxLength, requireUppercase, requireDigit, requireSpecial, common-list, customValidator. |
| `auth.oauthStateTtlSeconds` | `createOAuthState` | TTL for the Redis state token. |
| `auth.passwordResetTtlSeconds` | `createPasswordResetToken` / `sendPasswordResetEmail` | Reset-token TTL. |
| `auth.passwordResetBrand` | `sendPasswordResetEmail` | Fallback brand label when call site omits `brand`. |
| `auth.forgotPassword` (`'framework' \| 'custom' \| 'disabled'`) | `sendPasswordResetEmail` | Gates the framework-mode email flow. |
| `http.cors.allowedOrigins` | `isAllowedRedirectUrl` | Whitelist for `loginCallback` redirect validation. Accepts `string[]` or `(origin) => boolean`. |
| `loginRedirectUrl` | `loginCallback` | Default post-login URL when no per-call override and no resolver match. |
| `logging.devLogs` | Login flow | Gates debug-level diagnostic logs. |
| `defaultLanguage` | Register paths | Initial `language` column for new users. |
| `app.publicUrl` | `sendPasswordResetEmail` | Used to build the reset link host. |

---

## Peer deps

| Package | Status | Notes |
| --- | --- | --- |
| `@luckystack/core` | hard runtime dep (`dependencies`) | Source of `redis`, `prisma`, `tryCatch`, `dispatchHook`, `getProjectConfig`, `getProjectName`, `getLogger`, `getIoInstance`, `getUploadsDir`, `socketEventNames`, `BaseSessionLayout`. |
| `bcryptjs` | hard runtime dep | Password hashing + comparison. |
| `validator` | hard runtime dep | Email validation + name escaping. |
| `dotenv` | hard runtime dep | Env loading at boot. |
| `@prisma/client` | **required peer** | Default `UserAdapter` talks to `prisma.user`. Register a custom `UserAdapter` if you cannot ship Prisma. |
| `socket.io` | **required peer** | `logout` and session enforcement broadcast through the live `io` instance from `getIoInstance()`. |
| `@luckystack/email` | **optional peer** | Only required when `auth.forgotPassword === 'framework'`. Lazy-imported by `sendPasswordResetEmail` — every other API works without it. |

---

## Related links

- Repo root contract: [`/.claude/CLAUDE.md`](../../.claude/CLAUDE.md)
- Package README: [`./README.md`](./README.md)
- Architecture — auth lifecycle: [`/docs/ARCHITECTURE_AUTH.md`](../../docs/ARCHITECTURE_AUTH.md)
- Architecture — sessions (Redis layout, sliding expiration, single-session enforcement): [`/docs/ARCHITECTURE_SESSION.md`](../../docs/ARCHITECTURE_SESSION.md)
- Architecture — email (forgot-password modes, lazy-import pattern): [`/docs/ARCHITECTURE_EMAIL.md`](../../docs/ARCHITECTURE_EMAIL.md)
- Architecture — packaging strategy: [`/docs/ARCHITECTURE_PACKAGING.md`](../../docs/ARCHITECTURE_PACKAGING.md)
- Per-topic stubs (deeper how-tos): [`./docs/`](./docs/)
