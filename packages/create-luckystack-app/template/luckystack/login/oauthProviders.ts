//? OAuth providers — fully env-driven, no code edits needed to enable one.
//?
//? A provider becomes active (its button shows on the login form AND its
//? `/auth/api/<name>` route works) as soon as BOTH its *_CLIENT_ID and
//? *_CLIENT_SECRET are set for the current environment. So enabling Google
//? later is just: fill DEV_GOOGLE_CLIENT_ID + DEV_GOOGLE_CLIENT_SECRET in
//? `.env.local` (or the unprefixed pair in `.env` for prod), then restart.
//?
//? The login form learns which providers are active from `GET /auth/providers`
//? — client secrets never reach the browser. Each provider also needs its OAuth
//? app's redirect URL registered in the provider's developer console to match
//? `oauthCallbackBase` + `/auth/callback/<name>` (the BACKEND origin — in dev
//? that's http://localhost:80/auth/callback/<name>), and its origin added to
//? EXTERNAL_ORIGINS in `.env`. See config.ts for how that origin is resolved.

import {
  registerOAuthProviders,
  credentialsProvider,
  googleProvider,
  githubProvider,
  discordProvider,
  facebookProvider,
  microsoftProvider,
  type OAuthProvider,
} from '@luckystack/login';

import { oauthCallbackBase } from '../../config';

const callback = (name: string): string => `${oauthCallbackBase}/auth/callback/${name}`;
const dev = process.env.NODE_ENV !== 'production';

//? Reads DEV_<key> in dev, the unprefixed <key> in prod. Empty string when unset.
const env = (key: string): string => (dev ? process.env[`DEV_${key}`] : process.env[key]) ?? '';

const providers: OAuthProvider[] = [credentialsProvider()];

if (env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')) {
  providers.push(googleProvider({
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
    callbackUrl: callback('google'),
  }));
}

if (env('GITHUB_CLIENT_ID') && env('GITHUB_CLIENT_SECRET')) {
  providers.push(githubProvider({
    clientId: env('GITHUB_CLIENT_ID'),
    clientSecret: env('GITHUB_CLIENT_SECRET'),
    callbackUrl: callback('github'),
  }));
}

if (env('DISCORD_CLIENT_ID') && env('DISCORD_CLIENT_SECRET')) {
  providers.push(discordProvider({
    clientId: env('DISCORD_CLIENT_ID'),
    clientSecret: env('DISCORD_CLIENT_SECRET'),
    callbackUrl: callback('discord'),
  }));
}

if (env('FACEBOOK_CLIENT_ID') && env('FACEBOOK_CLIENT_SECRET')) {
  providers.push(facebookProvider({
    clientId: env('FACEBOOK_CLIENT_ID'),
    clientSecret: env('FACEBOOK_CLIENT_SECRET'),
    callbackUrl: callback('facebook'),
  }));
}

if (env('MICROSOFT_CLIENT_ID') && env('MICROSOFT_CLIENT_SECRET')) {
  providers.push(microsoftProvider({
    clientId: env('MICROSOFT_CLIENT_ID'),
    clientSecret: env('MICROSOFT_CLIENT_SECRET'),
    callbackUrl: callback('microsoft'),
    tenant: env('MICROSOFT_TENANT_ID') || undefined,
  }));
}

registerOAuthProviders(providers);
