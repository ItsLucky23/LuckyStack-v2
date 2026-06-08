import { Socket } from 'socket.io';

import { getLogger, readSession } from '@luckystack/core';

// Return type inferred from `getSession`, which is currently typed to the
// project-level `SessionLayout` (extends Prisma `User`) via the login
// package's session.ts. Any concrete session type extending
// `BaseSessionLayout` is structurally compatible with this flow.
export const socketLeaveRoom = async ({ token }: {
  token: string | null,
  socket: Socket,
  newPath: string | null,
}) => {

  if (!token) {
    getLogger().warn('presence: trying to update room peers but no token provided');
    return null;
  }

  const user = await readSession(token);
  if (!user?.id) {
    getLogger().warn('presence: no session data for given token', { token });
    return null;
  }

  return user;
};
