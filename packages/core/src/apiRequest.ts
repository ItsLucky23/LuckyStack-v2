import { getProjectConfig } from "./projectConfig";
import { getLogger } from "./loggerRegistry";
import { getRegisteredApiMethod } from "./apiMethodMapRegistry";
import { isGetMethodName } from "./httpApiUtils";
import { incrementResponseIndex, socket, waitForSocket } from "./socketState";
import type { ApiTypeMap, StreamPayload } from './apiTypeStubs';
import { notify } from "./notifier";
import { enqueueApiRequest, isOnline, removeApiQueueItem } from "./offlineQueue";
import { Socket } from "socket.io-client";
import { normalizeErrorResponseCore } from "./responseNormalizer";
import { parseServiceRouteName } from "./serviceRoute";
import tryCatchSync from "./tryCatchSync";
import {
  buildApiResponseEventName,
  buildApiStreamEventName,
  socketEventNames,
} from "./socketEvents";
import {
  dispatchApiRequestInterceptors,
  dispatchApiResponseInterceptors,
} from "./apiInterceptors";

//? Abort controller logic:
//? - abortable: true → always use abort controller
//? - abortable: false → never use abort controller
//? - abortable: undefined → use abort controller for GET APIs (from generated types)
//? Keyed by `fullName` + a stable hash of the request `data` so the
//? replace-previous (dedupe) semantics only fire for an IDENTICAL in-flight
//? call. Two components polling the same GET route with DIFFERENT params no
//? longer abort each other (each gets its own bucket); a genuine duplicate
//? still supersedes the prior one.
const abortControllers = new Map<string, AbortController>();

//? Stable, order-insensitive JSON stringify so `{a:1,b:2}` and `{b:2,a:1}`
//? hash to the same abort-controller key. Falls back to a non-deduping unique
//? token when the payload can't be serialised (circular ref), which is the
//? safe choice — an unserialisable payload should never silently abort a
//? sibling request.
const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const walk = (input: unknown): unknown => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) return '[circular]';
    seen.add(input);
    if (Array.isArray(input)) return input.map((entry) => walk(entry));
    const record = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).toSorted()) {
      out[key] = walk(record[key]);
    }
    return out;
  };
  const [error, json] = tryCatchSync(() => JSON.stringify(walk(value)));
  if (error || typeof json !== 'string') {
    return `__unserializable__:${String(Date.now())}-${String(Math.random())}`;
  }
  return json;
};

const buildAbortKey = (fullName: string, data: unknown): string =>
  `${fullName}::${stableStringify(data)}`;

export type ApiStreamEvent<T extends StreamPayload = StreamPayload> = T;

/**
 * Check if an API is a GET method.
 *
 * Primary path: consult the registered `apiMethodMap` (generated from the
 * actual handler's `httpMethod` export or name-based inference at codegen
 * time). Falls back to name-prefix heuristic only when the map isn't
 * registered yet — typically because the consumer hasn't called
 * `registerApiMethodMap(...)` from their `socketInitializer.ts` boot file.
 */
const isGetMethodByPrefix = (apiName: string): boolean => isGetMethodName(apiName.toLowerCase());

const isGetMethod = (apiName: string, version: string): boolean => {
  //? Resolved-name shape: `pagePath/apiName`. apiMethodMap is nested by
  //? pagePath → apiName → version. Split at the last `/` so multi-segment
  //? page paths (e.g. 'admin/users') still resolve.
  const lastSlash = apiName.lastIndexOf('/');
  if (lastSlash > 0) {
    const pagePath = apiName.slice(0, lastSlash);
    const leaf = apiName.slice(lastSlash + 1);
    const method = getRegisteredApiMethod(pagePath, leaf, version);
    if (method) return method === 'GET';
  }
  return isGetMethodByPrefix(apiName);
};

const canSendNow = (socketInstance: Socket) => {
  if (!socketInstance.connected) return false;
  return isOnline();
};

const createQueueId = () => {
  return `${String(Date.now())}-${String(Math.random())}`;
};

