import { LANGUAGE, THEME, User } from "@prisma/client";
import type { BaseSessionLayout, Jsonify } from '@luckystack/core';
//? `@luckystack/core/config`, NOT the main barrel: this file is imported by both
//? bundles, and the barrel drags server-only modules (ioredis, bootUuid, paths)
//? into Vite's client bundle. That was the reason this used to reach straight
//? into `./packages/core/src/projectConfig` — but a deep source import resolves
//? to a SEPARATE module instance under Bun, so the config registered into a
//? registry `@luckystack/server` never read and the boot died. The subpath solves
//? both: it is client-safe AND it shares one registry with the barrel.
import { registerProjectConfig, registerSecretsResolvedListener } from '@luckystack/core/config';
//? Single source of truth for frontend + backend ports (pure data; see
//? config.ports.ts). Re-exported below so vite/app code + server share one source.
import { ports } from './config.ports';
export { ports } from './config.ports';

interface AppEnvironmentConfig {
  backendUrl: string;
  dev: boolean;
  sessionBasedToken?: boolean;
  sessionPerUser?: 'single' | 'multiple';
}

const normalizeDns = (dns: string): string => dns.replace(/\/+$/, "");
const runtimeWindow = globalThis as typeof globalThis & { window?: Window };

//? Browser-safe env reader. `process` is a Node global — referencing
//? `process.env.X` directly inside the client bundle throws
//? `ReferenceError: process is not defined`. Always go through `env(...)`
//? when reading env vars from this file (it's imported by both bundles).
const env = (key: string): string | undefined =>
  typeof process === 'undefined' ? undefined : process.env[key];

//? Default environment used both as the localhost entry AND as the fallback
//? when the detected DNS isn't in the map. Pulled out so the fallback path is
//? guaranteed non-undefined under `noUncheckedIndexedAccess`.
const fallbackEnvironment: AppEnvironmentConfig = {
  backendUrl: `http://localhost:${ports.backend}`,
  dev: true,
  sessionBasedToken: false,
  sessionPerUser: 'multiple',
};

const dnsEnvironmentMap: Record<string, AppEnvironmentConfig> = {
  "http://localhost:5173": fallbackEnvironment,
  "http://localhost:5174": {
    backendUrl: `http://localhost:${ports.backend}`,
    dev: true,
    sessionBasedToken: false,
    sessionPerUser: 'multiple'
  },
  "https://staging.server.com": {
    backendUrl: "https://staging.server.com",
    dev: false,
    sessionBasedToken: false,
    sessionPerUser: 'single'
  },
  "https://app.server.com": {
    backendUrl: "https://app.server.com",
    dev: false,
    sessionBasedToken: false,
    sessionPerUser: 'single'
  },
};

const detectDns = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const raw = runtimeWindow.window?.location.origin ?? (env('DNS') ?? "http://localhost:5173");
  const candidate = raw.split(',')[0]?.trim();
  const primary = candidate === undefined || candidate.length === 0 ? "http://localhost:5173" : candidate;
  return normalizeDns(primary);
};

const resolveEnvironment = (dns: string): AppEnvironmentConfig =>
  dnsEnvironmentMap[dns] ?? fallbackEnvironment;

const detectedDns = detectDns();
const resolvedEnvironment = resolveEnvironment(detectedDns);

