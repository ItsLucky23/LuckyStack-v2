/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import { ioInstance } from "./socket";
import { Socket } from "socket.io";
import { getSession } from "../functions/session";
import { rateLimiting, AuthProps, SessionLayout } from "../../config";
import { getRuntimeSyncMaps as getRuntimeSyncMapsFromSource } from '../prod/runtimeMaps';
import { validateRequest } from "../utils/validateRequest";
import { extractTokenFromSocket } from "../utils/extractToken";
import tryCatch from "../../shared/tryCatch";
import { extractLanguageFromHeader, normalizeErrorResponse } from "../utils/responseNormalizer";
import { validateInputByType } from '../utils/runtimeTypeValidation';
import { checkRateLimit } from '../utils/rateLimiter';
import { setSentryUser, startSpan } from '../functions/sentry';

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

interface RuntimeSyncServerRoute {
  auth: AuthProps;
  main: (params: {
    clientInput: Record<string, unknown>;
    user: SessionLayout | null;
    functions: Record<string, unknown>;
    roomCode: string;
    stream: (payload?: SyncStreamPayload) => void;
  }) => Promise<RuntimeSyncResult> | RuntimeSyncResult;
  inputType?: string;
  inputTypeFilePath?: string;
}

type RuntimeSyncClientRoute = (params: {
  clientInput: Record<string, unknown>;
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

export type HttpSyncStreamEvent = SyncStreamPayload;

const ensureSyncErrorShape = (response: { status: 'error'; errorCode?: string; errorParams?: { key: string; value: string | number | boolean; }[]; httpStatus?: number }) => {
  if (typeof response.errorCode === 'string' && response.errorCode.trim().length > 0) {
    return response;
  }

  return {
    ...response,
    errorCode: 'sync.clientRejected',
  };
};

const socketLocale = (headers: Record<string, unknown>): string | null => {
  const xLanguage = headers['x-language'] as string | string[] | undefined;
  const acceptLanguage = headers['accept-language'] as string | string[] | undefined;
  return extractLanguageFromHeader(acceptLanguage) ?? extractLanguageFromHeader(xLanguage);
};

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
  const normalizedReceiver = typeof receiver === 'string' ? receiver.trim() : '';
  const preferredLocale =
    extractLanguageFromHeader(xLanguageHeader)
    ?? extractLanguageFromHeader(acceptLanguageHeader);
  const user = await getSession(token);
  setSentryUser(user?.id ? {
    id: typeof user.id === 'string' ? user.id : String(user.id),
    email: user.email,
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

  try {
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

    if (!normalizedReceiver) {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.missingReceiver' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    const { syncObject, functionsObject } = await getRuntimeSyncMapsFromSource();
    const nameSegments = name.split('/').filter(Boolean);
    const syncBaseName = nameSegments.at(-2) ?? '';
    const requestedVersion = nameSegments.at(-1) ?? '';
    const callbackName = typeof cb === 'string' && cb.trim().length > 0
      ? cb.trim()
      : `${syncBaseName}/${requestedVersion}`;

    let resolvedName = name;
    if (!syncObject[`${name}_client`] && !syncObject[`${name}_server`] && syncBaseName && requestedVersion) {
      const rootKey = `sync/${syncBaseName}/${requestedVersion}`;
      if (syncObject[`${rootKey}_client`] || syncObject[`${rootKey}_server`]) {
        resolvedName = rootKey;
      }
    }

    if (!syncObject[`${resolvedName}_client`] && !syncObject[`${resolvedName}_server`]) {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.notFound' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    // Rate limiting for HTTP sync requests
    const effectiveSyncLimit = rateLimiting.defaultApiLimit;
    if (effectiveSyncLimit !== false && effectiveSyncLimit > 0) {
      const requesterIdentity = token ?? requesterIp ?? 'anonymous';
      const keyPrefix = token ? 'token' : 'ip';

      const { allowed, resetIn } = await checkRateLimit({
        key: `${keyPrefix}:${requesterIdentity}:sync:${resolvedName}`,
        limit: effectiveSyncLimit,
        windowMs: rateLimiting.windowMs,
      });

      if (!allowed) {
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

    if (rateLimiting.defaultIpLimit !== false && rateLimiting.defaultIpLimit > 0) {
      const ipBucket = requesterIp ?? 'unknown';
      const { allowed, resetIn } = await checkRateLimit({
        key: `ip:${ipBucket}:sync:all`,
        limit: rateLimiting.defaultIpLimit,
        windowMs: rateLimiting.windowMs,
      });

      if (!allowed) {
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

    const serverSyncHandler = syncObject[`${resolvedName}_server`] as RuntimeSyncServerRoute | undefined;
    const clientSyncHandler = syncObject[`${resolvedName}_client`] as RuntimeSyncClientRoute | undefined;

    let serverOutput = {};
    if (serverSyncHandler) {
      const { auth, main: serverMain, inputType, inputTypeFilePath } = serverSyncHandler;
      const emitServerSyncStream = (payload: SyncStreamPayload = {}) => {
        if (!stream) {
          return;
        }

        stream(payload);
      };

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

      if (auth.login && !user?.id) {
        return buildSyncError({
          response: { status: 'error', errorCode: 'auth.required' },
          preferred: preferredLocale,
        });
      }

      if (!user) {
        return buildSyncError({
          response: { status: 'error', errorCode: 'auth.forbidden' },
          preferred: preferredLocale,
        });
      }

      const validationResult = validateRequest({ auth, user });
      if (validationResult.status === 'error') {
        return buildSyncError({
          response: {
            status: 'error',
            errorCode: validationResult.errorCode ?? 'auth.forbidden',
            errorParams: validationResult.errorParams,
            httpStatus: validationResult.httpStatus,
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }

      const [serverSyncError, serverSyncResult] = await tryCatch(
        async () => await serverMain({ clientInput: data, user, functions: functionsObject, roomCode: normalizedReceiver, stream: emitServerSyncStream }),
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

      if (!serverSyncResult) {
        return buildSyncError({
          response: { status: 'error', errorCode: 'sync.invalidServerResponse' },
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }

      if (serverSyncResult.status === 'error') {
        return buildSyncError({
          response: serverSyncResult,
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }

      serverOutput = serverSyncResult;
    }

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

    for (const socketEntry of sockets) {
      const tempSocket: Socket | undefined = receiver === 'all'
        ? (socketEntry as [string, Socket])[1]
        : ioInstance.sockets.sockets.get(socketEntry as string);

      if (!tempSocket) continue;

      const tempToken = extractTokenFromSocket(tempSocket);

      if (ignoreSelf && token && token === tempToken) {
        continue;
      }

      if (clientSyncHandler) {
        const emitClientSyncStream = (payload: SyncStreamPayload = {}) => {
          tempSocket.emit('sync', {
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
          const locale = socketLocale(tempSocket.handshake.headers as Record<string, unknown>);
          tempSocket.emit('sync', {
            cb: callbackName,
            fullName: resolvedName,
            ...buildSyncError({
              response: { status: 'error', errorCode: 'sync.clientExecutionFailed' },
              preferred: locale,
            }),
          });
          continue;
        }

        if (!clientSyncResult) {
          const locale = socketLocale(tempSocket.handshake.headers as Record<string, unknown>);
          tempSocket.emit('sync', {
            cb: callbackName,
            fullName: resolvedName,
            ...buildSyncError({
              response: { status: 'error', errorCode: 'sync.invalidClientResponse' },
              preferred: locale,
            }),
          });
          continue;
        }

        if (clientSyncResult.status === 'error') {
          const locale = socketLocale(tempSocket.handshake.headers as Record<string, unknown>);
          tempSocket.emit('sync', {
            cb: callbackName,
            fullName: resolvedName,
            ...buildSyncError({
              response: ensureSyncErrorShape(clientSyncResult),
              preferred: locale,
            }),
          });
          continue;
        }

        tempSocket.emit('sync', {
          cb: callbackName,
          fullName: resolvedName,
          serverOutput,
          clientOutput: clientSyncResult,
          message: clientSyncResult.message ?? `${name} sync success`,
          status: 'success',
        });
        continue;
      }

      tempSocket.emit('sync', {
        cb: callbackName,
        fullName: resolvedName,
        serverOutput,
        clientOutput: {},
        message: `${name} sync success`,
        status: 'success',
      });
    }

    return { status: 'success', message: `sync ${name} success` };
  } finally {
    span?.end?.();
  }
}