//? Resolve logging flags at call time so registration order doesn't matter.
//? `getLogging()` is called inside each handler instead of captured at load.
const getLogging = () => getProjectConfig().logging;
const shouldLogDev = () => getLogging().devLogs;
const shouldNotifyDev = () => getLogging().devNotifications;
const shouldLogStream = () => getLogging().stream;

const shouldUseAbortController = ({
  abortable,
  isGet,
}: {
  abortable: boolean | undefined;
  isGet: boolean;
}) => {
  if (abortable === true) return true;
  if (abortable === false) return false;
  return isGet;
};


// ═══════════════════════════════════════════════════════════════════════════════
// Type Helpers
// ═══════════════════════════════════════════════════════════════════════════════

// Check if data input is required (i.e., T does NOT allow empty object)
// Unions like {a:1} | {b:1} do NOT allow {}, so data will be required
type DataRequired<T> = Record<string, never> extends T ? false : true;

type UnionToIntersection<U> =
  (U extends unknown ? (arg: U) => void : never) extends ((arg: infer I) => void)
    ? I
    : never;

// ═══════════════════════════════════════════════════════════════════════════════
// Global API Params - Union of ALL valid API calls with proper data enforcement
// ═══════════════════════════════════════════════════════════════════════════════
type ApiRouteRecord = UnionToIntersection<{
  [P in keyof ApiTypeMap]: {
    [N in keyof ApiTypeMap[P] as P extends 'root'
      ? `system/${Extract<N, string>}`
      : `${Extract<P, string>}/${Extract<N, string>}`]: ApiTypeMap[P][N]
  }
}[keyof ApiTypeMap]>;

type ApiFullName = Extract<keyof ApiRouteRecord, string>;
type VersionsForFullName<F extends ApiFullName> = keyof ApiRouteRecord[F] & string;

// Force expansion of types to clear aliases in tooltips
type Prettify<T> = { [K in keyof T]: T[K] } & {};

// Get input type for an API name (union if exists on multiple pages)
type InputForFullName<F extends ApiFullName, V extends VersionsForFullName<F>> = ApiRouteRecord[F][V] extends { input: infer I }
  ? I
  : never;

// Get output type for an API name (union if exists on multiple pages)
type OutputForFullName<F extends ApiFullName, V extends VersionsForFullName<F>> = ApiRouteRecord[F][V] extends { output: infer O }
  ? O
  : never;

type StreamForFullName<F extends ApiFullName, V extends VersionsForFullName<F>> = ApiRouteRecord[F][V] extends { stream: infer S }
  ? S
  : never;

type ApiStreamCallbackForFullName<F extends ApiFullName, V extends VersionsForFullName<F>> =
  [StreamForFullName<F, V>] extends [never]
    ? never
    : (event: ApiStreamEvent<Prettify<StreamForFullName<F, V> extends StreamPayload ? StreamForFullName<F, V> : StreamPayload>>) => void;

// Build params type for a specific API name
type ApiParamsForFullName<
  F extends ApiFullName,
  V extends VersionsForFullName<F>
> = DataRequired<InputForFullName<F, V>> extends true
  ? { name: F; version: V; data: Prettify<InputForFullName<F, V>>; abortable?: boolean; disableErrorMessage?: boolean; onStream?: ApiStreamCallbackForFullName<F, V>; signal?: AbortSignal; timeoutMs?: number | false; }
  : { name: F; version: V; data?: Prettify<InputForFullName<F, V>>; abortable?: boolean; disableErrorMessage?: boolean; onStream?: ApiStreamCallbackForFullName<F, V>; signal?: AbortSignal; timeoutMs?: number | false; };

interface RuntimeApiParams {
  name?: string;
  version?: string;
  data?: unknown;
  abortable?: boolean;
  disableErrorMessage?: boolean;
  onStream?: (event: ApiStreamEvent) => void;
  signal?: AbortSignal;
  /** Per-call response timeout (ms). Overrides `api.requestTimeoutMs`. `false` disables. */
  timeoutMs?: number | false;
}