//? Dev backend origin the BROWSER talks to. Two modes:
//?
//?  1. DEFAULT (no `?backend=`): the current window origin — i.e. the Vite dev
//?     server. Every /api /sync /auth /socket.io call then goes SAME-ORIGIN and
//?     Vite's proxy forwards it to the real backend, FOLLOWING an auto-increment
//?     hop live via `node_modules/.luckystack/dev-server.json`. This is what makes
//?     the socket, fetches, AND the LoginForm OAuth redirect keep working when the
//?     backend hops off a busy `:80` — instead of hard-failing against a dead port.
//?
//?  2. `?backend=<port>` (local multi-instance testing): point a SINGLE tab
//?     DIRECTLY at a specific backend instance (e.g. http://localhost:5173/?backend=4101).
//?     Restricted to `localhost:<port>` + dev, so a prod build can never be
//?     redirected. Persisted in per-tab sessionStorage so the choice survives the
//?     post-login full-page redirect (which drops the query string).
const resolveBackendUrl = (environment: AppEnvironmentConfig): string => {
  const base = environment.backendUrl;
  if (!environment.dev) return base;
  const win = runtimeWindow.window;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!win) return base;
  const fromUrl = new URLSearchParams(win.location.search).get("backend");
  const stored = win.sessionStorage.getItem("ls-dev-backend");
  const port = fromUrl && /^\d+$/.test(fromUrl) ? fromUrl : stored;
  //? No explicit override → same-origin, so the Vite proxy (which reads the real
  //? bound port from dev-server.json) follows the backend even after a hop.
  if (!port || !/^\d+$/.test(port)) return win.location.origin;
  win.sessionStorage.setItem("ls-dev-backend", port);
  const url = `http://localhost:${port}`;
  //? Make the override visible — otherwise "why is it on :4100 without a param?"
  //? is confusing. It's the per-tab sessionStorage remembering the last choice.
  console.log(`[dev] backend override → ${url} (from ${fromUrl ? "?backend= URL param" : "sessionStorage — last ?backend= in this tab"})`);
  return url;
};

