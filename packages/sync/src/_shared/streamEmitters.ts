import {
  getIoInstance,
  getLogger,
  getProjectConfig,
  socketEventNames,
} from '@luckystack/core';

export type SyncStreamPayload = Record<string, unknown>;

export interface SyncStreamEmitters {
  emitServerSyncStream: (payload?: SyncStreamPayload) => void;
  emitBroadcastSyncStream: (payload?: SyncStreamPayload) => void;
  emitStreamToTokens: (tokens: string | string[], payload?: SyncStreamPayload) => void;
  buildBroadcastFrame: (payload: SyncStreamPayload) => Record<string, unknown>;
}

const shouldLogStream = () => getProjectConfig().logging.stream;

//? Shared between socket (`handleSyncRequest`) and HTTP/SSE
//? (`handleHttpSyncRequest`) transports. The only divergence is the originator
//? sink: socket transport unicasts a progress event back to the requesting
//? socket; HTTP transport pipes the chunk through the SSE writer. Caller
//? supplies that as `emitOriginatorChunk`. Broadcast/streamTo paths use
//? Socket.io regardless of transport because recipients always live on sockets.
export const buildSyncStreamEmitters = ({
  cb,
  receiver,
  resolvedName,
  emitOriginatorChunk,
  logLabel,
}: {
  cb: string | undefined;
  receiver: string;
  resolvedName: string;
  emitOriginatorChunk: (payload: SyncStreamPayload) => void;
  logLabel: string;
}): SyncStreamEmitters => {
  const buildBroadcastFrame = (payload: SyncStreamPayload) => ({
    ...payload,
    cb,
    fullName: resolvedName,
    status: 'stream' as const,
  });

  const emitServerSyncStream = (payload: SyncStreamPayload = {}) => {
    if (shouldLogStream()) {
      getLogger().debug(`${logLabel}: ${resolvedName} server stream`, { payload });
    }
    emitOriginatorChunk(payload);
  };

  const emitBroadcastSyncStream = (payload: SyncStreamPayload = {}) => {
    if (shouldLogStream()) {
      getLogger().debug(`${logLabel}: ${resolvedName} broadcastStream`, { payload });
    }
    if (!receiver) return;
    const io = getIoInstance();
    if (!io) return;

    const frame = buildBroadcastFrame(payload);
    const roomMembers = io.sockets.adapter.rooms.get(receiver);
    if (!roomMembers || roomMembers.size === 0) return;

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

  const emitStreamToTokens = (
    tokens: string | string[],
    payload: SyncStreamPayload = {},
  ) => {
    const list = Array.isArray(tokens) ? tokens : [tokens];
    const filtered = list.filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (filtered.length === 0) return;
    if (shouldLogStream()) {
      getLogger().debug(`${logLabel}: ${resolvedName} streamTo`, { tokens: filtered, payload });
    }
    const io = getIoInstance();
    if (!io) return;
    const frame = buildBroadcastFrame(payload);
    io.to(filtered).emit(socketEventNames.sync, frame);
  };

  return { emitServerSyncStream, emitBroadcastSyncStream, emitStreamToTokens, buildBroadcastFrame };
};
