# OAuth providers

Deep-dive on the OAuth provider registry, built-in helpers, and the contract for plugging in custom providers. The canonical source is [`./src/oauthProviders.ts`](../src/oauthProviders.ts).

`@luckystack/login` ships an OAuth 2.0 authorization-code flow with PKCE-equivalent state validation. Built-in helpers cover Google, GitHub, Discord, Facebook, and Microsoft. Anything else (Okta, Apple, X / Twitter, Auth0, Keycloak, custom enterprise SSO, self-hosted Gitea) plugs in as a raw `FullOAuthProvider` object.

---

## The registry

The active provider list is stored in a module-level variable in `oauthProviders.ts`:

```ts
let registeredProviders: OAuthProvider[] = [{ name: 'credentials' }];

export const registerOAuthProviders = (providers: OAuthProvider[]): OAuthProvider[] => {
  registeredProviders = providers;
  return registeredProviders;
};

export const getOAuthProviders = (): OAuthProvider[] => registeredProviders;
```

`registerOAuthProviders([...])` **replaces** the active list — it is not additive. The default list contains only `{ name: 'credentials' }`, which means in a fresh project with no registration call:

- `loginWithCredentials` keeps working (the `'credentials'` entry is still present).
- Every `/auth/callback/<provider>` request returns `false` because no matching provider is in the list.

Register at boot, before the first login request:

```ts
// luckystack/server/index.ts (installer side)
import {
  registerOAuthProviders,
  credentialsProvider,
  googleProvider,
  githubProvider,
} from '@luckystack/login';

registerOAuthProviders([
  credentialsProvider(),
  googleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: `${process.env.DNS}/auth/callback/google`,
  }),
  githubProvider({
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackUrl: `${process.env.DNS}/auth/callback/github`,
  }),
]);
```

If you omit `credentialsProvider()`, the credentials endpoint will reject all requests because the dispatcher looks the provider up by name.

## CSRF state — `createOAuthState`

OAuth 2.0 requires a `state` parameter on the `/authorize` request that the provider echoes back to the callback. `@luckystack/login` issues this state from Redis:

```ts
export const createOAuthState = async (providerName: string): Promise<string | null> => {
  const state = randomBytes(32).toString('hex');
  const key = `${getProjectName()}-oauth-state:${providerName}:${state}`;
  const result = await redis.set(key, '1', 'EX', auth.oauthStateTtlSeconds, 'NX');
  if (result !== 'OK') return null;
  return state;
};
```

Key points:

- 32 random bytes → 64-char hex.
- Key namespace: `${projectName}-oauth-state:<provider>:<state>`. Uses the shared `getProjectName()` helper so the namespace matches sessions / activeUsers / rate-limit / password-reset (no drift between keys).
- TTL: `auth.oauthStateTtlSeconds` (default 600 = 10 minutes).
- `NX` flag prevents collisions — if a random collision happened (astronomically unlikely with 256 bits of entropy), the function returns `null` and the caller retries.

The state is consumed atomically inside `loginCallback`:

```ts
const consumeOAuthState = async (provider, state) => {
  const txResult = await redis.multi().get(key).del(key).exec();
  // ...returns true iff the GET returned '1'.
};
```

This is a one-time-use redemption — replaying the same `state` on a second callback fails. Combined with the short TTL it defeats both CSRF and replay attacks on the callback.

## `OAuthProvider` discriminated union

```ts
export type OAuthProvider = CredentialsProvider | FullOAuthProvider;

export interface CredentialsProvider {
  name: 'credentials';
}

export interface FullOAuthProvider {
  name: string;
  clientID: string;
  clientSecret: string;
  callbackURL: string;
  authorizationURL: string;
  tokenExchangeURL: string;
  tokenExchangeMethod: 'json' | 'form';
  userInfoURL: string;
  scope: string[];
  nameKey: string;
  emailKey: string;
  avatarKey?: string;
  avatarCodeKey: string;
  getEmail?: (accessToken: string) => Promise<string | false | undefined>;
  getAvatar?: (params: {
    userData: OAuthUserData;
    avatarId?: string;
    accessToken: string;
  }) => string | undefined | Promise<string | undefined>;
  extraSessionFields?: (params: {
    userData: OAuthUserData;
    accessToken: string;
  }) => Promise<Record<string, unknown>> | Record<string, unknown>;
}
```

