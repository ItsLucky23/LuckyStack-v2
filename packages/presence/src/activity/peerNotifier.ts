/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-type-conversion, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-unnecessary-condition */

import { Server } from 'socket.io';

import { extractTokenFromSocket, socketEventNames } from '@luckystack/core';
import { getSession } from '@luckystack/login';
import { ioInstance } from '../../../../server/sockets/socket';
import { ensureIo } from './state';

export const informRoomPeers = async ({
  token,
  io = ioInstance,
  event,
  extraData,
}: {
  token: string,
  io?: Server | null,
  event: typeof socketEventNames.userAfk | typeof socketEventNames.userBack,
  extraData?: any
}) => {
  if (!ensureIo(io)) {
    console.log('no io instance found to inform room peers', 'red');
    return;
  }

  const session = await getSession(token);
  const roomCodes = Array.isArray(session?.roomCodes)
    ? session.roomCodes.filter((room: unknown): room is string => typeof room === 'string' && room.length > 0)
    : [];

  if (!session || roomCodes.length === 0) { return; }

  const handledSockets = new Set<string>();

  for (const room of roomCodes) {
    const roomSockets = io.sockets.adapter.rooms.get(room);

    for (const socketId of roomSockets || []) {
      const socketKey = String(socketId);
      if (handledSockets.has(socketKey)) { continue; }
      handledSockets.add(socketKey);

      const tempSocket = io.sockets.sockets.get(socketKey);
      if (!tempSocket) { continue; }

      if (extraData?.ignoreSelf) {
        const tempToken = extractTokenFromSocket(tempSocket);
        if (token == tempToken) { continue; }
      }

      if (event == socketEventNames.userAfk) {
        tempSocket.emit(socketEventNames.userAfk, { userId: session.id, endTime: Date.now() + (extraData?.time || 0) });
      } else if (event == socketEventNames.userBack) {
        tempSocket.emit(socketEventNames.userBack, { userId: session.id });
      }
    }
  }
};
