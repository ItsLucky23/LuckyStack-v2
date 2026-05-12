/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { Socket } from "socket.io";
import { redis as redisClient, tryCatch, socketEventNames, dispatchHook, getLogger } from '@luckystack/core';
import { deleteSession, activeUsersKeyFor } from "./session";

export const logout = async ({ token, socket, userId, skipSessionDelete }: {
  token: string | null,
  socket: Socket | undefined,
  userId: string | null,
  skipSessionDelete?: boolean,
}) => {
  const [error, result] = await tryCatch(async () => {
    if (!socket) {
      getLogger().warn('logout: invalid socket');
      return;
    }
    if (!token) {
      getLogger().warn('logout: no token provided');
      return;
    }

    const preLogoutResult = await dispatchHook('preLogout', { userId, token });
    if (preLogoutResult.stopped) {
      getLogger().warn('logout: aborted by preLogout hook', { errorCode: preLogoutResult.signal.errorCode });
      socket.emit(socketEventNames.logout, "error");
      return;
    }

    getLogger().debug(`logout: user ${userId ?? '?'}`, { token });

    if (!skipSessionDelete) {
      await deleteSession(token);
    }
    if (userId) {
      await redisClient.srem(activeUsersKeyFor(userId), token);
    }
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
