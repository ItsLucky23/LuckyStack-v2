# Redirect validation

Deep-dive on the post-login redirect resolver registry and the open-redirect defense that gates its output. Canonical sources: [`./src/redirectResolver.ts`](../src/redirectResolver.ts) (registry + types) and the `isAllowedRedirectUrl` / `resolvePostLoginRedirect` helpers in [`./src/login.ts`](../src/login.ts).

After a successful OAuth callback, `loginCallback` needs to decide where to send the browser. The default is `projectConfig.loginRedirectUrl` (typically `/dashboard`), but most non-trivial apps want to route by user state — first-time vs returning, per-tenant landing page, per-provider deep link. The post-login redirect resolver is the supported extension point.

This document covers: why it lives in its own registry (not a hook), the resolver shape, the open-redirect defense, the fallback chain, and the call-time validation rules.

---

## Why a dedicated registry instead of a hook

The framework's hook bus (`registerHook` / `dispatchHook`) is "stop-or-continue" — handlers return `undefined` or a `HookStopSignal`. They do not carry a value back to the caller. The redirect resolver MUST return a string (the URL). Two options:

1. Add a "value-returning hook" variant to `@luckystack/core`. Generic, but every hook gains a return-type for one use case.
2. Define a dedicated single-slot registry for this specific need.

The framework picks option 2 because:

- **Single resolver wins** — there is no "chain N redirect resolvers and pick the first non-empty" scenario that makes sense. Per-tenant routing, per-user routing, per-provider routing — all three compose inside a SINGLE resolver function. Two resolvers fighting over the same login is not a feature.
- **Clear ownership** — the resolver is set once at boot by the application, not registered ad-hoc by a feature package. The single-slot registry expresses that.
- **Smaller surface** — no hook-bus features the resolver doesn't need (priority, stop signals, async-iterable handler arrays).

```ts
// packages/login/src/redirectResolver.ts
let activeResolver: PostLoginRedirectResolver | null = null;

export const registerPostLoginRedirect = (resolver) => {
  activeResolver = resolver;
  return resolver;
};

export const getPostLoginRedirect = () => activeResolver;
```

`registerPostLoginRedirect` is last-write-wins. `getPostLoginRedirect()` returns `null` when no resolver has been registered — the default state — and `loginCallback` falls back to `projectConfig.loginRedirectUrl` in that case.

## Resolver shape

```ts
interface PostLoginRedirectInput {
  userId: string;
  provider: string;
  isNewUser: boolean;
  defaultUrl: string;
}

type PostLoginRedirectResolver = (input: PostLoginRedirectInput) => string | Promise<string>;
```

| Field        | Notes                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| `userId`     | The id of the user who just logged in. Look it up in your DB for per-user routing.          |
| `provider`   | The OAuth provider name (`'google'`, `'github'`, `'discord'`, etc.) or `'credentials'`.     |
| `isNewUser`  | `true` for first-time OAuth users (`postRegister` just fired), `false` for returning ones.  |
| `defaultUrl` | The framework's computed default — the same URL that would be used without a resolver. Use as a fallback inside the resolver. |

The resolver may be sync or async. It runs INSIDE `loginCallback` between `postLogin` and the HTTP redirect — keep it fast. Database reads on the `userId` are fine; reaching out to a slow remote API will visibly delay every login.

## The open-redirect defense — `isAllowedRedirectUrl`

`isAllowedRedirectUrl(url)` lives in `login.ts` and is the framework's defense against open-redirect attacks via the OAuth callback flow. Without it, a malicious link to `/auth/login/google?state=<attacker-state>&redirect_uri=https://evil.example/steal` could lure a user into authenticating and then bouncing them to a credential-stealing page.

```ts
const isAllowedRedirectUrl = (url: string): boolean => {
  if (!URL.canParse(url, 'http://placeholder')) return false;
  const parsed = new URL(url, 'http://placeholder');
  if (parsed.origin === 'http://placeholder') {
    // relative URL — same-origin, always safe
    return true;
  }
  const allowed = getProjectConfig().http.cors.allowedOrigins ?? [];
  if (typeof allowed === 'function') {
    return allowed(parsed.origin);
  }
  return allowed.some((origin) => {
    if (!URL.canParse(origin)) return false;
    return new URL(origin).origin === parsed.origin;
  });
};
```