`isFullOAuthProvider(provider)` is the type guard that separates the two branches:

```ts
export const isFullOAuthProvider = (provider: OAuthProvider): provider is FullOAuthProvider =>
  provider.name !== 'credentials';
```

`loginCallback` calls this guard first and bails when the lookup resolves to `{ name: 'credentials' }` — that entry exists only to keep the credentials endpoint enabled in the same list.

### Field reference

| Field                 | Purpose                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `name`                | URL slug used in `/auth/callback/<name>` and stored on `User.provider`.                                   |
| `clientID`            | OAuth app client id.                                                                                      |
| `clientSecret`        | OAuth app secret.                                                                                         |
| `callbackURL`         | Must match the URL registered with the provider, normally `${DNS}/auth/callback/<name>`.                  |
| `authorizationURL`    | Where to redirect the user to authorize (start of the flow).                                              |
| `tokenExchangeURL`    | POST endpoint for exchanging `code` → `access_token`.                                                     |
| `tokenExchangeMethod` | `'json'` (Google) or `'form'` (Discord, Facebook, Microsoft). GitHub accepts either; we use `'json'`.     |
| `userInfoURL`         | GET endpoint that returns the user profile JSON given a bearer token.                                     |
| `scope`               | Array of scopes requested at authorize-time. Joined with spaces by the consumer-side `/auth/login` route. |
| `nameKey`             | Top-level key in the userinfo response that holds the display name (`'name'` / `'login'` / etc.).         |
| `emailKey`            | Top-level key in the userinfo response that holds the email.                                              |
| `avatarKey`           | Direct-URL variant — `userData[avatarKey]` IS the avatar URL.                                             |
| `avatarCodeKey`       | Compose-URL variant — `userData[avatarCodeKey]` is an id that `getAvatar` turns into a URL.               |
| `getEmail`            | Optional fallback when `userData[emailKey]` is missing (GitHub `/user/emails`).                           |
| `getAvatar`           | Optional resolver for `avatarCodeKey` providers (Discord, Microsoft).                                     |
| `extraSessionFields`  | Optional hook that returns a record to merge onto the session BEFORE `saveSession`.                       |

`OAuthUserData = Record<string, unknown>` is the framework's representation of the userinfo response. `asOAuthUserData(value)` is a safe cast helper for use inside `getAvatar` / `extraSessionFields` callbacks:

```ts
export const asOAuthUserData = (value: unknown): OAuthUserData => {
  if (value && typeof value === 'object') {
    return value as OAuthUserData;
  }
  return {};
};
```

## `OAuthHelperInput` — the common factory input

Every built-in factory accepts the same base shape with optional override slots:

```ts
interface OAuthHelperInput {
  clientId: string | undefined;
  clientSecret: string | undefined;
  callbackUrl: string;
  endpoints?: {
    authorizationURL?: string;
    tokenExchangeURL?: string;
    userInfoURL?: string;
  };
  extraScopes?: string[];
  extraSessionFields?: FullOAuthProvider['extraSessionFields'];
}
```

Why each slot exists:

- **`endpoints?.*`** — Self-hosted GitHub Enterprise, single-tenant Azure with a custom hostname, internal auth proxies. The defaults match the public hosted services; overrides give you the same provider shape pointed at a different host.
- **`extraScopes`** — Add to (not replace) the default scopes. Use for "give me read access to the user's calendar / drive / repos" flows. Merged via `mergeScopes` with `Set`-based deduplication so passing a default scope is idempotent.
- **`extraSessionFields`** — Per-provider runtime extras (calendar tokens, tenant IDs, organization claims) merged into the session BEFORE the first `saveSession`.

`clientId` / `clientSecret` are typed as `string | undefined` because the most common call site is `process.env.X_CLIENT_ID`. Each factory calls `requireString(value, label)` and throws a descriptive `Error` at register time if either is empty. That error surfaces at boot, so a missing OAuth env var fails the server before the first request.

## Built-in factories

### `credentialsProvider()`

```ts
credentialsProvider(): CredentialsProvider // { name: 'credentials' }
```