interface ApiErrorResponse extends Record<string, unknown> {
  status: 'error';
  httpStatus: number;
  message: string;
  errorCode: string;
  errorParams?: { key: string; value: string | number | boolean }[];
}

interface ApiSuccessResponse extends Record<string, unknown> {
  status: 'success';
  httpStatus: number;
}

type ApiResponse = ApiErrorResponse | ApiSuccessResponse;

const normalizeApiError = ({
  response,
  fallbackErrorCode,
  fallbackHttpStatus = 500,
}: {
  response: { status: 'error'; errorCode?: string; errorParams?: { key: string; value: string | number | boolean }[]; httpStatus?: number; message?: string };
  fallbackErrorCode: string;
  fallbackHttpStatus?: number;
}): ApiErrorResponse => {
  const normalized = normalizeErrorResponseCore({
    response,
    fallbackErrorCode,
    fallbackHttpStatus,
    resolveMessage: ({ errorCode }) => {
      if (typeof response.message === 'string' && response.message.trim().length > 0) {
        return response.message;
      }
      return errorCode;
    },
  });

  return {
    status: 'error',
    message: normalized.message,
    errorCode: normalized.errorCode,
    errorParams: normalized.errorParams,
    httpStatus: normalized.httpStatus ?? fallbackHttpStatus,
  };
};

/**
 * Type-safe API request function.
 * 
 * @example
 * ```typescript
 * // Full name usage - includes page in the name
 * const result = await apiRequest({ name: 'examples/publicApi', version: 'v1', data: { message: 'hello' } });
 * // result is typed correctly for publicApi
 * 
 * // Global APIs use service-first naming
 * await apiRequest({ name: 'system/session', version: 'v1' });
 * ```
 */