const createConfig = (resolvedEnvironment: AppEnvironmentConfig) => ({
  /** The URL of the backend server. Update for production. */
  backendUrl: resolveBackendUrl(resolvedEnvironment),
 
  /** Enable extra console logs for debugging */
  dev: resolvedEnvironment.dev,

  /**
   * Granular logging and debug notification controls.
   *
   * Use these flags to avoid coupling all diagnostics to a single `dev` switch.
   */
  logging: {
    //? DEVTOOLS-LAG EXPERIMENT (branch debug/devtools-lag, handoff §5.1): devLogs +
    //? stream hard-off. Every object logged to the console is RETAINED by DevTools
    //? while open → residual lag even when no new logs are visible. Revert to
    //? `resolvedEnvironment.dev` if this makes no measurable difference.
    /** General debug logs in API/sync/client/server flows. */
    devLogs: false,
    /** Dev-only toast notifications for socket/API/sync errors. */
    devNotifications: resolvedEnvironment.dev,
    /** Client socket lifecycle status logs (connect/disconnect/reconnect). */
    socketStatus: resolvedEnvironment.dev,
    /** Server socket startup log line (SocketIO initialized). */
    socketStartup: true,
    /** Stream payload logs for API/Sync stream events. */
    stream: false,
  },
 
  /** Enable mobile-friendly console overlay (useful for debugging on phones) */
  mobileConsole: false,

  /** The title of the page */
  pageTitle: "LuckyStack",
 
  /** URL to redirect unauthenticated users */
  loginPageUrl: '/login',
 
  /** URL to redirect after successful login */
  loginRedirectUrl: '/playground',
 
  /**
   * 'single': logging in on a new device automatically signs out all other sessions for the user
   * (useful for security-sensitive apps). 'multiple': allow multiple simultaneous sessions.
   */
  sessionPerUser: resolvedEnvironment.sessionPerUser ?? 'single',
 
  /** 
    * Controls where auth tokens are read/written.
    * false: token is kept in HttpOnly cookies (shared across tabs, more secure).
    * true: token is kept in sessionStorage (tab-scoped sessions, useful for multi-account testing).
  */
  sessionBasedToken: resolvedEnvironment.sessionBasedToken ?? false,

  /**
   * Number of days before a session expires in Redis.
   * After this time, users will need to log in again.
   */
  sessionExpiryDays: 7,
 
  /**
   * Enable multiplayer awareness broadcasting.
   *
   * When FALSE:
   * - Sync events work normally between users in the same room
   * - Users don't know each other's connection status
   *
   * When TRUE:
   * - Users in the same room can see each other's status (online/AFK/reconnecting)
   * - Status is available via useSocketStatus() hook from SocketStatusProvider
   * - Useful for: multiplayer games, collaborative editors, presence indicators
   *
   * @example
   * ```tsx
   * import { useSocketStatus } from 'src/_providers/socketStatusProvider';
   *
   * function UserList() {
   *   const { socketStatus } = useSocketStatus();
   *   // socketStatus['user-id'] = { status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' }
   * }
   * ```
   */
  socketActivityBroadcaster: true,

  /**
   * Show the floating socket-status indicator badge in the corner of the screen.
   * Renders the `<SocketStatusIndicator />` from `@luckystack/presence/client`.
   * Useful in development to confirm connect/disconnect/reconnect state at a glance.
   */
  socketStatusIndicator: true,

  /**
   * Enable route-based location syncing from client to server session.
   *
   * When FALSE:
   * - Client will not emit `updateLocation` on route changes
   * - Server will skip writing `user.location` updates
   * - Any logic that depends on `user.location` (for example sync targeting by page) will be inactive
   *
   * When TRUE:
   * - Route changes are synced to the session via `user.location`
   */
  locationProviderEnabled: false as const,
 
  /** Default language for notifications and UI (matches files in src/_locales/) */
  defaultLanguage: 'en' as LANGUAGE,
 
  /** Default theme when user hasn't set a preference */
  defaultTheme: 'light' as THEME,

  /**
   * Rate limiting configuration for API requests.
   * Uses Redis-backed storage so counters are shared across processes and
   * instances (correct for multi-instance deploys behind the router). Switch
   * `store` to 'memory' only for a single-process deployment.
   *
   * @example Per-API override:
   * ```typescript
   * // In any _api/*.ts file
   * export const rateLimit = 60;    // 60 requests/minute
   * export const rateLimit = false; // Disable for this API
   * ```
   */
  rateLimiting: {
    /** Storage backend used for rate limiting counters. Use 'redis' for multi-instance consistency. */
    store: 'redis' as 'memory' | 'redis',
    /** Redis key namespace suffix used when store is set to 'redis'. */
    redisKeyPrefix: 'rate-limit',
    /** Fallback requests per minute for any API that does not export its own rateLimit. */
    defaultApiLimit: 60 as number | false,
    /** Global requests per minute per IP across all API routes combined. */
    defaultIpLimit: 100 as number | false,
    /** Request window duration in milliseconds used by both limits. */
    windowMs: 60_000,
  },

  /**
   * Transactional email configuration. The actual sender adapter is
   * registered in the server bootstrap (see `server/server.ts`). These values
   * are read by `sendEmail()` and the framework's password-reset flow.
   */
  email: {
    /**
     * Default sender address. Override per-message by passing `from` to sendEmail.
     * Read server-side only — the client bundle never sends email, so the value
     * is just a placeholder there. `typeof process` guard keeps the browser
     * bundle from blowing up on a `process is not defined` ReferenceError.
     *
     * READ AT CALL TIME, deliberately — a getter, not a value. This module is
     * imported by server.ts long before it awaits `resolveSecretsIfConfigured()`,
     * so a plain `from: env('EMAIL_FROM')` froze whatever was in process.env at
     * import: a secret-manager pointer never became the real address. The read
     * sites (`registerEmailConfig` + `autoSelectEmailSender`) both run AFTER the
     * resolve, so evaluating here rather than there is all it takes. Same fix as
     * `readRedisHost()` in core (finding B9): call-time env, not a snapshot.
     *
     * Measured before/after (finding C-04): with EMAIL_FROM=EMAIL_FROM_BASE_V1 at
     * import and the resolver later writing real-sender@company.com, the old
     * literal handed `EMAIL_FROM_BASE_V1` to the sender; the getter hands the real
     * address. Do not "simplify" this back to a value.
     */
    get from(): string { return env('EMAIL_FROM') ?? 'onboarding@resend.dev'; },
    /** Throw if sendEmail() runs with no sender registered. False = silent no-op. */
    required: false,
    logging: {
      errors: true,
      sends: resolvedEnvironment.dev,
    },
  },

  /**
   * Sentry sampling configuration.
   * Adjust these values to control observability volume and cost.
   */
  sentry: {
    client: {
      tracesSampleRate: {
        development: 1,
        production: 0.2,
      },
      replaysSessionSampleRate: {
        development: 0,
        production: 0.1,
      },
      replaysOnErrorSampleRate: {
        development: 1,
        production: 1,
      },
    },
    server: {
      tracesSampleRate: {
        development: 1,
        production: 0.2,
      },
    },
  },

  /**
   * Optional @luckystack/secret-manager wiring. When `url` is set AND the package
   * is installed, server boot resolves `.env` pointers (`NAME=BASE_V<n>`) against
   * the external secret-manager server and overwrites `process.env` with the real
   * values in remote mode — an unresolved pointer or an unreachable server is a
   * HARD boot failure. When `url` is empty, or the package isn't installed, boot
   * falls through to the plain local env files: no resolution, no crash.
   *
   * The shared bearer token is NOT an env var — it lives in a gitignored
   * single-line file referenced via `{ fromFile }`. See
   * `docs/ARCHITECTURE_SECRET_MANAGER.md`.
   */
  secretManager: {
    url: env('LUCKYSTACK_SECRET_MANAGER_URL') ?? '',
    token: { fromFile: '.secret-manager-token' },
    //? Dev-only: poll the server every 30s for secret rotations (a new version
    //? published server-side WITHOUT a local file change). `watch: false` because
    //? the dev supervisor already restarts on `.env` changes. No-op in production
    //? and when `url` is empty (init is skipped entirely).
    dev: { watch: false, pollIntervalMs: 30_000 },
  },
});

