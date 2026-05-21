/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-floating-promises, @typescript-eslint/require-await, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-misused-promises */

import { Server, Socket } from 'socket.io';

import { deleteSession, getSession } from '@luckystack/login';
import { informRoomPeers } from './peerNotifier';
import { socketLeaveRoom } from './leaveRoom';
import {
  clientSwitchedTab,
  disconnectTimers,
  getDisconnectTime,
  tempDisconnectedSockets,
} from './state';
import { dispatchHook, socketEventNames, getLogger } from '@luckystack/core';
import { getPresenceConfig } from '../presenceConfig';

export const socketConnected = async ({
  token,
  io
}: {
  token: string,
  io: Server
}) => {
  const timer = disconnectTimers.get(token);
  let isReconnect = false;
  if (timer) {
    isReconnect = true;
    getLogger().debug(`presence: user came back`, { token });
    clearTimeout(timer);
    disconnectTimers.delete(token);
    if (tempDisconnectedSockets.has(token)) {
      tempDisconnectedSockets.delete(token);
    } else {
      getLogger().debug(`presence: user connected`, { token });
    }
  }

  const session = await getSession(token);
  const userId = session?.id || null;
  const roomCodes = Array.isArray(session?.roomCodes)
    ? session.roomCodes.filter((room: unknown): room is string => typeof room === 'string' && room.length > 0)
    : [];

  //? `postSocketReconnect` fires only on reconnect (not on initial connect)
  //? so consumers can rehydrate state, replay missed events, or invalidate
  //? caches. Initial-connect cases are covered by the existing
  //? `onSocketConnect` hook from @luckystack/server.
  if (isReconnect) {
    void dispatchHook('postSocketReconnect', {
      token,
      userId,
      roomCodes,
    });
  }

  if (roomCodes.length === 0) { return; }
  if (!userId) { return; }

  informRoomPeers({ token, io, event: socketEventNames.userBack, extraData: { ignoreSelf: true } });
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

  //? Read from the live config so `registerPresenceConfig({ ignoreReasons })`
  //? works even if it ran after this module was imported.
  if (getPresenceConfig().ignoreReasons.includes(reason)) {
    getLogger().debug(`presence: ignored disconnect`, { reason });
    return;
  }

  if (!token) { return; }
  if (tempDisconnectedSockets.has(token)) {
    return;
  } else {
    tempDisconnectedSockets.add(token);
  }

  const time = getDisconnectTime({ token, reason });

  let deleteSessionOnDisconnect = true;
  if (clientSwitchedTab.has(token)) {
    deleteSessionOnDisconnect = false;
    clientSwitchedTab.delete(token);
  }

  getLogger().debug(`presence: user disconnected`, { reason, timerSeconds: time / 1000 });

  const timeout = setTimeout(async () => {
    if (tempDisconnectedSockets.has(token)) {
      tempDisconnectedSockets.delete(token);
    } else { return; }

    if (disconnectTimers.get(token) !== timeout) { return };

    await socketLeaveRoom({ token, socket, newPath: null });

    if (deleteSessionOnDisconnect) {
      await deleteSession(token);
    }

    getLogger().debug(`presence: user fully disconnected`, { reason, timerSeconds: time / 1000, deleteSessionOnDisconnect });
  }, time);

  if (disconnectTimers.has(token)) {
    clearTimeout(disconnectTimers.get(token));
    disconnectTimers.delete(token);
  }
  disconnectTimers.set(token, timeout);

}

export const initActivityBroadcaster = ({
  token,
  socket
}: {
  token: string,
  socket: Socket,
}) => {
  socket.on(socketEventNames.intentionalDisconnect, async () => {
    clientSwitchedTab.add(token);
    const time = getDisconnectTime({ token, reason: undefined });

    await informRoomPeers({ token, event: socketEventNames.userAfk, extraData: { time } });

    socket.disconnect(false);
  });
}
