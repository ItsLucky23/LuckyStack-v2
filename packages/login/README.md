# @luckystack/login

> Authentication for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). Credentials + OAuth (Google, GitHub, Facebook, Discord, Microsoft), Redis-backed sessions, single-session enforcement, and lifecycle hooks (`preLogin`, `preRegister`, `preLogout`, `preSessionCreate`, `preSessionDelete` and their `post*` counterparts).

## Install

```bash
npm install @luckystack/login @luckystack/core @prisma/client socket.io
```

## Quickstart

```ts
import { loginWithCredentials, getSession, logout } from '@luckystack/login';
import { registerHook } from '@luckystack/core';

// Block login for unverified users:
registerHook('preLogin', async ({ email }) => {
  const user = await prisma.user.findFirst({ where: { email } });
  if (user && !user.verified) {
    return { stop: true, errorCode: 'login.notVerified' };
  }
});

// Inside an /auth route handler:
const result = await loginWithCredentials({ email, password });
// → { status: true, reason, newToken, session } on success
// → { status: false, reason } on failure (including hook-stop with the hook's errorCode)
```

Sessions are stored in Redis under `${PROJECT_NAME}-session:<token>` and are sliding (every authenticated read extends the TTL by `ProjectConfig.session.expiryDays`).

## Hooks

`pre*` hooks fire before the side-effect and may return a `HookStopSignal` to abort. `post*` hooks fire after success. Payload types live in `./hookPayloads.ts` and are merged into `@luckystack/core`'s `HookPayloads` via module augmentation.

| Hook | Aborts | Fires from |
| --- | --- | --- |
| `preLogin` / `postLogin` | yes | `loginWithCredentials`, `loginCallback` |
| `preRegister` / `postRegister` | yes | `loginWithCredentials` (register branch), `loginCallback` (new OAuth user) |
| `preLogout` / `postLogout` | yes | `logout` |
| `preSessionCreate` / `postSessionCreate` | yes | `saveSession({ newUser: true })` |
| `preSessionDelete` / `postSessionDelete` | yes | `deleteSession` |

## OAuth provider registry

```ts
import {
  registerOAuthProviders,
  googleProvider,
  githubProvider,
  credentialsProvider,
} from '@luckystack/login';

registerOAuthProviders([
  credentialsProvider(),
  googleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: `http://localhost:80/auth/callback/google`,
  }),
  githubProvider({
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackUrl: `http://localhost:80/auth/callback/github`,
  }),
]);
```

Built-in helpers: `googleProvider`, `githubProvider`, `discordProvider`, `facebookProvider`, `microsoftProvider`, `credentialsProvider`. Each non-credentials helper takes `{ clientId, clientSecret, callbackUrl }` and returns a fully-typed `FullOAuthProvider` with the provider's authorize/token/userinfo URLs and standard scopes prefilled. Pass anything that satisfies the `OAuthProvider` interface to register custom providers — see [`packages/login/src/oauthProviders.ts`](./src/oauthProviders.ts) for the canonical shape.

### Provider options

Every helper accepts the base shape plus optional overrides for self-hosted instances and provider-specific tunables.

| Option | Applies to | Default | When to override |
| --- | --- | --- | --- |
| `clientId` | all | — | Required. The OAuth app's client identifier. |
| `clientSecret` | all | — | Required. The OAuth app's client secret. |
| `callbackUrl` | all | — | Required. Must match the URL registered with the provider — your BACKEND origin + `/auth/callback/<name>` (dev `http://localhost:80/auth/callback/<name>`, prod `https://your-domain.com/auth/callback/<name>`). |
| `endpoints?.authorizationURL` | all | provider-default | GitHub Enterprise host, Microsoft custom-tenant authorize URL, internal auth proxy, etc. |
| `endpoints?.tokenExchangeURL` | all | provider-default | Same use cases as `authorizationURL`. |
| `endpoints?.userInfoURL` | all | provider-default | Self-hosted GitHub Enterprise / Microsoft Graph mirror, etc. |
| `apiVersion?` | `facebookProvider`, `microsoftProvider` | facebook: `v18.0`, microsoft: `v2.0` | Pin to a known-good Graph API version when the upstream rolls out breaking changes. |
| `tenant?` | `microsoftProvider` | `'common'` | Restrict logins to a specific Azure AD tenant ID. Use a UUID or `'organizations'` / `'consumers'`. |
| `graphApiVersion?` | `microsoftProvider` | `'v1.0'` | Pin the Microsoft Graph version used to fetch the user profile (separate from the OAuth `apiVersion`). |

