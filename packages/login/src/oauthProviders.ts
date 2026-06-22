//? OAuth provider registry. Replaces the previously hardcoded provider list
//? in `loginConfig.ts`. Consumers register providers from their
//? `luckystack/login/oauthProviders.ts` overlay file at boot.
//?
//? Two-layer surface:
//?   1. `registerOAuthProviders([...])` — accept an array of provider definitions.
//?   2. Built-in helpers (`googleProvider`, `githubProvider`, ...) so the common
//?      case is one function call per provider with only the secrets + callback.
//?
//? Custom providers (Okta, Apple, X, etc.) plug in as raw `OAuthProvider`
//? objects alongside the helpers.

import { tryCatch } from '@luckystack/core';

export type OAuthUserData = Record<string, unknown>;

export const asOAuthUserData = (value: unknown): OAuthUserData => {
  if (value && typeof value === 'object') {
    return value as OAuthUserData;
  }
  return {};
};

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
  /**
   * OAuth scopes requested at the authorization step. Consumers can extend
   * a built-in provider's defaults to request additional permissions:
   *
   *   ```ts
   *   const customGoogle = googleProvider({...});
   *   customGoogle.scope.push('https://www.googleapis.com/auth/calendar.readonly');
   *   ```
   *
   * Or pass `extraScopes` to the built-in factory (see `OAuthHelperInput`).
   */
  scope: string[];
  nameKey: string;
  emailKey: string;
  /**
   * Optional key on the userInfo response holding a provider "email verified"
   * boolean. When set AND the field is present-and-falsy, the framework rejects
   * the profile rather than trusting an unverified address — defense-in-depth
   * against account-linking takeover under the `'unified'` strategy (SEC-21).
   * A missing field (provider doesn't report it) is treated as "trusted",
   * preserving behaviour for providers that don't expose the flag.
   */
  emailVerifiedKey?: string;
  avatarKey?: string;
  avatarCodeKey: string;
  getEmail?: (accessToken: string) => Promise<string | false | undefined>;
  getAvatar?: (params: { userData: OAuthUserData; avatarId?: string; accessToken: string }) => string | undefined | Promise<string | undefined>;
  /**
   * Optional per-provider hook to attach extra runtime-only data to the
   * session (NOT to the User row). Return key/value pairs that get merged
   * into `BaseSessionLayout` before `saveSession`. To get strict typing
   * downstream, extend `BaseSessionLayout` via module augmentation:
   *
   *   ```ts
   *   declare module '@luckystack/core' {
   *     interface BaseSessionLayout {
   *       googleCalendarToken?: string;
   *     }
   *   }
   *   ```
   *
   * Data lives on the session in Redis and disappears on logout — no Prisma
   * schema change required. Don't store secrets you wouldn't want surfaced
   * to a user inspecting their own session.
   */
  extraSessionFields?: (params: {
    userData: OAuthUserData;
    accessToken: string;
  }) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /**
   * Extra query params appended to the authorization-redirect URL (CFG-21).
   * Lets a provider request e.g. `access_type=offline`, `login_hint=...`, or
   * override the framework's default `prompt=select_account`. The server's
   * authorize route merges these over the built-in params (a key present here
   * wins). Reserved OAuth params (`client_id`, `redirect_uri`, `scope`,
   * `response_type`, `state`, `code_challenge`, `code_challenge_method`) should
   * NOT be set here — they are framework-owned. Default unset.
   */
  extraAuthorizationParams?: Record<string, string>;
  /**
   * Opt this provider into PKCE (RFC 7636, S256) (F11). When `true`, the
   * framework generates a `code_verifier` at flow start, stores it server-side
   * with the OAuth state, sends `code_challenge`/`code_challenge_method=S256` on
   * the authorize redirect, and replays the verifier at token exchange. Required
   * by OAuth 2.1 / PKCE-mandating providers (X/Twitter, some Okta/Auth0
   * policies). Default `false` (no PKCE — existing flows are byte-identical).
   */
  usePkce?: boolean;
}

export type OAuthProvider = CredentialsProvider | FullOAuthProvider;

