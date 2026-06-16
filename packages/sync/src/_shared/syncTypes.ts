//? Transport-agnostic sync runtime types shared by the Socket.io
//? (`handleSyncRequest`) and HTTP/SSE (`handleHttpSyncRequest`) handlers.
//? These were previously copy-pasted verbatim in both files (CC-6 / sync
//? duplication). Keeping a single definition guarantees the two transports
//? agree on the server/client handler contract and the error/success
//? envelope shapes.

import type { AuthProps, BaseSessionLayout as SessionLayout, ErrorFormatter } from '@luckystack/core';
import type { FlushPressure } from './streamEmitters';

export type SyncStreamPayload = Record<string, unknown>;

export interface RuntimeErrorResponse {
  status: 'error';
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean; }[];
  httpStatus?: number;
  message?: string;
  [key: string]: unknown;
}

export interface RuntimeSuccessResponse {
  status: 'success';
  message?: string;
  httpStatus?: number;
  [key: string]: unknown;
}

export type RuntimeSyncResponse = RuntimeSuccessResponse | RuntimeErrorResponse;

//? Stream-emit callbacks passed into the `_server` handler. Three flavors:
//?
//?   - `stream(payload)`           — unicast back to the originator socket
//?                                   only. Cheapest. Use for per-user progress
//?                                   that nobody else cares about.
//?   - `broadcastStream(payload)`  — fan-out to every socket in the receiver
//?                                   room, ACROSS all server instances (via the
//?                                   Redis adapter's `io.to(room).emit`). Use
//?                                   for live AI chat tokens, collab-editor
//?                                   diffs, anything the whole room should see
//?                                   in real time.
//?   - `streamTo(tokens, payload)` — selective fanout to only the given
//?                                   session tokens (each is its own room
//?                                   because every socket joins a room named
//?                                   after its token at connect time). Use
//?                                   when you want explicit subscribers, not
//?                                   "everyone in the room".
export type SyncBroadcastStream = (payload?: SyncStreamPayload) => void;
export type SyncStreamTo = (
  tokens: string | string[],
  payload?: SyncStreamPayload,
) => void;

export interface RuntimeSyncServerEntry {
  auth: AuthProps;
  main: (params: {
    clientInput: Record<string, unknown>;
    user: SessionLayout | null;
    functions: Record<string, unknown>;
    roomCode: string;
    stream: (payload?: SyncStreamPayload) => void;
    broadcastStream: SyncBroadcastStream;
    streamTo: SyncStreamTo;
    //? B1 — per-request AbortSignal. Aborts on client-side cancel
    //? (`syncCancel`) or socket disconnect. Handlers that don't destructure
    //? these still work unchanged (extra params are dropped).
    abortSignal: AbortSignal;
    //? B2 — backpressure helper. Awaitable; resolves when the worst-case
    //? Socket.io write-buffer across the affected sockets drops below the
    //? configured threshold (default 1 MB).
    flushPressure: FlushPressure;
  }) => Promise<RuntimeSyncResponse>;
  inputType?: string;
  inputTypeFilePath?: string;
  validation?: 'strict' | 'relaxed' | { input: 'skip' | 'strict' };
  /**
   * Per-route rate limit (mirrors `@luckystack/api`). Overrides
   * `rateLimiting.defaultApiLimit` for this sync route's per-requester bucket;
   * `false` disables it (the global per-IP bucket still applies); omit to fall
   * back to `defaultApiLimit`. Honored by both transports (passed as
   * `routeLimit` into `applySyncRateLimits` / `applyHttpSyncRateLimits`).
   */
  rateLimit?: number | false;
  /**
   * Per-route error response formatter. Falls back to the global formatter
   * from `registerErrorFormatter(...)`, then to the framework default
   * `normalizeErrorResponse`. Same contract as the API handler — both
   * transports honor the same `errorFormatter` export.
   */
  errorFormatter?: ErrorFormatter;
}

export type RuntimeSyncClientHandler = (params: {
  clientInput: Record<string, unknown>;
  token: string | null;
  functions: Record<string, unknown>;
  serverOutput: unknown;
  roomCode: string;
  stream: (payload?: SyncStreamPayload) => void;
}) => Promise<RuntimeSyncResponse>;

//? Normalized error-envelope input accepted by the error builders. Shared so
//? the per-transport `buildSyncError` closures and the rate-limit helpers all
//? speak the same shape.
export interface SyncErrorEnvelopeInput {
  status: 'error';
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean }[];
  httpStatus?: number;
}
