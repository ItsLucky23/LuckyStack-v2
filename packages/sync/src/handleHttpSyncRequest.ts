/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { ioInstance } from "../../../server/sockets/socket";
import { getSession } from "@luckystack/login";
import { logging, rateLimiting, SessionLayout } from '../../../config';
import type { AuthProps } from '@luckystack/login';
import { getRuntimeSyncMaps as getRuntimeSyncMapsFromSource } from '../../../server/prod/runtimeMaps';
import {
  validateRequest,
  extractTokenFromSocket,
  tryCatch,
  parseTransportRouteName,
  checkRateLimit,
  socketEventNames,
  validateInputByType,
} from "@luckystack/core";
import { extractLanguageFromHeader, normalizeErrorResponse } from "@luckystack/core";
import { setSentryUser, startSpan } from '@luckystack/sentry';

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

interface RuntimeSyncServerEntry {
  auth: AuthProps;
  main: (params: {
    clientInput: Record<string, unknown>;
    user: SessionLayout | null;
    functions: Record<string, unknown>;
    roomCode: string;
    stream: (payload?: SyncStreamPayload) => void;
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

const shouldLogDev = logging.devLogs;
const shouldLogStream = logging.stream;

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
  if (shouldLogDev) {
    console.log(`http sync: ${name} called`, 'cyan');
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

    let serverOutput = {};
    if (syncObject[`${resolvedName}_server`]) {
      const serverSyncEntry = syncObject[`${resolvedName}_server`] as RuntimeSyncServerEntry;
      const { auth, main: serverMain, inputType, inputTypeFilePath } = serverSyncEntry;
      const emitServerSyncStream = (payload: SyncStreamPayload = {}) => {
        if (shouldLogStream) {
          console.log(`http sync: ${resolvedName} server stream`, payload, 'cyan');
        }

        stream?.(payload);
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
          if (shouldLogStream) {
            console.log(`http sync: ${resolvedName} client stream`, payload, 'cyan');
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
    }

    if (shouldLogDev) {
      console.log(`http sync: ${resolvedName} completed`, 'cyan');
    }

    return { status: 'success', message: `sync ${resolvedName} success` };
  } finally {
    span?.end?.();
  }
}
