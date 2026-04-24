import { Socket } from 'socket.io';

import { getSession } from '@luckystack/login';

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
    console.log('trying to update room peers but no token provided', 'red');
    return null;
  }

  const user = await getSession(token);
  if (!user?.id) {
    console.log(`no session data for given token: ${token}`, 'red');
    return null;
  }

  return user;
};