The "no-OAuth" entry. Include it in your `registerOAuthProviders` call when you want the credentials endpoint active alongside the OAuth providers.

### `googleProvider(input)`

```ts
googleProvider({
  clientId, clientSecret, callbackUrl,
  endpoints?, extraScopes?, extraSessionFields?,
});
```

Defaults:

| Field                 | Value                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| `name`                | `'google'`                                                             |
| `authorizationURL`    | `'https://accounts.google.com/o/oauth2/v2/auth'`                       |
| `tokenExchangeURL`    | `'https://oauth2.googleapis.com/token'`                                |
| `tokenExchangeMethod` | `'json'`                                                               |
| `userInfoURL`         | `'https://www.googleapis.com/oauth2/v1/userinfo'`                      |
| `scope`               | `['userinfo.profile', 'userinfo.email']` (full URLs in the source)     |
| `nameKey`             | `'name'`                                                               |
| `emailKey`            | `'email'`                                                              |
| `avatarKey`           | `'picture'` (direct URL)                                               |

### `githubProvider(input)`

| Field                 | Value                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `name`                | `'github'`                                                                                     |
| `authorizationURL`    | `'https://github.com/login/oauth/authorize'`                                                   |
| `tokenExchangeURL`    | `'https://github.com/login/oauth/access_token'`                                                |
| `tokenExchangeMethod` | `'json'`                                                                                       |
| `userInfoURL`         | `'https://api.github.com/user'`                                                                |
| `scope`               | `['read:user', 'user:email']`                                                                  |
| `nameKey`             | `'login'` (GitHub username — `name` can be null for users who never set one)                   |
| `emailKey`            | `'email'`                                                                                      |
| `avatarKey`           | `'avatar_url'`                                                                                 |
| `getEmail`            | Falls back to `GET /user/emails` and picks the entry with `primary: true`, then the first one. |

GitHub returns `email: null` from `/user` when the user has hidden their email from their profile. `getEmail` fetches `/user/emails` (which requires the `user:email` scope) and selects an address.

### `discordProvider(input)`

| Field                 | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| `name`                | `'discord'`                                                        |
| `authorizationURL`    | `'https://discord.com/oauth2/authorize'`                           |
| `tokenExchangeURL`    | `'https://discord.com/api/oauth2/token'`                           |
| `tokenExchangeMethod` | `'form'`                                                           |
| `userInfoURL`         | `'https://discord.com/api/users/@me'`                              |
| `scope`               | `['identify', 'email']`                                            |
| `nameKey`             | `'username'`                                                       |
| `emailKey`            | `'email'`                                                          |
| `avatarCodeKey`       | `'avatar'` (a hash, not a URL)                                     |
| `getAvatar`           | Builds `cdn.discordapp.com/avatars/<userId>/<hash>.{png,gif}`.     |

`getAvatar` picks `.gif` when the hash starts with `a_` (animated avatars).

### `facebookProvider(input)`

```ts
interface FacebookProviderInput extends OAuthHelperInput {
  apiVersion?: string; // defaults to 'v18.0'
}
```

| Field                 | Value                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `name`                | `'facebook'`                                                                             |
| `authorizationURL`    | `https://www.facebook.com/${apiVersion}/dialog/oauth`                                    |
| `tokenExchangeURL`    | `https://graph.facebook.com/${apiVersion}/oauth/access_token`                            |
| `tokenExchangeMethod` | `'form'`                                                                                 |
| `userInfoURL`         | `'https://graph.facebook.com/me?fields=id,name,email,picture.type(large)'`               |
| `scope`               | `['public_profile', 'email']`                                                            |
| `nameKey`             | `'name'`                                                                                 |
| `emailKey`            | `'email'`                                                                                |
| `getAvatar`           | Reads `userData.picture.data.url` (Graph returns a nested object when you ask for it).   |

`apiVersion` is exposed because Meta deprecates Graph API versions on a rolling schedule. Pin the version explicitly if you want to lock against unannounced breaking changes.

### `microsoftProvider(input)`

```ts
interface MicrosoftProviderInput extends OAuthHelperInput {
  tenant?: string;          // defaults to 'common'
  apiVersion?: string;      // defaults to 'v2.0'
  graphApiVersion?: string; // defaults to 'v1.0'
}
```

