//? OAuth providers — single source of truth for which providers this app
//? supports. Edit this file to add/remove providers.
//?
//? Each helper (`googleProvider`, `githubProvider`, ...) returns a fully-formed
//? OAuthProvider object. For a custom provider (Okta, Apple, X, ...) drop a
//? raw object into the array — see `OAuthProvider` type for the shape.

import { loadEnvFiles, getProjectConfig } from '@luckystack/core';
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

loadEnvFiles();

const prod = process.env.NODE_ENV !== 'development';
const secure = process.env.SECURE === 'true';
//? The OAuth redirect URI host MUST equal what you registered in the provider's
//? console (Google Cloud, etc.). Use the framework's canonical backend origin —
//? `getProjectConfig().oauthCallbackBase` (set in config.ts: dev `http://localhost:80`,
//? prod the public domain) — NOT a hand-built `SERVER_IP:SERVER_PORT`, which in
//? dev resolves to `http://127.0.0.1:80` and fails Google's exact-match check
//? against the registered `http://localhost:80/...` (Error 400 redirect_uri_mismatch).
const callbackBase = (getProjectConfig().oauthCallbackBase || getProjectConfig().app.publicUrl).replace(/\/+$/, '');

const callback = (name: string): string => `${callbackBase}/auth/callback/${name}`;

const useProdCreds = prod && secure;
const env = (prodKey: string, devKey: string): string =>
  (useProdCreds ? process.env[prodKey] : process.env[devKey]) ?? '';

const providers: OAuthProvider[] = [
  credentialsProvider(),
];

if (env('GOOGLE_CLIENT_ID', 'DEV_GOOGLE_CLIENT_ID')) {
  providers.push(googleProvider({
    clientId: env('GOOGLE_CLIENT_ID', 'DEV_GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET', 'DEV_GOOGLE_CLIENT_SECRET'),
    callbackUrl: callback('google'),
  }));
}

if (env('GITHUB_CLIENT_ID', 'DEV_GITHUB_CLIENT_ID')) {
  providers.push(githubProvider({
    clientId: env('GITHUB_CLIENT_ID', 'DEV_GITHUB_CLIENT_ID'),
    clientSecret: env('GITHUB_CLIENT_SECRET', 'DEV_GITHUB_CLIENT_SECRET'),
    callbackUrl: callback('github'),
  }));
}

if (env('DISCORD_CLIENT_ID', 'DEV_DISCORD_CLIENT_ID')) {
  providers.push(discordProvider({
    clientId: env('DISCORD_CLIENT_ID', 'DEV_DISCORD_CLIENT_ID'),
    clientSecret: env('DISCORD_CLIENT_SECRET', 'DEV_DISCORD_CLIENT_SECRET'),
    callbackUrl: callback('discord'),
  }));
}

if (env('FACEBOOK_CLIENT_ID', 'DEV_FACEBOOK_CLIENT_ID')) {
  providers.push(facebookProvider({
    clientId: env('FACEBOOK_CLIENT_ID', 'DEV_FACEBOOK_CLIENT_ID'),
    clientSecret: env('FACEBOOK_CLIENT_SECRET', 'DEV_FACEBOOK_CLIENT_SECRET'),
    callbackUrl: callback('facebook'),
  }));
}

if (env('MICROSOFT_CLIENT_ID', 'DEV_MICROSOFT_CLIENT_ID')) {
  providers.push(microsoftProvider({
    clientId: env('MICROSOFT_CLIENT_ID', 'DEV_MICROSOFT_CLIENT_ID'),
    clientSecret: env('MICROSOFT_CLIENT_SECRET', 'DEV_MICROSOFT_CLIENT_SECRET'),
    callbackUrl: callback('microsoft'),
  }));
}

registerOAuthProviders(providers);
