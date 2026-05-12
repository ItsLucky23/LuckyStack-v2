//? Project-level runtime configuration, consumed by framework packages via
//? `getProjectConfig()`. The project's entrypoint calls
//? `registerProjectConfig({...})` once at boot — before any framework code
//? issues API/sync requests — mirroring the pattern we use for the localized
//? normalizer.
//?
//? Everything here is runtime-settable. Type-level project shapes
//? (`SessionLayout`, etc.) stay in the project's `config.ts` so TypeScript
//? inference keeps working at call sites.
//?
//? Framework code reads values through `getProjectConfig()` (call-time) so
//? `registerProjectConfig` can be invoked after this module is imported.
//? Never read at module load — that captures whatever was registered at
//? import time, which is fragile.
//?
//? `registerProjectConfig` accepts a deep-partial of `ProjectConfig`; missing
//? fields fall back to the defaults defined here. This means a project's
//? `config.ts` only has to specify the values it wants to override.

export interface LoggingConfig {
  devLogs: boolean;
  devNotifications: boolean;
  socketStatus: boolean;
  socketStartup: boolean;
  stream: boolean;
}

export interface RateLimitingConfig {
  store: 'memory' | 'redis';
  redisKeyPrefix: string;
  defaultApiLimit: number | false;
  defaultIpLimit: number | false;
  windowMs: number;
  /** How often the in-memory store evicts expired entries. */
  cleanupIntervalMs: number;
}

export interface SessionConfig {
  basedToken: boolean;
  expiryDays: number;
  allowMultiple: boolean;
  /**
   * Prefix used for Redis session/activeUsers keys (e.g. `${projectName}-session:<token>`).
   * Falls back to `process.env.PROJECT_NAME` then this default at config build time.
   */
  projectName: string;
}

export interface AppConfig {
  /**
   * Public URL of the app — used by OAuth callback redirects, transactional
   * email links (when `@luckystack/email` is installed), and any other
   * framework code that needs to render an absolute link to your app.
   * Empty default — consumers should set this to the public origin of their
   * deployment (e.g. `https://app.example.com`).
   */
  publicUrl: string;
}

export interface HttpStreamConfig {
  /** Query-string flag clients pass to opt into SSE streaming. */
  queryParam: string;
  /** Value the query-string flag must have. */
  enabledValue: string;
  /** Initial comment line written when an SSE stream opens (keeps proxies happy). */
  connectedComment: string;
}

export interface SecurityHeadersConfig {
  frameOptions: string;
  referrerPolicy: string;
  xssProtection: string;
  contentTypeOptions: string;
}

export interface CorsConfig {
  allowedMethods: string;
  allowedHeaders: string;
  exposedHeaders: string;
  /** Send `Access-Control-Allow-Credentials: true`. */
  credentials: boolean;
  /**
   * Origins permitted to make cross-origin requests. The framework always
   * permits the `SERVER_IP:SERVER_PORT` it binds to. Set `allowLocalhost`
   * to true to also accept any `localhost` origin (useful for dev).
   * Origins are normalized (scheme + host + port) before comparison.
   */
  allowedOrigins: string[];
  /**
   * Accept any origin matching `localhost` (any port). Convenient for local
   * development; should be `false` in production. Defaults to `false` so
   * production deployments fail closed.
   */
  allowLocalhost: boolean;
}

export interface HttpConfig {
  sessionCookieName: string;
  sessionCookieSameSite: 'Strict' | 'Lax' | 'None';
  sessionCookiePath: string;
  /** Maximum body size accepted on `/api/*` and `/sync/*` POSTs. */
  requestBodyMaxBytes: number;
  /** Path of the router boot-handshake endpoint. */
  healthEndpoint: string;
  /**
   * Liveness endpoint. Always returns 200 if the process is up and
   * responsive — does NOT check dependencies. Suitable for K8s `livenessProbe`.
   */
  liveEndpoint: string;
  /**
   * Readiness endpoint. Returns 200 only when Redis + Prisma are reachable
   * AND boot UUID is set. Suitable for K8s `readinessProbe`.
   */
  readyEndpoint: string;
  /** Path of the dev-only state-reset endpoint (gated by NODE_ENV + token). */
  testResetEndpoint: string;
  stream: HttpStreamConfig;
  securityHeaders: SecurityHeadersConfig;
  cors: CorsConfig;
}

