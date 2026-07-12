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

import { deepMerge, type DeepPartial } from './configUtils';
import { createRegistry } from './createRegistry';

export interface LoggingConfig {
  devLogs: boolean;
  devNotifications: boolean;
  socketStatus: boolean;
  socketStartup: boolean;
  stream: boolean;
}

export interface RateLimitingConfig {
  /**
   * Global kill-switch for all rate limiting. When `false`, every
   * `checkRateLimit` call short-circuits to "allowed" and counters are not
   * touched. Useful for local dev, load tests, or trusted internal tooling.
   * Defaults to `true`.
   */
  enabled: boolean;
  store: 'memory' | 'redis';
  redisKeyPrefix: string;
  defaultApiLimit: number | false;
  defaultIpLimit: number | false;
  windowMs: number;
  /** How often the in-memory store evicts expired entries. */
  cleanupIntervalMs: number;
  /**
   * What the default strategy does when `store: 'redis'` is active but a Redis
   * operation fails (disconnect, eval error). DEFAULT `'memory'` — degrade to
   * the process-local in-memory store (fail-open, backwards-compatible) and log
   * a one-shot warning. In a multi-instance deployment this silently relaxes the
   * global limit to per-instance (N×). Set `'deny'` to instead reject the
   * request (fail-closed) so a Redis outage can't bypass rate limiting.
   */
  onStoreError: 'memory' | 'deny';
  /**
   * Skip rate limiting for requests that resolve to a loopback client IP
   * (`127.0.0.1`, `::1`, the `UNKNOWN_CLIENT_IP` sentinel) when running in
   * development (`NODE_ENV !== 'production'`). Lets a dev machine hammer its own
   * server (HMR reload storms, local load tests) without tripping limits, while
   * staying fully enforced in production. DEFAULT `false` (enforce everywhere) —
   * a missing key keeps today's behavior. The api/sync transport handlers read
   * this when building the per-IP key; core only owns the flag + the
   * {@link isLoopbackIp} helper.
   */
  skipLoopbackInDev: boolean;
  /**
   * Identity callback that decides the BASIS of a rate-limit key for a given
   * request — i.e. whether to key per-user, per-IP, or some custom dimension.
   * The api/sync handlers call this (when set) to derive the `{ scope, id }`
   * used to build the bucket key, instead of the built-in user-then-IP default.
   * Returning `null` falls back to the framework default. Synchronous by design
   * (it runs on the hot request path). DEFAULT unset.
   */
  identity?: (params: RateLimitIdentityParams) => RateLimitIdentity | null;
  /**
   * Per-account brute-force lockout slot, keyed independently from the general
   * api/ip limits so credential endpoints (login, password-reset) can apply a
   * stricter window without affecting normal traffic.
   *
   * NOTE — DD-CORE-D3: **core does NOT consume this slot**. The core package
   * only declares and stores the config; the `@luckystack/login` package reads
   * `rateLimiting.auth` when keying a per-account attempt counter
   * (`auth:<accountKey>`). If you search the core source for usages of this
   * field and find none, that is expected — it is not dead config; it is login-
   * owned config that lives here for a single source of truth.
   *
   * DEFAULT `{ enabled: false }` — a missing/disabled slot keeps today's
   * behavior (no per-account lockout; only the per-IP throttle applies).
   */
  auth: AuthRateLimitConfig;
}

/** Inputs handed to the {@link RateLimitingConfig.identity} callback. */
export interface RateLimitIdentityParams {
  /** Resolved route name (`api/billing/getInvoice/v1`, `sync/...`). */
  routeName: string;
  /** Session user id when the request is authenticated, else null. */
  userId: string | null;
  /** Resolved client IP (already honours `http.trustProxy`). */
  ip: string;
  /** Transport the request arrived on. */
  transport: 'socket' | 'http';
}

/** Result of a {@link RateLimitingConfig.identity} callback. */
export interface RateLimitIdentity {
  /** Which dimension the key is built from. */
  scope: 'user' | 'ip' | 'custom';
  /** The identity value (user id, ip, or a custom string). Never a raw token. */
  id: string;
}

