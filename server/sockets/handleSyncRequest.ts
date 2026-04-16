import { ioInstance, syncMessage } from "./socket";
import { Socket } from "socket.io";
import { getSession } from "../functions/session";
import { rateLimiting, AuthProps, SessionLayout } from "../../config";
import { getRuntimeSyncMaps } from '../prod/runtimeMaps';
import { validateRequest } from "../utils/validateRequest";
import { extractTokenFromSocket } from "../utils/extractToken";
import tryCatch from "../../shared/tryCatch";
import { extractLanguageFromHeader, normalizeErrorResponse } from "../utils/responseNormalizer";
import { validateInputByType } from "../utils/runtimeTypeValidation";
import { checkRateLimit } from "../utils/rateLimiter";
import { setSentryUser } from '../functions/sentry';

type SyncStreamPayload = Record<string, unknown>;
type UnknownRecord = Record<string, unknown>;

interface RuntimeSyncServerRoute {
  auth: AuthProps;
  main: (params: {
    clientInput: UnknownRecord;
    user: SessionLayout | null;
    functions: Record<string, unknown>;
    roomCode: string;
    stream: (payload?: SyncStreamPayload) => void;
  }) => Promise<RuntimeSyncResult> | RuntimeSyncResult;
  inputType?: string;
  inputTypeFilePath?: string;
}

type RuntimeSyncClientRoute = (params: {
  clientInput: UnknownRecord;
  token: string | null;
  functions: Record<string, unknown>;
  serverOutput: unknown;
  roomCode: string;
  stream: (payload?: SyncStreamPayload) => void;
}) => Promise<RuntimeSyncResult> | RuntimeSyncResult;

type RuntimeSyncResult =
  | {
    status: 'success';
    message?: string;
    [key: string]: unknown;
  }
  | {
    status: 'error';
    errorCode?: string;
    errorParams?: { key: string; value: string | number | boolean }[];
    httpStatus?: number;
    message?: string;
    [key: string]: unknown;
  };

const toRecord = (value: unknown): UnknownRecord => {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
};

const socketLocale = (targetSocket: Socket): string | null => {
  return (
    extractLanguageFromHeader(targetSocket.handshake.headers['x-language'])
    ?? extractLanguageFromHeader(targetSocket.handshake.headers['accept-language'])
  );
};

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

const createClientSyncStreamEmitter = ({
  targetSocket,
  callback,
  fullName,
}: {
  targetSocket: Socket;
  callback: string;
  fullName: string;
}) => {
  return (payload: SyncStreamPayload = {}) => {
    targetSocket.emit('sync', {
      ...payload,
      cb: callback,
      fullName,
      status: 'stream',
    });
  };
};


