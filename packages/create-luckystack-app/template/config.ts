//? Project-level config. Registered into `@luckystack/core` at module load
//? (side-effect import) so framework packages read your overrides via
//? `getProjectConfig()`. Edit values here to tune the framework's behavior.

import { registerProjectConfig } from '@luckystack/core';

//? This file is imported by BOTH the Node server and the Vite browser bundle.
//? `process` is a Node global — referencing `process.env.X` directly in the
//? client bundle throws `ReferenceError: process is not defined`. Always read
//? env vars through `env(...)`, which returns undefined when `process` is absent.
const env = (key: string): string | undefined =>
  typeof process === 'undefined' ? undefined : process.env[key];

//? In the browser the app is same-origin with the backend — the Vite dev proxy
//? forwards /api, /sync, /socket.io, … to SERVER_IP:SERVER_PORT, and in prod the
//? frontend is served from the backend origin. On the server we read env vars.
const browserOrigin = typeof window === 'undefined' ? undefined : window.location.origin;

export const dev = env('NODE_ENV') !== 'production';
export const backendUrl =
  browserOrigin ?? env('DNS') ?? `http://${env('SERVER_IP') ?? '127.0.0.1'}:${env('SERVER_PORT') ?? '80'}`;

const config = {
  pageTitle: '{{PROJECT_TITLE}}',
  loginPageUrl: '/login',
  loginRedirectUrl: '/dashboard',
  defaultLanguage: 'en' as const,
  defaultTheme: 'light' as const,
  /** false = HttpOnly cookie, true = sessionStorage. */
  sessionBasedToken: false,
  sessionExpiryDays: 7,
  allowMultipleSessions: false,
  //? Auth providers shown on the login/register form. Keep 'credentials' for
  //? email+password; add OAuth provider ids (e.g. 'google') once you register
  //? them in server.ts and set their env vars.
  providers: ['credentials'] as string[],
  //? Presence/activity broadcasting + route-change location syncing. Opt-in.
  socketActivityBroadcaster: false,
  locationProviderEnabled: false,
  //? Dev-only console logging toggles.
  logging: {
    devLogs: dev,
    devNotifications: dev,
    socketStatus: dev,
    socketStartup: true,
    stream: dev,
  },
  //? Optional @luckystack/secret-manager (opt-in). Uncomment + set
  //? LUCKYSTACK_SECRET_MANAGER_URL to resolve `.env` pointers (NAME=BASE_V<n>)
  //? against an external secret server at boot (see server.ts + the docs).
  // secretManager: {
  //   url: process.env.LUCKYSTACK_SECRET_MANAGER_URL ?? '',
  //   token: { fromFile: '.secret-manager-token' },
  // },
};

registerProjectConfig({
  app: { publicUrl: backendUrl },
  logging: config.logging,
  session: {
    basedToken: config.sessionBasedToken,
    expiryDays: config.sessionExpiryDays,
    allowMultiple: config.allowMultipleSessions,
  },
  http: {
    cors: {
      allowedOrigins: [backendUrl, ...(env('EXTERNAL_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean)],
    },
  },
  defaultLanguage: config.defaultLanguage,
  loginRedirectUrl: config.loginRedirectUrl,
  socketActivityBroadcaster: config.socketActivityBroadcaster,
  locationProviderEnabled: config.locationProviderEnabled,
  //? Framework-mode forgot-password (needs @luckystack/email installed + a
  //? sender registered in server.ts). Set to 'disabled' or 'custom' to opt out.
  auth: { forgotPassword: 'framework' },
});

export default config;
export const {
  pageTitle,
  loginPageUrl,
  loginRedirectUrl,
  defaultLanguage,
  defaultTheme,
  sessionBasedToken,
  sessionExpiryDays,
  allowMultipleSessions,
  providers,
  socketActivityBroadcaster,
  locationProviderEnabled,
  logging,
} = config;

// Project-specific session shape. Extend the framework's BaseSessionLayout
// with whatever extra fields your User model has. Keep it structurally
// compatible with BaseSessionLayout (the type-check below enforces it).
import type { BaseSessionLayout } from '@luckystack/login';
import type { User } from '@prisma/client';

//? Re-export AuthProps so file-based `_api` / `_sync` handlers can
//? `import { AuthProps } from '../../config'` (mirrors the framework's config.ts).
//? It originates in @luckystack/core and is re-exported by @luckystack/login.
export type { AuthProps } from '@luckystack/login';

export interface SessionLayout extends Omit<User, 'password'> {
  avatarFallback: string;
  token: string;
  roomCodes?: string[];
}

export type _SessionLayoutCheck = SessionLayout extends BaseSessionLayout ? true : never;
