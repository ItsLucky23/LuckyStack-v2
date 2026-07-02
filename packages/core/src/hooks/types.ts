/**
 * Core hook contract: framework-generic payload shapes + augmentable registry.
 *
 * Feature packages (login/sync/api/presence/...) extend `HookPayloads` via
 * TypeScript module augmentation:
 *
 * ```ts
 * // packages/<feature>/src/hookPayloads.ts
 * declare module '@luckystack/core' {
 *   interface HookPayloads {
 *     myFeatureHook: { ... };
 *   }
 * }
 * export {};
 * ```
 *
 * Module-augmentation files MUST be in a tsconfig `include` path for TS to
 * pick up the merge; a side-effect import from the package's `index.ts`
 * (`import './hookPayloads';`) guarantees this.
 */

import type { ErrorResponseInput, NormalizedErrorResponse } from '../responseNormalizer';

/**
 * Minimal session shape used inside core-owned hook payloads. Defined here
 * (instead of imported from `@luckystack/login`) so `@luckystack/core` stays
 * independent of login. Any concrete session type (`BaseSessionLayout`,
 * project-level `SessionLayout` extending Prisma User, etc.) is structurally
 * assignable to this shape.
 */
export interface HookSessionShape {
  id: string;
  //? @adr 0018 — optional to match `BaseSessionLayout` (a CLIENT-facing session
  //? type may omit the server-only token). Server-side hook payloads still carry a
  //? real token at runtime; no framework hook handler reads it off this minimal
  //? shape as a guaranteed string.
  token?: string;
  email?: string | null;
  name?: string | null;
  avatar?: string | null;
  avatarFallback?: string | null;
  admin?: boolean | null;
  language?: string | null;
  roomCodes?: string[];
}

export interface HookStopSignal {
  stop: true;
  errorCode: string;
  httpStatus?: number;
  /**
   * Optional output override for per-recipient hooks (`preSyncRecipient`).
   * When present on a stop signal the framework DOES NOT skip the recipient —
   * instead it sends this value in place of the full `serverOutput`. Use to
   * redact PII before delivery without excluding the socket from the fanout.
   * Ignored by all other hook dispatch sites.
   */
  overrideOutput?: unknown;
}

/** Handlers return undefined / void to continue, or a stop signal to abort the main flow. */
//? Include `void` so handlers declared as `(payload) => { ... }` (no return)
//? are assignable without TypeScript complaining that "void is not undefined".
//? `void` and `undefined` are distinct in strict mode — `() => void` accepts
//? any return shape (effectively ignored), `() => undefined` requires an
//? explicit `return undefined`. Hook handlers want the looser shape.
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- intentional, see comment above
export type HookResult = void | undefined | HookStopSignal;

export type HookHandler<TPayload> = (payload: TPayload) => Promise<HookResult> | HookResult;

// --- Core-owned payloads (framework transport; concrete dispatch lives in @luckystack/api and @luckystack/sync) ---

export interface PreApiValidatePayload {
  routeName: string;
  data: Record<string, unknown>;
  user: HookSessionShape | null;
  /**
   * Optional transport tag — populated by the framework's socket/HTTP API
   * handlers so hook subscribers can branch on it (e.g. open span with a
   * different op name). Optional so consumer-side dispatchers don't have to
   * set it explicitly.
   */
  transport?: 'socket' | 'http';
}

export interface PostApiValidatePayload extends PreApiValidatePayload {
  validation: { status: 'success' } | { status: 'error'; message: string };
}

export interface PreApiExecutePayload {
  routeName: string;
  data: Record<string, unknown>;
  user: HookSessionShape | null;
  /** Optional transport tag — see {@link PreApiValidatePayload.transport}. */
  transport?: 'socket' | 'http';
}

export interface PostApiExecutePayload {
  routeName: string;
  data: Record<string, unknown>;
  user: HookSessionShape | null;
  result: unknown;
  error: Error | null;
  durationMs: number;
  /** Optional transport tag — see {@link PreApiValidatePayload.transport}. */
  transport?: 'socket' | 'http';
}

export interface ApiResponseEnvelope {
  status: 'success' | 'error';
  httpStatus?: number;
  errorCode?: string;
  message?: string;
  [key: string]: unknown;
}

//? Container so handlers can replace the outgoing response by mutating
//? `payload.response`. This is intentionally object-shaped (not a return
//? value) because the existing hook dispatcher reserves return values for
//? stop signals.
export interface PreApiRespondPayload {
  routeName: string;
  user: HookSessionShape | null;
  response: ApiResponseEnvelope;
  /** Optional transport tag — see {@link PreApiValidatePayload.transport}. */
  transport?: 'socket' | 'http';
}

