//? Project-level config. Registered into `@luckystack/core` at module load
//? (side-effect import) so framework packages read your overrides via
//? `getProjectConfig()`. Edit values here to tune the framework's behavior.

//? `/config`, not the main barrel: this file is imported by BOTH bundles, and the
//? barrel drags the whole server surface — ioredis included — into the browser.
//? The subpath exposes only the config registry (both share one registry, so
//? `getProjectConfig()` from the barrel still sees what is registered here).
import { registerProjectConfig, registerSecretsResolvedListener } from '@luckystack/core/config';
//? Frontend + backend ports live in ONE pure-data file (no side-effects) so
//? `vite.config.ts` can read them without importing this config. Re-exported so
//? app code + `server.ts` share the same single source of truth.
import { ports } from './config.ports';
export { ports } from './config.ports';

//? This file is imported by BOTH the Node server and the Vite browser bundle.
//? `process` is a Node global — referencing `process.env.X` directly in the
//? client bundle throws `ReferenceError: process is not defined`. Always read
//? env vars through `env(...)`, which returns undefined when `process` is absent.
const env = (key: string): string | undefined =>
  typeof process === 'undefined' ? undefined : process.env[key];

//? Honors LUCKYSTACK_ENV first (the framework canonical, mirroring core's
//? `resolveEnvKey()`), then NODE_ENV — via the browser-safe `env()` helper so
//? this dual-bundle file never references `process` directly in the client.
const resolveDev = (): boolean => (env('LUCKYSTACK_ENV') ?? env('NODE_ENV')) !== 'production';
export const dev = resolveDev();

//? Backend HTTP origin as the BROWSER reaches it — where the framework's own
//? routes live (notably the OAuth `/auth/callback/<provider>` handler). We use
//? `localhost` for the host (NOT SERVER_IP, which is just the bind address) so it
//? shares a host with the frontend on localhost — the session cookie set during
//? the OAuth callback is then visible to the app. The port defaults to
//? `config.ports.ts` (`backend`) — so in dev this is http://localhost:80 — but a
//? positional argv port (`npm run server -- <preset> <port>`, which parseArgv
//? writes to process.env.SERVER_PORT) overrides it, mirroring createServer.
const resolveBackendOrigin = (): string =>
  `http://localhost:${env('SERVER_PORT') ?? ports.backend}`;
const backendOrigin = resolveBackendOrigin();

//? Public origin — where users actually browse the app. Drives post-login
//? redirects, transactional email links, and the CORS allow-list. In dev that's
//? the Vite dev server on `config.ports.ts` `frontend`; in production set
//? PUBLIC_URL to your deployed domain (frontend + backend share one origin
//? there, so PUBLIC_URL also covers the OAuth callback host).
const resolvePublicUrl = (isDev: boolean, currentBackendOrigin: string): string =>
  isDev ? `http://localhost:${ports.frontend}` : (env('PUBLIC_URL') ?? currentBackendOrigin);
const publicUrl = resolvePublicUrl(dev, backendOrigin);

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

const createConfig = (isDev: boolean) => ({
  pageTitle: '{{PROJECT_TITLE}}',
  loginPageUrl: '/login',
  loginRedirectUrl: '/dashboard',
  defaultLanguage: 'en' as const,
  defaultTheme: 'light' as const,
  /** false = HttpOnly cookie, true = sessionStorage. */
  sessionBasedToken: false,
  sessionExpiryDays: 7,
  //? `'single'` (default): logging in on a new device kicks the previous one.
  //? `'multiple'` enables multiple concurrent sessions per user across devices.
  sessionPerUser: 'single' as const,
  //? Presence/activity broadcasting + route-change location syncing. Opt-in.
  socketActivityBroadcaster: false,
  socketStatusIndicator: false,
  locationProviderEnabled: false,
  //? Dev-only console logging toggles.
  logging: {
    devLogs: isDev,
    devNotifications: isDev,
    socketStatus: isDev,
    socketStartup: true,
    stream: isDev,
  },
  //? Rate limiting for API requests (Redis-backed so counters are shared across
  //? instances). Per-route override: `export const rateLimit = 60;` (or `false`)
  //? in any `_api/*.ts`. Read by the framework limiter + the docs-ui explorer.
  rateLimiting: {
    store: 'redis' as 'memory' | 'redis',
    redisKeyPrefix: 'rate-limit',
    defaultApiLimit: 60 as number | false,
    defaultIpLimit: 100 as number | false,
    windowMs: 60_000,
  },
  //? Optional @luckystack/secret-manager (opt-in). Uncomment + set
  //? LUCKYSTACK_SECRET_MANAGER_URL to resolve `.env` pointers (NAME=BASE_V<n>)
  //? against an external secret server at boot (see server.ts + the docs).
  // secretManager: {
  //   url: env('LUCKYSTACK_SECRET_MANAGER_URL') ?? '',
  //   token: { fromFile: '.secret-manager-token' },
  // },
});

const config = createConfig(dev);

