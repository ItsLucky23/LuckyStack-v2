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

const dnsEnvironmentMap: Record<string, AppEnvironmentConfig> = {
  "http://localhost:5173": {
    backendUrl: "http://localhost:80",
    dev: true,
    sessionBasedToken: true,
    allowMultipleSessions: true
  },
  "http://localhost:5176": {
    backendUrl: "http://localhost:83",
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
  runtimeWindow.window?.location.origin ?? (process.env.DNS ?? "http://localhost:5173"),
);

const resolvedEnvironment =
  dnsEnvironmentMap[detectedDns] ?? dnsEnvironmentMap["http://localhost:5173"];

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
  loginRedirectUrl: '/dashboard',
 
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
}

// Verify SessionLayout is structurally compatible with BaseSessionLayout at compile time.
export type _SessionLayoutCheck = SessionLayout extends BaseSessionLayout ? true : never;
 
/** Supported OAuth providers */
export const providers = ['credentials', 'google', 'github', 'facebook', 'discord'];
 
//? Side-effect registration: any import of this file — client bundle entry,
//? server entry, tests — wires the project config into @luckystack/core so
//? framework packages read the right values. Server re-registers explicitly
//? in server.ts for order safety, which is a no-op overwrite.
registerProjectConfig({
  logging: config.logging,
  rateLimiting: config.rateLimiting,
  session: {
    basedToken: config.sessionBasedToken,
    expiryDays: config.sessionExpiryDays,
    allowMultiple: config.allowMultipleSessions,
  },
  defaultLanguage: config.defaultLanguage as unknown as string,
  sentry: config.sentry,
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
  locationProviderEnabled,
  defaultTheme,
  logging,
  rateLimiting,
  sentry,
  pageTitle
} = config;