export interface AuthRateLimitConfig {
  /** When false (default), no per-account lockout is applied. */
  enabled: boolean;
  /** Max failed attempts per account FROM ONE IP within `windowMs` before that
   * IP+account bucket locks (per-IP cap; also bounds a single IP and protects other
   * IPs from a victim-lock DoS). Default 5. */
  maxAttempts: number;
  /**
   * Cross-IP cap: max failed attempts against a SINGLE account from ALL IPs
   * combined within `windowMs` before the account locks. This is the
   * distributed-credential-stuffing defense — `maxAttempts` alone is per-IP, so N
   * attacker IPs would otherwise each get a fresh `maxAttempts` budget. Should be
   * HIGHER than `maxAttempts` (it counts every IP). Default 50.
   */
  maxAttemptsPerAccount: number;
  /** Rolling window in ms over which both caps are counted. Default 900000 (15 min). */
  windowMs: number;
}

export interface SessionConfig {
  basedToken: boolean;
  expiryDays: number;
  /**
   * Whether a single user can hold multiple active sessions across devices.
   * `'single'` (default): logging in on a new device kicks the previous one.
   * `'multiple'`: device A and device B can both be logged in concurrently.
   */
  perUser: 'single' | 'multiple';
  /**
   * Optional cap on concurrent sessions when `perUser === 'multiple'`. Null
   * = unlimited. When the cap is reached, the policy from `onConflict`
   * decides whether the new login is accepted (kicking oldest) or rejected.
   */
  maxConcurrentPerUser: number | null;
  /**
   * What to do when a session limit is exceeded.
   * `'revokeOld'` (default): kick the oldest session, accept the new login.
   * `'rejectNew'`: refuse the new login, leave existing sessions intact.
   */
  onConflict: 'revokeOld' | 'rejectNew';
  /**
   * When `onConflict === 'revokeOld'`, whether to broadcast a short UI
   * notification ("logged in elsewhere") to the kicked device before
   * disconnecting it. Default true.
   */
  notifyOldDeviceOnRevoke: boolean;
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
   *
   * Static list mode: pass a `string[]`. Origins are matched exactly.
   * Dynamic mode: pass a synchronous function `(origin) => boolean` for
   * per-tenant / per-time-window allow-listing. Async resolvers are NOT
   * supported here because Socket.io's CORS check is synchronous; use a
   * pre-computed in-memory cache that the function can read from.
   */
  allowedOrigins: string[] | ((origin: string) => boolean);
  /**
   * Accept any origin matching `localhost` (any port). Convenient for local
   * development; should be `false` in production. Defaults to `false` so
   * production deployments fail closed.
   */
  allowLocalhost: boolean;
  /**
   * Historical opt-in kept for symmetry. Origin-less requests are ALWAYS
   * admitted at the CORS layer now (see `loadSocket.ts`): browsers omit the
   * `Origin` header on same-origin GETs, which is exactly the initial Socket.io
   * polling handshake in both dev (Vite proxy) and prod-with-router (single
   * origin) topologies — rejecting it broke every connection with
   * `400 code:3 MIDDLEWARE_FAILURE`. The real auth gate is the session token
   * in the handshake, not the Origin header. This flag no longer gates
   * anything and is retained only so existing configs that set it keep
   * type-checking; it may be removed in a future major version.
   */
  allowOriginless?: boolean;
  /**
   * Optional per-route override hook. When a `_api/*` file exports
   * `export const cors = { allowedOrigins, allowedHeaders, ... }` the
   * framework merges that on top of the global config for THAT route only.
   * Implemented in the api handler — this field is documentation-only.
   */
  // Note: per-route override is wired in `packages/api/src/handleHttpApiRequest.ts`.
}

