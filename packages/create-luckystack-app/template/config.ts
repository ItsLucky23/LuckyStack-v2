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

export const dev = env('NODE_ENV') !== 'production';

//? Backend HTTP origin as the BROWSER reaches it — where the framework's own
//? routes live (notably the OAuth `/auth/callback/<provider>` handler). We use
//? `localhost` for the host (NOT SERVER_IP, which is just the bind address) so it
//? shares a host with the frontend on localhost — the session cookie set during
//? the OAuth callback is then visible to the app. The port is SERVER_PORT, so in
//? dev this is http://localhost:80.
const backendOrigin = `http://localhost:${env('SERVER_PORT') ?? '80'}`;

//? Public origin — where users actually browse the app. Drives post-login
//? redirects, transactional email links, and the CORS allow-list. In dev that's
//? the Vite dev server (keep in sync with vite.config.ts `server.port`); in
//? production set PUBLIC_URL to your deployed domain (frontend + backend share
//? one origin there, so PUBLIC_URL also covers the OAuth callback host).
const publicUrl = dev ? 'http://localhost:5173' : (env('PUBLIC_URL') ?? backendOrigin);

//? In the browser the app talks to its API surface same-origin — the Vite dev
//? proxy forwards /api, /sync, /auth, /socket.io, … to the backend in dev, and in
//? prod the frontend is served from the same origin. So client code uses the
//? current window origin; on the server we fall back to the public origin.
const browserOrigin = typeof window === 'undefined' ? undefined : window.location.origin;
export const backendUrl = browserOrigin ?? publicUrl;

//? OAuth callback base = the redirect_uri host you register with each provider.
//? `/auth/callback/<provider>` is a BACKEND route, so in dev this is the backend
//? origin — register e.g. http://localhost:80/auth/callback/google with Google.
//? In prod it's the public domain (same origin as the backend).
export const oauthCallbackBase = dev ? backendOrigin : publicUrl;

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
  app: { publicUrl },
  logging: config.logging,
  session: {
    basedToken: config.sessionBasedToken,
    expiryDays: config.sessionExpiryDays,
    allowMultiple: config.allowMultipleSessions,
  },
  http: {
    cors: {
      //? The backend's own origin is always allowed. Add extra hosts (a separate
      //? frontend domain, OAuth provider origins, …) to EXTERNAL_ORIGINS in
      //? `.env`, comma-separated — e.g. EXTERNAL_ORIGINS=https://app.example.com,https://accounts.google.com
      allowedOrigins: [publicUrl, backendOrigin, ...(env('EXTERNAL_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean)],
      //? In dev (NODE_ENV !== 'production') accept ANY localhost origin, so the
      //? Vite dev server on http://localhost:5173 (and :5174, :5175, … when the
      //? port is taken) can talk to the backend without listing each port. Stays
      //? false in production so deployments fail closed.
      allowLocalhost: dev,
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