export const isFullOAuthProvider = (provider: OAuthProvider): provider is FullOAuthProvider =>
  provider.name !== 'credentials';

export interface OAuthEndpointOverrides {
  /** Override the provider's authorization URL (e.g. GitHub Enterprise host, Microsoft custom tenant). */
  authorizationURL?: string;
  /** Override the token exchange URL. */
  tokenExchangeURL?: string;
  /** Override the userInfo URL. */
  userInfoURL?: string;
}

interface OAuthHelperInput {
  clientId: string | undefined;
  clientSecret: string | undefined;
  callbackUrl: string;
  /** Optional URL overrides for self-hosted / custom-tenant deployments. */
  endpoints?: OAuthEndpointOverrides;
  /**
   * Additional OAuth scopes to request alongside the built-in defaults. Use
   * for "give me access to the user's calendar / drive / repos" flows.
   * Merged with the helper's default scopes; duplicates are deduplicated.
   */
  extraScopes?: string[];
  /**
   * Per-provider hook for attaching runtime-only fields to the session.
   * See `FullOAuthProvider.extraSessionFields` for usage + module-augmentation
   * pattern.
   */
  extraSessionFields?: FullOAuthProvider['extraSessionFields'];
  /**
   * Extra query params for the authorize redirect (CFG-21). See
   * `FullOAuthProvider.extraAuthorizationParams`.
   */
  extraAuthorizationParams?: Record<string, string>;
  /** Opt this provider into PKCE (S256) (F11). See `FullOAuthProvider.usePkce`. */
  usePkce?: boolean;
}

const mergeScopes = (defaults: string[], extra: string[] | undefined): string[] => {
  if (!extra || extra.length === 0) return defaults;
  return [...new Set([...defaults, ...extra])];
};

const requireString = (value: string | undefined, label: string): string => {
  if (!value || value.length === 0) {
    throw new Error(`OAuth provider configuration error: ${label} is empty.`);
  }
  return value;
};

export const credentialsProvider = (): CredentialsProvider => ({ name: 'credentials' });

export const googleProvider = (input: OAuthHelperInput): FullOAuthProvider => ({
  name: 'google',
  clientID: requireString(input.clientId, 'google clientId'),
  clientSecret: requireString(input.clientSecret, 'google clientSecret'),
  callbackURL: input.callbackUrl,
  authorizationURL: input.endpoints?.authorizationURL ?? 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenExchangeURL: input.endpoints?.tokenExchangeURL ?? 'https://oauth2.googleapis.com/token',
  tokenExchangeMethod: 'json',
  //? OIDC userinfo (v3) — the legacy `oauth2/v1/userinfo` is deprecated and
  //? reports verification as `verified_email`; v3 reports the OIDC-standard
  //? `email_verified`. Use v3 so `emailVerifiedKey` below lines up (SEC-21/QUA-24).
  userInfoURL: input.endpoints?.userInfoURL ?? 'https://www.googleapis.com/oauth2/v3/userinfo',
  scope: mergeScopes([
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ], input.extraScopes),
  nameKey: 'name',
  emailKey: 'email',
  //? Google's OIDC userinfo returns `email_verified`; reject an unverified
  //? address so a Google account with an unverified email can't link to a
  //? victim's existing account under the `'unified'` strategy (SEC-21).
  emailVerifiedKey: 'email_verified',
  avatarKey: 'picture',
  avatarCodeKey: '',
  extraSessionFields: input.extraSessionFields,
  extraAuthorizationParams: input.extraAuthorizationParams,
  usePkce: input.usePkce,
});

