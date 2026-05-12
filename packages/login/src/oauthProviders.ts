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

type OAuthUserData = Record<string, unknown>;

const asOAuthUserData = (value: unknown): OAuthUserData => {
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
  scope: string[];
  nameKey: string;
  emailKey: string;
  avatarKey?: string;
  avatarCodeKey: string;
  getEmail?: (accessToken: string) => Promise<string | false | undefined>;
  getAvatar?: (params: { userData: OAuthUserData; avatarId?: string }) => string | undefined | Promise<string | undefined>;
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
}

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
  userInfoURL: input.endpoints?.userInfoURL ?? 'https://www.googleapis.com/oauth2/v1/userinfo',
  scope: [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  nameKey: 'name',
  emailKey: 'email',
  avatarKey: 'picture',
  avatarCodeKey: '',
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
  scope: ['read:user', 'user:email'],
  nameKey: 'login',
  emailKey: 'email',
  avatarKey: 'avatar_url',
  avatarCodeKey: '',
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
      const emails = await response.json();
      if (!Array.isArray(emails)) return false;
      return emails;
    };

    const [error, emails] = await tryCatch(fetchEmails);
    if (error || !emails) return false;

    let mainEmail: string | undefined;
    for (const entry of emails) {
      if (entry.primary) mainEmail = entry.email;
    }
    if (!mainEmail) mainEmail = emails[0]?.email;
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
  scope: ['identify', 'email'],
  nameKey: 'username',
  emailKey: 'email',
  avatarCodeKey: 'avatar',
  getAvatar: ({ userData, avatarId }) => {
    if (!avatarId) return;
    const userId = typeof userData.id === 'string' ? userData.id : '';
    if (!userId) return;
    const format = avatarId.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarId}.${format}`;
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
  scope: ['public_profile', 'email'],
  nameKey: 'name',
  emailKey: 'email',
  avatarCodeKey: '',
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
}

export const microsoftProvider = (input: MicrosoftProviderInput): FullOAuthProvider => {
  const tenant = input.tenant ?? 'common';
  const oauthVersion = input.apiVersion ?? 'v2.0';
  const graphVersion = input.graphApiVersion ?? 'v1.0';
  return {
  name: 'microsoft',
  clientID: requireString(input.clientId, 'microsoft clientId'),
  clientSecret: requireString(input.clientSecret, 'microsoft clientSecret'),
  callbackURL: input.callbackUrl,
  authorizationURL: input.endpoints?.authorizationURL ?? `https://login.microsoftonline.com/${tenant}/oauth2/${oauthVersion}/authorize`,
  tokenExchangeURL: input.endpoints?.tokenExchangeURL ?? `https://login.microsoftonline.com/${tenant}/oauth2/${oauthVersion}/token`,
  tokenExchangeMethod: 'form',
  userInfoURL: input.endpoints?.userInfoURL ?? `https://graph.microsoft.com/${graphVersion}/me`,
  scope: ['openid', 'profile', 'email', 'User.Read'],
  nameKey: 'displayName',
  emailKey: 'mail',
  avatarCodeKey: 'id',
  getAvatar: ({ avatarId }) => {
    if (!avatarId) return;
    return `https://graph.microsoft.com/${graphVersion}/users/${avatarId}/photo/$value`;
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
      const data = await response.json();
      if (!data) return false;
      return data;
    };

    const [error, profile] = await tryCatch(fetchProfile);
    if (error || !profile) return false;

    const record = asOAuthUserData(profile);
    const mail = typeof record.mail === 'string' ? record.mail : '';
    const userPrincipalName = typeof record.userPrincipalName === 'string' ? record.userPrincipalName : '';
    return (mail || userPrincipalName) || false;
  },
  };
};

let registeredProviders: OAuthProvider[] = [{ name: 'credentials' }];

//? Always returns the active list. The default value contains only the
//? `credentials` entry so calls into `loginWithCredentials` keep working in
//? environments that never register OAuth providers (tests, CLI, etc.).
export const getOAuthProviders = (): OAuthProvider[] => registeredProviders;

export const registerOAuthProviders = (providers: OAuthProvider[]): OAuthProvider[] => {
  registeredProviders = providers;
  return registeredProviders;
};