The rules:

### 1. Same-origin (relative URL) — always allowed

```ts
'/dashboard'             // ✓ relative path
'/welcome?step=1'        // ✓ relative path with query
'/org/123/projects'      // ✓ relative path with multi-segment
```

The trick is parsing against a `'http://placeholder'` base — if the resulting origin matches the base, the input was a relative URL (no scheme/host of its own). Relative URLs land on the same origin as the app, so they're safe by definition.

### 2. Absolute URL — origin must match `http.cors.allowedOrigins`

```ts
'https://app.example.com/dashboard'  // ✓ if 'https://app.example.com' is in allowedOrigins
'https://evil.example/steal'         // ✗ unless explicitly allowed
'https://api.example.com/'           // ✗ if only 'https://app.example.com' is allowed
```

The check compares the parsed `origin` (scheme + host + port) of the URL to the parsed `origin` of each entry in `allowedOrigins`. String comparison wouldn't work — `https://app.example.com:443` and `https://app.example.com` should match (default port elided), and parsing both through `new URL().origin` normalizes them.

### 3. `allowedOrigins` as a function

`http.cors.allowedOrigins` is typed as `string[] | (origin: string) => boolean`. The function variant lets consumers compute allowed origins dynamically — wildcard subdomains, tenant-specific origin allow-lists, integration with an internal "approved partners" service:

```ts
registerProjectConfig({
  http: {
    cors: {
      allowedOrigins: (origin) => {
        // Allow any *.acme-customers.example subdomain
        const url = new URL(origin);
        if (url.hostname.endsWith('.acme-customers.example')) return true;
        // Allow the main app domain
        if (origin === 'https://app.acme.example') return true;
        return false;
      },
    },
  },
});
```

The function receives the already-parsed origin string (e.g. `'https://app.acme.example'`) and returns boolean. The branch in `isAllowedRedirectUrl` calls it with the same origin it would have string-compared:

```ts
if (typeof allowed === 'function') {
  return allowed(parsed.origin);
}
```

### 4. Invalid input — rejected

```ts
'not a url'              // ✗ URL.canParse returns false
'javascript:alert(1)'    // ✗ same-origin check fails — wrong scheme
'///evil.example/x'      // ✗ resolves to '//evil.example/x', not same-origin
```

The `URL.canParse(url, 'http://placeholder')` first-gate handles malformed inputs. `'javascript:...'` parses fine but the origin check rejects it.

## Fallback chain — `resolvePostLoginRedirect`

`resolvePostLoginRedirect` orchestrates the resolver call and the validation:

```ts
const resolvePostLoginRedirect = async ({ fallbackUrl, userId, providerName, isNewUser }) => {
  const resolver = getPostLoginRedirect();
  if (!resolver) return fallbackUrl;

  const [resolverError, resolved] = await tryCatch(() => resolver({
    userId,
    provider: providerName,
    isNewUser,
    defaultUrl: fallbackUrl,
  }));
  if (resolverError) {
    getLogger().warn(`[oauth] postLoginRedirect resolver threw`, { message: (resolverError as Error).message });
    return fallbackUrl;
  }
  if (resolved && isAllowedRedirectUrl(resolved)) return resolved;
  if (resolved) {
    getLogger().warn(
      `[oauth] postLoginRedirect returned a URL not in allowed origins — falling back`,
      { resolved, fallbackUrl },
    );
  }
  return fallbackUrl;
};
```

Fallback order (from `loginCallback`):

1. **`options.defaultRedirectUrl`** — the per-call override passed by `@luckystack/server`'s callback route handler. Useful when the server adds an additional safety layer (e.g. "always send first-time users to /onboarding").
2. **`projectConfig.loginRedirectUrl`** — the project-wide default. Typically `/dashboard` or `/`. Set via `registerProjectConfig`.
3. **`'/'`** — hard fallback. Used only when both options.defaultRedirectUrl AND projectConfig.loginRedirectUrl are undefined; effectively unreachable in real deployments because the framework's `DEFAULT_PROJECT_CONFIG` populates `loginRedirectUrl`.