// export default async function handleSyncRequest({ name, clientData, user, serverOutput, roomCode }: syncMessage) {
export default async function handleSyncRequest({ msg, socket, token }: {
  msg: syncMessage,
  socket: Socket,
  token: string | null,
}) {

  if (!ioInstance) { return; }

  const emitIndexedSync = (index: number | undefined, payload: Record<string, unknown>) => {
    if (typeof index !== 'number') {
      return;
    }

    socket.emit(`sync-${String(index)}`, payload);
  };

  //? first we validate the data
  if (typeof msg != 'object') {
    console.log('message', 'socket message was not a json object', 'red')
    const normalized = normalizeErrorResponse({
      response: { status: 'error', errorCode: 'sync.invalidRequest' },
      preferredLocale:
        extractLanguageFromHeader(socket.handshake.headers['x-language'])
        ?? extractLanguageFromHeader(socket.handshake.headers['accept-language']),
    });
    return socket.emit('sync', {
      status: normalized.status,
      message: normalized.message,
      errorCode: normalized.errorCode,
      errorParams: normalized.errorParams,
      httpStatus: normalized.httpStatus,
    });
  }

  const { name, data, cb, receiver: rawReceiver, responseIndex, ignoreSelf } = msg;
  const payloadData = toRecord(data);
  const receiver = typeof rawReceiver === 'string' ? rawReceiver.trim() : '';
  const preferredLocale =
    extractLanguageFromHeader(socket.handshake.headers['x-language'])
    ?? extractLanguageFromHeader(socket.handshake.headers['accept-language']);

  if (!name || typeof name != 'string' || Object.keys(payloadData).length === 0) {
    emitIndexedSync(responseIndex, buildSyncError({
      response: { status: 'error', errorCode: 'sync.invalidRequest' },
      preferred: preferredLocale,
    }));
    return;
  }

  if (!cb || typeof cb != 'string') {
    emitIndexedSync(responseIndex, buildSyncError({
      response: { status: 'error', errorCode: 'sync.invalidCallback' },
      preferred: preferredLocale,
    }));
    return;
  }

  if (!receiver) {
    console.log('receiver / roomCode:', receiver, 'red')
    emitIndexedSync(responseIndex, buildSyncError({
      response: { status: 'error', errorCode: 'sync.missingReceiver' },
      preferred: preferredLocale,
    }));
    return;
  }

  console.log(' ', 'blue')
  console.log(' ', 'blue')
  console.log(`sync: ${name} called`, 'blue');

  const user = await getSession(token);
  setSentryUser(user?.id ? {
    id: typeof user.id === 'string' ? user.id : String(user.id),
    email: user.email,
  } : null);
  const { syncObject, functionsObject } = await getRuntimeSyncMaps();
  const nameSegments = name.split('/').filter(Boolean);
  const syncBaseName = nameSegments.at(-2);
  const requestedVersion = nameSegments.at(-1);

  //? Resolve sync: try exact match first, then fall back to root-level
  //? e.g. client sends "sync/examples/updateCounter/v1" → not found → try "sync/updateCounter/v1"
  let resolvedName = name;
  if (!syncObject[`${name}_client`] && !syncObject[`${name}_server`] && syncBaseName && requestedVersion) {
    const rootKey = `sync/${syncBaseName}/${requestedVersion}`;
    if (syncObject[`${rootKey}_client`] || syncObject[`${rootKey}_server`]) {
      resolvedName = rootKey;
    }
  }

  const clientSyncHandler = syncObject[`${resolvedName}_client`] as RuntimeSyncClientRoute | undefined;
  const serverSyncHandler = syncObject[`${resolvedName}_server`] as RuntimeSyncServerRoute | undefined;

  //? we check if there is a client file or/and a server file, if they both dont exist we abort
  if (!clientSyncHandler && !serverSyncHandler) {
    console.log("ERROR!!!,", `you need ${name}_client or ${name}_server file to sync`, 'red');
    emitIndexedSync(responseIndex, buildSyncError({
      response: { status: 'error', errorCode: 'sync.notFound' },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
    return;
  }

  const emitServerSyncStream = (payload: SyncStreamPayload = {}) => {
    if (typeof responseIndex !== 'number') {
      return;
    }

    socket.emit(`sync-progress-${String(responseIndex)}`, payload);
  };

  //? Rate limit check: per-sync bucket fallback + global per-IP cap
  if (rateLimiting.defaultApiLimit !== false && rateLimiting.defaultApiLimit > 0) {
    const requesterIdentity = token ?? socket.handshake.address;
    const keyPrefix = token ? 'token' : 'ip';

    const { allowed, resetIn } = await checkRateLimit({
      key: `${keyPrefix}:${requesterIdentity}:sync:${resolvedName}`,
      limit: rateLimiting.defaultApiLimit,
      windowMs: rateLimiting.windowMs,
    });

    if (!allowed) {
      emitIndexedSync(responseIndex, buildSyncError({
        response: {
          status: 'error',
          errorCode: 'sync.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
          httpStatus: 429,
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }));
      return;
    }
  }

  if (rateLimiting.defaultIpLimit !== false && rateLimiting.defaultIpLimit > 0) {
    const requesterIp = socket.handshake.address;
    const { allowed, resetIn } = await checkRateLimit({
      key: `ip:${requesterIp}:sync:all`,
      limit: rateLimiting.defaultIpLimit,
      windowMs: rateLimiting.windowMs,
    });

    if (!allowed) {
      emitIndexedSync(responseIndex, buildSyncError({
        response: {
          status: 'error',
          errorCode: 'sync.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
          httpStatus: 429,
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }));
      return;
    }
  }

  let serverOutput: RuntimeSyncResult | Record<string, unknown> = {};
  if (serverSyncHandler) {
    const { auth, main: serverMain, inputType, inputTypeFilePath } = serverSyncHandler;

    const inputValidation = await validateInputByType({
      typeText: inputType,
      value: data,
      rootKey: 'clientInput',
      filePath: inputTypeFilePath,
    });
    if (inputValidation.status === 'error') {
      if (typeof responseIndex === 'number') {
        socket.emit(`sync-${String(responseIndex)}`, buildSyncError({
        response: {
          status: 'error',
          errorCode: 'sync.invalidInputType',
          errorParams: [{ key: 'message', value: inputValidation.message }],
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      }));
      }
      return;
    }

    //? if the login key is true we check if the user has an id in the session object
    if (auth.login && !user?.id) {
        console.log(`ERROR!!!, not logged in but sync requires login`, 'red');
        emitIndexedSync(responseIndex, buildSyncError({
          response: { status: 'error', errorCode: 'auth.required' },
          preferred: preferredLocale,
        }));
        return;
      }

    if (!user) {
      emitIndexedSync(responseIndex, buildSyncError({
        response: { status: 'error', errorCode: 'auth.forbidden' },
        preferred: preferredLocale,
      }));
      return;
    }

    const validationResult = validateRequest({ auth, user });
    if (validationResult.status === 'error') {
      console.log('ERROR!!!,', validationResult.errorCode, 'red');
      emitIndexedSync(responseIndex, buildSyncError({
        response: {
          status: 'error',
          errorCode: validationResult.errorCode ?? 'auth.forbidden',
          errorParams: validationResult.errorParams,
          httpStatus: validationResult.httpStatus,
        },
        preferred: preferredLocale,
        userLanguage: user.language,
      }));
      return;
    }

    //? if the user has passed all the checks we call the preload sync function and return the result
    const [serverSyncError, serverSyncResult] = await tryCatch(
      async () => await serverMain({ clientInput: payloadData, user, functions: functionsObject, roomCode: receiver, stream: emitServerSyncStream }),
      undefined,
      {
        handler: 'handleSyncRequest',
        sync: resolvedName,
        stage: 'server',
        userId: user.id,
        receiver,
        transport: 'socket',
      },
    );
    if (serverSyncError) {
      console.log('ERROR!!!,', serverSyncError.message, 'red');
      emitIndexedSync(responseIndex, buildSyncError({
        response: { status: 'error', errorCode: 'sync.serverExecutionFailed' },
        preferred: preferredLocale,
        userLanguage: user.language,
      }));
      return;
    }

    if (!serverSyncResult) {
      emitIndexedSync(responseIndex, buildSyncError({
        response: { status: 'error', errorCode: 'sync.invalidServerResponse' },
        preferred: preferredLocale,
        userLanguage: user.language,
      }));
      return;
    }

    if (serverSyncResult.status === 'error') {
      const normalizedServerError = buildSyncError({
        response: serverSyncResult,
        preferred: preferredLocale,
        userLanguage: user.language,
      });
      console.log('ERROR!!!,', normalizedServerError.message, 'red');
      emitIndexedSync(responseIndex, normalizedServerError);
      return;
    }

    serverOutput = serverSyncResult;
  }

  //? from here on we can assume that we have either called a server sync and got a proper result of we didnt call a server sync

  //? get the desired sockets based on the receiver key
  const sockets = receiver === 'all'
    ? ioInstance.sockets.sockets //? all connected sockets (Map)
    : ioInstance.sockets.adapter.rooms.get(receiver) //? Set of socket IDs in room

  //? now we check if we found any sockets
  if (!sockets) {
    console.log('data:', msg, 'red');
    console.log('receiver:', receiver, 'red');
    console.log('no sockets found', 'red');
    emitIndexedSync(responseIndex, buildSyncError({
      response: { status: 'error', errorCode: 'sync.noReceiversFound' },
      preferred: preferredLocale,
      userLanguage: user?.language,
    }));
    return;
  }

  if (!clientSyncHandler) {
    const result = {
      cb,
      fullName: resolvedName,
      serverOutput,
      clientOutput: {},
      message: `${name} sync success`,
      status: 'success',
    };

    if (receiver === 'all') {
      if (ignoreSelf) {
        socket.broadcast.emit('sync', result);
      } else {
        ioInstance.emit('sync', result);
      }
    } else if (ignoreSelf) {
      socket.to(receiver).emit('sync', result);
    } else {
      ioInstance.to(receiver).emit('sync', result);
    }

    if (typeof responseIndex === 'number') {
      socket.emit(`sync-${String(responseIndex)}`, {
        status: 'success',
        message: `sync ${name} success`,
        result: serverOutput,
      });
    }
    return;
  }

  //? here we loop over all the connected clients
  //? we keep track of an counter and await the loop every 100 iterations to avoid the server running out of memory and crashing
  let tempCount = 1;
  for (const socketEntry of sockets) {
    tempCount++;
    if (tempCount % 100 == 0) { await new Promise((resolve) => setTimeout(resolve, 1)); }

    const tempSocket = receiver === 'all'
      ? (socketEntry as [string, Socket])[1] //? Map entry
      : ioInstance.sockets.sockets.get(socketEntry as string); //? socket ID from Set

    if (!tempSocket) { continue; }

    //? check if they have a token stored in their cookie or session based on the settings
    const tempToken = extractTokenFromSocket(tempSocket);

    if (ignoreSelf && token === tempToken) {
        continue;
      }

    const emitClientSyncStream = createClientSyncStreamEmitter({
      targetSocket: tempSocket,
      callback: cb,
      fullName: resolvedName,
    });

    const [clientSyncError, clientSyncResult] = await tryCatch(
      async () => await clientSyncHandler({ clientInput: payloadData, token: tempToken, functions: functionsObject, serverOutput, roomCode: receiver, stream: emitClientSyncStream }),
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
      tempSocket.emit('sync', {
        cb,
        fullName: resolvedName,
        ...buildSyncError({
          response: { status: 'error', errorCode: 'sync.clientExecutionFailed' },
          preferred: socketLocale(tempSocket),
        }),
      });
      continue;
    }

    if (!clientSyncResult) {
      tempSocket.emit('sync', {
        cb,
        fullName: resolvedName,
        ...buildSyncError({
          response: { status: 'error', errorCode: 'sync.invalidClientResponse' },
          preferred: socketLocale(tempSocket),
        }),
      });
      continue;
    }

    if (clientSyncResult.status === 'error') {
      tempSocket.emit('sync', {
        cb,
        fullName: resolvedName,
        ...buildSyncError({
          response: ensureSyncErrorShape(clientSyncResult),
          preferred: socketLocale(tempSocket),
        }),
      });
      continue;
    }

    const result = {
      cb,
      fullName: resolvedName,
      serverOutput,
      clientOutput: clientSyncResult,  // Return from _client file (success only)
      message: clientSyncResult.message ?? `${name} sync success`,
      status: 'success',
    };
    console.log(result, 'blue')
    tempSocket.emit('sync', result);
  }

  emitIndexedSync(responseIndex, {
    status: 'success',
    message: `sync ${name} success`,
    result: serverOutput,
  });
  return;
}