export interface AuthConfig {
  /** TTL for OAuth state tokens stored in Redis. */
  oauthStateTtlSeconds: number;
  /** Minimum password length for credentials auth. */
  passwordMinLength: number;
  /** Maximum password length for credentials auth. */
  passwordMaxLength: number;
  /** Maximum email length for credentials auth. */
  emailMaxLength: number;
  /** Maximum display-name length for credentials auth. */
  nameMaxLength: number;
  /**
   * bcrypt cost factor used when hashing passwords (registration, password
   * change, password reset). Default 10 matches industry guidance for 2026
   * hardware. Bump to 12 for higher-value accounts; 4 is acceptable for tests
   * to keep them fast.
   */
  bcryptRounds: number;
  /**
   * `'per-provider'` (default) — same email via Google and GitHub creates
   *   two separate User rows (current behavior, no schema change).
   * `'unified'` — same email maps to a single User; subsequent sign-ins via
   *   different providers link an Account row to the same User. Requires a
   *   Prisma schema change documented in @luckystack/login's README.
   */
  providerAccountStrategy: 'per-provider' | 'unified';
  /**
   * `'framework'` — login package ships the /reset-password pages + APIs and
   *   sends the reset email. Requires a registered email sender.
   * `'custom'` — login exposes only the primitives
   *   (`createPasswordResetToken`, `consumePasswordResetToken`,
   *   `updatePasswordHash`); the consumer wires their own UI and emails.
   * `'disabled'` (default) — no forgot-password feature; the link in
   *   `LoginForm` does not render.
   */
  forgotPassword: 'framework' | 'custom' | 'disabled';
  /** Reset-token TTL in seconds when `forgotPassword === 'framework'`. */
  passwordResetTtlSeconds: number;
  /**
   * Brand/display name used in framework-mode password-reset emails (subject +
   * greeting + footer). Falls back to `'LuckyStack'` if unset; consumers should
   * override this to their own brand.
   */
  passwordResetBrand?: string;
}

export interface OfflineQueueConfig {
  /** Hard cap on items per queue (api + sync are tracked separately). Default 200. */
  maxSize: number;
  /** Drop items older than this many ms when flushing/enqueuing. Default 1 hour. */
  maxAgeMs: number;
  /**
   * What to do when the queue is full:
   * - 'drop-oldest' (default): evict the oldest item, append the new one.
   * - 'drop-newest': reject the new item, keep the existing queue.
   * - 'reject': do not enqueue; caller must handle the failure.
   */
  dropPolicy: 'drop-oldest' | 'drop-newest' | 'reject';
}

export interface SyncStreamThrottleConfig {
  /** Default `flushAtChars` for `createStreamThrottle({...})`. */
  flushAtChars: number;
  /** Default `flushEveryMs` for `createStreamThrottle({...})`. */
  flushEveryMs: number | false;
  /** Default `field` (payload key) for emitted chunks. */
  field: string;
}

export interface SyncConfig {
  streamThrottle: SyncStreamThrottleConfig;
  /**
   * Yield to the event loop every N recipients during a broadcast fanout
   * (`receiver: 'all'` or large rooms). Lower = more responsive, higher
   * overhead. Default 100.
   */
  fanoutYieldEvery: number;
  /** Milliseconds to sleep when yielding. Default 1ms. */
  fanoutYieldMs: number;
}

export interface SocketConfig {
  /** Maximum payload size for any single Socket.io message (bytes). */
  maxHttpBufferSize: number;
  /** ms with no pong response before the server considers the client gone. */
  pingTimeout: number;
  /** ms between pings. */
  pingInterval: number;
}

