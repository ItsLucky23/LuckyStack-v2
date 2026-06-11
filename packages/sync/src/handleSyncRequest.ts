/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import type { syncMessage, PostSyncFanoutPayload } from "@luckystack/core";
import { Socket } from "socket.io";
import { readSession } from "@luckystack/core";
import type { BaseSessionLayout as SessionLayout } from '@luckystack/core';
import { getProjectConfig } from '@luckystack/core';
import { getRuntimeSyncMaps } from '@luckystack/core';
import {
  validateRequest,
  extractTokenFromSocket,
  getIoInstance,
  tryCatch,
  parseTransportRouteName,
  checkRateLimit,
  buildSyncProgressEventName,
  buildSyncResponseEventName,
  socketEventNames,
  dispatchHook,
  validateInputByType,
  getLogger,
  resolveClientIp,
} from "@luckystack/core";
import { extractLanguageFromHeader, normalizeErrorResponse } from "@luckystack/core";
import type { ErrorFormatter } from "@luckystack/core";
import { buildSyncStreamEmitters } from './_shared/streamEmitters';
import {
  registerSyncAbortController,
  unregisterSyncAbortController,
} from '@luckystack/core';
import type {
  RuntimeErrorResponse,
  RuntimeSyncServerEntry,
  RuntimeSyncClientHandler,
  SyncErrorEnvelopeInput,
} from './_shared/syncTypes';
import { shouldLogDev, shouldLogStream } from './_shared/logFlags';
import { buildFormattedError } from './_shared/errorBuilders';
import { processClientSyncForRecipient } from './_shared/clientFanout';
import { resolveSyncValidationMode } from './_shared/validationMode';

interface SyncErrorBuilder {
  (args: {
    response: SyncErrorEnvelopeInput;
    preferred?: string | null;
    userLanguage?: string | null;
  }): RuntimeErrorResponse;
}

//? Returns true when both buckets passed; false when one rejected and the
//? caller should bail. The caller still owns the socket emit + responseIndex
//? wiring because the existing code structure interleaves emit logic with
//? other guard returns.
const applySyncRateLimits = async ({
  resolvedName,
  token,
  socket,
  user,
  responseIndex,
  buildSyncError,
  preferredLocale,
}: {
  resolvedName: string;
  token: string | null;
  socket: Socket;
  user: SessionLayout | null;
  responseIndex: number | undefined;
  buildSyncError: SyncErrorBuilder;
  preferredLocale: string | null | undefined;
}): Promise<boolean> => {
  const config = getProjectConfig();
  //? Resolve the real client IP once for both buckets. Default
  //? `http.trustProxy: false` returns `socket.handshake.address` verbatim
  //? (only IPv4-mapped IPv6 canonicalized), preserving historical keys; a
  //? trusted proxy honors X-Forwarded-For / X-Real-IP.
  const resolvedIp = resolveClientIp({
    rawAddress: socket.handshake.address,
    headers: socket.handshake.headers,
    trustProxy: config.http.trustProxy,
  });
  const defaultApiLimit = config.rateLimiting.defaultApiLimit;
  if (defaultApiLimit !== false && defaultApiLimit > 0) {
    const requesterIdentity = token ?? resolvedIp;
    const keyPrefix = token ? 'token' : 'ip';
    const rateLimitKey = `${keyPrefix}:${requesterIdentity}:sync:${resolvedName}`;
    const { allowed, resetIn } = await checkRateLimit({
      key: rateLimitKey,
      limit: defaultApiLimit,
      windowMs: config.rateLimiting.windowMs,
    });
    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        scope: token ? 'user' : 'route',
        key: rateLimitKey,
        limit: defaultApiLimit,
        windowMs: config.rateLimiting.windowMs,
        count: defaultApiLimit + 1,
        route: resolvedName,
        userId: user?.id,
      });
      if (typeof responseIndex === 'number') {
        socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
          response: {
            status: 'error',
            errorCode: 'sync.rateLimitExceeded',
            errorParams: [{ key: 'seconds', value: resetIn }],
            httpStatus: 429,
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        }));
      }
      return false;
    }
  }

  const defaultIpLimit = config.rateLimiting.defaultIpLimit;
  if (defaultIpLimit !== false && defaultIpLimit > 0) {
    const requesterIp = resolvedIp;
    const ipKey = `ip:${requesterIp}:sync:all`;
    const { allowed, resetIn } = await checkRateLimit({
      key: ipKey,
      limit: defaultIpLimit,
      windowMs: config.rateLimiting.windowMs,
    });
    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        scope: 'ip',
        key: ipKey,
        limit: defaultIpLimit,
        windowMs: config.rateLimiting.windowMs,
        count: defaultIpLimit + 1,
        ip: requesterIp,
      });
      if (typeof responseIndex === 'number') {
        socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
          response: {
            status: 'error',
            errorCode: 'sync.rateLimitExceeded',
            errorParams: [{ key: 'seconds', value: resetIn }],
            httpStatus: 429,
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        }));
      }
      return false;
    }
  }

  return true;
};


