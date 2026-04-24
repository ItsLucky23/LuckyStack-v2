/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { Socket } from "socket.io";
import { redis as redisClient, tryCatch, socketEventNames, dispatchHook } from '@luckystack/core';
import { deleteSession } from "./session";

export const logout = async ({ token, socket, userId, skipSessionDelete }: {
  token: string | null,
  socket: Socket | undefined,
  userId: string | null,
  skipSessionDelete?: boolean,
}) => {
  const [error, result] = await tryCatch(async () => {
    if (!socket) {
      console.log('Trying to logout but invalid socket', 'red');
      return;
    }
    if (!token) {
      console.log('Trying to logout without a token', 'red');
      return;
    }

    console.log(`Logging out user with token: ${token}`, 'cyan');

    if (!skipSessionDelete) {
      await deleteSession(token);
    }
    const tokensOfActiveUsers = `${process.env.PROJECT_NAME}-activeUsers:${userId}`
    await redisClient.srem(tokensOfActiveUsers, token);
    socket.leave(token);

    // Presence state (disconnectTimers, tempDisconnectedSockets) is cleaned up
    // by `@luckystack/presence`'s `postLogout` hook handler, registered at
    // server startup via `registerPresenceHooks()`. Keeps login → presence
    // a one-way dep: presence knows about login (uses getSession/deleteSession),
    // login does not know about presence.
    await dispatchHook('postLogout', { userId, token });
    return true;
  });
  if (error) {
    if (socket) {
      socket.emit(socketEventNames.logout, "error");
    }
  } else if (result && socket) {
      socket.emit(socketEventNames.logout, "success");
    }
}