export const githubProvider = (input: OAuthHelperInput): FullOAuthProvider => ({
  name: 'github',
  clientID: requireString(input.clientId, 'github clientId'),
  clientSecret: requireString(input.clientSecret, 'github clientSecret'),
  callbackURL: input.callbackUrl,
  authorizationURL: input.endpoints?.authorizationURL ?? 'https://github.com/login/oauth/authorize',
  tokenExchangeURL: input.endpoints?.tokenExchangeURL ?? 'https://github.com/login/oauth/access_token',
  tokenExchangeMethod: 'json',
  userInfoURL: input.endpoints?.userInfoURL ?? 'https://api.github.com/user',
  scope: mergeScopes(['read:user', 'user:email'], input.extraScopes),
  nameKey: 'login',
  emailKey: 'email',
  avatarKey: 'avatar_url',
  avatarCodeKey: '',
  extraSessionFields: input.extraSessionFields,
  extraAuthorizationParams: input.extraAuthorizationParams,
  usePkce: input.usePkce,
  getEmail: async (accessToken) => {
    const fetchEmails = async () => {
      const response = await fetch('https://api.github.com/user/emails', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) return false;
      const emails: unknown = await response.json();
      if (!Array.isArray(emails)) return false;
      return emails as { primary?: boolean; verified?: boolean; email?: string }[];
    };

    const [error, emails] = await tryCatch(fetchEmails);
    if (error || !emails) return false;

    //? Defense-in-depth: only ever select a `verified === true` address. GitHub
    //? forbids an unverified email from being `primary`, so in the normal case
    //? this is a no-op — but the `emails[0]` fallback (when no primary exists)
    //? could otherwise pick an UNVERIFIED address an attacker added to their
    //? GitHub account, which under the `'unified'` account strategy would link
    //? to a victim's existing account by that email (SEC-21). Filtering on
    //? `verified` first closes that fallback path.
    const verified = emails.filter((entry) => entry.verified === true);
    let mainEmail: string | undefined;
    for (const entry of verified) {
      if (entry.primary && typeof entry.email === 'string') mainEmail = entry.email;
    }
    mainEmail ??= verified[0]?.email;
    return mainEmail;
  },
});

export const discordProvider = (input: OAuthHelperInput): FullOAuthProvider => ({
  name: 'discord',
  clientID: requireString(input.clientId, 'discord clientId'),
  clientSecret: requireString(input.clientSecret, 'discord clientSecret'),
  callbackURL: input.callbackUrl,
  authorizationURL: input.endpoints?.authorizationURL ?? 'https://discord.com/oauth2/authorize',
  tokenExchangeURL: input.endpoints?.tokenExchangeURL ?? 'https://discord.com/api/oauth2/token',
  tokenExchangeMethod: 'form',
  userInfoURL: input.endpoints?.userInfoURL ?? 'https://discord.com/api/users/@me',
  scope: mergeScopes(['identify', 'email'], input.extraScopes),
  nameKey: 'username',
  emailKey: 'email',
  //? Discord's /users/@me returns a `verified` boolean for the account email;
  //? reject the address when it is explicitly unverified (SEC-21).
  emailVerifiedKey: 'verified',
  avatarCodeKey: 'avatar',
  extraSessionFields: input.extraSessionFields,
  extraAuthorizationParams: input.extraAuthorizationParams,
  usePkce: input.usePkce,
  getAvatar: ({ userData, avatarId }) => {
    if (!avatarId) return;
    const userId = typeof userData.id === 'string' ? userData.id : '';
    if (!userId) return;
    const format = avatarId.startsWith('a_') ? 'gif' : 'png';
    //? Encode the provider-supplied id + avatar hash before interpolation so a
    //? malformed value can't inject `../` path segments into the CDN URL (SEC-23).
    return `https://cdn.discordapp.com/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(avatarId)}.${format}`;
  },
});

export interface FacebookProviderInput extends OAuthHelperInput {
  /** Graph API version segment used in the URLs. Default `'v18.0'` (current as of 2026 — bump as Meta deprecates older versions). */
  apiVersion?: string;
}

