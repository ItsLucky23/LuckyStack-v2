/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { getSession } from "@luckystack/login";
import type { BaseSessionLayout as SessionLayout } from '@luckystack/login';
import { getProjectConfig } from '@luckystack/core';
import type { AuthProps } from '@luckystack/login';
import { getRuntimeSyncMaps as getRuntimeSyncMapsFromSource } from '@luckystack/core';
import {
  validateRequest,
  extractTokenFromSocket,
  getIoInstance,
  tryCatch,
  parseTransportRouteName,
  checkRateLimit,
  socketEventNames,
  validateInputByType,
  dispatchHook,
  getLogger,
} from "@luckystack/core";
import { extractLanguageFromHeader, normalizeErrorResponse } from "@luckystack/core";
import { setSentryUser, startSpan } from '@luckystack/error-tracking';
import { buildSyncStreamEmitters } from './_shared/streamEmitters';

interface HttpSyncRequestParams {
  name: string;
  cb?: string;
  data: Record<string, unknown>;
  receiver: string;
  ignoreSelf?: boolean;
  token: string | null;
  requesterIp?: string;
  xLanguageHeader?: string | string[];
  acceptLanguageHeader?: string | string[];
  stream?: (payload: HttpSyncStreamEvent) => void;
}

interface HttpSyncResponse {
  status: 'success' | 'error';
  message: string;
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean; }[];
  httpStatus?: number;
}

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

interface HttpSyncErrorBuilder {
  (args: {
    response: { status: 'error'; errorCode?: string; errorParams?: { key: string; value: string | number | boolean }[]; httpStatus?: number };
    preferred?: string | null;
    userLanguage?: string | null;
  }): HttpSyncResponse;
}