Example — self-hosted GitHub Enterprise:

```ts
githubProvider({
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackUrl: `http://localhost:80/auth/callback/github`,
  endpoints: {
    authorizationURL: 'https://github.acme.example/login/oauth/authorize',
    tokenExchangeURL: 'https://github.acme.example/login/oauth/access_token',
    userInfoURL: 'https://github.acme.example/api/v3/user',
  },
});
```

Example — single-tenant Microsoft Entra ID:

```ts
microsoftProvider({
  clientId: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  callbackUrl: `http://localhost:80/auth/callback/microsoft`,
  tenant: process.env.MICROSOFT_TENANT_ID, // 'common' for any tenant; UUID for a single tenant.
  apiVersion: 'v2.0',                       // OAuth endpoint version
  graphApiVersion: 'v1.0',                  // Graph endpoint version
});
```

## User adapter

By default the package reads / writes the Prisma `User` model directly. To bind auth flows to a different table (multi-tenant, alternative ORM, soft-deleted users, etc.), register your own `UserAdapter`:

```ts
import { registerUserAdapter, defaultPrismaUserAdapter } from '@luckystack/login';

registerUserAdapter({
  ...defaultPrismaUserAdapter,
  findByEmail: async (email) => {
    const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
    return user;
  },
});
```

## Account strategy: per-provider vs unified

`auth.providerAccountStrategy` (in `registerProjectConfig`) controls how the same email address is treated across sign-in providers:

| Strategy | Behavior | Schema |
|---|---|---|
| `'per-provider'` (default) | `sam@x.com` via Google and via GitHub are **two separate `User` rows**. Lookups are scoped to `(email, provider)`. | `@@unique([email, provider])` recommended. |
| `'unified'` | `sam@x.com` maps to **one `User` row**; signing in via a new provider links to the existing account (credentials login, OAuth find-or-create, and register dedupe all resolve by email alone). | `email` must be `@unique`. |

```ts
registerProjectConfig({ auth: { providerAccountStrategy: 'unified' } });
```

**Migrating an existing project to `'unified'`** (the strategy reads accounts by email irrespective of provider, so the DB must enforce one row per email):

1. **Dedupe existing rows.** If you previously ran `'per-provider'`, the same email may already exist under multiple providers. Merge or remove duplicates so each email appears once. (Pick the row to keep — usually the credentials account or the earliest — repoint related rows, delete the rest.)
2. **Make `email` unique** in `prisma/schema.prisma`:
   ```prisma
   model User {
     // ...
     email    String  @unique   // was: email String  (+ optional @@unique([email, provider]))
     provider String              // now records the ORIGINAL signup provider only
   }
   ```
   Then `prisma migrate` (or `db push`). The DB constraint closes the registration race that the application-level check alone cannot.
3. **No code change is required** beyond the config flag — the default `UserAdapter` already implements `findByEmailAnyProvider`. A **custom** `UserAdapter` must add `findByEmailAnyProvider({ email })` (resolve by email, ignoring provider); if it doesn't, the framework logs a one-time warning and falls back to provider-scoped lookup so the misconfiguration is visible rather than silent.

## Post-login redirect

Compute the OAuth callback destination dynamically (per-user, per-tenant, per-provider):

```ts
import { registerPostLoginRedirect } from '@luckystack/login';

