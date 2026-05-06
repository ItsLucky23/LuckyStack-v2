//? OAuth providers — single source of truth for which providers this app
//? supports. Edit this file to add/remove providers.
//?
//? Each helper (`googleProvider`, `githubProvider`, ...) returns a fully-formed
//? OAuthProvider object. For a custom provider (Okta, Apple, X, ...) drop a
//? raw object into the array — see `OAuthProvider` type for the shape.

import { config as loadEnv } from 'dotenv';
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

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

const prod = process.env.NODE_ENV !== 'development';
const secure = process.env.SECURE === 'true';
const protocol = secure ? 'https' : 'http';
const backendUrl = prod
  ? (process.env.DNS || '')
  : `${protocol}://${process.env.SERVER_IP}:${process.env.SERVER_PORT}`;

const callback = (name: string): string => `${backendUrl}/auth/callback/${name}`;

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