```ts
// From loginCallback
const fallbackUrl =
  options.defaultRedirectUrl
  ?? getProjectConfig().loginRedirectUrl
  ?? '/';
```

The fallback URL is passed to the resolver as `defaultUrl` — resolvers can use it directly to "do the framework default" for cases the resolver doesn't care about.

## Resolver error handling

The resolver runs inside `tryCatch`. Any thrown error is warn-logged and the function returns the fallback URL. Logins are NOT failed because of a bad resolver — the user lands on the fallback page instead.

```ts
if (resolverError) {
  getLogger().warn(`[oauth] postLoginRedirect resolver threw`, {
    message: (resolverError as Error).message,
  });
  return fallbackUrl;
}
```

This is intentionally lenient. A resolver bug (typo, DB outage, internal API down) should not block users from signing in — at worst they land on the default page and click their way to where they were going. The warn-log gives ops the visibility they need to find and fix the bug.

If the resolver returns a string that fails `isAllowedRedirectUrl`, that case is ALSO warn-logged separately:

```ts
if (resolved) {
  getLogger().warn(
    `[oauth] postLoginRedirect returned a URL not in allowed origins — falling back`,
    { resolved, fallbackUrl },
  );
}
return fallbackUrl;
```

The two warn-logs are deliberately separate so a misconfigured `allowedOrigins` (returns valid URL but origin not whitelisted) is distinguishable from a resolver bug (throws an error). Different ops fixes for the two.

## Resolver patterns

### First-time vs returning

```ts
import { registerPostLoginRedirect } from '@luckystack/login';

registerPostLoginRedirect(({ isNewUser, defaultUrl }) => {
  if (isNewUser) return '/welcome';
  return defaultUrl;
});
```

The simplest case — onboard new users through a `/welcome` flow, send returning users to wherever the default sends them.

### Per-tenant landing page

```ts
registerPostLoginRedirect(async ({ userId, defaultUrl }) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true },
  });
  if (!user?.organizationId) return defaultUrl;
  return `/org/${user.organizationId}/dashboard`;
});
```

Look up the user's tenant and route to a tenant-scoped URL. The relative path is always same-origin so it passes `isAllowedRedirectUrl` without needing `allowedOrigins` entries.

### Per-provider deep link

```ts
registerPostLoginRedirect(({ provider, isNewUser }) => {
  if (provider === 'google' && isNewUser) {
    return '/setup/google-calendar'; // hook them to grant calendar access
  }
  if (provider === 'github') {
    return '/repos/connect';
  }
  return '/dashboard';
});
```

Different providers get different onboarding flows. Useful when each OAuth provider unlocks a different feature (calendar for Google, repos for GitHub, file storage for Microsoft Graph).

### Cross-origin enterprise app

```ts
registerProjectConfig({
  http: {
    cors: {
      allowedOrigins: [
        'https://app.acme.example',
        'https://admin.acme.example',
        'https://mobile.acme.example',
      ],
    },
  },
});

registerPostLoginRedirect(async ({ userId }) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role === 'admin') return 'https://admin.acme.example/';
  if (user?.role === 'mobile') return 'https://mobile.acme.example/';
  return 'https://app.acme.example/';
});
```

Three domains, role-based routing. Each absolute URL is checked against `allowedOrigins` — if you forget to whitelist `https://mobile.acme.example`, the resolver's return value gets warn-logged and falls back. Maintain the allow-list and the resolver as a pair.

### Resume-where-you-left-off

```ts
// 1. Frontend stores the "where they came from" URL in sessionStorage before the OAuth redirect.
// 2. After login the frontend reads sessionStorage and pushes to that URL.

// This package's resolver is NOT the right place for "return to the page they were on" —
// the server doesn't know what the user was looking at. Wire this on the CLIENT side instead.
```

The resolver runs server-side and has no knowledge of the user's browser state. "Resume where you left off" is a client-side concern.

## Threat model

The open-redirect class of vulnerability is the reason this validation exists. Without it:

1. Attacker crafts a phishing email: "Sign in to ACME with your Google account: https://app.acme.example/auth/login/google?...".
2. The link goes through real ACME, the user trusts the domain, completes the OAuth flow.
3. The OAuth callback runs, and a malicious resolver / unvalidated query param sends the user to `https://evil.example/login-confirmation` — a page that looks like ACME and asks them to "re-enter your password to continue".