export interface PostApiRespondPayload {
  routeName: string;
  user: HookSessionShape | null;
  response: ApiResponseEnvelope;
  /** Optional transport tag — see {@link PreApiValidatePayload.transport}. */
  transport?: 'socket' | 'http';
}

export interface PreSyncAuthorizePayload {
  routeName: string;
  /** Raw (un-validated) data payload. May be reshape-able by the consumer. */
  data: Record<string, unknown>;
  user: HookSessionShape | null;
  /** Room code / receiver token — the sync's intended audience. */
  receiver: string;
  /** Optional transport tag — see {@link PreApiValidatePayload.transport}. */
  transport?: 'socket' | 'http';
}

//? Fires AFTER `preSyncAuthorize` resolves without a stop signal — i.e.
//? the request is past auth + custom-policy checks, and is about to go
//? through rate-limit + input validation. Observational only (handlers
//? that return a stop signal are ignored). Use this to audit successful
//? authorizations per recipient / per route without forking the dispatch
//? loop.
export interface PostSyncAuthorizePayload {
  routeName: string;
  data: Record<string, unknown>;
  user: HookSessionShape | null;
  receiver: string;
  /** Optional transport tag — see {@link PreApiValidatePayload.transport}. */
  transport?: 'socket' | 'http';
}

//? Validation-stage sync hooks — mirror the API pipeline's
//? `preApiValidate`/`postApiValidate`. `preSyncValidate` fires before runtime
//? input validation (a stop signal short-circuits before the `_server` runs);
//? `postSyncValidate` fires after, carrying the validation outcome. Use these
//? for schema-augmentation, audit, or to reject on a custom validation rule the
//? generated input type can't express.
export interface PreSyncValidatePayload {
  routeName: string;
  data: Record<string, unknown>;
  user: HookSessionShape | null;
  receiver: string;
  /** Optional transport tag — see {@link PreApiValidatePayload.transport}. */
  transport?: 'socket' | 'http';
}

export interface PostSyncValidatePayload extends PreSyncValidatePayload {
  validation: { status: 'success' } | { status: 'error'; message: string };
}

//? Execution-stage sync hooks — mirror the API pipeline's
//? `preApiExecute`/`postApiExecute`. `preSyncExecute` fires before the
//? `_server` handler runs (a stop signal short-circuits execution);
//? `postSyncExecute` fires after it resolves OR throws, carrying
//? `{ result, error, durationMs }`. Crucially `postSyncExecute` fires on the
//? FAILURE path too (unlike `preSyncFanout`, which is success-only), so
//? audit / latency / error-alerting subscribers see failed sync mutations.
export interface PreSyncExecutePayload {
  routeName: string;
  data: Record<string, unknown>;
  user: HookSessionShape | null;
  receiver: string;
  /** Optional transport tag — see {@link PreApiValidatePayload.transport}. */
  transport?: 'socket' | 'http';
}

export interface PostSyncExecutePayload {
  routeName: string;
  data: Record<string, unknown>;
  user: HookSessionShape | null;
  receiver: string;
  result: unknown;
  error: Error | null;
  durationMs: number;
  /** Optional transport tag — see {@link PreApiValidatePayload.transport}. */
  transport?: 'socket' | 'http';
}

export interface PreSyncFanoutPayload {
  routeName: string;
  data: Record<string, unknown>;
  user: HookSessionShape | null;
  receiver: string;
  serverOutput: unknown;
  /** Optional transport tag — see {@link PreApiValidatePayload.transport}. */
  transport?: 'socket' | 'http';
}

export interface PostSyncFanoutPayload extends PreSyncFanoutPayload {
  recipientCount: number;
}

export interface PreSyncStreamPayload {
  routeName: string;
  /** Stream chunk being sent (already serialised by the framework). */
  chunk: unknown;
  /** Final recipient — socket id when known, room code otherwise. */
  recipient: string;
}

export interface PostSyncStreamPayload extends PreSyncStreamPayload {
  /** Total chunks streamed so far in this sync invocation. */
  chunkIndex: number;
}

// --- Error / security signals ---

//? These payloads are dispatched from the server / api / sync packages when
//? a request fails, gets rate-limited, or is rejected by CORS. Third-party
//? packages (audit logs, abuse detection, alerting) subscribe via
//? `registerHook(...)` instead of forking the framework.

