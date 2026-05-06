/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import type { syncMessage } from "@luckystack/core";
import { Socket } from "socket.io";
import { getSession } from "@luckystack/login";
import type { BaseSessionLayout as SessionLayout } from '@luckystack/login';
import { getProjectConfig } from '@luckystack/core';
import type { AuthProps } from '@luckystack/login';
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
} from "@luckystack/core";
import { extractLanguageFromHeader, normalizeErrorResponse } from "@luckystack/core";
import { setSentryUser } from '@luckystack/sentry';

type SyncStreamPayload = Record<string, unknown>;

interface RuntimeErrorResponse {
  status: 'error';
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean; }[];
  httpStatus?: number;
  message?: string;
  [key: string]: unknown;
}

interface RuntimeSuccessResponse {
  status: 'success';
  message?: string;
  httpStatus?: number;
  [key: string]: unknown;
}

type RuntimeSyncResponse = RuntimeSuccessResponse | RuntimeErrorResponse;

//? Stream-emit callbacks passed into the `_server` handler. Three flavors:
//?
//?   - `stream(payload)`           — unicast back to the originator socket
//?                                   only. Cheapest. Use for per-user progress
//?                                   that nobody else cares about.
//?   - `broadcastStream(payload)`  — fan-out to every socket currently in
//?                                   the receiver room. Use for live AI chat
//?                                   tokens, collab-editor diffs, anything
//?                                   the whole room should see in real time.
//?                                   Auto-degrades to a unicast emit when the
//?                                   room contains a single socket.
//?   - `streamTo(tokens, payload)` — selective fanout to only the given
//?                                   session tokens (each is its own room
//?                                   because every socket joins a room named
//?                                   after its token at connect time). Use
//?                                   when you want explicit subscribers, not
//?                                   "everyone in the room".
type SyncBroadcastStream = (payload?: SyncStreamPayload) => void;
type SyncStreamTo = (
  tokens: string | string[],
  payload?: SyncStreamPayload,
) => void;

interface RuntimeSyncServerEntry {
  auth: AuthProps;
  main: (params: {
    clientInput: Record<string, unknown>;
    user: SessionLayout | null;
    functions: Record<string, unknown>;
    roomCode: string;
    stream: (payload?: SyncStreamPayload) => void;
    broadcastStream: SyncBroadcastStream;
    streamTo: SyncStreamTo;
  }) => Promise<RuntimeSyncResponse>;
  inputType?: string;
  inputTypeFilePath?: string;
}

type RuntimeSyncClientHandler = (params: {
  clientInput: Record<string, unknown>;
  token: string | null;
  functions: Record<string, unknown>;
  serverOutput: unknown;
  roomCode: string;
  stream: (payload?: SyncStreamPayload) => void;
}) => Promise<RuntimeSyncResponse>;

