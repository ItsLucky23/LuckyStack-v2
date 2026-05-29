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
  token: string;
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

// --- Augmentable payload map ---

export interface HookPayloads {
  preHttpRequest: PreHttpRequestPayload;
  preApiValidate: PreApiValidatePayload;
  postApiValidate: PostApiValidatePayload;
  preApiExecute: PreApiExecutePayload;
  postApiExecute: PostApiExecutePayload;
  preApiRespond: PreApiRespondPayload;
  transformApiResponse: PreApiRespondPayload;
  postApiRespond: PostApiRespondPayload;
  preSyncAuthorize: PreSyncAuthorizePayload;
  postSyncAuthorize: PostSyncAuthorizePayload;
  preSyncFanout: PreSyncFanoutPayload;
  postSyncFanout: PostSyncFanoutPayload;
  preSyncStream: PreSyncStreamPayload;
  postSyncStream: PostSyncStreamPayload;
  apiError: ApiErrorPayload;
  syncError: SyncErrorPayload;
  rateLimitExceeded: RateLimitExceededPayload;
  corsRejected: CorsRejectedPayload;
  csrfMismatch: CsrfMismatchPayload;
  preSessionRefresh: PreSessionRefreshPayload;
  postSessionRefresh: PostSessionRefreshPayload;
  onUploadStart: OnUploadStartPayload;
  onUploadComplete: OnUploadCompletePayload;
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
