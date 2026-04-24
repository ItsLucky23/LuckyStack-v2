/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { Socket } from "socket.io";
import { redis as redisClient, tryCatch, socketEventNames, dispatchHook } from '@luckystack/core';
import { disconnectTimers, tempDisconnectedSockets } from "@luckystack/presence";
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

    if (tempDisconnectedSockets.has(token)) {
      tempDisconnectedSockets.delete(token);
    }

    if (disconnectTimers.has(token)) {
      const timer = disconnectTimers.get(token);
      if (timer) {
        clearTimeout(timer);
        disconnectTimers.delete(token);
      }
    }

    console.log(`Logging out user with token: ${token}`, 'cyan');

    if (!skipSessionDelete) {
      await deleteSession(token);
    }
    const tokensOfActiveUsers = `${process.env.PROJECT_NAME}-activeUsers:${userId}`
    await redisClient.srem(tokensOfActiveUsers, token);
    socket.leave(token);

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