export interface DevConfig {
  /** Debounce window for hot-reload triggers. */
  hotReloadDebounceMs: number;
  /** Chokidar `awaitWriteFinish.stabilityThreshold`. */
  watcherStabilityThresholdMs: number;
  /** Chokidar `awaitWriteFinish.pollInterval`. */
  watcherPollIntervalMs: number;
  /**
   * When true, log a warning the first time an api/sync route is invoked
   * without an `inputType` (typically because generated types haven't been
   * regenerated since the route was added). Helps catch routes that ship
   * with no runtime input validation. Default false (silent), set to true
   * in dev to surface missing types.
   */
  warnOnMissingInputType?: boolean;
}

export interface PathsConfig {
  /** Frontend source root. */
  srcDir: string;
  /** Server-side source root. */
  serverDir: string;
  /** Shared (universal) source root. */
  sharedDir: string;
  /** Where uploaded user assets (avatars, etc.) live. */
  uploadsDir: string;
  /** Public static assets served as-is. */
  publicDir: string;
  /** Server-side function modules consumed by API/sync handlers. */
  serverFunctionsDir: string;
  /** Generated socket types output path (relative to project root). */
  generatedSocketTypes: string;
  /** Generated API input schemas output path. */
  generatedApiSchemas: string;
  /** Generated API docs JSON output path. */
  generatedApiDocs: string;
}

export interface ProjectConfig {
  app: AppConfig;
  logging: LoggingConfig;
  rateLimiting: RateLimitingConfig;
  session: SessionConfig;
  http: HttpConfig;
  auth: AuthConfig;
  socket: SocketConfig;
  sync: SyncConfig;
  offlineQueue: OfflineQueueConfig;
  dev: DevConfig;
  paths: PathsConfig;
  defaultLanguage: string;
  /** Enable per-room activity broadcasting (presence). */
  socketActivityBroadcaster?: boolean;
  /** Show the floating socket-status indicator badge from `@luckystack/presence/client`. */
  socketStatusIndicator?: boolean;
  /** Enable client → server `updateLocation` syncing. */
  locationProviderEnabled?: boolean;
  /** Where to redirect the user after a successful OAuth callback. */
  loginRedirectUrl?: string;
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object | undefined ? DeepPartial<NonNullable<T[K]>> : T[K];
};

