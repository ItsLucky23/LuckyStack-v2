//? Per-recipient `_client` dispatch — shared by both sync transports.
//?
//? `handleSyncRequest` (socket) and `handleHttpSyncRequest` (HTTP/SSE)
//? previously inlined an identical ~70-line loop body that, for one recipient
//? socket, ran the route's optional `_client_v{N}` handler, normalized its
//? result, and emitted the per-recipient `sync` envelope (stream / error /
//? success / server-only-success). The two copies differed only in:
//?
//?   - the `cb` value carried back to the client (raw `cb` over sockets,
//?     `callbackName` over HTTP),
//?   - the accept-/x-language header preference ORDER used to localize a
//?     per-recipient error (socket prefers `x-language`; HTTP prefers
//?     `accept-language` — preserved verbatim here), and
//?   - the `handler` / log-label strings used for tryCatch context + dev logs.
//?
//? Those are now explicit parameters, so the loop body itself is single-source.
//? Behaviour (emit shapes, ordering, continue-on-error) is identical to the
//? previous inlined copies.

import { tryCatch, socketEventNames, getLogger } from '@luckystack/core';
import type { RuntimeSyncClientHandler, SyncStreamPayload, SyncErrorEnvelopeInput } from './syncTypes';
import { ensureSyncErrorShape } from './errorBuilders';
import { redactToken } from './redactToken';

//? Minimal surface of the per-recipient socket the fanout uses. Both
//? `RemoteSocket` (cross-instance, via the Redis adapter) and a plain local
//? `Socket` satisfy it, so the helper works for whichever `fetchSockets()`
//? returns. `emit` is declared method-style (bivariant params) and returns
//? `unknown` so socket.io's overloaded `emit(): boolean` is assignable.
interface FanoutRecipientSocket {
  emit(event: string, ...args: unknown[]): unknown;
  handshake: { headers: Record<string, string | string[] | undefined> };
}

export interface ProcessClientSyncForRecipientArgs<TError extends object> {
  tempSocket: FanoutRecipientSocket;
  tempToken: string | null;
  clientSyncHandler: RuntimeSyncClientHandler;
  data: Record<string, unknown>;
  functionsObject: Record<string, unknown>;
  serverOutput: unknown;
  receiver: string;
  resolvedName: string;
  //? `cb` value echoed back to the recipient. Socket transport uses the raw
  //? client `cb`; HTTP transport uses the derived `callbackName`.
  callbackKey: string;
  //? `'socket' | 'http'` — feeds the tryCatch context + chooses the header
  //? preference order for per-recipient error localization.
  transport: 'socket' | 'http';
  handlerName: 'handleSyncRequest' | 'handleHttpSyncRequest';
  logLabel: 'sync' | 'http sync';
  shouldLogDev: () => boolean;
  shouldLogStream: () => boolean;
  buildSyncError: (args: {
    response: SyncErrorEnvelopeInput;
    preferred?: string | null;
    userLanguage?: string | null;
  }) => TError;
  //? Resolves a recipient's preferred locale from its handshake headers,
  //? honoring the transport-specific header preference order.
  resolvePreferredLocale: (headers: Record<string, string | string[] | undefined>) => string | null | undefined;
  sourceUserId?: string;
}

/**
 * Run the optional `_client` handler for ONE recipient socket and emit the
 * per-recipient `sync` envelope. When the route has no `_client` file the
 * caller emits the server-only success envelope instead (kept at the call site
 * because it does not run the handler). Behaviour-identical to the previously
 * inlined loop body in both transports.
 */
export const processClientSyncForRecipient = async <TError extends object>({
  tempSocket,
  tempToken,
  clientSyncHandler,
  data,
  functionsObject,
  serverOutput,
  receiver,
  resolvedName,
  callbackKey,
  transport,
  handlerName,
  logLabel,
  shouldLogDev,
  shouldLogStream,
  buildSyncError,
  resolvePreferredLocale,
  sourceUserId,
}: ProcessClientSyncForRecipientArgs<TError>): Promise<void> => {
  const emitClientSyncStream = (payload: SyncStreamPayload = {}) => {
    if (shouldLogStream()) {
      getLogger().debug(`${logLabel}: ${resolvedName} client stream`, { payload });
    }

    tempSocket.emit(socketEventNames.sync, {
      ...payload,
      cb: callbackKey,
      fullName: resolvedName,
      status: 'stream',
    });
  };

  //? SYNC-O14 — the raw `tempToken` is passed to the `_client` handler by design:
  //? `_client` handlers receive it specifically so they can call
  //? `functions.session.getSession(token)` to look up the RECIPIENT's session
  //? without a server-side session store hit from the fanout loop. The token is
  //? NOT forwarded to the error-tracker context — `targetToken` below uses
  //? `redactToken(tempToken)` (SYNC-N2 fix).
  const [clientSyncError, clientSyncResult] = await tryCatch(
    async () => await clientSyncHandler({ clientInput: data, token: tempToken, functions: functionsObject, serverOutput, roomCode: receiver, stream: emitClientSyncStream }),
    undefined,
    {
      handler: handlerName,
      sync: resolvedName,
      stage: 'client',
      sourceUserId,
      //? Redact the raw bearer session token before it lands in the
      //? error-tracker context (`captureException`) — a verbatim token there is
      //? a usable credential (defeats HttpOnly-cookie mode). The 4-char prefix
      //? still correlates error events.
      targetToken: redactToken(tempToken),
      receiver,
      transport,
    },
  );
  const preferred = resolvePreferredLocale(tempSocket.handshake.headers);
  if (clientSyncError) {
    tempSocket.emit(socketEventNames.sync, {
      cb: callbackKey,
      fullName: resolvedName,
      ...buildSyncError({
        response: { status: 'error', errorCode: 'sync.clientExecutionFailed' },
        preferred,
      }),
    });
    return;
  }
  if (clientSyncResult?.status === 'error') {
    tempSocket.emit(socketEventNames.sync, {
      cb: callbackKey,
      fullName: resolvedName,
      ...buildSyncError({
        response: ensureSyncErrorShape(clientSyncResult),
        preferred,
      }),
    });
    return;
  }
  if (clientSyncResult?.status !== 'success') {
    tempSocket.emit(socketEventNames.sync, {
      cb: callbackKey,
      fullName: resolvedName,
      ...buildSyncError({
        response: { status: 'error', errorCode: 'sync.invalidClientResponse' },
        preferred,
      }),
    });
    return;
  }

  const result = {
    cb: callbackKey,
    fullName: resolvedName,
    serverOutput,
    clientOutput: clientSyncResult,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty message should fall back to the default too
    message: clientSyncResult.message || `${resolvedName} sync success`,
    status: 'success',
  };
  if (shouldLogDev()) {
    getLogger().debug(`${logLabel}: ${resolvedName} client success`, { result });
  }
  tempSocket.emit(socketEventNames.sync, result);
};