registerPostLoginRedirect(async ({ user, provider }) => {
  if (user.organizationId) return `/org/${user.organizationId}`;
  return '/welcome';
});
```

## Password reset primitives

Used by the `forgotPassword: 'framework'` mode and exported for `'custom'` consumers who want to drive their own flow:

```ts
import {
  createPasswordResetToken,
  consumePasswordResetToken,
  updatePasswordHash,
  verifyPassword,
  sendPasswordResetEmail, // requires @luckystack/email registered
} from '@luckystack/login';
```

`sendPasswordResetEmail` is a no-op when `@luckystack/email` has not been registered, so you can keep the import unconditionally.

## Public API

| Export | Purpose |
| --- | --- |
| `loginWithCredentials(params)` | Combined login/register dispatcher. Routes to `register*` or `login*` based on the body shape (presence of `confirmPassword`). Used by the HTTP `/auth/api/credentials` route. |
| `registerWithCredentials({ email, password, name, confirmPassword })` | Register-only entry point. Use this when you wire a custom auth surface that bypasses the dispatcher's body-shape branching. |
| `loginWithCredentialsCore({ email, password })` | Login-only entry point. Same idea as `registerWithCredentials`. |
| `loginCallback(pathname, req, res)` | OAuth state-exchange handler — wired to `/auth/callback/<provider>` by `@luckystack/server`. |
| `createOAuthState(providerName)` | Issue a CSRF state token (Redis, NX, TTL from project config). |
| `logout({ token, socket, userId })` | End a single socket's session. |
| `saveSession(token, user, newUser?)` | Write to Redis + broadcast to existing connections. |
| `getSession(token)` | Read + slide expiration. Dispatches `preSessionRefresh` / `postSessionRefresh` around the Redis EXPIRE call. |
| `deleteSession(token)` | Hard delete + clean up active-tokens set. |
| `getAllSessions()` | Admin utility — scans all sessions. |
| `revokeUserSessions(userId)` | Force-logout every active session for a user. |
| `sessionKeyFor(token)` / `activeUsersKeyFor(userId)` | Centralized Redis-key builders (`{projectName}-session:{token}` / `{projectName}-activeUsers:{userId}`). Use these when you read or scan session data from outside `@luckystack/login` so the key shape stays in lockstep. |
| `registerOAuthProviders(list)` / `getOAuthProviders()` / `isFullOAuthProvider(p)` | OAuth registry. |
| `googleProvider`, `githubProvider`, `discordProvider`, `facebookProvider`, `microsoftProvider`, `credentialsProvider` | Built-in provider factories. |
| `registerUserAdapter(adapter)` / `getUserAdapter()` / `isUserAdapterRegistered()` / `defaultPrismaUserAdapter` | Pluggable user store. |
| `registerPostLoginRedirect(resolver)` / `getPostLoginRedirect()` | Dynamic redirect resolution. |
| `createPasswordResetToken`, `consumePasswordResetToken`, `updatePasswordHash`, `verifyPassword`, `sendPasswordResetEmail` | Password-reset primitives. |

Types: `BaseSessionLayout`, `SessionLocation`, `AuthProps` (re-exported from `@luckystack/core`); `OAuthProvider`, `CredentialsProvider`, `FullOAuthProvider`, `UserAdapter`, `UserAdapterCreateInput`, `UserRecord`, `PostLoginRedirectResolver`, `PostLoginRedirectInput`, plus all `Pre*Payload` / `Post*Payload` types.

## Stored-XSS warning: OAuth `name` fields

`loginCallback` reads the user's display name straight from the OAuth provider's profile response and stores it on the `User.name` column unsanitized. That is fine for plain text rendering and for the framework's avatar-fallback initials, but **becomes stored XSS the moment a consumer renders the name as raw HTML** (e.g. `dangerouslySetInnerHTML`, an HTML email body, a server-rendered widget). Two recommended mitigations on the consumer side:

- Render names with React text nodes (the default; safe).
- Strip or escape any `<` / `>` characters before injecting names into HTML emails or non-React surfaces.

If your project has no such surfaces this is informational. The framework intentionally does not silently mutate the field because some apps need exact-match search across providers.

## Related architecture docs

- [`docs/ARCHITECTURE_AUTH.md`](../../docs/ARCHITECTURE_AUTH.md) — OAuth + credentials lifecycle, allowed-origin checks, role guards.
- [`docs/ARCHITECTURE_SESSION.md`](../../docs/ARCHITECTURE_SESSION.md) — Redis layout, sliding expiration, single-session enforcement.
- [`docs/ARCHITECTURE_EMAIL.md`](../../docs/ARCHITECTURE_EMAIL.md) — forgot-password modes (`framework` / `custom` / `disabled`).

## Dependencies

- Runtime: `@luckystack/core`, `bcryptjs`, `validator`, `dotenv`
- Peer (canonical ranges, standardized 2026-05-07):
  - `@prisma/client@^6.19.0`
  - `socket.io@^4.8.0`
- Optional peer: `@luckystack/email` — only required when `forgotPassword: 'framework'`. The package lazy-imports it; without it, the framework-mode flow is disabled but every other API works.

Your Prisma schema must include a `User` model with at least: `id`, `email`, `provider` (enum `PROVIDERS`), `password` (nullable), `name`, `avatar`, `avatarFallback`, `admin`, `language`. See [`prisma/schema.prisma`](../../prisma/schema.prisma) for the canonical shape, or register a `UserAdapter` to talk to a different schema.

## License

MIT — see [LICENSE](../../LICENSE).
