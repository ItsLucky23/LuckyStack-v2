import { getProjectConfig } from "./projectConfig";
import { getLogger } from "./loggerRegistry";
import { getRegisteredApiMethod } from "./apiMethodMapRegistry";
import { incrementResponseIndex, socket, waitForSocket } from "./socketState";
import type { ApiTypeMap, StreamPayload } from './apiTypeStubs';
import { notify } from "./notifier";
import { enqueueApiRequest, isOnline, removeApiQueueItem } from "./offlineQueue";
import { Socket } from "socket.io-client";
import { normalizeErrorResponseCore } from "./responseNormalizer";
import { parseServiceRouteName } from "./serviceRoute";
import {
  buildApiResponseEventName,
  buildApiStreamEventName,
  socketEventNames,
} from "./socketEvents";

//? Abort controller logic:
//? - abortable: true → always use abort controller
//? - abortable: false → never use abort controller
//? - abortable: undefined → use abort controller for GET APIs (from generated types)
const abortControllers = new Map<string, AbortController>();

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
const isGetMethodByPrefix = (apiName: string): boolean => {
  const lower = apiName.toLowerCase();
  return lower.startsWith('get') || lower.startsWith('fetch') || lower.startsWith('list');
};

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
  ? { name: F; version: V; data: Prettify<InputForFullName<F, V>>; abortable?: boolean; disableErrorMessage?: boolean; onStream?: ApiStreamCallbackForFullName<F, V>; }
  : { name: F; version: V; data?: Prettify<InputForFullName<F, V>>; abortable?: boolean; disableErrorMessage?: boolean; onStream?: ApiStreamCallbackForFullName<F, V>; };

interface RuntimeApiParams {
  name?: string;
  version?: string;
  data?: unknown;
  abortable?: boolean;
  disableErrorMessage?: boolean;
  onStream?: (event: ApiStreamEvent) => void;
}

interface ApiErrorResponse {
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
  const { name, version, disableErrorMessage = false, onStream } = runtimeParams;
  const payloadData = runtimeParams.data;

  return new Promise<RequestOutput>((resolve, reject) => {
    void (async () => {
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

      let signal: AbortSignal | null = null;
      let abortHandler: (() => void) | null = null;
      let queueId: string | null = null;
      let cleanupStreamListener: (() => void) | null = null;

      const cleanupAbortController = () => {
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
        }
        abortControllers.delete(fullName);
      };

      if (useAbortController) {
        if (abortControllers.has(fullName)) {
          const prevAbortController = abortControllers.get(fullName);
          prevAbortController?.abort();
        }
        const abortController = new AbortController();
        abortControllers.set(fullName, abortController);
        signal = abortController.signal;

        abortHandler = () => {
          cleanupStreamListener?.();
          cleanupStreamListener = null;
          cleanupAbortController();
          if (queueId) {
            removeApiQueueItem(queueId);
          }
          reject(new Error(`Request ${fullName} aborted`));
        };

        signal.addEventListener("abort", abortHandler);
      }

      const runRequest = (socketInstance: Socket) => {
        if (!canSendNow(socketInstance)) {
          queueId ??= createQueueId();
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
          });
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
        socketInstance.once(buildApiResponseEventName(tempIndex), (response: ApiResponse) => {
          if (signal?.aborted) {
            return;
          }

          cleanupStreamListener?.();
          cleanupStreamListener = null;

          const status = response.status;

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
        });
      };

      runRequest(socket);
    })();
  });
}