export interface ApiErrorPayload {
  route: string;
  method?: string;
  requestId?: string;
  user?: HookSessionShape | null;
  error: Error;
}

export interface SyncErrorPayload {
  route: string;
  method?: string;
  requestId?: string;
  user?: HookSessionShape | null;
  error: Error;
}

export interface RateLimitExceededPayload {
  /** Where the limit was hit — IP, user, or route. */
  scope: 'ip' | 'user' | 'route' | 'auth';
  /** The key that exceeded its limit (sanitized — no tokens). */
  key: string;
  /** Configured limit count for this key. */
  limit: number;
  /** Window in milliseconds. */
  windowMs: number;
  /** Current bucket count after the rejected request. */
  count: number;
  /** Optional route or transport context. */
  route?: string;
  ip?: string;
  userId?: string;
}

export interface CorsRejectedPayload {
  /** Origin header sent by the client. */
  origin: string;
  /** Origin after framework normalization (scheme + host[:port]). */
  normalizedOrigin: string;
  /** Effective allowed-origins set at the time of rejection. */
  allowedOrigins: string[];
  /** Whether `allowLocalhost` was on. */
  allowLocalhost: boolean;
  /** Optional route the rejected request was for. */
  route?: string;
  /**
   * Why the request was rejected (server HOK-27). Distinguishes a present-but-
   * disallowed Origin (`'origin-not-allowed'`) from a MISSING Origin header
   * (`'origin-missing'`, the 403 dispatched by the server's origin gate) and the
   * normalization-failure case. Optional so existing `allowedOrigin()` callers
   * that don't set it stay source-compatible.
   */
  reason?: 'origin-not-allowed' | 'origin-missing' | 'origin-malformed';
}

export interface PreSessionRefreshPayload {
  token: string;
  userId: string | null;
  oldTtl: number | null;
  newTtl: number;
}

export interface PostSessionRefreshPayload {
  token: string;
  userId: string | null;
  oldTtl: number | null;
  newTtl: number;
  /** True if Redis EXPIRE succeeded; false on failure or non-existent key. */
  applied: boolean;
}

//? Core-level session lifecycle hooks. Dispatched by `@luckystack/login` when a
//? session is minted / revoked so consumers can audit-log or react without
//? depending on login internals. Observational — handlers' stop signals are
//? ignored (the session transition has already happened).
export interface SessionCreatedPayload {
  token: string;
  userId: string;
  /** How the session came to exist (credentials login, OAuth, refresh-mint, ...). */
  via?: string;
}

export interface SessionRevokedPayload {
  token: string;
  userId: string | null;
  /** Why the session was revoked (logout, kicked-by-new-device, admin, expiry, ...). */
  reason?: string;
}

export interface OnUploadStartPayload {
  userId: string;
  contentType: string;
  sizeBytes: number;
  //? `'avatar'` is the framework-owned upload kind; any other string is a
  //? project-defined kind. The union documents the convention for autocomplete.
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- intentional autocomplete hint
  uploadKind: 'avatar' | string;
}

export interface OnUploadCompletePayload {
  userId: string;
  fileName: string;
  sizeBytes: number;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- intentional autocomplete hint
  uploadKind: 'avatar' | string;
}

//? Read-side avatar hooks (counterpart to the upload hooks). `preAvatarServe`
//? runs BEFORE the file is located/streamed — a handler may return a stop
//? signal to deny the read (the framework answers 404, so a private avatar's
//? existence isn't disclosed) for access control / auditing without forking
//? `serveAvatar`. `postAvatarServe` runs after the stream is piped.
export interface PreAvatarServePayload {
  /** The route path requested (`/avatars/:fileId`). */
  routePath: string;
  /** The allowlisted file id resolved from the route path. */
  fileId: string;
}

export interface PostAvatarServePayload {
  routePath: string;
  fileId: string;
  /** Disk extension of the format that was served (e.g. `'webp'`). */
  extension: string;
  /** Content-Type header sent for the served file. */
  contentType: string;
}

export interface CsrfMismatchPayload {
  /** Path of the rejected request. */
  route: string;
  /** HTTP method of the rejected request. */
  method?: string;
  /** Request id (X-Request-Id) for log correlation. */
  requestId?: string;
  /** User id from the session that the request claimed, if any. */
  userId?: string;
  /** Whether a token was provided in `x-csrf-token` (presence only — never the value). */
  providedToken: boolean;
}

// --- Socket transport-level hook ---

