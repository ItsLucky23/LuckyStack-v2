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
    //? Spurious logouts are always a bug — log loudly so the originating
    //? caller is identifiable from the stacktrace. The client receives this
    //? success-emit and clears sessionStorage + redirects to /login, so any
    //? unexpected occurrence here is the smoking gun.
    getLogger().warn('[session] logout success — emitting logout to socket', {
      tokenPrefix: token ? token.slice(0, 8) : null,
      userId,
      socketId: socket.id,
      stack: new Error('logout invoked').stack,
    });
    socket.emit(socketEventNames.logout, "success");
  }
}
