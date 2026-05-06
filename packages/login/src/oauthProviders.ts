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

interface OAuthHelperInput {
  clientId: string | undefined;
  clientSecret: string | undefined;
  callbackUrl: string;
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
  authorizationURL: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenExchangeURL: 'https://oauth2.googleapis.com/token',
  tokenExchangeMethod: 'json',
  userInfoURL: 'https://www.googleapis.com/oauth2/v1/userinfo',
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
  authorizationURL: 'https://github.com/login/oauth/authorize',
  tokenExchangeURL: 'https://github.com/login/oauth/access_token',
  tokenExchangeMethod: 'json',
  userInfoURL: 'https://api.github.com/user',
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
  authorizationURL: 'https://discord.com/oauth2/authorize',
  tokenExchangeURL: 'https://discord.com/api/oauth2/token',
  tokenExchangeMethod: 'form',
  userInfoURL: 'https://discord.com/api/users/@me',
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

export const facebookProvider = (input: OAuthHelperInput): FullOAuthProvider => ({
  name: 'facebook',
  clientID: requireString(input.clientId, 'facebook clientId'),
  clientSecret: requireString(input.clientSecret, 'facebook clientSecret'),
  callbackURL: input.callbackUrl,
  authorizationURL: 'https://www.facebook.com/v10.0/dialog/oauth',
  tokenExchangeURL: 'https://graph.facebook.com/v10.0/oauth/access_token',
  tokenExchangeMethod: 'form',
  userInfoURL: 'https://graph.facebook.com/me?fields=id,name,email,picture.type(large)',
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
});

export const microsoftProvider = (input: OAuthHelperInput): FullOAuthProvider => ({
  name: 'microsoft',
  clientID: requireString(input.clientId, 'microsoft clientId'),
  clientSecret: requireString(input.clientSecret, 'microsoft clientSecret'),
  callbackURL: input.callbackUrl,
  authorizationURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenExchangeURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  tokenExchangeMethod: 'form',
  userInfoURL: 'https://graph.microsoft.com/v1.0/me',
  scope: ['openid', 'profile', 'email', 'User.Read'],
  nameKey: 'displayName',
  emailKey: 'mail',
  avatarCodeKey: 'id',
  getAvatar: ({ avatarId }) => {
    if (!avatarId) return;
    return `https://graph.microsoft.com/v1.0/users/${avatarId}/photo/$value`;
  },
  getEmail: async (accessToken) => {
    const fetchProfile = async () => {
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
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
});

let registeredProviders: OAuthProvider[] = [{ name: 'credentials' }];

//? Always returns the active list. The default value contains only the
//? `credentials` entry so calls into `loginWithCredentials` keep working in
//? environments that never register OAuth providers (tests, CLI, etc.).
export const getOAuthProviders = (): OAuthProvider[] => registeredProviders;

export const registerOAuthProviders = (providers: OAuthProvider[]): OAuthProvider[] => {
  registeredProviders = providers;
  return registeredProviders;
};