//? Per-message socket interception seam — the websocket counterpart to
//? `preHttpRequest`. Dispatched at the very top of the api + sync socket
//? message handlers, BEFORE session lookup / route resolution / auth, so a
//? consumer can gate, throttle, or audit individual socket messages without
//? reaching into framework internals. A handler may return a `HookStopSignal`
//? to reject the message (the handler emits a localized error envelope back to
//? the originator on the matching response channel and aborts the pipeline).
//? `io.use(...)` middleware only runs once at handshake — this fires per
//? message, closing the asymmetry with the stop-capable HTTP path.
export interface PreSocketMessagePayload {
  /** Which socket pipeline received the message. */
  channel: 'api' | 'sync';
  /** Socket.io connection id of the originator. */
  socketId: string;
  /** Handshake address of the originator (best-effort; honours no proxy trust). */
  ip: string;
  /** Whether the originating socket carried a session token (presence only — never the value). */
  authenticated: boolean;
  /** Raw route name from the message envelope, when present (un-parsed, un-trusted). */
  routeName?: string;
}

// --- HTTP request-level hook ---

export interface PreHttpRequestPayload {
  /** HTTP method (always uppercase: GET/POST/...). */
  method: string;
  /** Request URL (path + query). */
  url: string;
  /** Caller-supplied or framework-generated `X-Request-Id`. */
  requestId: string;
  /** Origin header value (or empty string when absent). */
  origin: string;
  /**
   * Subset of headers — `authorization`, `cookie`, etc. are NOT included
   * to keep payloads safe for logging. Use the full request object via
   * a custom route if you need raw access.
   */
  headers: Record<string, string>;
}

//? Fires AFTER the HTTP pipeline has produced a response (server HOK-15) —
//? the request-level counterpart to `postApiRespond` but at the raw HTTP layer,
//? so it also covers non-api routes (avatars, health, custom routes, webhooks).
//? Observational: a stop signal is ignored (the response has already been
//? written / is about to be). Use for access logging, latency metrics, and
//? request auditing without forking the HTTP dispatcher.
export interface PostHttpRequestPayload {
  /** HTTP method (always uppercase). */
  method: string;
  /** Request URL (path + query). */
  url: string;
  /** Caller-supplied or framework-generated `X-Request-Id`. */
  requestId: string;
  /** Final HTTP status code written to the response. */
  statusCode: number;
  /** Wall-clock duration from request receipt to response, in ms. */
  durationMs: number;
}

//? Fires when an api request is rejected for AUTH reasons (api F9) — i.e. the
//? route required login (or an `additional[]` predicate) and the session did
//? not satisfy it, BEFORE the handler runs. Lets abuse-detection / audit
//? subscribers see auth failures without forking the api handler. Observational
//? (stop signal ignored — the rejection has already been decided).
export interface ApiAuthRejectedPayload {
  /** Resolved route name (`api/billing/getInvoice/v1`). */
  routeName: string;
  /** Why auth failed. `'login-required'` = no/invalid session on a login route;
   *  `'additional-failed'` = a session existed but an `additional[]` predicate
   *  rejected; `'invalid-condition'` = a misconfigured predicate (setup error). */
  reason: 'login-required' | 'additional-failed' | 'invalid-condition';
  /** Session user id when a (insufficient) session was present, else null. */
  userId: string | null;
  /** Resolved client IP (honours `http.trustProxy`). */
  ip?: string;
  /** Transport the request arrived on. */
  transport?: 'socket' | 'http';
  /** The specific `additional[]` key that failed, when `reason === 'additional-failed'`. */
  failedKey?: string;
}

//? Per-recipient sync fanout hook (sync SYNC-22 / SYNC-O8). Fires ONCE per
//? resolved recipient just before the framework emits the sync payload to that
//? socket. A handler can:
//?   • Return a stop signal to SKIP that recipient (rest of fanout continues).
//?   • Return a stop signal with `overrideOutput` to REDACT — the recipient
//?     still receives the event but with the override value instead of the full
//?     `serverOutput`. Useful when no `_client` file is present and `serverOutput`
//?     contains PII that should not reach every room member verbatim.
//?
//? NOTE: `recipientUserId` is null on the hot path to avoid a session read per
//? recipient. Opt in to resolution by registering a `resolveRecipientUser`
//? function in your hook registration (the framework will call it and populate
//? the field before dispatching). When no resolver is registered the field stays
//? null and the hook must derive the user from `recipientSocketId` itself if needed.
export interface PreSyncRecipientPayload {
  /** Resolved route name (`sync/board/moveCard/v1`). */
  routeName: string;
  /** Room code / receiver this fanout is for. */
  receiver: string;
  /** Socket id of THIS recipient. */
  recipientSocketId: string;
  /**
   * Recipient's session user id.  `null` by default (avoids a Redis read per
   * recipient on the hot path).  Populated when the consumer registers a
   * `resolveRecipientUser` function via `registerHookHandler` options.
   */
  recipientUserId: string | null;
  /** The server-validated output about to be sent. */
  serverOutput: unknown;
}