const shouldLogDev = () => getProjectConfig().logging.devLogs;
const shouldLogStream = () => getProjectConfig().logging.stream;


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

  const buildSyncError = ({
    response,
    preferred,
    userLanguage,
  }: {
    response: { status: 'error'; errorCode?: string; errorParams?: { key: string; value: string | number | boolean; }[]; httpStatus?: number };
    preferred?: string | null;
    userLanguage?: string | null;
  }) => {
    const normalized = normalizeErrorResponse({
      response,
      preferredLocale: preferred,
      userLanguage,
    });

    return {
      status: normalized.status,
      message: normalized.message,
      errorCode: normalized.errorCode,
      errorParams: normalized.errorParams,
      httpStatus: normalized.httpStatus,
    };
  };

  const ensureSyncErrorShape = (response: { status: 'error'; errorCode?: string; errorParams?: { key: string; value: string | number | boolean; }[]; httpStatus?: number }) => {
    if (typeof response.errorCode === 'string' && response.errorCode.trim().length > 0) {
      return response;
    }

    return {
      ...response,
      errorCode: 'sync.clientRejected',
    };
  };

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

  const user = await getSession(token);
  setSentryUser(user?.id ? {
    id: user.id,
    email: user.email || undefined,
  } : null);
  const { syncObject, functionsObject } = await getRuntimeSyncMaps();

  //? we check if there is a client file or/and a server file, if they both dont exist we abort
  if (!syncObject[`${resolvedName}_client`] && !syncObject[`${resolvedName}_server`]) {
    if (shouldLogDev()) {
      getLogger().warn(`sync: ${name} has no _client or _server file`, { sync: name });
    }
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.notFound' },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
  }

  const emitServerSyncStream = (payload: SyncStreamPayload = {}) => {
    if (typeof responseIndex !== 'number') {
      return;
    }

    if (shouldLogStream()) {
      console.log(`sync: ${resolvedName} server stream`, payload, 'cyan');
    }

    socket.emit(buildSyncProgressEventName(responseIndex), payload);
  };

  //? Build the wire-shape every recipient expects on the sync channel. Same
  //? envelope `_client`'s stream uses, so consumers' `upsertSyncEventCallback`
  //? listeners receive both indistinguishably.
  const buildBroadcastFrame = (payload: SyncStreamPayload) => ({
    ...payload,
    cb,
    fullName: resolvedName,
    status: 'stream' as const,
  });

  //? broadcastStream: fan a chunk out to every socket currently joined to
  //? the receiver room. Auto-degrades to unicast when the room has at most
  //? one socket — saves the room-iterator round-trip in solo cases (e.g. a
  //? user querying an AI in their own private session).
  const emitBroadcastSyncStream = (payload: SyncStreamPayload = {}) => {
    if (shouldLogStream()) {
      console.log(`sync: ${resolvedName} broadcastStream`, payload, 'cyan');
    }
    if (!receiver) return;
    const io = getIoInstance();
    if (!io) return;

    const frame = buildBroadcastFrame(payload);
    const roomMembers = io.sockets.adapter.rooms.get(receiver);
    if (!roomMembers || roomMembers.size === 0) return;

    //? Solo-room shortcut: if only one socket is listening (typically the
    //? originator), unicast directly instead of iterating. Identical wire
    //? output, slightly cheaper path.
    if (roomMembers.size <= 1) {
      const onlyId = roomMembers.values().next().value;
      const onlySocket = onlyId ? io.sockets.sockets.get(onlyId) : undefined;
      if (onlySocket) {
        onlySocket.emit(socketEventNames.sync, frame);
      }
      return;
    }

    io.to(receiver).emit(socketEventNames.sync, frame);
  };

  //? streamTo: selective fanout. Each socket joins a room keyed by its own
  //? auth token at connect time, so emitting to those rooms reaches exactly
  //? the targeted users (across multiple devices/tabs of the same token,
  //? you'll hit every connection sharing that token).
  const emitStreamToTokens = (
    tokens: string | string[],
    payload: SyncStreamPayload = {},
  ) => {
    const list = Array.isArray(tokens) ? tokens : [tokens];
    const filtered = list.filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (filtered.length === 0) return;

    if (shouldLogStream()) {
      console.log(`sync: ${resolvedName} streamTo`, { tokens: filtered, payload }, 'cyan');
    }
    const io = getIoInstance();
    if (!io) return;

    const frame = buildBroadcastFrame(payload);
    //? Single emit covers the union of all matching token-rooms. Socket.io
    //? deduplicates per-socket so a recipient on two tabs (both joined to
    //? their token-room) won't receive the chunk twice.
    io.to(filtered).emit(socketEventNames.sync, frame);
  };

  //? Rate limit check: per-sync bucket fallback + global per-IP cap
  const defaultApiLimit = getProjectConfig().rateLimiting.defaultApiLimit;
  if (defaultApiLimit !== false && defaultApiLimit > 0) {
    const requesterIdentity = token ?? socket.handshake.address ?? 'unknown';
    const keyPrefix = token ? 'token' : 'ip';

    const { allowed, resetIn } = await checkRateLimit({
      key: `${keyPrefix}:${requesterIdentity}:sync:${resolvedName}`,
      limit: defaultApiLimit,
      windowMs: getProjectConfig().rateLimiting.windowMs,
    });

    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        scope: token ? 'user' : 'route',
        key: `${keyPrefix}:${requesterIdentity}:sync:${resolvedName}`,
        limit: defaultApiLimit,
        windowMs: getProjectConfig().rateLimiting.windowMs,
        count: defaultApiLimit + 1,
        route: resolvedName,
        userId: user?.id,
      });
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
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
  }

  const defaultIpLimit = getProjectConfig().rateLimiting.defaultIpLimit;
  if (defaultIpLimit !== false && defaultIpLimit > 0) {
    const requesterIp = socket.handshake.address ?? 'unknown';
    const { allowed, resetIn } = await checkRateLimit({
      key: `ip:${requesterIp}:sync:all`,
      limit: defaultIpLimit,
      windowMs: getProjectConfig().rateLimiting.windowMs,
    });

    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        scope: 'ip',
        key: `ip:${requesterIp}:sync:all`,
        limit: defaultIpLimit,
        windowMs: getProjectConfig().rateLimiting.windowMs,
        count: defaultIpLimit + 1,
        ip: requesterIp,
      });
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
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
  }

  let serverOutput = {};
  if (syncObject[`${resolvedName}_server`]) {
    const serverSyncEntry = syncObject[`${resolvedName}_server`] as RuntimeSyncServerEntry;
    const { auth, main: serverMain, inputType, inputTypeFilePath } = serverSyncEntry;

    const inputValidation = await validateInputByType({
      typeText: inputType,
      value: normalizedData,
      rootKey: 'clientInput',
      filePath: inputTypeFilePath,
    });
    if (inputValidation.status === 'error') {
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

    //? if the login key is true we check if the user has an id in the session object
    if (auth.login && !user?.id) {
        if (shouldLogDev()) {
          getLogger().warn(`sync: ${resolvedName} requires login`, { sync: resolvedName });
        }
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
      return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), normalizedServerError);
    } else if (serverSyncResult?.status !== 'success') {
      //? badReturn means it doesnt include a status key with the value 'success' || 'error'
      if (shouldLogDev()) {
        getLogger().warn(`sync: ${resolvedName}_server returned invalid response`, { sync: resolvedName });
      }
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

  //? get the desired sockets based on the receiver key
  const sockets = receiver === 'all'
    ? ioInstance.sockets.sockets //? all connected sockets (Map)
    : ioInstance.sockets.adapter.rooms.get(receiver) //? Set of socket IDs in room

  //? now we check if we found any sockets
  if (!sockets) {
    if (shouldLogDev()) {
      getLogger().warn('sync: no sockets found for receiver', { receiver, sync: resolvedName });
    }
    return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), buildSyncError({
      response: { status: 'error', errorCode: 'sync.noReceiversFound' },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
  }

  const preFanoutResult = await dispatchHook('preSyncFanout', {
    routeName: resolvedName,
    data: normalizedData,
    user,
    receiver,
    serverOutput,
  });
  if (preFanoutResult.stopped) {
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
  //? we keep track of an counter and await the loop every 100 iterations to avoid the server running out of memory and crashing
  let recipientCount = 0;
  let tempCount = 1;
  for (const socketEntry of sockets) {
    tempCount++;
    if (tempCount % 100 == 0) { await new Promise(resolve => setTimeout(resolve, 1)); }

    const tempSocket = receiver === 'all'
      ? (socketEntry as [string, Socket])[1] //? Map entry
      : ioInstance.sockets.sockets.get(socketEntry as string); //? socket ID from Set

    if (!tempSocket) { continue; }

    //? check if they have a token stored in their cookie or session based on the settings
    const tempToken = extractTokenFromSocket(tempSocket);

    if (ignoreSelf && typeof ignoreSelf == 'boolean' && token == tempToken) {
        continue;
      }

    recipientCount++;

    if (syncObject[`${resolvedName}_client`]) {
      const clientSyncHandler = syncObject[`${resolvedName}_client`] as RuntimeSyncClientHandler;
      const emitClientSyncStream = (payload: SyncStreamPayload = {}) => {
        if (shouldLogStream()) {
          console.log(`sync: ${resolvedName} client stream`, payload, 'cyan');
        }

        tempSocket.emit(socketEventNames.sync, {
          ...payload,
          cb,
          fullName: resolvedName,
          status: 'stream',
        });
      };

      const [clientSyncError, clientSyncResult] = await tryCatch(
        async () => await clientSyncHandler({ clientInput: normalizedData, token: tempToken, functions: functionsObject, serverOutput, roomCode: receiver, stream: emitClientSyncStream }),
        undefined,
        {
          handler: 'handleSyncRequest',
          sync: resolvedName,
          stage: 'client',
          sourceUserId: user?.id,
          targetToken: tempToken,
          receiver,
          transport: 'socket',
        },
      );
      if (clientSyncError) {
        tempSocket.emit(socketEventNames.sync, {
          cb,
          fullName: resolvedName,
          ...buildSyncError({
            response: { status: 'error', errorCode: 'sync.clientExecutionFailed' },
            preferred:
              extractLanguageFromHeader(tempSocket.handshake.headers['x-language'])
              || extractLanguageFromHeader(tempSocket.handshake.headers['accept-language']),
          }),
        });
        continue;
      }
      if (clientSyncResult?.status == 'error') {
        tempSocket.emit(socketEventNames.sync, {
          cb,
          fullName: resolvedName,
          ...buildSyncError({
            response: ensureSyncErrorShape(clientSyncResult),
            preferred:
              extractLanguageFromHeader(tempSocket.handshake.headers['x-language'])
              || extractLanguageFromHeader(tempSocket.handshake.headers['accept-language']),
          }),
        });
        continue;
      }
      if (clientSyncResult?.status !== 'success') {
        tempSocket.emit(socketEventNames.sync, {
          cb,
          fullName: resolvedName,
          ...buildSyncError({
            response: { status: 'error', errorCode: 'sync.invalidClientResponse' },
            preferred:
              extractLanguageFromHeader(tempSocket.handshake.headers['x-language'])
              || extractLanguageFromHeader(tempSocket.handshake.headers['accept-language']),
          }),
        });
        continue;
      }
      else if (clientSyncResult?.status == 'success') {
        const result = {
          cb,
          fullName: resolvedName,
          serverOutput,
          clientOutput: clientSyncResult,  // Return from _client file (success only)
          message: clientSyncResult.message || `${resolvedName} sync success`,
          status: 'success'
        };
        if (shouldLogDev()) {
          console.log(result, 'blue');
        }
        tempSocket.emit(socketEventNames.sync, result);
      }
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
        console.log(result, 'blue');
      }
      tempSocket.emit(socketEventNames.sync, result);
    }
  }

  await dispatchHook('postSyncFanout', {
    routeName: resolvedName,
    data: normalizedData,
    user,
    receiver,
    serverOutput,
    recipientCount,
  });

  return typeof responseIndex == 'number' && socket.emit(buildSyncResponseEventName(responseIndex), {
    status: 'success',
    message: `sync ${resolvedName} success`,
    result: serverOutput,
  });
}