//? Returns an HttpSyncResponse when a rate limit was hit (caller should
//? return it directly), or null when both buckets passed.
const applyHttpSyncRateLimits = async ({
  resolvedName,
  token,
  requesterIp,
  user,
  buildSyncError,
  preferredLocale,
}: {
  resolvedName: string;
  token: string | null;
  requesterIp: string | undefined;
  user: SessionLayout | null;
  buildSyncError: HttpSyncErrorBuilder;
  preferredLocale: string | null | undefined;
}): Promise<HttpSyncResponse | null> => {
  const config = getProjectConfig();
  const effectiveSyncLimit = config.rateLimiting.defaultApiLimit;
  if (effectiveSyncLimit !== false && effectiveSyncLimit > 0) {
    const requesterIdentity = token ?? requesterIp ?? 'anonymous';
    const keyPrefix = token ? 'token' : 'ip';
    const rateLimitKey = `${keyPrefix}:${requesterIdentity}:sync:${resolvedName}`;
    const { allowed, resetIn } = await checkRateLimit({
      key: rateLimitKey,
      limit: effectiveSyncLimit,
      windowMs: config.rateLimiting.windowMs,
    });
    if (!allowed) {
      void dispatchHook('rateLimitExceeded', {
        scope: token ? 'user' : 'route',
        key: rateLimitKey,
        limit: effectiveSyncLimit,
        windowMs: config.rateLimiting.windowMs,
        count: effectiveSyncLimit + 1,
        route: resolvedName,
        userId: user?.id,
      });
      return buildSyncError({
        response: {
          status: 'error',
          errorCode: 'sync.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
          httpStatus: 429,
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }
  }

  const defaultIpLimit = config.rateLimiting.defaultIpLimit;
  if (defaultIpLimit !== false && defaultIpLimit > 0) {
    const ipBucket = requesterIp ?? 'unknown';
    const ipKey = `ip:${ipBucket}:sync:all`;
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
        ip: ipBucket,
      });
      return buildSyncError({
        response: {
          status: 'error',
          errorCode: 'sync.rateLimitExceeded',
          errorParams: [{ key: 'seconds', value: resetIn }],
          httpStatus: 429,
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }
  }

  return null;
};

export type HttpSyncStreamEvent = SyncStreamPayload;

export default async function handleHttpSyncRequest({
  name,
  cb,
  data,
  receiver,
  ignoreSelf,
  token,
  requesterIp,
  xLanguageHeader,
  acceptLanguageHeader,
  stream,
}: HttpSyncRequestParams): Promise<HttpSyncResponse> {
  if (shouldLogDev()) {
    getLogger().debug(`http sync: ${name} called`);
  }

  const normalizedReceiver = typeof receiver === 'string' ? receiver.trim() : '';
  const preferredLocale =
    extractLanguageFromHeader(xLanguageHeader)
    || extractLanguageFromHeader(acceptLanguageHeader);
  const user = await getSession(token);
  setSentryUser(user?.id ? {
    id: user.id,
    email: user.email || undefined,
  } : null);
  const span = startSpan(name, 'sync.request.http') as { end?: () => void } | undefined;

  const buildSyncError = ({
    response,
    preferred,
    userLanguage,
  }: {
    response: { status: 'error'; errorCode?: string; errorParams?: { key: string; value: string | number | boolean; }[]; httpStatus?: number };
    preferred?: string | null;
    userLanguage?: string | null;
  }): HttpSyncResponse => {
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

  const ioInstance = getIoInstance();

  //? Wrap the body so the span always closes — including on an unexpected
  //? throw. tryCatch returns `[error, value]` so we can call `span.end()`
  //? in one place after the inner work resolves.
  const [bodyError, bodyResult] = await tryCatch(async () => {
    if (!ioInstance) {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.ioUnavailable' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    if (!name || typeof name !== 'string') {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.invalidRequest' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    const parsedRoute = parseTransportRouteName({ value: name, prefix: 'sync' });
    if (parsedRoute.status === 'error') {
      return buildSyncError({
        response: {
          status: 'error',
          errorCode: 'routing.invalidServiceRouteName',
          errorParams: [{ key: 'name', value: name }],
        },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    const resolvedName = parsedRoute.normalizedFullName;
    const callbackName = typeof cb === 'string' && cb.trim().length > 0
      ? cb.trim()
      : `${parsedRoute.serviceRoute.normalizedRouteName}/${parsedRoute.version}`;

    if (!normalizedReceiver) {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.missingReceiver' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    const { syncObject, functionsObject } = await getRuntimeSyncMapsFromSource();

    if (!syncObject[`${resolvedName}_client`] && !syncObject[`${resolvedName}_server`]) {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.notFound' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    //? Pipeline order: auth → rate-limit → validate → execute → respond.
    //? Auth runs first so unauthenticated probes can't consume rate-limit budget
    //? or learn input shape from `inputValidation.message`. Mirrors api handlers.
    const serverSyncEntry = syncObject[`${resolvedName}_server`] as RuntimeSyncServerEntry | undefined;
    if (serverSyncEntry) {
      const { auth } = serverSyncEntry;
      if (auth.login && !user?.id) {
        return buildSyncError({
          response: { status: 'error', errorCode: 'auth.required' },
          preferred: preferredLocale,
        });
      }

      const validationResult = validateRequest({ auth, user: user! });
      if (validationResult.status === 'error') {
        return buildSyncError({
          response: {
            status: 'error',
            errorCode: validationResult.errorCode || 'auth.forbidden',
            errorParams: validationResult.errorParams,
            httpStatus: validationResult.httpStatus,
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }
    }

    // Rate limiting for HTTP sync requests (per-route + global IP buckets)
    const rateLimitResult = await applyHttpSyncRateLimits({
      resolvedName,
      token,
      requesterIp,
      user,
      buildSyncError,
      preferredLocale,
    });
    if (rateLimitResult) return rateLimitResult;

    let serverOutput = {};
    if (serverSyncEntry) {
      const { main: serverMain, inputType, inputTypeFilePath } = serverSyncEntry;
      const { emitServerSyncStream, emitBroadcastSyncStream, emitStreamToTokens } =
        buildSyncStreamEmitters({
          cb,
          receiver: normalizedReceiver,
          resolvedName,
          logLabel: 'http sync',
          //? Originator chunks travel back via SSE; broadcast / targeted
          //? chunks still flow over Socket.io to recipients in the receiver room.
          emitOriginatorChunk: (payload) => {
            stream?.(payload);
          },
        });

      const inputValidation = await validateInputByType({
        typeText: inputType,
        value: data,
        rootKey: 'clientInput',
        filePath: inputTypeFilePath,
      });
      if (inputValidation.status === 'error') {
        return buildSyncError({
          response: {
            status: 'error',
            errorCode: 'sync.invalidInputType',
            errorParams: [{ key: 'message', value: inputValidation.message }],
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }

      const [serverSyncError, serverSyncResult] = await tryCatch(
        async () => await serverMain({
          clientInput: data,
          user,
          functions: functionsObject,
          roomCode: normalizedReceiver,
          stream: emitServerSyncStream,
          broadcastStream: emitBroadcastSyncStream,
          streamTo: emitStreamToTokens,
        }),
        undefined,
        {
          handler: 'handleHttpSyncRequest',
          sync: resolvedName,
          stage: 'server',
          userId: user?.id,
          receiver,
          transport: 'http',
        },
      );
      if (serverSyncError) {
        return buildSyncError({
          response: { status: 'error', errorCode: 'sync.serverExecutionFailed' },
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }

      if (serverSyncResult?.status == 'error') {
        return buildSyncError({
          response: serverSyncResult,
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }

      if (serverSyncResult?.status !== 'success') {
        return buildSyncError({
          response: { status: 'error', errorCode: 'sync.invalidServerResponse' },
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }

      serverOutput = serverSyncResult;
    }

    await dispatchHook('preSyncFanout', {
      routeName: resolvedName,
      data,
      user,
      receiver: normalizedReceiver,
      serverOutput,
    });

    const sockets = receiver === 'all'
      ? ioInstance.sockets.sockets
      : ioInstance.sockets.adapter.rooms.get(normalizedReceiver);

    if (!sockets) {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.noReceiversFound' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    let recipientCount = 0;
    for (const socketEntry of sockets) {
      const tempSocket = receiver === 'all'
        ? (socketEntry as [string, any])[1]
        : ioInstance.sockets.sockets.get(socketEntry as string);

      if (!tempSocket) continue;

      const tempToken = extractTokenFromSocket(tempSocket);

      if (ignoreSelf && token && token === tempToken) {
        continue;
      }

      if (syncObject[`${resolvedName}_client`]) {
        const clientSyncHandler = syncObject[`${resolvedName}_client`] as RuntimeSyncClientHandler;
        const emitClientSyncStream = (payload: SyncStreamPayload = {}) => {
          if (shouldLogStream()) {
            getLogger().debug(`http sync: ${resolvedName} client stream`, { payload });
          }

          tempSocket.emit(socketEventNames.sync, {
            ...payload,
            cb: callbackName,
            fullName: resolvedName,
            status: 'stream',
          });
        };

        const [clientSyncError, clientSyncResult] = await tryCatch(
          async () => await clientSyncHandler({ clientInput: data, token: tempToken, functions: functionsObject, serverOutput, roomCode: normalizedReceiver, stream: emitClientSyncStream }),
          undefined,
          {
            handler: 'handleHttpSyncRequest',
            sync: resolvedName,
            stage: 'client',
            sourceUserId: user?.id,
            targetToken: tempToken,
            receiver,
            transport: 'http',
          },
        );
        if (clientSyncError) {
          tempSocket.emit(socketEventNames.sync, {
            cb: callbackName,
            fullName: resolvedName,
            ...buildSyncError({
              response: { status: 'error', errorCode: 'sync.clientExecutionFailed' },
              preferred: extractLanguageFromHeader(tempSocket.handshake.headers['accept-language'] || tempSocket.handshake.headers['x-language']),
            }),
          });
          continue;
        }

        if (clientSyncResult?.status === 'error') {
          tempSocket.emit(socketEventNames.sync, {
            cb: callbackName,
            fullName: resolvedName,
            ...buildSyncError({
              response: ensureSyncErrorShape(clientSyncResult),
              preferred: extractLanguageFromHeader(tempSocket.handshake.headers['accept-language'] || tempSocket.handshake.headers['x-language']),
            }),
          });
          continue;
        }

        if (clientSyncResult?.status !== 'success') {
          tempSocket.emit(socketEventNames.sync, {
            cb: callbackName,
            fullName: resolvedName,
            ...buildSyncError({
              response: { status: 'error', errorCode: 'sync.invalidClientResponse' },
              preferred: extractLanguageFromHeader(tempSocket.handshake.headers['accept-language'] || tempSocket.handshake.headers['x-language']),
            }),
          });
          continue;
        }

        tempSocket.emit(socketEventNames.sync, {
          cb: callbackName,
          fullName: resolvedName,
          serverOutput,
          clientOutput: clientSyncResult,
          message: clientSyncResult.message || `${resolvedName} sync success`,
          status: 'success',
        });
        recipientCount++;
        continue;
      }

      tempSocket.emit(socketEventNames.sync, {
        cb: callbackName,
        fullName: resolvedName,
        serverOutput,
        clientOutput: {},
        message: `${resolvedName} sync success`,
        status: 'success',
      });
      recipientCount++;
    }

    await dispatchHook('postSyncFanout', {
      routeName: resolvedName,
      data,
      user,
      receiver: normalizedReceiver,
      serverOutput,
      recipientCount,
    });

    if (shouldLogDev()) {
      getLogger().debug(`http sync: ${resolvedName} completed`);
    }

    return { status: 'success' as const, message: `sync ${resolvedName} success` };
  });
  span?.end?.();
  if (bodyError) {
    getLogger().error(`http sync: ${name} threw`, bodyError, { sync: name });
    return buildSyncError({
      response: { status: 'error', errorCode: 'sync.serverExecutionFailed' },
      preferred: preferredLocale,
      userLanguage: user?.language,
    });
  }
  return bodyResult ?? buildSyncError({
    response: { status: 'error', errorCode: 'sync.serverExecutionFailed' },
    preferred: preferredLocale,
    userLanguage: user?.language,
  });
}