| Field                 | Value                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `name`                | `'microsoft'`                                                                                           |
| `authorizationURL`    | `https://login.microsoftonline.com/${tenant}/oauth2/${apiVersion}/authorize`                            |
| `tokenExchangeURL`    | `https://login.microsoftonline.com/${tenant}/oauth2/${apiVersion}/token`                                |
| `tokenExchangeMethod` | `'form'`                                                                                                |
| `userInfoURL`         | `https://graph.microsoft.com/${graphApiVersion}/me`                                                     |
| `scope`               | `['openid', 'profile', 'email', 'User.Read']`                                                           |
| `nameKey`             | `'displayName'`                                                                                         |
| `emailKey`            | `'mail'`                                                                                                |
| `avatarCodeKey`       | `'id'`                                                                                                  |
| `getAvatar`           | Fetches `/users/${id}/photo/$value` with the bearer token, inlines bytes as a `data:image/...` URL.     |
| `getEmail`            | Falls back to a second `/me` call that picks `mail` then `userPrincipalName`.                           |

Microsoft Graph's `/photo/$value` endpoint requires bearer auth, so we can't store the URL on the user record — a browser `<img>` would 401. `getAvatar` fetches the bytes server-side and produces a `data:` URL, which is then stored on `User.avatar` and served like any other inline avatar.

`tenant` accepts:

- A UUID (`'b3f1...'`) — single-tenant Azure AD.
- `'common'` (default) — multi-tenant + personal accounts.
- `'organizations'` — multi-tenant work/school only.
- `'consumers'` — personal accounts only.

> Note: as of 2026-05-14 the Microsoft flow is implemented but has not been end-to-end verified against a live Azure AD tenant. The token-exchange URL, the Graph `/me` shape, and the photo data-URL pipeline are based on the official Microsoft docs and pattern-matched against Google/GitHub. The first consumer to wire a real Azure tenant should report any rough edges so the note can be dropped.

## End-to-end OAuth flow

The pieces glue together in `loginCallback` (see [`./src/login.ts`](../src/login.ts)):

1. **Authorize redirect** — `/auth/login/<provider>` (wired by `@luckystack/server`) calls `createOAuthState(provider)` and redirects the browser to `provider.authorizationURL?client_id=...&redirect_uri=...&state=...&scope=...&response_type=code`.
2. **User authorizes** — the user accepts on the provider's UI; the provider redirects back to `callbackURL?code=...&state=...`.
3. **State validation** — `loginCallback` calls `consumeOAuthState(provider.name, state)`. Invalid or missing state → return `false`.
4. **Token exchange** — `exchangeOAuthToken(provider, code)` POSTs to `tokenExchangeURL`. JSON or form body depending on `tokenExchangeMethod`. Reads `access_token` from the response.
5. **Userinfo fetch** — `fetchOAuthProfile(provider, accessToken)`. Pulls `name` via `nameKey`, `email` via `emailKey`. Calls `getAvatar` / `getEmail` for providers that need post-processing.
6. **Find-or-create** — `findOrCreateOAuthUser(provider, profile)`:
   - Dispatches `preLogin`. Stop signal → return `null` (which becomes `false` upstream).
   - `userAdapter.findByEmail({ email, provider: provider.name })`.
   - Returning user → dispatch `postLogin`; update `lastLogin`; return `{ user, isNewUser: false }`.
   - New user → dispatch `preRegister` (can stop); `userAdapter.create(...)`; return `{ user, isNewUser: true }`.
7. **Mint session token** — 32 bytes hex, attached to `resolved.user.token`.
8. **`extraSessionFields`** — if the provider defined one, run it and merge the result onto the session. Errors are warn-logged and skipped (a missing extra is not worth blocking login).
9. **`saveSession(token, user, true)`** — runs `preSessionCreate` / `postSessionCreate`, single-session enforcement, CSRF minting, broadcast.
10. **`postRegister` (new only) + `postLogin`** — fired with `{ userId, provider, isNewUser, token }`.
11. **Resolve redirect** — `resolvePostLoginRedirect` calls the registered post-login resolver (if any), validates the URL against `http.cors.allowedOrigins`, falls back to `loginRedirectUrl` or `'/'`. See [`./redirect-validation.md`](./redirect-validation.md).
12. **Return** — `{ token, redirectUrl, userId, provider, isNewUser }`. `@luckystack/server` writes the token to the session cookie and 302s the browser to `redirectUrl`.