// export default async function handleSyncRequest({ name, clientData, user, serverOutput, roomCode }: syncMessage) {
export default async function handleSyncRequest({ msg, socket, token }: {
  msg: syncMessage,
  socket: Socket,
  token: string | null,
}) {

  const ioInstance = getIoInstance();
  if (!ioInstance) { return; }

  //? first we validate the data
  if (typeof msg != 'object') {
    if (shouldLogDev()) {
      getLogger().warn('sync: socket message was not a json object');
    }
    const normalized = normalizeErrorResponse({
      response: { status: 'error', errorCode: 'sync.invalidRequest' },
      preferredLocale:
        extractLanguageFromHeader(socket.handshake.headers['x-language'])
        || extractLanguageFromHeader(socket.handshake.headers['accept-language']),
    });
    return socket.emit(socketEventNames.sync, {
      status: normalized.status,
      message: normalized.message,
      errorCode: normalized.errorCode,
      errorParams: normalized.errorParams,
      httpStatus: normalized.httpStatus,
    });
  }

  const { name, data, cb, receiver: rawReceiver, responseIndex, ignoreSelf } = msg;
  const receiver = typeof rawReceiver === 'string' ? rawReceiver.trim() : '';
  const preferredLocale =
    extractLanguageFromHeader(socket.handshake.headers['x-language'])
    || extractLanguageFromHeader(socket.handshake.headers['accept-language']);

  //? Per-route formatter ref + resolved-name ref — both undefined until the
  //? sync entry is looked up. Pre-lookup errors (invalid message, unknown
  //? route) emit with global formatter only because there's no syncEntry yet.
  let currentRouteName: string | undefined;
  let currentPerRouteFormatter: ErrorFormatter | undefined;
  let currentUserId: string | undefined;

  const buildSyncError = ({
    response,
    preferred,
    userLanguage,
  }: {
    response: SyncErrorEnvelopeInput;
    preferred?: string | null;
    userLanguage?: string | null;
  }): RuntimeErrorResponse => buildFormattedError({
    response,
    preferred,
    userLanguage,
    routeName: currentRouteName,
    transport: 'socket',
    userId: currentUserId,
    perRouteFormatter: currentPerRouteFormatter,
  });

  if (!name || !data || typeof name != 'string' || typeof data != 'object') {
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.invalidRequest' },
      preferred: preferredLocale,
    }))
  }

  const normalizedData = data as Record<string, unknown>;

  const parsedRoute = parseTransportRouteName({ value: name, prefix: 'sync' });
  if (parsedRoute.status === 'error') {
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: {
        status: 'error',
        errorCode: 'routing.invalidServiceRouteName',
        errorParams: [{ key: 'name', value: name }],
      },
      preferred: preferredLocale,
    }));
  }

  const resolvedName = parsedRoute.normalizedFullName;
  currentRouteName = resolvedName;

  if (!cb || typeof cb != 'string') {
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.invalidCallback' },
      preferred: preferredLocale,
    }));
  }

  if (!receiver) {
    if (shouldLogDev()) {
      getLogger().warn('sync: missing receiver / roomCode', { receiver });
    }
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.missingReceiver' },
      preferred: preferredLocale,
    }));
  }

  if (shouldLogDev()) {
    getLogger().debug(`sync: ${resolvedName} called`, { sync: resolvedName });
  }

  const user = await readSession(token);
  currentUserId = user?.id;
  //? Identity propagation now flows via the `preSyncAuthorize` hook subscriber
  //? registered by `@luckystack/error-tracking`'s `enableErrorTrackingAutoInstrumentation()`.
  //? Direct `setSentryUser` removed from this handler — see migration doc.
  const { syncObject, functionsObject } = await getRuntimeSyncMaps();

  //? B1 — per-request AbortController. The controller drives three things:
  //?   1. Aborts when the client emits `syncCancel { cb }` (registered in cancelRegistry).
  //?   2. Aborts when the originator socket disconnects (listener below).
  //?   3. Gates further chunk emits via the signal handed to streamEmitters.
  //? `cb` is the stable per-request key the client already knows; we register
  //? under `${socket.id}:${cb}` so cancel lookups are deterministic.
  const abortController = new AbortController();
  const abortKey = registerSyncAbortController(socket.id, cb, abortController);
  const onSocketDisconnect = () => {
    abortController.abort();
  };
  socket.once(socketEventNames.disconnect, onSocketDisconnect);
  let cleanupDone = false;
  const cleanupRequest = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    socket.off(socketEventNames.disconnect, onSocketDisconnect);
    unregisterSyncAbortController(abortKey);
  };

  //? we check if there is a client file or/and a server file, if they both dont exist we abort
  if (!syncObject[`${resolvedName}_client`] && !syncObject[`${resolvedName}_server`]) {
    if (shouldLogDev()) {
      getLogger().warn(`sync: ${name} has no _client or _server file`, { sync: name });
    }
    cleanupRequest();
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.notFound' },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
  }

  const { emitServerSyncStream, emitBroadcastSyncStream, emitStreamToTokens, flushPressure } =
    buildSyncStreamEmitters({
      cb,
      receiver,
      resolvedName,
      logLabel: 'sync',
      signal: abortController.signal,
      originatorSocket: socket,
      emitOriginatorChunk: (payload) => {
        if (typeof responseIndex !== 'number') return;
        socket.emit(buildSyncProgressEventName(responseIndex), payload);
      },
    });

  //? Pipeline order: auth → rate-limit → validate → execute → respond.
  //? Auth runs first so unauthenticated probes can't consume rate-limit budget
  //? or learn input shape from `inputValidation.message`. Mirrors api handlers.
  const serverSyncEntry = syncObject[`${resolvedName}_server`] as RuntimeSyncServerEntry | undefined;
  currentPerRouteFormatter = serverSyncEntry?.errorFormatter;
  if (serverSyncEntry) {
    const { auth } = serverSyncEntry;
    if (auth.login && !user?.id) {
      if (shouldLogDev()) {
        getLogger().warn(`sync: ${resolvedName} requires login`, { sync: resolvedName });
      }
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
        response: { status: 'error', errorCode: 'auth.required' },
        preferred: preferredLocale,
      }));
    }

    const validationResult = validateRequest({ auth, user: user! });
    if (validationResult.status === 'error') {
      if (shouldLogDev()) {
        getLogger().warn(`sync: auth failed for ${resolvedName}`, { sync: resolvedName, errorCode: validationResult.errorCode });
      }
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
        response: {
          status: 'error',
          errorCode: validationResult.errorCode || 'auth.forbidden',
          errorParams: validationResult.errorParams,
          httpStatus: validationResult.httpStatus,
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }));
    }
  }

  //? Custom authorization hook. Fires after basic auth + AuthProps check
  //? pass, before rate-limit + input validation. Consumers use this to
  //? enforce room-membership rules ("user X may only emit sync to room
  //? Y"), per-tenant policies, or audit trails. Stop with a specific
  //? errorCode to reject without revealing input shape.
  const preAuthorizeResult = await dispatchHook('preSyncAuthorize', {
    routeName: resolvedName,
    data: normalizedData,
    user,
    receiver,
    transport: 'socket',
  });
  if (preAuthorizeResult.stopped) {
    if (shouldLogDev()) {
      getLogger().warn(`sync: preSyncAuthorize stopped ${resolvedName}`, { sync: resolvedName, errorCode: preAuthorizeResult.signal.errorCode });
    }
    cleanupRequest();
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: {
        status: 'error',
        errorCode: preAuthorizeResult.signal.errorCode,
        httpStatus: preAuthorizeResult.signal.httpStatus,
      },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
  }

  //? Observational mirror of `preSyncAuthorize`. Fires after the request
  //? passes auth + custom policy; lets audit-log / metrics subscribers
  //? record successful authorizations without forking the dispatch path.
  //? Stop signals from handlers are ignored (this is post-decision).
  void dispatchHook('postSyncAuthorize', {
    routeName: resolvedName,
    data: normalizedData,
    user,
    receiver,
    transport: 'socket',
  });

  //? Rate limit check: per-sync bucket fallback + global per-IP cap
  const rateLimitOk = await applySyncRateLimits({
    resolvedName,
    token,
    socket,
    user,
    responseIndex,
    buildSyncError,
    preferredLocale,
  });
  if (!rateLimitOk) { cleanupRequest(); return; }

  let serverOutput = {};
  if (serverSyncEntry) {
    const { main: serverMain, inputType, inputTypeFilePath } = serverSyncEntry;

    //? Per-route validation toggle (mirrors the API handler). `'relaxed'` or
    //? `{ input: 'skip' }` skips runtime input validation entirely — for routes
    //? whose payload shape can't be modelled in TS. Default `'strict'`.
    if (resolveSyncValidationMode(serverSyncEntry.validation) === 'strict') {
      const inputValidation = await validateInputByType({
        typeText: inputType,
        value: normalizedData,
        rootKey: 'clientInput',
        filePath: inputTypeFilePath,
      });
      if (inputValidation.status === 'error') {
        cleanupRequest();
        return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
          response: {
            status: 'error',
            errorCode: 'sync.invalidInputType',
            errorParams: [{ key: 'message', value: inputValidation.message }],
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        }));
      }
    }

    //? if the user has passed all the checks we call the preload sync function and return the result
    const [serverSyncError, serverSyncResult] = await tryCatch(
      async () => await serverMain({
        clientInput: normalizedData,
        user,
        functions: functionsObject,
        roomCode: receiver,
        stream: emitServerSyncStream,
        broadcastStream: emitBroadcastSyncStream,
        streamTo: emitStreamToTokens,
        abortSignal: abortController.signal,
        flushPressure,
      }),
      undefined,
      {
        handler: 'handleSyncRequest',
        sync: resolvedName,
        stage: 'server',
        userId: user?.id,
        receiver,
        transport: 'socket',
      },
    );
    if (serverSyncError) {
      if (shouldLogDev()) {
        getLogger().error(`sync: server execution failed for ${resolvedName}`, serverSyncError, { sync: resolvedName });
      }
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
        response: { status: 'error', errorCode: 'sync.serverExecutionFailed' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }));
    } else if (serverSyncResult?.status == 'error') {
      const normalizedServerError = buildSyncError({
        response: serverSyncResult,
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
      if (shouldLogDev()) {
        getLogger().warn(`sync: server returned error for ${resolvedName}`, { sync: resolvedName, message: normalizedServerError.message });
      }
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), normalizedServerError);
    } else if (serverSyncResult?.status !== 'success') {
      //? badReturn means it doesnt include a status key with the value 'success' || 'error'
      if (shouldLogDev()) {
        getLogger().warn(`sync: ${resolvedName}_server returned invalid response`, { sync: resolvedName });
      }
      cleanupRequest();
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
        response: { status: 'error', errorCode: 'sync.invalidServerResponse' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }));
    } else if (serverSyncResult?.status == 'success') {
      serverOutput = serverSyncResult;
    }
  }

  //? from here on we can assume that we have either called a server sync and got a proper result of we didnt call a server sync

  //? Cross-instance recipient list. `fetchSockets()` (via the Redis adapter)
  //? returns RemoteSocket objects spanning EVERY backend sharing the adapter —
  //? not just this process's room view — so a normal sync fan-out reaches room
  //? members connected to other instances. `remoteSocket.emit()` routes to the
  //? owning instance. (Per-sync Redis round-trip; see docs/ARCHITECTURE_MULTI_INSTANCE.md.)
  const sockets = receiver === 'all'
    ? await ioInstance.fetchSockets()
    : await ioInstance.in(receiver).fetchSockets();

  //? now we check if we found any sockets
  if (sockets.length === 0) {
    if (shouldLogDev()) {
      getLogger().warn('sync: no sockets found for receiver', { receiver, sync: resolvedName });
    }
    cleanupRequest();
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.noReceiversFound' },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
  }

  //? Single payload reference reused by pre/post — span pinning in
  //? `@luckystack/error-tracking` uses WeakMap on this object. `recipientCount`
  //? is mutated in place after fanout completes.
  const fanoutPayload: PostSyncFanoutPayload = {
    routeName: resolvedName,
    data: normalizedData,
    user,
    receiver,
    serverOutput,
    transport: 'socket',
    recipientCount: 0,
  };
  const preFanoutResult = await dispatchHook('preSyncFanout', fanoutPayload);
  if (preFanoutResult.stopped) {
    cleanupRequest();
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: {
        status: 'error',
        errorCode: preFanoutResult.signal.errorCode,
        httpStatus: preFanoutResult.signal.httpStatus,
      },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
  }

  //? here we loop over all the connected clients
  //? Yield to the event loop periodically so a giant `receiver: 'all'` fanout
  //? doesn't starve other requests. Tunables live in projectConfig.sync.
  const { fanoutYieldEvery, fanoutYieldMs } = getProjectConfig().sync;
  let recipientCount = 0;
  let tempCount = 1;
  for (const tempSocket of sockets) {
    tempCount++;
    if (tempCount % fanoutYieldEvery === 0) { await new Promise(resolve => setTimeout(resolve, fanoutYieldMs)); }

    //? check if they have a token stored in their cookie or session based on the settings
    const tempToken = extractTokenFromSocket(tempSocket);

    //? Symmetry with the HTTP handler: strict equality + a `token` guard so an
    //? anonymous (token-less) socket is never treated as "self" (null == null).
    if (ignoreSelf && typeof ignoreSelf === 'boolean' && token && token === tempToken) {
        continue;
      }

    recipientCount++;

    if (syncObject[`${resolvedName}_client`]) {
      const clientSyncHandler = syncObject[`${resolvedName}_client`] as RuntimeSyncClientHandler;
      await processClientSyncForRecipient({
        tempSocket,
        tempToken,
        clientSyncHandler,
        data: normalizedData,
        functionsObject,
        serverOutput,
        receiver,
        resolvedName,
        callbackKey: cb,
        transport: 'socket',
        handlerName: 'handleSyncRequest',
        logLabel: 'sync',
        shouldLogDev,
        shouldLogStream,
        buildSyncError,
        //? Socket transport prefers `x-language` over `accept-language` —
        //? preserved verbatim from the previous inlined error path.
        resolvePreferredLocale: (headers) =>
          extractLanguageFromHeader(headers['x-language'])
          || extractLanguageFromHeader(headers['accept-language']),
        sourceUserId: user?.id,
      });
    } else {
      //? if there is no client function we still want to send the server data to the clients
      const result = {
        cb,
        fullName: resolvedName,
        serverOutput,
        clientOutput: {},  // No client file, so empty output
        message: `${resolvedName} sync success`,
        status: 'success'
      };
      if (shouldLogDev()) {
        getLogger().debug(`sync: ${resolvedName} server-only success`, { result });
      }
      tempSocket.emit(socketEventNames.sync, result);
    }
  }

  fanoutPayload.recipientCount = recipientCount;
  await dispatchHook('postSyncFanout', fanoutPayload);

  cleanupRequest();
  return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), {
    status: 'success',
    message: `sync ${resolvedName} success`,
    result: serverOutput,
  });
}