//? Graceful-shutdown hook (CORE-SHUTDOWN). Dispatched ONCE by
//? `@luckystack/server` when the process receives a termination signal
//? (SIGTERM/SIGINT) BEFORE the HTTP/socket server stops accepting connections
//? and the process exits. Lets a consumer flush error-trackers, drain queues,
//? close DB/Redis pools, or release leases without forking the server bootstrap.
//? Observational for control flow — a returned stop signal does NOT abort the
//? shutdown (the process IS going down); handlers should be best-effort and
//? self-isolating (the dispatcher already swallows per-handler throws).
export interface PreServerStopPayload {
  /** Why the server is stopping — the signal name, or `'manual'` for a programmatic stop. */
  reason: 'SIGTERM' | 'SIGINT' | 'SIGHUP' | 'manual';
  /**
   * Soft budget (ms) the server intends to wait for shutdown handlers + in-flight
   * requests to drain before forcing exit. Handlers should not block longer than
   * this. `undefined` when the server applies no deadline.
   */
  timeoutMs?: number;
}

// --- Augmentable payload map ---

export interface HookPayloads {
  preHttpRequest: PreHttpRequestPayload;
  postHttpRequest: PostHttpRequestPayload;
  preSocketMessage: PreSocketMessagePayload;
  preApiValidate: PreApiValidatePayload;
  postApiValidate: PostApiValidatePayload;
  preApiExecute: PreApiExecutePayload;
  postApiExecute: PostApiExecutePayload;
  preApiRespond: PreApiRespondPayload;
  transformApiResponse: PreApiRespondPayload;
  postApiRespond: PostApiRespondPayload;
  preSyncAuthorize: PreSyncAuthorizePayload;
  postSyncAuthorize: PostSyncAuthorizePayload;
  preSyncValidate: PreSyncValidatePayload;
  postSyncValidate: PostSyncValidatePayload;
  preSyncExecute: PreSyncExecutePayload;
  postSyncExecute: PostSyncExecutePayload;
  preSyncFanout: PreSyncFanoutPayload;
  postSyncFanout: PostSyncFanoutPayload;
  preSyncRecipient: PreSyncRecipientPayload;
  preSyncStream: PreSyncStreamPayload;
  postSyncStream: PostSyncStreamPayload;
  apiError: ApiErrorPayload;
  syncError: SyncErrorPayload;
  apiAuthRejected: ApiAuthRejectedPayload;
  rateLimitExceeded: RateLimitExceededPayload;
  corsRejected: CorsRejectedPayload;
  csrfMismatch: CsrfMismatchPayload;
  preSessionRefresh: PreSessionRefreshPayload;
  postSessionRefresh: PostSessionRefreshPayload;
  sessionCreated: SessionCreatedPayload;
  sessionRevoked: SessionRevokedPayload;
  onUploadStart: OnUploadStartPayload;
  onUploadComplete: OnUploadCompletePayload;
  preAvatarServe: PreAvatarServePayload;
  postAvatarServe: PostAvatarServePayload;
  preServerStop: PreServerStopPayload;
}

// --- Synchronous mutator hooks ---

//? `normalizeErrorResponse` is a synchronous primitive used in many hot paths,
//? so its hooks are dispatched via a separate sync registry (`registerSyncHook`
//? / `dispatchSyncHook`). Handlers mutate `payload.response` (preErrorNormalize)
//? or `payload.normalized` (postErrorNormalize) in place.

export interface PreErrorNormalizePayload {
  response: ErrorResponseInput;
  preferredLocale?: string | null;
  userLanguage?: string | null;
  fallbackHttpStatus?: number;
}

export interface PostErrorNormalizePayload {
  normalized: NormalizedErrorResponse;
  preferredLocale?: string | null;
  userLanguage?: string | null;
}

export interface SyncHookPayloads {
  preErrorNormalize: PreErrorNormalizePayload;
  postErrorNormalize: PostErrorNormalizePayload;
}

export type SyncHookName = keyof SyncHookPayloads;

export type SyncHookHandler<TPayload> = (payload: TPayload) => void;

export type HookName = keyof HookPayloads;