export interface HttpConfig {
  sessionCookieName: string;
  sessionCookieSameSite: 'Strict' | 'Lax' | 'None';
  sessionCookiePath: string;
  /**
   * Optional `Domain` attribute for the session cookie (CORE-39). Leave unset
   * (DEFAULT) for a host-only cookie (most secure). Set to a parent domain
   * (`.example.com`) only when the cookie must be shared across subdomains.
   * IGNORED when `sessionCookiePrefix === '__Host-'` (that prefix forbids
   * `Domain`). A missing key keeps today's host-only behavior.
   */
  sessionCookieDomain?: string;
  /**
   * Optional cookie name prefix enforcing browser-level guarantees (CORE-10/39):
   *
   * - `'__Host-'` — forces `Secure`, `Path=/`, and NO `Domain` (blocks
   *   subdomain cookie-tossing). The strongest option for a host-only session.
   * - `'__Secure-'` — forces `Secure` (cookie only sent over HTTPS).
   * - unset (DEFAULT) — no prefix; today's behavior. A missing key changes
   *   nothing.
   *
   * The server's cookie builder (`buildSessionCookie`) reads this and applies
   * the prefix to `sessionCookieName` plus the forced attributes. Use
   * {@link applyCookiePrefixConstraints} to compute the effective attributes.
   */
  sessionCookiePrefix?: '__Host-' | '__Secure-';
  /**
   * Per-cookie `Secure` override (CORE-39). When unset (DEFAULT) the server
   * derives `Secure` from `process.env.SECURE` as today. Set explicitly to
   * force on/off independently of the env flag. A `__Host-`/`__Secure-` prefix
   * forces `Secure: true` regardless.
   */
  sessionCookieSecure?: boolean;
  /**
   * Maximum body size (bytes) accepted on the HTTP transport for `/api/*` and
   * `/sync/*` POSTs. DEFAULT 1 MiB (1024 * 1024). This is the HTTP-body cap; the
   * SOCKET transport has a SEPARATE, independently-configurable frame cap
   * (`socket.maxHttpBufferSize`, default 5 MiB) — the two are deliberately distinct
   * knobs (HTTP body parser vs Socket.io whole-frame buffer). Set both to the same
   * value if you want a uniform per-call payload ceiling across transports.
   */
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
  /**
   * Whether a known reverse proxy sits in front of this server. DEFAULT false.
   * When false, per-IP rate-limit keys derive from the raw transport peer
   * address (historical behaviour). When true, the framework resolves the real
   * client IP from `X-Forwarded-For` / `X-Real-IP` before keying — so per-IP
   * limits stay meaningful behind nginx/HAProxy. Only enable when a trusted
   * proxy populates those headers, otherwise clients can spoof their IP.
   */
  trustProxy?: boolean;
  /**
   * How many proxy hops to skip from the RIGHT of `X-Forwarded-For` when
   * `trustProxy` is on (CORE-O3). The rightmost entries are the ones appended by
   * YOUR trusted proxies, so the resolved client IP is the entry that many hops
   * in from the end. The LEFTMOST hop is client-controlled and must never be
   * trusted (it enables per-IP rate-limit evasion + audit-IP spoofing).
   *
   * DEFAULT 1 — with the standard single-trusted-proxy topology this selects the
   * immediate upstream peer (the rightmost real hop), i.e. the IP the proxy saw
   * the connection arrive from. Raise it to match the number of trusted proxies
   * in the chain. Clamped to the list length so an over-large count falls back
   * to the leftmost available trusted hop rather than the spoofable client entry.
   * IGNORED when `trustProxy` is false (raw peer address is used verbatim).
   */
  trustedProxyHopCount?: number;
  /**
   * Whether cookie-mode sessions (`session.basedToken === false`) also accept a
   * token supplied via `Authorization: Bearer` / `handshake.auth.token` as a
   * fallback (CORE-O10). DEFAULT false — in cookie-mode the framework reads ONLY
   * the session cookie and ignores any bearer/handshake-auth token, so a stolen
   * token replayed through a header can no longer defeat the cookie/CSRF model.
   * Set true to restore the legacy behaviour (cookie-then-bearer fallback).
   * IGNORED in token-mode (`session.basedToken === true`), which is unaffected:
   * it always reads the bearer/handshake token first, cookie as fallback.
   */
  acceptBearerInCookieMode?: boolean;
  /**
   * Controls how `/_health` exposes synchronized-env-var hashes (SEC-13).
   * Previously `/_health` returned an UNSALTED `sha256(value)` of each
   * synchronized secret, unauthenticated — enabling offline dictionary attacks
   * on low-entropy secrets + key-name disclosure. This config + the shared
   * {@link hashSynchronizedValue} helper let both the server (`/_health`) and the
   * router (boot handshake) salt/HMAC consistently so the compare still works.
   * DEFAULTS keep today's wire behavior (`mode: 'plain'`) so a missing key does
   * not break an existing router handshake — opt into `'salted'`/`'hmac'`
   * explicitly (and bump server + router together).
   */
  healthHash: HealthHashConfig;
  stream: HttpStreamConfig;
  securityHeaders: SecurityHeadersConfig;
  cors: CorsConfig;
}