export type ProjectConfigInput = DeepPartial<ProjectConfig>;

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  app: {
    publicUrl: '',
  },
  logging: {
    devLogs: false,
    devNotifications: false,
    socketStatus: false,
    socketStartup: false,
    stream: false,
  },
  rateLimiting: {
    store: 'memory',
    redisKeyPrefix: 'rate-limit',
    defaultApiLimit: 60,
    defaultIpLimit: 100,
    windowMs: 60_000,
    cleanupIntervalMs: 60_000,
  },
  session: {
    basedToken: false,
    expiryDays: 7,
    allowMultiple: false,
    //? Empty default — `getProjectName()` reads `process.env.PROJECT_NAME` at
    //? call time and falls back to `'luckystack'`. Avoids capturing env at
    //? module-load before dotenv runs.
    projectName: '',
  },
  http: {
    sessionCookieName: 'token',
    sessionCookieSameSite: 'Strict',
    sessionCookiePath: '/',
    requestBodyMaxBytes: 1024 * 1024,
    healthEndpoint: '/_health',
    liveEndpoint: '/livez',
    readyEndpoint: '/readyz',
    testResetEndpoint: '/_test/reset',
    stream: {
      queryParam: 'stream',
      enabledValue: 'true',
      connectedComment: ': connected',
    },
    securityHeaders: {
      frameOptions: 'SAMEORIGIN',
      referrerPolicy: 'no-referrer',
      xssProtection: '1; mode=block',
      contentTypeOptions: 'nosniff',
    },
    cors: {
      allowedMethods: 'GET, POST, PUT, DELETE, OPTIONS',
      allowedHeaders: 'Content-Type, Authorization, X-Session-Based-Token, X-CSRF-Token, X-Request-Id',
      exposedHeaders: 'X-Session-Token, X-Request-Id',
      credentials: true,
      allowedOrigins: [],
      allowLocalhost: false,
    },
  },
  auth: {
    oauthStateTtlSeconds: 60 * 10,
    passwordMinLength: 8,
    passwordMaxLength: 191,
    emailMaxLength: 191,
    nameMaxLength: 191,
    bcryptRounds: 10,
    providerAccountStrategy: 'per-provider',
    forgotPassword: 'disabled',
    passwordResetTtlSeconds: 60 * 60,
  },
  socket: {
    maxHttpBufferSize: 5 * 1024 * 1024,
    pingTimeout: 20_000,
    pingInterval: 25_000,
  },
  sync: {
    streamThrottle: {
      flushAtChars: 32,
      flushEveryMs: 50,
      field: 'chunk',
    },
    fanoutYieldEvery: 100,
    fanoutYieldMs: 1,
  },
  offlineQueue: {
    maxSize: 200,
    maxAgeMs: 60 * 60 * 1000,
    dropPolicy: 'drop-oldest',
  },
  dev: {
    hotReloadDebounceMs: 120,
    watcherStabilityThresholdMs: 120,
    watcherPollIntervalMs: 20,
  },
  paths: {
    srcDir: 'src',
    serverDir: 'server',
    sharedDir: 'shared',
    uploadsDir: 'uploads',
    publicDir: 'public',
    serverFunctionsDir: 'server/functions',
    generatedSocketTypes: 'src/_sockets/apiTypes.generated.ts',
    generatedApiSchemas: 'src/_sockets/apiInputSchemas.generated.ts',
    generatedApiDocs: 'src/docs/apiDocs.generated.json',
  },
  defaultLanguage: 'en',
  socketActivityBroadcaster: false,
  socketStatusIndicator: false,
  locationProviderEnabled: false,
  loginRedirectUrl: '/',
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
};

const deepMerge = <T>(base: T, override: DeepPartial<T> | undefined): T => {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base;
  }

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, overrideValue] of Object.entries(override as Record<string, unknown>)) {
    if (overrideValue === undefined) continue;
    const baseValue = (base as Record<string, unknown>)[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue as DeepPartial<unknown>);
    } else {
      result[key] = overrideValue;
    }
  }
  return result as T;
};

let activeConfig: ProjectConfig = DEFAULT_PROJECT_CONFIG;
let isRegistered = false;

export const registerProjectConfig = (config: ProjectConfigInput): void => {
  activeConfig = deepMerge(DEFAULT_PROJECT_CONFIG, config);
  isRegistered = true;
};

export const getProjectConfig = (): ProjectConfig => activeConfig;

//? Resolve the project namespace at call time. Single source of truth used
//? for Redis key prefixes (`<projectName>-session:`, `-activeUsers:`,
//? `-pwreset:`, `-oauth-state:`, etc.) across session.ts, logout.ts,
//? rateLimiter.ts, passwordReset.ts, login.ts, testResetRoute.ts.
//?
//? Resolution order (first non-empty wins):
//?   1. `projectConfig.session.projectName` (if a consumer set it explicitly)
//?   2. `process.env.PROJECT_NAME` (read at call time — works after dotenv)
//?   3. literal `'luckystack'` as the absolute fallback
export const getProjectName = (): string => {
  const fromConfig = activeConfig.session.projectName;
  if (fromConfig && fromConfig.length > 0) return fromConfig;
  const fromEnv = process.env.PROJECT_NAME;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return 'luckystack';
};

//? Guard for code paths that MUST run after registration (e.g. the server's
//? startup sequence). Log once, never throw — framework packages should
//? still do something reasonable when called in a test or CLI context that
//? never registered.
export const isProjectConfigRegistered = (): boolean => isRegistered;
