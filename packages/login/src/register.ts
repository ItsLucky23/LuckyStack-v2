//? Side-effect `./register` entry for @luckystack/login. Auto-imported at boot by
//? @luckystack/server's `bootstrapLuckyStack` when this package is installed, so
//? OAuth providers + the default user adapter wire themselves from env with NO
//? consumer code edit — adding an OAuth provider is just env vars + restart.
//?
//? (Session-provider registration lives in this package's index module load —
//? `bootstrapLuckyStack` force-loads it via `getLogin()`. This register entry
//? covers the parts that USED to live in the consumer
//? `luckystack/login/{oauthProviders,userAdapter}.ts` overlay.)
//?
//? A provider becomes active (its button shows on the login form via
//? `GET /auth/providers` AND its `/auth/api/<name>` route works) as soon as BOTH
//? its *_CLIENT_ID and *_CLIENT_SECRET are set for the current environment:
//? `DEV_<KEY>` in dev, the unprefixed `<KEY>` in prod. The callback origin comes
//? from `getProjectConfig().oauthCallbackBase` (set in the consumer's config.ts)
//? — the redirect URI to register with each provider is
//? `<oauthCallbackBase>/auth/callback/<provider>`.
//?
//? A consumer overlay (`luckystack/login/*.ts`) runs AFTER this import, so a
//? hand-written `registerOAuthProviders(...)` / `registerUserAdapter(...)` still
//? wins (last writer).

import { getProjectConfig, resolveEnvKey } from '@luckystack/core';
import {
  registerOAuthProviderFactory,
  credentialsProvider,
  googleProvider,
  githubProvider,
  discordProvider,
  facebookProvider,
  microsoftProvider,
  type OAuthProvider,
} from './oauthProviders';
import {
  registerUserAdapter,
  isUserAdapterRegistered,
  defaultPrismaUserAdapter,
} from './userAdapter';

//? Default Prisma-backed user store — guard so a consumer overlay that
//? registered a custom adapter before this runs is never clobbered.
if (!isUserAdapterRegistered()) {
  registerUserAdapter(defaultPrismaUserAdapter());
}

//? LOGIN-01: all config/env reads are deferred into a factory function that
//? executes at first-request time, not at module-load time. This prevents
//? stale-config footguns when `getProjectConfig()` is overridden after import
//? (e.g. in tests or multi-step boot sequences). Module-load side effects
//? in the block below are now limited to adapter registration (which is safe
//? because the adapter registry itself does not depend on project config).
const buildProviders = (): OAuthProvider[] => {
  const dev = resolveEnvKey() !== 'production';

  //? Reads `DEV_<key>` in dev, the unprefixed `<key>` in prod. Empty when unset.
  const env = (key: string): string => (dev ? process.env[`DEV_${key}`] : process.env[key]) ?? '';

  //? Backend origin for the OAuth redirect URI. Prefer the explicit
  //? `oauthCallbackBase` slot; fall back to `app.publicUrl` so a consumer that
  //? only set `publicUrl` still gets a usable callback.
  const projectConfig = getProjectConfig();
  //? Empty-string slot (the default) must fall through to publicUrl. Use an
  //? explicit length check so `??` (which would keep the empty string) is wrong here.
  const configuredCallbackBase = projectConfig.oauthCallbackBase ?? '';
  const callbackBase = configuredCallbackBase.length > 0 ? configuredCallbackBase : projectConfig.app.publicUrl;
  const callback = (name: string): string => `${callbackBase}/auth/callback/${name}`;

  //? Credentials (email+password) is a registry entry too, gated by a single
  //? config flag so the registry — exposed via GET /auth/providers — is the ONE
  //? source the login form reads (no duplicate static `config.providers` list).
  const providers: OAuthProvider[] = [];
  if (projectConfig.auth.credentials) {
    providers.push(credentialsProvider());
  }

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

  return providers;
};

registerOAuthProviderFactory(buildProviders);