The framework defends by:

- Not accepting an unvalidated `redirect_uri` query param from the OAuth callback. The callback URL is pinned at provider registration time (`provider.callbackURL`); attackers cannot inject one.
- Running the resolver's returned URL through `isAllowedRedirectUrl` before redirecting.
- Falling back to a known-safe URL when the validation fails.

The right mental model: `isAllowedRedirectUrl` is the "I trust this URL enough to 302 a freshly-authenticated user to it" gate. NEVER bypass it. If the resolver needs to return a cross-origin URL, register that origin in `allowedOrigins` — that's the documented extension point.

## Validation gotchas

### `localhost` is auto-allowed ONLY when `http.cors.allowLocalhost` is on

When `http.cors.allowLocalhost` is `true` (a dev convenience; defaults `false` in prod), an absolute redirect whose hostname is exactly `localhost` IS auto-allowed (note: only the `localhost` hostname — `127.0.0.1` is NOT covered by this branch). With `allowLocalhost` off (the prod default) `localhost` gets no free pass. To allow a specific loopback origin regardless, add it to `allowedOrigins`:

```ts
registerProjectConfig({
  http: {
    cors: {
      allowedOrigins: process.env.NODE_ENV === 'development'
        ? ['http://localhost:5173', 'http://127.0.0.1:5173']
        : ['https://app.example.com'],
    },
  },
});
```

Relative URLs (`/dashboard`) still work without the entry — they're always same-origin.

### Port mismatches

`https://app.example.com:8443` and `https://app.example.com` are different origins (default port for HTTPS is 443; explicit 8443 is a different port). Whitelist the EXACT origin the resolver returns.

### Wildcards are NOT supported in the string array

`allowedOrigins: ['https://*.example.com']` does NOT work — strings are compared as full origins. For wildcard subdomains, use the function variant:

```ts
allowedOrigins: (origin) => {
  const url = new URL(origin);
  return url.hostname.endsWith('.example.com') && url.protocol === 'https:';
},
```

### Trailing slashes

`new URL('https://app.example.com/').origin === 'https://app.example.com'` (origin doesn't include the path). So `'https://app.example.com'` and `'https://app.example.com/'` are equivalent in the allow-list. Either form works.

## Diagnostic logging

The validation warn-logs are intentionally noisy because spurious redirect mismatches are a clear "the resolver and the allowed-origins config don't agree" signal. In production, monitor for:

```
[oauth] postLoginRedirect returned a URL not in allowed origins — falling back
  resolved: https://mobile.acme.example/
  fallbackUrl: /dashboard
```

That entry means: someone added `mobile.acme.example` to the resolver but forgot the `allowedOrigins` list. Users are landing on `/dashboard` instead of where the resolver intended.

```
[oauth] postLoginRedirect resolver threw
  message: Cannot read properties of null (reading 'organizationId')
```

That entry means: the resolver's DB read returned null for a user that just signed in — race condition, soft-deleted user, missing column. Trace the userId from the surrounding `postLogin` log line.

## When NOT to use a resolver

- **"Redirect to the URL they came from before login"** — that's a client-side concern (sessionStorage on the login page).
- **"Send them to a generic /onboarding for first-time users"** — fine, but consider just adding the `/onboarding` route to the bundled template; if every project does this, the framework could lift it.
- **"Block login when the user fails some check"** — use `preLogin` with a stop signal instead. The resolver runs AFTER the login has succeeded; there's no clean way to undo a freshly-minted session from the resolver.

## Related

- [`./oauth-providers.md`](./oauth-providers.md) — `loginCallback` and where the resolver runs in the OAuth flow.
- [`./hooks.md`](./hooks.md) — `preLogin` (for "block login" use cases) and `postLogin` (for side-effects that don't need to return a URL).
- [`./credentials-auth.md`](./credentials-auth.md) — credentials login does NOT go through `loginCallback`, so the resolver is OAuth-only. Credentials login returns to whatever URL the login page navigates to on its own.
- Architecture: [`/docs/ARCHITECTURE_AUTH.md`](../../../docs/ARCHITECTURE_AUTH.md).