export const facebookProvider = (input: FacebookProviderInput): FullOAuthProvider => {
  const v = input.apiVersion ?? 'v18.0';
  return {
  name: 'facebook',
  clientID: requireString(input.clientId, 'facebook clientId'),
  clientSecret: requireString(input.clientSecret, 'facebook clientSecret'),
  callbackURL: input.callbackUrl,
  authorizationURL: input.endpoints?.authorizationURL ?? `https://www.facebook.com/${v}/dialog/oauth`,
  tokenExchangeURL: input.endpoints?.tokenExchangeURL ?? `https://graph.facebook.com/${v}/oauth/access_token`,
  tokenExchangeMethod: 'form',
  userInfoURL: input.endpoints?.userInfoURL ?? 'https://graph.facebook.com/me?fields=id,name,email,picture.type(large)',
  scope: mergeScopes(['public_profile', 'email'], input.extraScopes),
  nameKey: 'name',
  emailKey: 'email',
  //? Facebook's Graph `/me` only returns `email` for an address the user has
  //? CONFIRMED with Facebook (unconfirmed emails are omitted), so there is no
  //? separate verified flag to gate on — the presence of `email` IS the verified
  //? signal. If a consumer opts into receiving unverified emails via a future
  //? Graph field, set `emailVerifiedKey` on the returned provider (SEC-21).
  avatarCodeKey: '',
  extraSessionFields: input.extraSessionFields,
  extraAuthorizationParams: input.extraAuthorizationParams,
  usePkce: input.usePkce,
  getAvatar: ({ userData }) => {
    const picture = asOAuthUserData(userData.picture);
    const pictureData = asOAuthUserData(picture.data);
    const url = pictureData.url;
    return typeof url === 'string' ? url : undefined;
  },
  };
};

export interface MicrosoftProviderInput extends OAuthHelperInput {
  /** Tenant id segment in the authorize/token URLs. Default `'common'`. */
  tenant?: string;
  /** OAuth API version segment. Default `'v2.0'`. */
  apiVersion?: string;
  /** Graph API version segment for /me. Default `'v1.0'`. */
  graphApiVersion?: string;
  /**
   * Allow falling back to `userPrincipalName` as the account email when Graph
   * `/me.mail` is empty (SEC-11). A UPN is NOT guaranteed routable or verified;
   * under the `'unified'` account strategy a UPN equal to a victim's email would
   * link accounts, and it commonly mis-keys an account on a non-deliverable
   * address (reset emails never arrive). Default `false` — only enable when the
   * tenant guarantees UPN == primary SMTP. When `false` and `.mail` is empty the
   * provider reports "no email" and the login is rejected rather than linked.
   */
  allowUpnFallback?: boolean;
}