export interface HealthHashConfig {
  /**
   * - `'plain'` — unsalted `sha256(value)`; the pre-0.2.0 behavior, kept so an
   *   existing router boot handshake keeps comparing successfully. Opt in with
   *   `mode:'plain'` to restore the legacy wire output.
   * - `'salted'` — `sha256(salt + value)` using `salt` below (or the boot UUID
   *   when `salt` is the literal `'@bootUuid'`). Stable across a boot, rotates on
   *   restart when bound to the boot UUID.
   * - `'hmac'` (DEFAULT in 0.2.0) — `HMAC-SHA256(key=salt, value)`. The default
   *   `salt:'@bootUuid'` keys it on the per-boot UUID server + router already
   *   share, so `/_health` no longer exposes a stable, offline-attackable
   *   `sha256(secret)`. Collapses to `'plain'` when no boot UUID is available so
   *   the boot handshake never silently diverges.
   */
  mode: 'plain' | 'salted' | 'hmac';
  /**
   * Shared salt / HMAC key. Both the backend `/_health` and the router's
   * compare MUST use the same value. The literal `'@bootUuid'` is a sentinel
   * meaning "use the current boot UUID as the salt" (valid with `'salted'` or
   * `'hmac'`). DEFAULTS to `'@bootUuid'` in 0.2.0 (only consulted when
   * `mode !== 'plain'`); set a non-empty static value to pin a stable key.
   */
  salt: string;
}

export interface PasswordPolicyConfig {
  /** Minimum total length. Default 8. */
  minLength: number;
  /** Maximum total length. Default 191 (DB column-friendly). */
  maxLength: number;
  /** Require at least one uppercase letter (A-Z). Default false. */
  requireUppercase: boolean;
  /** Require at least one lowercase letter (a-z). Default false. */
  requireLowercase: boolean;
  /** Require at least one digit (0-9). Default false. */
  requireNumber: boolean;
  /** Require at least one non-alphanumeric character. Default false. */
  requireSpecial: boolean;
  /**
   * Reject the 10k most common passwords (built-in list shipped with
   * `@luckystack/login`). Default true. Set to false in tests or when
   * onboarding from a legacy system that allowed weak passwords.
   */
  forbidCommon: boolean;
  /**
   * Optional consumer-supplied predicate. Return null when the password is
   * acceptable, or a string describing why it isn't (the string is used as
   * the i18n errorCode-style key surfaced to the client).
   */
  customValidator?: (password: string) => string | null;
}