export function apiRequest<F extends ApiFullName, V extends VersionsForFullName<F>>(
  params: ApiParamsForFullName<F, V>
): Promise<Prettify<OutputForFullName<F, V>>> {
  type RequestOutput = Prettify<OutputForFullName<F, V> & ApiResponse>;
  const runtimeParams = params as RuntimeApiParams;
  const { name, version, disableErrorMessage = false, onStream, signal: externalSignal, timeoutMs } = runtimeParams;
  const payloadData = runtimeParams.data;

  return new Promise<RequestOutput>((resolve) => {
    void (async () => {
      //? B1 — if the consumer-supplied signal is already aborted at call
      //? time, short-circuit before we even touch the socket. Mirrors the
      //? `fetch(url, { signal })` contract.
      if (externalSignal?.aborted) {
        resolve(normalizeApiError({
          response: { status: 'error', errorCode: 'request.aborted' },
          fallbackErrorCode: 'request.aborted',
        }) as RequestOutput);
        return;
      }
      if (!name || typeof name !== "string") {
        if (shouldLogDev()) {
          getLogger().error("apiRequest: Invalid name");
        }
        if (shouldNotifyDev()) {
          notify.error({ key: 'api.invalidName' });
        }
        resolve(normalizeApiError({
          response: { status: 'error', errorCode: 'api.invalidName' },
          fallbackErrorCode: 'api.invalidName',
        }) as RequestOutput);
        return;
      }

      if (!version || typeof version !== 'string') {
        if (shouldLogDev()) {
          getLogger().error("apiRequest: Invalid version");
        }
        if (shouldNotifyDev()) {
          notify.error({ key: 'api.invalidVersion' });
        }
        resolve(normalizeApiError({
          response: { status: 'error', errorCode: 'api.invalidVersion' },
          fallbackErrorCode: 'api.invalidVersion',
        }) as RequestOutput);
        return;
      }

      const parsedRoute = parseServiceRouteName(name);
      if (parsedRoute.status === 'error') {
        if (shouldLogDev()) {
          getLogger().error(`[apiRequest] Invalid service route name`, undefined, { name, reason: parsedRoute.reason });
        }
        if (shouldNotifyDev()) {
          notify.error({ key: 'routing.invalidServiceRouteName' });
        }
        resolve(normalizeErrorResponseCore({
          response: {
            status: 'error',
            errorCode: 'routing.invalidServiceRouteName',
            errorParams: [{ key: 'name', value: name }],
          },
          fallbackErrorCode: 'routing.invalidServiceRouteName',
        }) as RequestOutput);
        return;
      }

      const sanitizedName = parsedRoute.normalizedRouteName;

      const data = payloadData && typeof payloadData === "object" ? payloadData : {};

      if (!await waitForSocket()) {
        resolve(normalizeApiError({
          response: { status: 'error', errorCode: 'api.ioUnavailable' },
          fallbackErrorCode: 'api.ioUnavailable',
        }) as RequestOutput);
        return;
      }
      if (!socket) {
        resolve(normalizeApiError({
          response: { status: 'error', errorCode: 'api.ioUnavailable' },
          fallbackErrorCode: 'api.ioUnavailable',
        }) as RequestOutput);
        return;
      }

      //? Abort controller logic:
      //? - abortable: true → always use abort controller
      //? - abortable: false → never use abort controller
      //? - abortable: undefined → smart default (GET-like APIs get abort controller)
      //? Pass the full pagePath/apiName so the registry lookup can resolve via
      //? the generated apiMethodMap (falls back to the leaf-name prefix heuristic
      //? when the map isn't registered yet).
      const isGet = isGetMethod(sanitizedName, version);
      const useAbortController = shouldUseAbortController({
        abortable: runtimeParams.abortable,
        isGet,
      });
      const fullName = `api/${sanitizedName}/${version}`;
      //? Per-payload abort key: only an identical in-flight call to the same
      //? route supersedes the previous one (see `buildAbortKey` rationale).
      const abortKey = buildAbortKey(fullName, data);

      let signal: AbortSignal | null = null;
      let abortHandler: (() => void) | null = null;
      let queueId: string | null = null;
      let cleanupStreamListener: (() => void) | null = null;
      //? Response listener cleanup, registered once the `.once` handler is
      //? attached in `runRequest`. Lets the abort path proactively `off()` the
      //? lingering response listener instead of waiting for a response that was
      //? cancelled and will never arrive.
      let cleanupResponseListener: (() => void) | null = null;
      //? Response-timeout timer. Armed right after the request is emitted so a
      //? lost response (server restart/crash between emit and reply) settles the
      //? promise instead of hanging the awaiting caller forever.
      let responseTimeout: ReturnType<typeof setTimeout> | null = null;
      const clearResponseTimeout = () => {
        if (responseTimeout) {
          clearTimeout(responseTimeout);
          responseTimeout = null;
        }
      };

      const cleanupAbortController = () => {
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
        }
        abortControllers.delete(abortKey);
      };

      if (useAbortController) {
        if (abortControllers.has(abortKey)) {
          const prevAbortController = abortControllers.get(abortKey);
          prevAbortController?.abort();
        }
        const abortController = new AbortController();
        abortControllers.set(abortKey, abortController);
        signal = abortController.signal;

        abortHandler = () => {
          clearResponseTimeout();
          cleanupStreamListener?.();
          cleanupStreamListener = null;
          cleanupResponseListener?.();
          cleanupResponseListener = null;
          cleanupAbortController();
          if (queueId) {
            removeApiQueueItem(queueId);
          }
          //? Resolve (not reject) with the same `request.aborted` envelope the
          //? external-signal abort path uses. Rejecting here produced an
          //? unhandled rejection for fire-and-forget GET calls that get
          //? superseded by the default replace-previous behaviour.
          resolve(normalizeApiError({
            response: { status: 'error', errorCode: 'request.aborted' },
            fallbackErrorCode: 'request.aborted',
          }) as RequestOutput);
        };

        signal.addEventListener("abort", abortHandler);
      }

      const runRequest = (socketInstance: Socket) => {
        if (!canSendNow(socketInstance)) {
          queueId ??= createQueueId();
          //? For the immediate reject-new path (`drop-newest` / `reject`
          //? policy) THIS item's `onDrop` fires SYNCHRONOUSLY inside
          //? `enqueueApiRequest`. We keep surfacing that as the historical
          //? `offline.queueFull` via the `!enqueued` branch, so suppress the
          //? `onDrop` resolve during the synchronous enqueue window and re-arm
          //? it only if the item was actually queued (so a LATER async eviction
          //? — drop-oldest by a future enqueue, or age expiry — still settles).
          let suppressOnDrop = true;
          //? `enqueueApiRequest` returns `false` when the offline queue is
          //? full and `dropPolicy: 'reject'` is active. Without honoring
          //? that signal the outer promise never settles and the caller
          //? awaits forever. Resolve with a normalized error envelope so
          //? callers can branch.
          const enqueued = enqueueApiRequest({
            id: queueId,
            key: fullName,
            run: (nextSocket) => {
              runRequest(nextSocket);
            },
            createdAt: Date.now(),
            //? CORE: mirror SYNC-09. Settle the awaiting caller when this
            //? QUEUED request is later EVICTED (drop-oldest by a future
            //? enqueue / age expiry) instead of ever running. Without it the
            //? promise hangs forever, since `run` is the only thing that could
            //? otherwise resolve it — `apiRequest` had drifted from the sibling
            //? `syncRequest` which already had this fix. Also tear down the
            //? abort-controller registry entry so it isn't leaked.
            onDrop: (reason) => {
              if (suppressOnDrop) return;
              cleanupAbortController();
              resolve(normalizeApiError({
                response: { status: 'error', errorCode: 'offline.dropped', errorParams: [{ key: 'reason', value: reason }] },
                fallbackErrorCode: 'offline.dropped',
              }) as RequestOutput);
            },
          });
          //? Past the synchronous enqueue window: if the item is sitting in the
          //? queue, a future eviction should settle via `onDrop`.
          suppressOnDrop = false;
          if (!enqueued) {
            resolve(normalizeApiError({
              response: { status: 'error', errorCode: 'offline.queueFull', httpStatus: 503 },
              fallbackErrorCode: 'offline.queueFull',
              fallbackHttpStatus: 503,
            }) as RequestOutput);
          }
          return;
        }

        if (signal?.aborted) {
          return;
        }

        const tempIndex = incrementResponseIndex();
        socketInstance.emit(socketEventNames.apiRequest, { name: fullName, data, responseIndex: tempIndex });

        //? B1 — bridge the consumer's AbortSignal to the server. When the
        //? signal fires we emit `apiCancel { responseIndex }` so the server
        //? handler stops emitting new chunks. We also resolve locally with
        //? `request.aborted` so the awaiting caller settles (vs awaiting
        //? a response that will never arrive because we cancelled it).
        let cleanupExternalAbort: (() => void) | null = null;
        if (externalSignal) {
          const externalAbortHandler = () => {
            clearResponseTimeout();
            socketInstance.emit(socketEventNames.apiCancel, { responseIndex: tempIndex });
            cleanupStreamListener?.();
            cleanupStreamListener = null;
            cleanupResponseListener?.();
            cleanupResponseListener = null;
            cleanupAbortController();
            cleanupExternalAbort?.();
            cleanupExternalAbort = null;
            resolve(normalizeApiError({
              response: { status: 'error', errorCode: 'request.aborted' },
              fallbackErrorCode: 'request.aborted',
            }) as RequestOutput);
          };
          externalSignal.addEventListener('abort', externalAbortHandler);
          cleanupExternalAbort = () => {
            externalSignal.removeEventListener('abort', externalAbortHandler);
          };
        }

        //? Arm the response timeout. A per-call `timeoutMs` overrides the
        //? `api.requestTimeoutMs` config default; either may be `false` to
        //? disable. On expiry we tear down every listener/controller and settle
        //? with a 504 envelope so the awaiting caller never hangs.
        clearResponseTimeout();
        const effectiveTimeoutMs = timeoutMs ?? getProjectConfig().api.requestTimeoutMs;
        if (typeof effectiveTimeoutMs === 'number' && effectiveTimeoutMs > 0) {
          responseTimeout = setTimeout(() => {
            responseTimeout = null;
            cleanupStreamListener?.();
            cleanupStreamListener = null;
            cleanupResponseListener?.();
            cleanupResponseListener = null;
            cleanupExternalAbort?.();
            cleanupExternalAbort = null;
            cleanupAbortController();
            if (queueId) {
              removeApiQueueItem(queueId);
            }
            resolve(normalizeApiError({
              response: { status: 'error', errorCode: 'api.timeout', httpStatus: 504 },
              fallbackErrorCode: 'api.timeout',
              fallbackHttpStatus: 504,
            }) as RequestOutput);
          }, effectiveTimeoutMs);
        }

        if (typeof onStream === 'function') {
          const streamEventName = buildApiStreamEventName(tempIndex);
          const streamListener = (streamPayload: ApiStreamEvent) => {
            if (signal?.aborted) {
              return;
            }

            if (shouldLogStream()) {
              getLogger().debug(`Server API Stream(${String(tempIndex)})`, { APINAME: sanitizedName, streamPayload });
            }

            onStream(streamPayload);
          };

          socketInstance.on(streamEventName, streamListener);
          cleanupStreamListener = () => {
            socketInstance.off(streamEventName, streamListener);
          };
        }

        if (shouldLogDev()) {
          getLogger().debug(`Client API Request(${String(tempIndex)})`, { APINAME: sanitizedName, data });
        }

        //? Inside the handler we type as the runtime envelope (ApiResponse).
        //? Project-specific output narrowing only matters at the call site,
        //? where `RequestOutput = OutputForFullName<F,V> & ApiResponse` is
        //? returned via `resolve(... as RequestOutput)`. When core is type-
        //? checked in isolation (e.g. per-package tsup dts build), ApiTypeMap
        //? is empty so OutputForFullName collapses to never; using ApiResponse
        //? here keeps the body type-safe in both cases.
        const responseEventName = buildApiResponseEventName(tempIndex);
        const responseListener = (response: ApiResponse) => {
          if (signal?.aborted) {
            clearResponseTimeout();
            cleanupExternalAbort?.();
            cleanupExternalAbort = null;
            return;
          }

          clearResponseTimeout();
          cleanupStreamListener?.();
          cleanupStreamListener = null;
          cleanupExternalAbort?.();
          cleanupExternalAbort = null;
          cleanupResponseListener = null;

          const status = response.status;

          //? EXT-03 — fire client response interceptors when the envelope
          //? arrives (observation-only: metrics, breadcrumb, custom logging).
          dispatchApiResponseInterceptors({ name: sanitizedName, version, response });

          if (shouldLogDev()) {
            getLogger().debug(`Server API Response(${String(tempIndex)})`, { ...response, APINAME: sanitizedName });
          }

          if (status === "error") {
            const normalizedError = normalizeErrorResponseCore({ response });

            if (!disableErrorMessage) {
              if (normalizedError.errorCode) {
                notify.error({ key: normalizedError.errorCode, params: normalizedError.errorParams });
              } else {
                notify.error({ key: normalizedError.message });
              }
            }

            Object.assign(response, normalizedError);
            cleanupAbortController();
            resolve(response as RequestOutput);
            return;
          }

          cleanupAbortController();

          resolve(response as RequestOutput);
        };

        socketInstance.once(responseEventName, responseListener);
        cleanupResponseListener = () => {
          socketInstance.off(responseEventName, responseListener);
        };
      };

      //? EXT-03 — fire client request interceptors just before the emit. They
      //? may mutate `data` in place (correlation id / feature-flag context).
      //? `data` is the same reference passed to `socketInstance.emit`, so the
      //? mutation is on the wire. Awaited so an async interceptor (flag lookup,
      //? trace-id mint) completes first; failures are caught + logged inside.
      await dispatchApiRequestInterceptors({
        name: sanitizedName,
        version,
        data: data as Record<string, unknown>,
      });

      runRequest(socket);
    })();
  });
}