const config = createConfig(resolvedEnvironment);
 
// ============================================
// TYPE DEFINITIONS
// ============================================

export type { SessionLocation, AuthProps } from '@luckystack/core';

// Project-specific session shape — extends the Prisma User model and satisfies BaseSessionLayout.
interface SessionLayoutBase extends Omit<User, 'password'> {
  avatarFallback: string;
  token: string;
  roomCodes?: string[];
}

/**
 * The session as a handler RECEIVES it — hence `Jsonify`.
 *
 * Sessions are persisted to Redis with `JSON.stringify` and read back with
 * `JSON.parse` (`@luckystack/login`'s `session.ts`). JSON has no `Date`, so a
 * `createdAt` that was a Date on the way in is an ISO **string** on the way out.
 * Inheriting Prisma's `User` verbatim therefore declared `createdAt: Date` for a
 * value that is a string at runtime: `user.createdAt.getTime()` compiled inside
 * an API handler and threw.
 *
 * `Jsonify<T>` states the round-trip truth. It is the same rule the codegen
 * applies to route outputs — this is its hand-written counterpart, one layer up.
 * The write side is unaffected: login builds the session from a live Prisma user
 * and the serializer converts on the way in.
 */
export interface SessionLayout extends Jsonify<SessionLayoutBase> {
  location?: import('@luckystack/core').SessionLocation;
  /** CSRF token bound to this session. Minted by `saveSession` in cookie mode. */
  csrfToken?: string;
  //? `lastLogin` comes from Prisma's User via SessionLayoutBase, already
  //? projected to `string | null` by Jsonify — do not redeclare it here.
  /** Previous successful login, runtime-only (not a Prisma column). */
  previousLogin?: string | null;
}

// Verify SessionLayout is structurally compatible with BaseSessionLayout at compile time.
export type _SessionLayoutCheck = SessionLayout extends BaseSessionLayout ? true : never;

//? @adr 0018 — CLIENT-facing session shape: a copy of `SessionLayout` WITHOUT the
//? server-only credential fields (`token` = the HttpOnly-cookie credential;
//? `csrfToken` = fetched separately via `/auth/csrf`, never needed off the session
//? object). Server-side API/sync handlers keep using the full `SessionLayout`
//? (they legitimately need `user.token` for revoke/sign-out flows); page JS uses
//? this. `session_v1` returns this shape and `SessionProvider` holds it, so the
//? token can never reach page JS in cookie mode by construction — while the
//? server-side typing is untouched.
//?
//? No `Jsonify` wrapper here, deliberately: `SessionLayout` is ALREADY the
//? post-round-trip shape (see its own comment — a session comes back out of Redis
//? as JSON), so a handler and page JS hold the same value apart from the two
//? credential fields. Projecting again would be a no-op that implies a conversion
//? which never happens.
export type ClientSessionLayout = Omit<SessionLayout, 'token' | 'csrfToken'>;