export interface AuthConfig {
  /**
   * Whether email+password (credentials) auth is enabled. When `true` (default)
   * `@luckystack/login/register` registers the credentials provider, so it shows
   * up in `GET /auth/providers` and the login form renders the email/password
   * fields. Set `false` for an OAuth-only app — the form hides the fields AND the
   * `/auth/api/credentials` route rejects (`auth.credentialsDisabled`).
   */
  credentials: boolean;
  /** TTL for OAuth state tokens stored in Redis. */
  oauthStateTtlSeconds: number;
  /**
   * @deprecated Read `passwordPolicy.minLength`. Kept as a top-level field
   * for older consumer code; new code should use the structured policy.
   */
  passwordMinLength: number;
  /**
   * @deprecated Read `passwordPolicy.maxLength`. Kept as a top-level field
   * for older consumer code; new code should use the structured policy.
   */
  passwordMaxLength: number;
  /** Full credentials password policy. Replaces the deprecated min/max-length pair. */
  passwordPolicy: PasswordPolicyConfig;
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
   *   different providers resolve to (link to) that same User row instead of
   *   creating a duplicate. Requires `email` to be `@unique` — see the
   *   "Account strategy" migration steps in @luckystack/login's README.
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
  /** Email-change confirmation-token TTL in seconds. Default 3600 (1 hour). */
  emailChangeTtlSeconds: number;
  /**
   * Whether public self-service registration is permitted (login F18). When
   * `false`, the credentials `/register` route rejects with
   * `auth.registrationDisabled` and the login UI hides the "create account"
   * affordance — useful for invite-only / admin-provisioned apps. OAuth-driven
   * first-login account creation is governed separately by the provider flow.
   * DEFAULT `true` (today's behavior — open registration).
   */
  allowRegistration: boolean;
  /**
   * Frontend path the framework-mode password-reset email links to (login F22).
   * The reset token is appended as a query param. DEFAULT `/reset-password`.
   * Override when your reset page lives at a different route.
   */
  passwordResetPath: string;
  /**
   * Frontend path the email-change confirmation email links to (login F22).
   * The confirmation token is appended as a query param.
   * DEFAULT `/confirm-email-change`.
   */
  emailChangeConfirmPath: string;
  /**
   * Passwordless email-code login (ADR 0024): the user enters their email,
   * receives a short numeric code, and signs in by typing it. Requires a
   * registered email sender (`@luckystack/email`). DEFAULT `false`.
   * Anti-enumeration: the request endpoint always answers "sent".
   */
  emailCodeLogin: boolean;
  /** Email-code TTL in seconds (login + 2FA fallback codes). DEFAULT 600. */
  emailCodeTtlSeconds: number;
  /** Email-code length in digits. DEFAULT 6. */
  emailCodeLength: number;
  /** Wrong-code attempts before an email code is burned. DEFAULT 5. */
  emailCodeMaxAttempts: number;
  /**
   * Second factor at login (ADR 0024). `'optional'` = per-user opt-in: a user
   * who enrolled an authenticator app (TOTP — Google/Microsoft Authenticator,
   * Authy, …) must answer a 2FA challenge after their password/email-code is
   * verified. `'disabled'` (DEFAULT) = the challenge step never triggers, even
   * for enrolled users (kill switch).
   */
  twoFactor: 'disabled' | 'optional';
  /**
   * Allow "send the code to my email instead" as a 2FA fallback channel for
   * enrolled users (lost phone). Requires a registered email sender.
   * DEFAULT `true` (recovery codes always work regardless).
   */
  twoFactorEmailFallback: boolean;
  /** Pending 2FA login-challenge TTL in seconds. DEFAULT 300. */
  twoFactorChallengeTtlSeconds: number;
  /** Wrong-code attempts before a pending 2FA challenge is burned. DEFAULT 5. */
  twoFactorMaxAttempts: number;
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

export interface ApiConfig {
  /**
   * Default response timeout (ms) for `apiRequest`. After this elapses with no
   * response (e.g. server restart/crash between emit and reply) the request
   * settles with `{ status:'error', errorCode:'api.timeout', httpStatus:504 }`
   * instead of hanging forever. Set `false` to disable the timeout. A per-call
   * `timeoutMs` overrides this. Default 30000.
   */
  requestTimeoutMs: number | false;
}

export interface ValidationConfig {
  /**
   * Whether runtime input validation runs in PRODUCTION (CORE-01).
   *
   * - `'enforce'` (DEFAULT) — the structural validator (`validateType`) runs
   *   against the route's resolved input type in production too, so a malformed
   *   payload is rejected with `api.invalidInputType` / `sync.invalidInputType`
   *   instead of reaching the handler. Only the dev-only devkit DEEP type
   *   resolver (TypeScript compiler API) is skipped in prod — the already-resolved
   *   generated type text is validated directly.
   * - `'off'` — restore the legacy behavior where prod skips input validation
   *   entirely (input shape is the handler's responsibility). This is the loud,
   *   documented opt-out; set it only if a route's generated type text can't be
   *   validated structurally in your deployment.
   *
   * DEFAULT `'enforce'`. Note: this CHANGES prior behavior (prod was a no-op).
   * Set `'off'` to keep the old no-op.
   */
  runtimeMode: 'enforce' | 'off';
}

export interface SyncConfig {
  streamThrottle: SyncStreamThrottleConfig;
  /**
   * Default response timeout (ms) for `syncRequest`'s acknowledgement. Same
   * semantics as `api.requestTimeoutMs` but for sync. Settles with
   * `sync.requestTimeout` / httpStatus 504 on expiry. `false` to disable.
   * Default 30000.
   */
  requestTimeoutMs: number | false;
  /**
   * Yield to the event loop every N recipients during a broadcast fanout
   * (`receiver: 'all'` or large rooms). Lower = more responsive, higher
   * overhead. Default 100.
   */
  fanoutYieldEvery: number;
  /** Milliseconds to sleep when yielding. Default 1ms. */
  fanoutYieldMs: number;
  /**
   * Receiver-authorization policy (SYNC-07). These flags add framework-level
   * defaults read by `@luckystack/sync`'s `authorizeSyncReceiver`:
   *
   * - `allowClientReceiverAll` — when false, a client requesting the broadcast
   *   receiver `'all'` is rejected unless a `preSyncAuthorize` handler approves
   *   it. DEFAULT `false` (0.2.0 secure-default flip — a client can no longer
   *   broadcast cluster-wide by default; opt back in with `true` for the legacy
   *   permissive behavior).
   * - `requireRoomMembership` — when true, a client may only target a room it
   *   has actually joined (its `roomCodes`); targeting an unjoined room is
   *   rejected. DEFAULT `true` (0.2.0 secure-default flip — a client can no
   *   longer fan out to a room it never joined; set `false` for the legacy
   *   any-room behavior).
   *
   * BREAKING (0.2.0): both defaults now fail CLOSED. Apps that relied on
   * implicit cluster-wide / arbitrary-room broadcasts must either join the room
   * before targeting it, approve the receiver via a `preSyncAuthorize` handler,
   * or explicitly opt back into the permissive values.
   */
  allowClientReceiverAll: boolean;
  requireRoomMembership: boolean;
  /**
   * Stream backpressure tuning (SYNC-15) for `createStreamThrottle` /
   * server-initiated stream emits. Constants were previously hardcoded in the
   * sync package; surfacing them here lets a consumer tune flush cadence under
   * load without forking. DEFAULTS reproduce the historical hardcoded values.
   */
  flushPressure: SyncFlushPressureConfig;
}

export interface SyncFlushPressureConfig {
  /** Max queued chunks before the stream applies backpressure (pauses). Default 1000. */
  highWaterMarkChunks: number;
  /** Resume emitting once the queue drains below this. Default 250. */
  lowWaterMarkChunks: number;
  /** Hard cap on bytes buffered for a single stream before dropping/erroring. Default 5_242_880 (5 MiB). */
  maxBufferedBytes: number;
}

export interface SocketConfig {
  /**
   * Maximum payload size (bytes) for any single Socket.io message (whole-frame
   * buffer). DEFAULT 5 MiB (5 * 1024 * 1024). This is the SOCKET-transport cap; the
   * HTTP transport has a SEPARATE, independently-configurable body cap
   * (`http.requestBodyMaxBytes`, default 1 MiB). The two are intentionally distinct —
   * set both to the same value for a uniform per-call ceiling across transports.
   */
  maxHttpBufferSize: number;
  /** ms with no pong response before the server considers the client gone. */
  pingTimeout: number;
  /** ms between pings. */
  pingInterval: number;
  /**
   * Minimum ms between client → server `activity` heartbeats (repo-src C-CFG /
   * presence C1). The consumer template's activity tracker + `@luckystack/presence`
   * read this to throttle how often mouse/keyboard/touch activity is reported
   * (previously hardcoded to 10s). DEFAULT 10000 (10s) — a missing key keeps the
   * historical cadence.
   */
  activityHeartbeatThrottleMs: number;
  /**
   * Hard cap on how many rooms a single session may be joined to at once. When a
   * join would exceed the cap the OLDEST joined room is left first (FIFO eviction)
   * so `session.roomCodes` can't grow unbounded in Redis (session-bloat DoS).
   * DEFAULT 50. Set to `false` to disable the cap (unbounded — legacy behavior).
   */
  maxRoomsPerSession: number | false;
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
  /**
   * @deprecated Use `serverFunctionDirs` instead. Kept for backwards
   * compatibility with projects that set the singular form before the
   * function-injection system grew multi-directory support. When both are
   * present, `serverFunctionDirs` wins.
   */
  serverFunctionsDir: string;
  /**
   * Server-side function modules consumed by API/sync handlers. The
   * codegen and runtime walk every listed directory in order and merge the
   * results into one `Functions` interface / object. Duplicate keys
   * (same `<dirname>.<filename>.<export>` path produced by two roots)
   * fail the build — `shared/` is canonical, so the conflict tells the
   * consumer to delete the override.
   *
   * Default: `['functions', 'shared']`.
   *
   * Nested subdirectories work transparently — `functions/test/helper.ts`
   * with `export const foo = …` shows up as
   * `functions.test.helper.foo` on the injected `functions` parameter.
   */
  serverFunctionDirs: string[];
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
  api: ApiConfig;
  sync: SyncConfig;
  validation: ValidationConfig;
  offlineQueue: OfflineQueueConfig;
  dev: DevConfig;
  paths: PathsConfig;
  defaultLanguage: string;
  /** Default theme for new users / fallback when no session preference exists. */
  defaultTheme?: 'light' | 'dark';
  /** Enable per-room activity broadcasting (presence). */
  socketActivityBroadcaster?: boolean;
  /** Show the floating socket-status indicator badge from `@luckystack/presence/client`. */
  socketStatusIndicator?: boolean;
  /** Enable client → server `updateLocation` syncing. */
  locationProviderEnabled?: boolean;
  /** Where to redirect the user after a successful OAuth callback. */
  loginRedirectUrl?: string;
  /**
   * Base origin used to build OAuth callback redirect URIs
   * (`<oauthCallbackBase>/auth/callback/<provider>`). This is the BACKEND
   * origin the provider redirects to — in dev typically `http://localhost:80`,
   * in prod the public domain. Read by `@luckystack/login/register`'s env-driven
   * provider scan so OAuth wiring needs no consumer code. Empty default — the
   * consumer's `config.ts` sets it.
   */
  oauthCallbackBase?: string;
}

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
    enabled: true,
    store: 'memory',
    redisKeyPrefix: 'rate-limit',
    defaultApiLimit: 60,
    defaultIpLimit: 100,
    windowMs: 60_000,
    cleanupIntervalMs: 60_000,
    onStoreError: 'memory',
    skipLoopbackInDev: false,
    //? DD-CORE-D3: consumed exclusively by @luckystack/login, not by core itself.
    auth: {
      enabled: false,
      maxAttempts: 5,
      maxAttemptsPerAccount: 50,
      windowMs: 15 * 60 * 1000,
    },
  },
  session: {
    basedToken: false,
    expiryDays: 7,
    perUser: 'single',
    maxConcurrentPerUser: null,
    onConflict: 'revokeOld',
    notifyOldDeviceOnRevoke: true,
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
    trustProxy: false,
    //? CORE-O3: skip 1 hop from the RIGHT of X-Forwarded-For (the rightmost
    //? entry is appended by your own trusted proxy) instead of trusting the
    //? leftmost, client-controlled hop. Only consulted when `trustProxy` is on.
    trustedProxyHopCount: 1,
    //? CORE-O10 secure default: in cookie-mode, ignore any `Authorization: Bearer`
    //? / `handshake.auth.token` fallback so a stolen token cannot bypass the
    //? cookie/CSRF model. Set true to restore the legacy cookie-then-bearer
    //? fallback. Token-mode (`basedToken: true`) is unaffected.
    acceptBearerInCookieMode: false,
    //? 0.2.0 secure-default flip (SEC-13): `/_health` no longer exposes a stable,
    //? unsalted `sha256(secret)` fingerprint. Default mode is `'hmac'` keyed on
    //? the `'@bootUuid'` sentinel — the per-boot UUID both server + router already
    //? share via the boot handshake — so the synchronized-env hash rotates every
    //? restart and is no longer offline dictionary-attackable. Set an explicit
    //? non-empty `salt` to pin a stable HMAC key across restarts, or `mode:'plain'`
    //? to restore the legacy unsalted wire output.
    healthHash: {
      mode: 'hmac',
      salt: '@bootUuid',
    },
    stream: {
      queryParam: 'stream',
      enabledValue: 'true',
      connectedComment: ': connected',
    },
    securityHeaders: {
      frameOptions: 'SAMEORIGIN',
      referrerPolicy: 'no-referrer',
      //? '1; mode=block' is deprecated (Chrome 78+ ignores it; can trigger
      //? reflected-XSS in older IE/Edge auditors). '0' disables the legacy
      //? auditor and defers to CSP, which is the modern defence.
      xssProtection: '0',
      contentTypeOptions: 'nosniff',
    },
    cors: {
      allowedMethods: 'GET, POST, PUT, DELETE, OPTIONS',
      allowedHeaders: 'Content-Type, Authorization, X-Session-Based-Token, X-CSRF-Token, X-Request-Id',
      exposedHeaders: 'X-Session-Token, X-Request-Id',
      credentials: true,
      allowedOrigins: [],
      allowLocalhost: false,
      allowOriginless: false,
    },
  },
  auth: {
    credentials: true,
    oauthStateTtlSeconds: 60 * 10,
    passwordMinLength: 8,
    passwordMaxLength: 191,
    passwordPolicy: {
      minLength: 8,
      maxLength: 191,
      requireUppercase: false,
      requireLowercase: false,
      requireNumber: false,
      requireSpecial: false,
      forbidCommon: true,
    },
    emailMaxLength: 191,
    nameMaxLength: 191,
    bcryptRounds: 10,
    providerAccountStrategy: 'per-provider',
    forgotPassword: 'disabled',
    passwordResetTtlSeconds: 60 * 60,
    emailChangeTtlSeconds: 60 * 60,
    allowRegistration: true,
    passwordResetPath: '/reset-password',
    emailChangeConfirmPath: '/confirm-email-change',
    emailCodeLogin: false,
    emailCodeTtlSeconds: 60 * 10,
    emailCodeLength: 6,
    emailCodeMaxAttempts: 5,
    twoFactor: 'disabled',
    twoFactorEmailFallback: true,
    twoFactorChallengeTtlSeconds: 60 * 5,
    twoFactorMaxAttempts: 5,
  },
  socket: {
    maxHttpBufferSize: 5 * 1024 * 1024,
    pingTimeout: 20_000,
    pingInterval: 25_000,
    activityHeartbeatThrottleMs: 10_000,
    maxRoomsPerSession: 50,
  },
  api: {
    //? Default OFF (was 30_000): a legit handler may run for minutes (e.g. a deep
    //? image parse / long upstream call) and must not be aborted by a wall-clock
    //? race. A disconnecting client still aborts the handler via the wired
    //? abortSignal; set a number to opt back into a hard per-request ceiling
    //? (streaming requests are exempt even then — see runHttpApiExecution).
    requestTimeoutMs: false,
  },
  validation: {
    runtimeMode: 'enforce',
  },
  sync: {
    streamThrottle: {
      flushAtChars: 32,
      flushEveryMs: 50,
      field: 'chunk',
    },
    fanoutYieldEvery: 100,
    fanoutYieldMs: 1,
    requestTimeoutMs: 30_000,
    allowClientReceiverAll: false,
    requireRoomMembership: true,
    flushPressure: {
      highWaterMarkChunks: 1000,
      lowWaterMarkChunks: 250,
      maxBufferedBytes: 5 * 1024 * 1024,
    },
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
    serverFunctionDirs: ['functions', 'shared'],
    generatedSocketTypes: 'src/_sockets/apiTypes.generated.ts',
    generatedApiSchemas: 'src/_sockets/apiInputSchemas.generated.ts',
    generatedApiDocs: 'src/docs/apiDocs.generated.json',
  },
  defaultLanguage: 'en',
  defaultTheme: 'light',
  socketActivityBroadcaster: false,
  socketStatusIndicator: false,
  locationProviderEnabled: false,
  loginRedirectUrl: '/',
  oauthCallbackBase: '',
};

const registry = createRegistry<ProjectConfig, ProjectConfigInput>(DEFAULT_PROJECT_CONFIG, {
  //? Always merge the consumer override over the pristine defaults (not the
  //? previously-stored config) — matches the historical register behaviour
  //? where each call rebuilds from `DEFAULT_PROJECT_CONFIG`.
  transform: (input) => deepMerge(DEFAULT_PROJECT_CONFIG, input),
});

export const registerProjectConfig = (config: ProjectConfigInput): void => {
  registry.register(config);
};

export const getProjectConfig = (): ProjectConfig => registry.get();

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
  const fromConfig = registry.get().session.projectName;
  if (fromConfig && fromConfig.length > 0) return fromConfig;
  const fromEnv = process.env.PROJECT_NAME;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return 'luckystack';
};

//? Guard for code paths that MUST run after registration (e.g. the server's
//? startup sequence). Log once, never throw — framework packages should
//? still do something reasonable when called in a test or CLI context that
//? never registered.
export const isProjectConfigRegistered = (): boolean => registry.isRegistered();