//? The backend's own origin is always allowed. Add extra hosts (a separate
//? frontend domain, OAuth provider origins, …) to EXTERNAL_ORIGINS in `.env`,
//? comma-separated — e.g. EXTERNAL_ORIGINS=https://app.example.com,https://accounts.google.com
//?
//? A FUNCTION, not an inline array, so it can be re-run — see the listener below.
const collectAllowedOrigins = (currentPublicUrl: string, currentBackendOrigin: string): string[] =>
  [currentPublicUrl, currentBackendOrigin, ...(env('EXTERNAL_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean)];

//? @adr 0030 — Build a COMPLETE replacement registration from current env. The project
//? registry intentionally rebuilds every call over pristine defaults; applying
//? only a CORS partial here would reset unrelated auth/session/rate-limit policy.
//? Recomputing the URL family together also prevents publicUrl/CORS/OAuth drift.
const createProjectConfigRegistration = () => {
  const currentDev = resolveDev();
  const currentBackendOrigin = resolveBackendOrigin();
  const currentPublicUrl = resolvePublicUrl(currentDev, currentBackendOrigin);
  const currentConfig = createConfig(currentDev);

  return {
    app: { publicUrl: currentPublicUrl },
    logging: currentConfig.logging,
    rateLimiting: currentConfig.rateLimiting,
    session: {
      basedToken: currentConfig.sessionBasedToken,
      expiryDays: currentConfig.sessionExpiryDays,
      perUser: currentConfig.sessionPerUser,
    },
    http: {
      cors: {
        allowedOrigins: collectAllowedOrigins(currentPublicUrl, currentBackendOrigin),
        //? In dev (NODE_ENV !== 'production') accept ANY localhost origin, so the
        //? Vite dev server on http://localhost:5173 (and :5174, :5175, … when the
        //? port is taken) can talk to the backend without listing each port. Stays
        //? false in production so deployments fail closed.
        allowLocalhost: currentDev,
        //? NOTE: the initial Socket.io polling handshake is an origin-less GET in
        //? BOTH dev (Vite proxy → backend) and prod-with-router (single origin),
        //? because browsers omit the `Origin` header on same-origin requests. The
        //? framework's CORS layer admits origin-less handshakes unconditionally
        //? (see @luckystack/server loadSocket.ts) — this list only gates requests
        //? that DO carry an `Origin` header (cross-origin browsers, OAuth
        //? callbacks). So you do NOT need to list every same-origin variant here.
      },
    },
    defaultLanguage: currentConfig.defaultLanguage,
    loginRedirectUrl: currentConfig.loginRedirectUrl,
    //? Backend origin for OAuth callback redirect URIs. Read by
    //? @luckystack/login/register's env-driven provider scan so adding an OAuth
    //? provider is just env vars + restart (no code edit).
    oauthCallbackBase: currentDev ? currentBackendOrigin : currentPublicUrl,
    socketActivityBroadcaster: currentConfig.socketActivityBroadcaster,
    socketStatusIndicator: currentConfig.socketStatusIndicator,
    locationProviderEnabled: currentConfig.locationProviderEnabled,
    auth: {
      //? forgot-password is a @luckystack/login feature: it ONLY works with
      //? @luckystack/login installed. 'framework' mode ALSO needs @luckystack/email
      //? installed + a sender registered in server.ts to deliver the reset mail.
      //? Set to 'disabled' or 'custom' to opt out.
      forgotPassword: 'framework' as const,
      //? Email+password auth. Set `false` for an OAuth-only app — the login form
      //? hides the email/password fields and the credentials route rejects.
      credentials: true,
      //? Passwordless email-code login (ADR 0024): uncomment to let users sign in
      //? with a short numeric code sent to their email (needs @luckystack/email).
      // emailCodeLogin: true,
      //? Second factor (ADR 0024): 'optional' lets users enroll an authenticator
      //? app (Google/Microsoft Authenticator, Authy, … — the open TOTP standard).
      //? Enrolled users answer a 2FA challenge at login; recovery codes + an
      //? email-code fallback are included. Tip: set TOTP_ENCRYPTION_KEY (and,
      //? during rotation, TOTP_ENCRYPTION_LEGACY_KEYS as a JSON array) in
      //? .env.local to encrypt the TOTP secrets at rest.
      // twoFactor: 'optional',
    },
  };
};

//? This file loads before secret resolution. Re-register the complete config
//? after process.env changes; without a secret manager the listener never fires.
registerSecretsResolvedListener(() => {
  registerProjectConfig(createProjectConfigRegistration());
});

registerProjectConfig(createProjectConfigRegistration());

export default config;
export const {
  pageTitle,
  loginPageUrl,
  loginRedirectUrl,
  defaultLanguage,
  defaultTheme,
  sessionBasedToken,
  sessionExpiryDays,
  sessionPerUser,
  socketActivityBroadcaster,
  socketStatusIndicator,
  locationProviderEnabled,
  logging,
  rateLimiting,
} = config;

// Project-specific session shape. Extend the framework's BaseSessionLayout
// with whatever extra fields your User model has. Keep it structurally
// compatible with BaseSessionLayout (the type-check below enforces it).
import type { BaseSessionLayout, Jsonify } from '@luckystack/core';
import type { User } from '@prisma/client';

//? Re-export AuthProps so file-based `_api` / `_sync` handlers can
//? `import { AuthProps } from '../../config'` (mirrors the framework's config.ts).
//? It originates in @luckystack/core (login re-exports it too); we import from
//? core so this file compiles identically with or without @luckystack/login.
export type { AuthProps } from '@luckystack/core';

/**
 * The session as a handler RECEIVES it — hence `Jsonify`.
 *
 * Sessions are persisted to Redis with `JSON.stringify` and read back with
 * `JSON.parse`. JSON has no `Date`, so a `createdAt` that was a Date on the way
 * in is an ISO **string** on the way out. Inheriting Prisma's `User` verbatim
 * would declare `createdAt: Date` for a value that is a string at runtime, and
 * `user.createdAt.getTime()` would compile inside an API handler and then throw.
 *
 * The write side is unaffected: login builds the session from a live Prisma user
 * and the serializer converts on the way in.
 */
export interface SessionLayout extends Jsonify<Omit<User, 'password'>> {
  avatarFallback: string;
  token: string;
  roomCodes?: string[];
}

export type _SessionLayoutCheck = SessionLayout extends BaseSessionLayout ? true : never;