## `extraSessionFields` — per-provider runtime extras

```ts
googleProvider({
  clientId, clientSecret, callbackUrl,
  extraScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  extraSessionFields: async ({ userData, accessToken }) => ({
    googleCalendarToken: accessToken,
  }),
});
```

For strict typing on the session field, augment `BaseSessionLayout`:

```ts
declare module '@luckystack/core' {
  interface BaseSessionLayout {
    googleCalendarToken?: string;
  }
}
```

Important constraints:

- Data lives on the Redis session record. It disappears on logout — no Prisma schema change required.
- Do NOT put secrets you wouldn't want a user to see if they inspected their own session. The session is broadcast to the user's own browser; treat everything in it as "the user can see this".
- Errors thrown from the hook are caught, warn-logged with `[oauth:<provider>] extraSessionFields hook threw — continuing without extras`, and login proceeds without the extras. A missing extra is preferable to a blocked login.

## Authoring a custom provider

Custom providers (Okta, Apple, X, Auth0, internal SSO) plug in as raw `FullOAuthProvider` objects:

```ts
import { registerOAuthProviders, type FullOAuthProvider } from '@luckystack/login';

const oktaProvider = (input): FullOAuthProvider => ({
  name: 'okta',
  clientID: input.clientId,
  clientSecret: input.clientSecret,
  callbackURL: input.callbackUrl,
  authorizationURL: `https://${input.domain}/oauth2/v1/authorize`,
  tokenExchangeURL: `https://${input.domain}/oauth2/v1/token`,
  tokenExchangeMethod: 'form',
  userInfoURL: `https://${input.domain}/oauth2/v1/userinfo`,
  scope: ['openid', 'profile', 'email'],
  nameKey: 'name',
  emailKey: 'email',
  avatarKey: 'picture',
  avatarCodeKey: '',
});

registerOAuthProviders([
  credentialsProvider(),
  googleProvider({ ... }),
  oktaProvider({
    clientId: process.env.OKTA_CLIENT_ID,
    clientSecret: process.env.OKTA_CLIENT_SECRET,
    callbackUrl: `${process.env.DNS}/auth/callback/okta`,
    domain: 'acme.okta.com',
  }),
]);
```

Two non-obvious things to watch:

1. **`name` must be URL-safe.** It's interpolated into the callback path (`/auth/callback/okta`).
2. **`tokenExchangeMethod`.** If the provider expects `application/x-www-form-urlencoded` for the token exchange (most do, including Okta), use `'form'`. JSON-style (Google, GitHub) is the exception.

## Self-hosted enterprise mirrors

For self-hosted GitHub Enterprise / GitLab / Gitea, use the `endpoints?.*` overrides on the built-in helpers:

```ts
githubProvider({
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackUrl: `${process.env.DNS}/auth/callback/github`,
  endpoints: {
    authorizationURL: 'https://github.acme.example/login/oauth/authorize',
    tokenExchangeURL: 'https://github.acme.example/login/oauth/access_token',
    userInfoURL: 'https://github.acme.example/api/v3/user',
  },
});
```

The provider `name` is still `'github'` (so the callback path stays `/auth/callback/github`), but the URLs point at the enterprise host.

## Related

- [`./redirect-validation.md`](./redirect-validation.md) — `isAllowedRedirectUrl` and `registerPostLoginRedirect`.
- [`./session-management.md`](./session-management.md) — what `saveSession(token, user, true)` does after OAuth resolution.
- [`./hooks.md`](./hooks.md) — `preLogin` / `postLogin` / `preRegister` / `postRegister` for OAuth flows.
- [`./user-adapter.md`](./user-adapter.md) — replacing the Prisma-backed user store; OAuth uses the same `findByEmail` / `create` surface.
- Architecture: [`/docs/ARCHITECTURE_AUTH.md`](../../../docs/ARCHITECTURE_AUTH.md).