//? OAuth providers + the credentials form are now ENV-DRIVEN and read from the
//? live registry via `GET /auth/providers` (a provider registers in
//? `@luckystack/login/register` only when its *_CLIENT_ID + *_CLIENT_SECRET are
//? set; credentials is gated by `auth.credentials`). No static `providers` array.
//?
//? Build the CORS allowedOrigins list from the env vars this project cares
//? about. The framework no longer reads DNS/EXTERNAL_ORIGINS itself — it
//? expects an explicit list via ProjectConfig.http.cors.allowedOrigins.
const splitOriginEnv = (key: string): string[] =>
  (env(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const collectAllowedOrigins = (): string[] =>
  [...splitOriginEnv('DNS'), ...splitOriginEnv('EXTERNAL_ORIGINS')];

//? @adr 0030 — Build the COMPLETE registration from current env. Repeated
//? `registerProjectConfig` calls are replacement registrations: each one merges
//? over pristine defaults, not over the previous active value. A listener that
//? re-registers only CORS therefore resets unrelated auth/session/rate-limit
//? policy. Rebuilding the complete registration preserves those slots and also
//? refreshes every DNS-derived URL coherently after secret resolution.
const createProjectConfigRegistration = () => {
  const currentDetectedDns = detectDns();
  const currentEnvironment = resolveEnvironment(currentDetectedDns);
  const currentConfig = createConfig(currentEnvironment);

  return {
    app: {
      //? The PUBLIC app origin — where the SPA routes live. Email links
      //? (/reset-password, /settings/confirm-email) are built on this base, so
      //? it must point at the FRONTEND (dev: Vite on :5173), not the backend.
      //? Server-side this is the first DNS entry; in the browser it's the
      //? window origin. OAuth callbacks use `oauthCallbackBase` (backend) below.
      publicUrl: currentDetectedDns,
    },
    logging: currentConfig.logging,
    rateLimiting: currentConfig.rateLimiting,
    session: {
      basedToken: currentConfig.sessionBasedToken,
      expiryDays: currentConfig.sessionExpiryDays,
      perUser: currentConfig.sessionPerUser,
    },
    http: {
      cors: {
        allowedOrigins: collectAllowedOrigins(),
        //? Convenience for local dev: any localhost origin is accepted regardless
        //? of port. Production deployments should keep this `false` (the framework
        //? default) and rely on `allowedOrigins` only.
        allowLocalhost: currentEnvironment.dev,
      },
    },
    defaultLanguage: currentConfig.defaultLanguage,
    //? Backend origin for OAuth callback redirect URIs, read by
    //? @luckystack/login/register's env-driven provider scan.
    //?
    //? In dev: derive from the actual SERVER_PORT env var so that starting the
    //? server on a non-standard port (e.g. SERVER_PORT=8080 for parallel instances)
    //? produces the correct redirect_uri automatically. `currentEnvironment.backendUrl`
    //? is a static DNS-map value (always :80) and is NOT overridden by ?backend=,
    //? so it cannot be used here for multi-port dev setups.
    //? In prod: use the static backendUrl from the DNS map (the public domain).
    oauthCallbackBase: currentEnvironment.dev
      ? `http://localhost:${env('SERVER_PORT') ?? ports.backend}`
      : currentEnvironment.backendUrl,
    socketActivityBroadcaster: currentConfig.socketActivityBroadcaster,
    socketStatusIndicator: currentConfig.socketStatusIndicator,
    locationProviderEnabled: currentConfig.locationProviderEnabled,
    loginRedirectUrl: currentConfig.loginRedirectUrl,
    auth: {
      //? forgot-password is a @luckystack/login feature: it ONLY works when
      //? @luckystack/login is installed (no login package ⇒ no auth surface ⇒ this key
      //? does nothing). 'framework' mode ALSO needs @luckystack/email installed + a
      //? sender registered in server.ts to deliver the reset mail; without a sender it
      //? silently no-ops (anti-enumeration). Use 'disabled' / 'custom' to opt out.
      forgotPassword: 'framework' as const,
    },
  };
};

//? Re-register after the secret manager has overwritten process.env. No secret
//? manager means the listener never fires and the initial registration is final.
registerSecretsResolvedListener(() => {
  registerProjectConfig(createProjectConfigRegistration());
});

//? Side-effect registration: any import of this file — client bundle entry,
//? server entry, tests — wires the project config into @luckystack/core so
//? framework packages read the right values.
registerProjectConfig(createProjectConfigRegistration());

export default config;
export const {
  backendUrl,
  dev,
  loginPageUrl,
  loginRedirectUrl,
  defaultLanguage,
  mobileConsole,
  sessionPerUser,
  sessionBasedToken,
  sessionExpiryDays,
  socketActivityBroadcaster,
  socketStatusIndicator,
  locationProviderEnabled,
  defaultTheme,
  logging,
  rateLimiting,
  sentry,
  pageTitle
} = config;