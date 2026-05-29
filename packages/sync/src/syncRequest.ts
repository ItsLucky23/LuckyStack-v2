//? All cross-package imports go through `@luckystack/core/client` (the
//? browser-safe subpath) — never the main `@luckystack/core` barrel which
//? re-exports server-only modules (paths.ts, db.ts, redis.ts) that must
//? not enter a Vite client bundle.
import type {
  BaseSessionLayout as SessionLayout,
  StreamPayload,
  SyncTypeMap,
  statusContent,
} from "@luckystack/core/client";
import {
  getLogger,
  getProjectConfig,
  notify,
  incrementResponseIndex,
  socket,
  waitForSocket,
  enqueueSyncRequest,
  isOnline,
  normalizeErrorResponseCore,
  parseServiceRouteName,
  buildSyncProgressEventName,
  buildSyncResponseEventName,
  socketEventNames,
} from "@luckystack/core/client";
import { Dispatch, RefObject, SetStateAction, useCallback, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";

export type SyncRequestStreamEvent<T extends StreamPayload = StreamPayload> = T;

export type SyncRouteStreamEvent<T extends StreamPayload = StreamPayload> = T;

type SyncRequestStreamCallback = (event: SyncRequestStreamEvent) => void;
type SyncEventStreamCallback = (params: { stream: SyncRouteStreamEvent }) => void;

const shouldLogDev = () => getProjectConfig().logging.devLogs;
const shouldNotifyDev = () => getProjectConfig().logging.devNotifications;
const shouldLogSocketStatus = () => getProjectConfig().logging.socketStatus;
const shouldLogStream = () => getProjectConfig().logging.stream;

// ═══════════════════════════════════════════════════════════════════════════════
// Type Helpers for Sync Requests
// ═══════════════════════════════════════════════════════════════════════════════

// Check if data input is required (i.e., T does NOT allow empty object)
// Unions like {a:1} | {b:1} do NOT allow {}, so data will be required
type DataRequired<T> = Record<string, never> extends T ? false : true;

type UnionToIntersection<U> =
  (U extends unknown ? (arg: U) => void : never) extends ((arg: infer I) => void)
    ? I
    : never;

type Prettify<T> = { [K in keyof T]: T[K] } & {};

// ═══════════════════════════════════════════════════════════════════════════════
// Global Sync Params
// ═══════════════════════════════════════════════════════════════════════════════

// All possible sync names across all pages
type SyncRouteRecord = UnionToIntersection<{
  [P in keyof SyncTypeMap]: {
    [N in keyof SyncTypeMap[P] as P extends 'root'
      ? `system/${Extract<N, string>}`
      : `${Extract<P, string>}/${Extract<N, string>}`]: SyncTypeMap[P][N]
  }
}[keyof SyncTypeMap]>;

type SyncFullName = Extract<keyof SyncRouteRecord, string>;
type VersionsForFullName<F extends SyncFullName> = Extract<keyof SyncRouteRecord[F], string>;

type ClientInputForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> = SyncRouteRecord[F][V] extends { clientInput: infer I }
  ? I
  : never;

type ServerOutputForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> = SyncRouteRecord[F][V] extends { serverOutput: infer O }
  ? O
  : never;

type ClientOutputForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> = SyncRouteRecord[F][V] extends { clientOutput: infer O }
  ? O
  : never;

type ServerStreamForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> = SyncRouteRecord[F][V] extends { serverStream: infer O }
  ? O
  : never;

type ClientStreamForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> = SyncRouteRecord[F][V] extends { clientStream: infer O }
  ? O
  : never;

type SyncRequestStreamCallbackForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> =
  [ServerStreamForFullName<F, V>] extends [never]
    ? never
    : (event: SyncRequestStreamEvent<Prettify<ServerStreamForFullName<F, V> extends StreamPayload ? ServerStreamForFullName<F, V> : StreamPayload>>) => void;

//? Recipients see chunks from THREE sources, all on the same wire channel:
//?   1. `_client_v{n}.ts`'s `stream(...)` (per-recipient, runs after _server)
//?   2. `_server_v{n}.ts`'s `broadcastStream(...)` (room-wide fan-out)
//?   3. `_server_v{n}.ts`'s `streamTo(tokens, ...)` (selective fan-out)
//? All three flow into `upsertSyncEventCallback`'s `stream` argument. Both
//? serverStream and clientStream are folded into the union so the callback
//? sees every shape the route can emit. If neither side ever streams, the
//? callback type collapses to never (compile error to register one).
type CombinedRouteStream<F extends SyncFullName, V extends VersionsForFullName<F>> =
  | (ClientStreamForFullName<F, V> extends never ? never : ClientStreamForFullName<F, V>)
  | (ServerStreamForFullName<F, V> extends never ? never : ServerStreamForFullName<F, V>);

type SyncRouteStreamCallbackForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> =
  [CombinedRouteStream<F, V>] extends [never]
    ? never
    : (params: { stream: SyncRouteStreamEvent<Prettify<CombinedRouteStream<F, V> extends StreamPayload ? CombinedRouteStream<F, V> : StreamPayload>> }) => void;

type SyncParamsForFullName<
  F extends SyncFullName,
  V extends VersionsForFullName<F>
> = DataRequired<ClientInputForFullName<F, V>> extends true
  ? {
    name: F;
    version: V;
    data: ClientInputForFullName<F, V>;
    receiver: string;
    ignoreSelf?: boolean;
    onStream?: SyncRequestStreamCallbackForFullName<F, V>;
    /**
     * Per-request override of `projectConfig.offlineQueue.dropPolicy`. Lets a
     * specific sync ("editor cursor move") pick `'drop-oldest'` while the
     * app default stays `'reject'` for safer sends. When omitted, falls back
     * to the global config.
     */
    offlineDropPolicy?: 'drop-oldest' | 'drop-newest' | 'reject';
    /**
     * Optional AbortSignal. When aborted the client emits `syncCancel { cb }`
     * to the server and resolves locally with
     * `{ status: 'error', errorCode: 'request.aborted' }`.
     */
    signal?: AbortSignal;
  }
  : {
    name: F;
    version: V;
    data?: ClientInputForFullName<F, V>;
    receiver: string;
    ignoreSelf?: boolean;
    onStream?: SyncRequestStreamCallbackForFullName<F, V>;
    /** Per-request override (see typed branch). */
    offlineDropPolicy?: 'drop-oldest' | 'drop-newest' | 'reject';
    /** Optional AbortSignal — see typed branch. */
    signal?: AbortSignal;
  };

interface RuntimeSyncParams {
  name?: string;
  version?: string;
  data?: unknown;
  receiver?: string;
  ignoreSelf?: boolean;
  onStream?: SyncRequestStreamCallback;
  offlineDropPolicy?: 'drop-oldest' | 'drop-newest' | 'reject';
  signal?: AbortSignal;
}

interface SyncErrorParam { key: string; value: string | number | boolean };

interface SyncResponseError {
  status: 'error';
  message: string;
  errorCode: string;
  errorParams?: SyncErrorParam[];
  httpStatus?: number;
}

interface SyncAckResponse {
  status?: 'success' | 'error';
  message?: string;
  result?: unknown;
  errorCode?: string;
  errorParams?: SyncErrorParam[];
  httpStatus?: number;
}

type SyncResultForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> =
  [ServerOutputForFullName<F, V>] extends [never]
    ? Record<string, never>
    : ServerOutputForFullName<F, V>;

type SyncRequestResponseForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> =
  | SyncResponseError
  | {
    status: 'success';
    message: string;
    result: SyncResultForFullName<F, V>;
  };

// ═══════════════════════════════════════════════════════════════════════════════
// Sync Event Callbacks Registry
// ═══════════════════════════════════════════════════════════════════════════════

type SyncEventCallback = (params: { clientOutput: unknown; serverOutput: unknown }) => void;
const syncEvents: Partial<Record<string, SyncEventCallback[]>> = {};
const syncStreamEvents: Partial<Record<string, SyncEventStreamCallback[]>> = {};
const noop = () => null;

interface SyncLifecycleHandlers {
  connect: () => void;
  disconnect: () => void;
  reconnectAttempt: (attempt: number) => void;
  userAfk: (payload: { userId: string; endTime?: number }) => void;
  userBack: (payload: { userId: string }) => void;
  connectError: (err: { message: string }) => void;
}

let activeLifecycleHandlers: SyncLifecycleHandlers | null = null;

const canSendNow = (socketInstance: Socket) => {
  if (!socketInstance.connected) return false;
  return isOnline();
};

const createQueueId = () => {
  return `${String(Date.now())}-${String(Math.random())}`;
};

const getCallbacksForRoute = (route: string): SyncEventCallback[] => {
  syncEvents[route] ??= [];
  return syncEvents[route];
};

const getStreamCallbacksForRoute = (route: string): SyncEventStreamCallback[] => {
  syncStreamEvents[route] ??= [];
  return syncStreamEvents[route];
};

const triggerSyncCallbacks = (name: string, clientOutput: unknown, serverOutput: unknown) => {
  const callbacks = syncEvents[name] ?? [];
  if (callbacks.length === 0) {
    if (shouldLogDev()) {
      getLogger().warn(`Sync event ${name} has no registered callback on this page`);
    }
    return;
  }

  for (const callback of callbacks) {
    callback({ clientOutput, serverOutput });
  }
};

const triggerSyncStreamCallbacks = (name: string, stream: SyncRouteStreamEvent) => {
  const callbacks = syncStreamEvents[name] ?? [];
  if (callbacks.length === 0) {
    return;
  }

  for (const callback of callbacks) {
    callback({ stream });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// syncRequest Function Overloads
// ═══════════════════════════════════════════════════════════════════════════════

const normalizeSyncError = ({
  response,
  fallbackErrorCode,
}: {
  response: SyncAckResponse;
  fallbackErrorCode: string;
}): SyncResponseError => {
  const normalized = normalizeErrorResponseCore({
    response,
    fallbackErrorCode,
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
    httpStatus: normalized.httpStatus,
  };
};

type SyncRequestParamsWithOptions<F extends SyncFullName, V extends VersionsForFullName<F>> =
  SyncParamsForFullName<F, V>;

const syncRequestInternal = <F extends SyncFullName, V extends VersionsForFullName<F>>(
  params: SyncRequestParamsWithOptions<F, V>
): Promise<Prettify<SyncRequestResponseForFullName<F, V>>> => {
  const runtimeParams = params as RuntimeSyncParams;
  const { name, version, receiver, ignoreSelf, onStream, offlineDropPolicy, signal: externalSignal } = runtimeParams;
  const payloadData = runtimeParams.data;

  type RequestOutput = Prettify<SyncRequestResponseForFullName<F, V>>;

  return new Promise<RequestOutput>((resolve) => {
    void (async () => {
      //? B1 — if the consumer-supplied signal is already aborted at call
      //? time, short-circuit before we even touch the socket.
      if (externalSignal?.aborted) {
        resolve(normalizeSyncError({
          response: { status: 'error', errorCode: 'request.aborted' },
          fallbackErrorCode: 'request.aborted',
        }) as RequestOutput);
        return;
      }
      if (!name || typeof name !== "string") {
        if (shouldLogDev()) {
          getLogger().error("Invalid name for syncRequest");
        }
        if (shouldNotifyDev()) {
          notify.error({ key: 'sync.invalidName' });
        }
        resolve(normalizeSyncError({
          response: { status: 'error', errorCode: 'sync.invalidName' },
          fallbackErrorCode: 'sync.invalidName',
        }) as RequestOutput);
        return;
      }

      const parsedRoute = parseServiceRouteName(name);
      if (parsedRoute.status === 'error') {
        if (shouldLogDev()) {
          getLogger().error(`[syncRequest] Invalid service route name '${name}'`, undefined, { reason: parsedRoute.reason });
        }
        if (shouldNotifyDev()) {
          notify.error({ key: 'routing.invalidServiceRouteName' });
        }
        resolve(normalizeSyncError({
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

      if (!version || typeof version !== 'string') {
        if (shouldLogDev()) {
          getLogger().error("Invalid version for syncRequest");
        }
        if (shouldNotifyDev()) {
          notify.error({ key: 'sync.invalidVersion' });
        }
        resolve(normalizeSyncError({
          response: { status: 'error', errorCode: 'sync.invalidVersion' },
          fallbackErrorCode: 'sync.invalidVersion',
        }) as RequestOutput);
        return;
      }

      const normalizedReceiver = typeof receiver === 'string' ? receiver.trim() : '';

      if (!normalizedReceiver) {
        if (shouldLogDev()) {
          getLogger().error("You need to provide a receiver for syncRequest, this can be either 'all' to trigger all sockets which we do not recommend or it can be any value such as a code e.g 'Ag2cg4'. this works together with the joinRoom and leaveRoom function");
        }
        if (shouldNotifyDev()) {
          notify.error({ key: 'sync.missingReceiver' });
        }
        resolve(normalizeSyncError({
          response: { status: 'error', errorCode: 'sync.missingReceiver' },
          fallbackErrorCode: 'sync.missingReceiver',
        }) as RequestOutput);
        return;
      }

      if (!await waitForSocket()) {
        resolve(normalizeSyncError({
          response: { status: 'error', errorCode: 'sync.ioUnavailable' },
          fallbackErrorCode: 'sync.ioUnavailable',
        }) as RequestOutput);
        return;
      }
      if (!socket) {
        resolve(normalizeSyncError({
          response: { status: 'error', errorCode: 'sync.ioUnavailable' },
          fallbackErrorCode: 'sync.ioUnavailable',
        }) as RequestOutput);
        return;
      }

      const fullName = `sync/${sanitizedName}/${version}`;
      let queueId: string | null = null;

      const runRequest = (socketInstance: Socket) => {
        if (!canSendNow(socketInstance)) {
          queueId ??= createQueueId();
          //? `enqueueSyncRequest` returns `false` when the offline queue is
          //? full and `dropPolicy: 'reject'` is active. Resolve with a
          //? normalized error envelope so the caller can branch instead of
          //? awaiting forever.
          const enqueued = enqueueSyncRequest({
            id: queueId,
            key: fullName,
            run: (s) => {
              runRequest(s);
            },
            createdAt: Date.now(),
            dropPolicy: offlineDropPolicy,
          });
          if (!enqueued) {
            resolve(normalizeSyncError({
              response: { status: 'error', errorCode: 'offline.queueFull' },
              fallbackErrorCode: 'offline.queueFull',
            }) as RequestOutput);
          }
          return;
        }

        const tempIndex = incrementResponseIndex();

        let cleanupProgressListener: (() => void) | null = null;

        if (shouldLogDev()) {
          getLogger().debug(`Client Sync Request(${String(tempIndex)})`, { syncName: sanitizedName, data, receiver: normalizedReceiver, ignoreSelf });
        }

        if (typeof onStream === 'function') {
          const progressEventName = buildSyncProgressEventName(tempIndex);
          const progressListener = (streamPayload: SyncRequestStreamEvent) => {
            if (shouldLogStream()) {
              getLogger().debug(`Server Sync Stream(${String(tempIndex)})`, { syncName: sanitizedName, streamPayload });
            }

            onStream(streamPayload);
          };

          socketInstance.on(progressEventName, progressListener);
          cleanupProgressListener = () => {
            socketInstance.off(progressEventName, progressListener);
          };
        }

        const syncCb = `${sanitizedName}/${version}`;
        socketInstance.emit(socketEventNames.sync, { name: fullName, data, cb: syncCb, receiver: normalizedReceiver, responseIndex: tempIndex, ignoreSelf });

        //? B1 — bridge the consumer's AbortSignal to the server. When the
        //? signal fires we emit `syncCancel { cb }` so the server-side
        //? handler stops emitting new chunks. We also resolve locally with
        //? `request.aborted` so the awaiting caller settles.
        let cleanupExternalAbort: (() => void) | null = null;
        if (externalSignal) {
          const externalAbortHandler = () => {
            socketInstance.emit(socketEventNames.syncCancel, { cb: syncCb });
            cleanupProgressListener?.();
            cleanupProgressListener = null;
            cleanupExternalAbort?.();
            cleanupExternalAbort = null;
            resolve(normalizeSyncError({
              response: { status: 'error', errorCode: 'request.aborted' },
              fallbackErrorCode: 'request.aborted',
            }) as RequestOutput);
          };
          externalSignal.addEventListener('abort', externalAbortHandler);
          cleanupExternalAbort = () => {
            externalSignal.removeEventListener('abort', externalAbortHandler);
          };
        }

        socketInstance.once(buildSyncResponseEventName(tempIndex), (responseData: SyncAckResponse) => {
          cleanupProgressListener?.();
          cleanupExternalAbort?.();
          cleanupExternalAbort = null;

          if (responseData.status === "error") {
            const normalizedError = normalizeSyncError({
              response: responseData,
              fallbackErrorCode: 'sync.failedRequest',
            });

            if (shouldLogDev()) {
              getLogger().error(`Sync ${sanitizedName} failed`, undefined, { message: normalizedError.message });
            }
            if (shouldNotifyDev()) {
              notify.error({
                key: 'sync.failedRequest',
                params: [
                  { key: 'name', value: sanitizedName },
                  { key: 'message', value: normalizedError.message },
                ],
              });
            }
            resolve(normalizedError);
            return;
          }

          if (responseData.status !== 'success') {
            resolve(normalizeSyncError({
              response: responseData,
              fallbackErrorCode: 'sync.invalidServerResponse',
            }) as RequestOutput);
            return;
          }

          const result = responseData.result && typeof responseData.result === 'object'
            ? responseData.result
            : {};

          //? `RequestOutput.result` is a generic `Record<string, never>` shape
          //? that the runtime response can't structurally satisfy from the
          //? untyped `responseData.result` (server-side typing lives on the
          //? other side of the socket). The cast is the documented socket
          //? response boundary.
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- socket response boundary
          resolve({
            status: 'success',
            message: typeof responseData.message === 'string' && responseData.message.trim().length > 0
              ? responseData.message
              : `sync ${sanitizedName} success`,
            result,
          } as RequestOutput);
        });
      };

      runRequest(socket);
    })();
  });
};

export function syncRequest<F extends SyncFullName, V extends VersionsForFullName<F>>(
  params: SyncRequestParamsWithOptions<F, V>
): Promise<Prettify<SyncRequestResponseForFullName<F, V>>> {
  return syncRequestInternal(params);
}

// ═══════════════════════════════════════════════════════════════════════════════
// useSyncEvents Hook - Type-Safe Event Registration
// ═══════════════════════════════════════════════════════════════════════════════

//? Hoisted to module scope so the emitted `.d.ts` for `useSyncEvents` can
//? reference them. Local interface declarations inside an exported function
//? trigger TS4025 ("has or is using private name") under `declaration: true`.
interface TypedCallbackParams<F extends SyncFullName, V extends VersionsForFullName<F>> {
  clientOutput: ClientOutputForFullName<F, V>;
  serverOutput: ServerOutputForFullName<F, V>;
}

interface UpsertParams<F extends SyncFullName, V extends VersionsForFullName<F>> {
  name: F;
  version: V;
  callback: (params: TypedCallbackParams<F, V>) => void;
}

interface UpsertStreamParams<F extends SyncFullName, V extends VersionsForFullName<F>> {
  name: F;
  version: V;
  callback: SyncRouteStreamCallbackForFullName<F, V>;
}

export const useSyncEvents = () => {
  const localRegistryRef = useRef<Map<string, SyncEventCallback>>(new Map());
  const localStreamRegistryRef = useRef<Map<string, SyncEventStreamCallback>>(new Map());

  const upsertSyncEventCallback = useCallback(<F extends SyncFullName, V extends VersionsForFullName<F>>(
    params: UpsertParams<F, V>
  ): (() => void) => {

    if (typeof params.version !== 'string') {
      if (shouldLogDev()) {
        getLogger().error("Invalid version for upsertSyncEventCallback");
      }
      if (shouldNotifyDev()) {
        notify.error({ key: 'sync.invalidVersion' });
      }
      return noop;
    }

    if (typeof params.callback !== 'function') {
      if (shouldLogDev()) {
        getLogger().error("Invalid callback for upsertSyncEventCallback");
      }
      if (shouldNotifyDev()) {
        notify.error({ key: 'sync.invalidCallback' });
      }
      return noop;
    }

    const routeName = params.name;
    const parsedRoute = parseServiceRouteName(routeName);
    if (parsedRoute.status === 'error') {
      if (shouldLogDev()) {
        getLogger().error(`Invalid name for upsertSyncEventCallback`, undefined, { routeName, reason: parsedRoute.reason });
      }
      if (shouldNotifyDev()) {
        notify.error({ key: 'routing.invalidServiceRouteName' });
      }
      return noop;
    }
    const sanitizedName = parsedRoute.normalizedRouteName;

    const routeVersion = params.version;
    const fullName = `sync/${sanitizedName}/${routeVersion}`;
    const callback: SyncEventCallback = ({ clientOutput, serverOutput }) => {
      params.callback({
        clientOutput: clientOutput as ClientOutputForFullName<F, V>,
        serverOutput: serverOutput as ServerOutputForFullName<F, V>,
      });
    };
    const callbacks = getCallbacksForRoute(fullName);

    const previousForRoute = localRegistryRef.current.get(fullName);
    if (previousForRoute) {
      syncEvents[fullName] = callbacks.filter((cb) => cb !== previousForRoute);
    }

    const nextCallbacks = getCallbacksForRoute(fullName);
    // Multiple components can intentionally subscribe to the same sync event.
    // Only warn when the exact same callback is registered twice.
    if (nextCallbacks.includes(callback)) {
      if (shouldLogDev()) {
        getLogger().warn(`[SyncEvents] Duplicate callback registration was ignored`, { fullName });
      }

      localRegistryRef.current.set(fullName, callback);

      return () => {
        const current = getCallbacksForRoute(fullName);
        syncEvents[fullName] = current.filter((cb) => cb !== callback);

        if (localRegistryRef.current.get(fullName) === callback) {
          localRegistryRef.current.delete(fullName);
        }
      };
    }

    nextCallbacks.push(callback);
    syncEvents[fullName] = nextCallbacks;
    localRegistryRef.current.set(fullName, callback);

    return () => {
      const current = getCallbacksForRoute(fullName);
      syncEvents[fullName] = current.filter((cb) => cb !== callback);

      if (localRegistryRef.current.get(fullName) === callback) {
        localRegistryRef.current.delete(fullName);
      }
    };
  }, []);

  const upsertSyncEventStreamCallback = useCallback(<F extends SyncFullName, V extends VersionsForFullName<F>>(
    params: UpsertStreamParams<F, V>
  ): (() => void) => {

    if (typeof params.version !== 'string') {
      if (shouldLogDev()) {
        getLogger().error("Invalid version for upsertSyncEventStreamCallback");
      }
      if (shouldNotifyDev()) {
        notify.error({ key: 'sync.invalidVersion' });
      }
      return noop;
    }

    if (typeof params.callback !== 'function') {
      if (shouldLogDev()) {
        getLogger().error("Invalid callback for upsertSyncEventStreamCallback");
      }
      if (shouldNotifyDev()) {
        notify.error({ key: 'sync.invalidCallback' });
      }
      return noop;
    }

    const routeName = params.name;
    const parsedRoute = parseServiceRouteName(routeName);
    if (parsedRoute.status === 'error') {
      if (shouldLogDev()) {
        getLogger().error(`Invalid name for upsertSyncEventStreamCallback`, undefined, { routeName, reason: parsedRoute.reason });
      }
      if (shouldNotifyDev()) {
        notify.error({ key: 'routing.invalidServiceRouteName' });
      }
      return noop;
    }
    const sanitizedName = parsedRoute.normalizedRouteName;

    const routeVersion = params.version;
    const fullName = `sync/${sanitizedName}/${routeVersion}`;
    //? Combined union: both `serverStream` (from `broadcastStream` /
    //? `streamTo`) and `clientStream` (from `_client_v{n}.ts`) flow through
    //? this callback. The type matches `SyncRouteStreamCallbackForFullName`.
    const typedCallback = params.callback as (params: {
      stream: SyncRouteStreamEvent<Prettify<CombinedRouteStream<F, V> extends StreamPayload ? CombinedRouteStream<F, V> : StreamPayload>>;
    }) => void;
    const callback: SyncEventStreamCallback = ({ stream }) => {
      typedCallback({
        stream: stream as SyncRouteStreamEvent<Prettify<CombinedRouteStream<F, V> extends StreamPayload ? CombinedRouteStream<F, V> : StreamPayload>>,
      });
    };
    const callbacks = getStreamCallbacksForRoute(fullName);

    const previousForRoute = localStreamRegistryRef.current.get(fullName);
    if (previousForRoute) {
      syncStreamEvents[fullName] = callbacks.filter((cb) => cb !== previousForRoute);
    }

    const nextCallbacks = getStreamCallbacksForRoute(fullName);
    if (nextCallbacks.includes(callback)) {
      if (shouldLogDev()) {
        getLogger().warn(`[SyncEvents] Duplicate stream callback registration was ignored`, { fullName });
      }

      localStreamRegistryRef.current.set(fullName, callback);

      return () => {
        const current = getStreamCallbacksForRoute(fullName);
        syncStreamEvents[fullName] = current.filter((cb) => cb !== callback);

        if (localStreamRegistryRef.current.get(fullName) === callback) {
          localStreamRegistryRef.current.delete(fullName);
        }
      };
    }

    nextCallbacks.push(callback);
    syncStreamEvents[fullName] = nextCallbacks;
    localStreamRegistryRef.current.set(fullName, callback);

    return () => {
      const current = getStreamCallbacksForRoute(fullName);
      syncStreamEvents[fullName] = current.filter((cb) => cb !== callback);

      if (localStreamRegistryRef.current.get(fullName) === callback) {
        localStreamRegistryRef.current.delete(fullName);
      }
    };
  }, []);

  useEffect(() => {
    const localRegistry = localRegistryRef.current;
    const localStreamRegistry = localStreamRegistryRef.current;

    return () => {
      for (const [fullName, callback] of localRegistry.entries()) {
        const current = getCallbacksForRoute(fullName);
        syncEvents[fullName] = current.filter((cb) => cb !== callback);
      }

      for (const [fullName, callback] of localStreamRegistry.entries()) {
        const current = getStreamCallbacksForRoute(fullName);
        syncStreamEvents[fullName] = current.filter((cb) => cb !== callback);
      }

      localRegistry.clear();
      localStreamRegistry.clear();
    };
  }, []);

  return { upsertSyncEventCallback, upsertSyncEventStreamCallback };
}

export const useSyncEventTrigger = () => {
  const triggerSyncEvent = useCallback((name: string, clientOutput: unknown = {}, serverOutput: unknown = {}) => {
    triggerSyncCallbacks(name, clientOutput, serverOutput);
  }, []);

  const triggerSyncStreamEvent = useCallback((name: string, stream: SyncRouteStreamEvent) => {
    triggerSyncStreamCallbacks(name, stream);
  }, []);

  return { triggerSyncEvent, triggerSyncStreamEvent }
}

type SocketStatusSetter = Dispatch<
  SetStateAction<{
    self: statusContent;
    [userId: string]: statusContent;
  }>
>;

const buildConnectHandler = ({ setSocketStatus }: { setSocketStatus: SocketStatusSetter }) => () => {
  if (shouldLogSocketStatus()) getLogger().info("Connected to server");
  setSocketStatus(prev => ({ ...prev, self: { ...prev.self, status: "CONNECTED" } }));
};

const buildDisconnectHandler = ({ setSocketStatus }: { setSocketStatus: SocketStatusSetter }) => () => {
  setSocketStatus(prev => ({ ...prev, self: { ...prev.self, status: "DISCONNECTED" } }));
  if (shouldLogSocketStatus()) getLogger().info("Disconnected, trying to reconnect...");
};

const buildReconnectAttemptHandler = ({ setSocketStatus }: { setSocketStatus: SocketStatusSetter }) => (attempt: number) => {
  setSocketStatus(prev => ({ ...prev, self: { ...prev.self, status: "RECONNECTING", reconnectAttempt: attempt } }));
  if (shouldLogSocketStatus()) getLogger().info(`Reconnecting attempt ${String(attempt)}...`);
};

const buildUserAfkHandler = ({
  setSocketStatus, sessionRef,
}: {
  setSocketStatus: SocketStatusSetter;
  sessionRef: RefObject<SessionLayout | null>;
}) => ({ userId, endTime }: { userId: string; endTime?: number }) => {
  if (sessionRef.current !== null && userId === sessionRef.current.id) {
    setSocketStatus(prev => ({
      ...prev,
      self: { status: "DISCONNECTED", reconnectAttempt: undefined, endTime },
    }));
  } else {
    setSocketStatus(prev => ({
      ...prev,
      [userId]: { status: "DISCONNECTED", endTime },
    }));
  }
};

const buildUserBackHandler = ({ setSocketStatus }: { setSocketStatus: SocketStatusSetter }) => ({ userId }: { userId: string }) => {
  if (shouldLogSocketStatus()) getLogger().debug("userBack", { userId });
  setSocketStatus(prev => ({
    ...prev,
    [userId]: { status: "CONNECTED", endTime: undefined },
  }));
};

const buildConnectErrorHandler = ({ setSocketStatus }: { setSocketStatus: SocketStatusSetter }) => (err: { message: string }) => {
  if (shouldLogSocketStatus()) getLogger().debug("connect_error", { err });
  setSocketStatus(prev => ({
    ...prev,
    self: { ...prev.self, status: "DISCONNECTED", reconnectAttempt: undefined },
  }));
  if (shouldLogDev()) getLogger().error(`Connection error`, err);
  if (shouldNotifyDev()) notify.error({ key: 'common.connectionError' });
};

export const initSyncRequest = async ({
  setSocketStatus,
  sessionRef
}: {
  setSocketStatus: SocketStatusSetter;
  sessionRef: RefObject<SessionLayout | null> | null;
}) => {

  if (!await waitForSocket()) { return; }
  if (!socket) { return; }
  if (!sessionRef) { return; }

  if (activeLifecycleHandlers) {
    socket.off(socketEventNames.connect, activeLifecycleHandlers.connect);
    socket.off(socketEventNames.disconnect, activeLifecycleHandlers.disconnect);
    socket.off(socketEventNames.reconnectAttempt, activeLifecycleHandlers.reconnectAttempt);
    socket.off(socketEventNames.userAfk, activeLifecycleHandlers.userAfk);
    socket.off(socketEventNames.userBack, activeLifecycleHandlers.userBack);
    socket.off(socketEventNames.connectError, activeLifecycleHandlers.connectError);
  }

  const connect = buildConnectHandler({ setSocketStatus });
  const disconnect = buildDisconnectHandler({ setSocketStatus });
  const reconnectAttempt = buildReconnectAttemptHandler({ setSocketStatus });
  const userAfk = buildUserAfkHandler({ setSocketStatus, sessionRef });
  const userBack = buildUserBackHandler({ setSocketStatus });
  const connectError = buildConnectErrorHandler({ setSocketStatus });

  activeLifecycleHandlers = {
    connect,
    disconnect,
    reconnectAttempt,
    userAfk,
    userBack,
    connectError,
  };

  socket.on(socketEventNames.connect, connect);
  socket.on(socketEventNames.disconnect, disconnect);
  socket.on(socketEventNames.reconnectAttempt, reconnectAttempt);
  socket.on(socketEventNames.userAfk, userAfk);
  socket.on(socketEventNames.userBack, userBack);
  socket.on(socketEventNames.connectError, connectError);

}