import { Server, Socket } from 'socket.io';

import { deleteSession, getSession } from '../../../functions/session';
import { informRoomPeers } from './peerNotifier';
import { socketLeaveRoom } from './leaveRoom';
import {
  clientSwitchedTab,
  disconnectReasonsWeIgnore,
  disconnectTimers,
  getDisconnectTime,
  tempDisconnectedSockets,
} from './state';

export const socketConnected = async ({
  token,
  io
}: {
  token: string,
  io: Server
}) => {
  const timer = disconnectTimers.get(token);
  if (timer) {
    console.log(`user came back with token: ${token}`, 'yellow');
    clearTimeout(timer);
    disconnectTimers.delete(token);
    if (tempDisconnectedSockets.has(token)) {
      tempDisconnectedSockets.delete(token);
    } else {
      console.log(`a user connected with token: ${token}`, 'cyan');
    }
  }

  const session = await getSession(token);
  const userId = session?.id || null;
  const roomCodes = Array.isArray(session?.roomCodes)
    ? session.roomCodes.filter((room: unknown): room is string => typeof room === 'string' && room.length > 0)
    : [];

  if (!roomCodes.length) { return; }
  if (!userId) { return; }

  informRoomPeers({ token, io, event: 'userBack', extraData: { ignoreSelf: true } });
}

export const socketDisconnecting = async ({
  token,
  reason,
  socket
}: {
  token: string,
  reason: string,
  socket: Socket
}) => {

  if (disconnectReasonsWeIgnore.includes(reason)) {
    console.log(`user disconnected but we ignore it, reason: ${reason}`, 'yellow');
    return;
  }

  if (!token) { return; }
  if (!tempDisconnectedSockets.has(token)) {
    tempDisconnectedSockets.add(token);
  } else {
    return;
  }

  const time = getDisconnectTime({ token, reason });

  let deleteSessionOnDisconnect = true;
  if (clientSwitchedTab.has(token)) {
    deleteSessionOnDisconnect = false;
    clientSwitchedTab.delete(token);
  }

  console.log(`user disconnected, reason: ${reason}, timer: ${time / 1000} seconds`, 'yellow');

  const timeout = setTimeout(async () => {
    if (tempDisconnectedSockets.has(token)) {
      tempDisconnectedSockets.delete(token);
    } else { return; }

    if (disconnectTimers.get(token) !== timeout) { return };

    await socketLeaveRoom({ token, socket, newPath: null });

    if (deleteSessionOnDisconnect) {
      await deleteSession(token);
    }

    console.log(`user fully disconnected, reason: ${reason}, timer : ${time / 1000} seconds, deleteSessionOnDisconnect: ${deleteSessionOnDisconnect}`, 'yellow');
  }, time);

  if (disconnectTimers.has(token)) {
    clearTimeout(disconnectTimers.get(token)!);
    disconnectTimers.delete(token);
  }
  disconnectTimers.set(token, timeout);

}

export const initAcitivityBroadcaster = ({
  token,
  socket
}: {
  token: string,
  socket: Socket,
}) => {
  socket.on("intentionalDisconnect", async () => {
    clientSwitchedTab.add(token);
    const time = getDisconnectTime({ token, reason: undefined });

    await informRoomPeers({ token, event: 'userAfk', extraData: { time } });

    socket.disconnect(false);
  });
}
