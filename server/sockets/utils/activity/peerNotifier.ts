import { Server } from 'socket.io';

import { extractTokenFromSocket } from '../../../utils/extractToken';
import { getSession } from '../../../functions/session';
import { ioInstance } from '../../socket';
import { ensureIo } from './state';

export const informRoomPeers = async ({
  token,
  io = ioInstance,
  event,
  extraData,
}: {
  token: string,
  io?: Server | null,
  event: 'userAfk' | 'userBack',
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

  if (!session || !roomCodes.length) { return; }

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

      if (event == 'userAfk') {
        tempSocket.emit('userAfk', { userId: session.id, endTime: Date.now() + (extraData?.time || 0) });
      } else if (event == 'userBack') {
        tempSocket.emit('userBack', { userId: session.id });
      }
    }
  }
};
