import { LANGUAGE, THEME, User } from "@prisma/client";
import type { BaseSessionLayout } from '@luckystack/login';
//? Import from the specific file (not the barrel) so Vite's client bundle
//? doesn't drag server-only core modules (bootUuid, ioredis, etc.) into the
//? browser. Same rule we use in apiRequest/syncRequest.
import { registerProjectConfig } from './packages/core/src/projectConfig';

interface AppEnvironmentConfig {
  backendUrl: string;
  dev: boolean;
  sessionBasedToken?: boolean;
  allowMultipleSessions?: boolean;
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
  backendUrl: "http://localhost:80",
  dev: true,
  sessionBasedToken: true,
  allowMultipleSessions: true,
};

const dnsEnvironmentMap: Record<string, AppEnvironmentConfig> = {
  "http://localhost:5173": fallbackEnvironment,
  "http://localhost:5174": {
    backendUrl: "http://localhost:81",
    dev: true,
    sessionBasedToken: true,
    allowMultipleSessions: true
  },
  "https://staging.server.com": {
    backendUrl: "https://staging.server.com",
    dev: false,
    sessionBasedToken: false,
    allowMultipleSessions: false
  },
  "https://app.server.com": {
    backendUrl: "https://app.server.com",
    dev: false,
    sessionBasedToken: false,
    allowMultipleSessions: false
  },
};

const detectedDns = normalizeDns(
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  runtimeWindow.window?.location.origin ?? (env('DNS') ?? "http://localhost:5173"),
);

const resolvedEnvironment: AppEnvironmentConfig =
  dnsEnvironmentMap[detectedDns] ?? fallbackEnvironment;

const config = {
  /** The URL of the backend server. Update for production. */
  backendUrl: resolvedEnvironment.backendUrl,
 
  /** Enable extra console logs for debugging */
  dev: resolvedEnvironment.dev,

  /**
   * Granular logging and debug notification controls.
   *
   * Use these flags to avoid coupling all diagnostics to a single `dev` switch.
   */
  logging: {
    /** General debug logs in API/sync/client/server flows. */
    devLogs: resolvedEnvironment.dev,
    /** Dev-only toast notifications for socket/API/sync errors. */
    devNotifications: resolvedEnvironment.dev,
    /** Client socket lifecycle status logs (connect/disconnect/reconnect). */
    socketStatus: resolvedEnvironment.dev,
    /** Server socket startup log line (SocketIO initialized). */
    socketStartup: true,
    /** Stream payload logs for API/Sync stream events. */
    stream: resolvedEnvironment.dev,
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
   * If false, logging in on a new device will automatically sign out all other sessions for the user.
   * Useful for security-sensitive apps. Set to true to allow multiple simultaneous sessions.
   */
  allowMultipleSessions: resolvedEnvironment.allowMultipleSessions ?? false,
 
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
  socketActivityBroadcaster: false,

  /**
   * Show the floating socket-status indicator badge in the corner of the screen.
   * Renders the `<SocketStatusIndicator />` from `@luckystack/presence/client`.
   * Useful in development to confirm connect/disconnect/reconnect state at a glance.
   */
  socketStatusIndicator: false,

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
   * Uses in-memory storage (suitable for single-server deployments).
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
    store: 'memory' as 'memory' | 'redis',
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
     */
    from: env('EMAIL_FROM') ?? 'onboarding@resend.dev',
    /** Public app URL — used to build absolute reset-password / verification links. */
    appUrl: resolvedEnvironment.backendUrl,
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
};
 
// ============================================
// TYPE DEFINITIONS
// ============================================

export type { SessionLocation, AuthProps } from '@luckystack/login';

// Project-specific session shape — extends the Prisma User model and satisfies BaseSessionLayout.
interface SessionLayoutBase extends Omit<User, 'password'> {
  avatarFallback: string;
  token: string;
  roomCodes?: string[];
}

export interface SessionLayout extends SessionLayoutBase {
  location?: import('@luckystack/login').SessionLocation;
  /** CSRF token bound to this session. Minted by `saveSession` in cookie mode. */
  csrfToken?: string;
  //? `lastLogin` already comes from Prisma's User model via SessionLayoutBase
  //? — don't redeclare it here (TS would flag the widening as incompatible).
  /** Previous successful login, runtime-only (not a Prisma column). */
  previousLogin?: Date | string | null;
}

// Verify SessionLayout is structurally compatible with BaseSessionLayout at compile time.
export type _SessionLayoutCheck = SessionLayout extends BaseSessionLayout ? true : never;
 
/** Supported OAuth providers */
export const providers = ['credentials', 'google', 'github', 'facebook', 'discord'];
 
//? Build the CORS allowedOrigins list from the env vars this project cares
//? about. The framework no longer reads DNS/EXTERNAL_ORIGINS itself — it
//? expects an explicit list via ProjectConfig.http.cors.allowedOrigins.
const splitOriginEnv = (key: string): string[] =>
  (env(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const collectAllowedOrigins = (): string[] =>
  [...splitOriginEnv('DNS'), ...splitOriginEnv('EXTERNAL_ORIGINS')];

//? Side-effect registration: any import of this file — client bundle entry,
//? server entry, tests — wires the project config into @luckystack/core so
//? framework packages read the right values. Server re-registers explicitly
//? in server.ts for order safety, which is a no-op overwrite.
registerProjectConfig({
  app: {
    publicUrl: resolvedEnvironment.backendUrl,
  },
  logging: config.logging,
  rateLimiting: config.rateLimiting,
  session: {
    basedToken: config.sessionBasedToken,
    expiryDays: config.sessionExpiryDays,
    allowMultiple: config.allowMultipleSessions,
  },
  http: {
    cors: {
      allowedOrigins: collectAllowedOrigins(),
      //? Convenience for local dev: any localhost origin is accepted regardless
      //? of port. Production deployments should keep this `false` (the framework
      //? default) and rely on `allowedOrigins` only.
      allowLocalhost: resolvedEnvironment.dev,
    },
  },
  defaultLanguage: config.defaultLanguage,
  socketActivityBroadcaster: config.socketActivityBroadcaster,
  socketStatusIndicator: config.socketStatusIndicator,
  locationProviderEnabled: config.locationProviderEnabled,
  loginRedirectUrl: config.loginRedirectUrl,
  auth: {
    forgotPassword: 'framework',
  },
});

export default config;
export const {
  backendUrl,
  dev,
  loginPageUrl,
  loginRedirectUrl,
  defaultLanguage,
  mobileConsole,
  allowMultipleSessions,
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