//? NOTE: Microsoft flow is implemented but has not been end-to-end verified
//? against an Azure AD tenant as of 2026-05-14. The token-exchange URL, the
//? Graph /me shape, and the photo data-URL pipeline are based on Microsoft
//? docs and pattern-matching against Google/GitHub. First consumer to wire a
//? real Azure tenant should report back so this note can be dropped.
export const microsoftProvider = (input: MicrosoftProviderInput): FullOAuthProvider => {
  const tenant = input.tenant ?? 'common';
  const oauthVersion = input.apiVersion ?? 'v2.0';
  const graphVersion = input.graphApiVersion ?? 'v1.0';
  const allowUpnFallback = input.allowUpnFallback ?? false;
  return {
  name: 'microsoft',
  clientID: requireString(input.clientId, 'microsoft clientId'),
  clientSecret: requireString(input.clientSecret, 'microsoft clientSecret'),
  callbackURL: input.callbackUrl,
  authorizationURL: input.endpoints?.authorizationURL ?? `https://login.microsoftonline.com/${tenant}/oauth2/${oauthVersion}/authorize`,
  tokenExchangeURL: input.endpoints?.tokenExchangeURL ?? `https://login.microsoftonline.com/${tenant}/oauth2/${oauthVersion}/token`,
  tokenExchangeMethod: 'form',
  userInfoURL: input.endpoints?.userInfoURL ?? `https://graph.microsoft.com/${graphVersion}/me`,
  scope: mergeScopes(['openid', 'profile', 'email', 'User.Read'], input.extraScopes),
  nameKey: 'displayName',
  emailKey: 'mail',
  avatarCodeKey: 'id',
  extraSessionFields: input.extraSessionFields,
  extraAuthorizationParams: input.extraAuthorizationParams,
  usePkce: input.usePkce,
  //? Graph's /photo/$value requires bearer auth, so we can't store the URL —
  //? a browser <img> would 401. Fetch the bytes and inline as a data URL.
  getAvatar: async ({ avatarId, accessToken }) => {
    if (!avatarId) return;
    // 200 KB base64 cap: a data-URI is inlined into the Redis session record.
    // An unbounded photo (multi-MB) would bloat every session read and could
    // exhaust memory or hit Redis value-size limits on large tenants.
    const MAX_PHOTO_BYTES = 200 * 1024;
    const fetchPhoto = async () => {
      //? `encodeURIComponent` the provider-supplied id before interpolating it
      //? into the path: a malicious / malformed id could otherwise inject `../`
      //? segments and redirect the bearer-authenticated fetch to another Graph
      //? resource (SEC-23). The host is fixed, so this is not full SSRF, but the
      //? result is inlined into the session, so still worth closing.
      const response = await fetch(
        `https://graph.microsoft.com/${graphVersion}/users/${encodeURIComponent(avatarId)}/photo/$value`,
        { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) return;
      const rawContentType = response.headers.get('content-type') ?? 'image/jpeg';
      //? SEC: allowlist content-type to safe image MIME types before embedding in
      //? a data-URI that is stored in Redis and later served to the browser.
      const SAFE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
      const contentType = SAFE_IMAGE_TYPES.has(rawContentType) ? rawContentType : 'image/jpeg';
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_PHOTO_BYTES) return;
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    };
    const [error, dataUrl] = await tryCatch(fetchPhoto);
    if (error) return;
    return dataUrl ?? undefined;
  },
  getEmail: async (accessToken) => {
    const fetchProfile = async () => {
      const response = await fetch(`https://graph.microsoft.com/${graphVersion}/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) return false;
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object') return false;
      return data as Record<string, unknown>;
    };

    const [error, profile] = await tryCatch(fetchProfile);
    if (error || !profile) return false;

    const record = asOAuthUserData(profile);
    const mail = typeof record.mail === 'string' ? record.mail : '';
    if (mail) return mail;
    //? Only fall back to `userPrincipalName` when the consumer explicitly opted
    //? in (SEC-11). A UPN is not guaranteed routable/verified; using it as the
    //? account email under `'unified'` enables account-linking takeover and
    //? mis-keys accounts on non-deliverable addresses.
    if (allowUpnFallback) {
      const userPrincipalName = typeof record.userPrincipalName === 'string' ? record.userPrincipalName : '';
      return userPrincipalName || false;
    }
    return false;
  },
  };
};

let registeredProviders: OAuthProvider[] = [{ name: 'credentials' }];
//? LOGIN-01: optional factory that builds the provider list lazily on first
//? `getOAuthProviders()` call. This lets `register.ts` (the package auto-wire
//? side-effect) defer all config/env reads to request time rather than baking
//? them at module-load time. Once resolved the factory is discarded and the
//? static list is used on every subsequent call (same performance as before).
let providerFactory: (() => OAuthProvider[]) | null = null;

//? Always returns the active list. The default value contains only the
//? `credentials` entry so calls into `loginWithCredentials` keep working in
//? environments that never register OAuth providers (tests, CLI, etc.).
export const getOAuthProviders = (): OAuthProvider[] => {
  if (providerFactory) {
    registeredProviders = providerFactory();
    providerFactory = null;
  }
  return registeredProviders;
};

export const registerOAuthProviders = (providers: OAuthProvider[]): OAuthProvider[] => {
  providerFactory = null;
  registeredProviders = providers;
  return registeredProviders;
};

/**
 * Register a factory function that builds the provider list on first use.
 * Prefer this over `registerOAuthProviders` from the package `register` side-
 * effect so config/env reads are deferred to request time and survive any
 * `registerProjectConfig` call that happens after package import.
 * A subsequent `registerOAuthProviders` call replaces the factory.
 */
export const registerOAuthProviderFactory = (factory: () => OAuthProvider[]): void => {
  providerFactory = factory;
};
