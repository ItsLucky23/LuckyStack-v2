import { Socket } from 'socket.io';

import type { SessionLayout } from '../../../../config';
import { getSession } from '../../../functions/session';

export const socketLeaveRoom = async ({ token, socket: _socket, newPath: _newPath }: {
  token: string | null,
  socket: Socket,
  newPath: string | null
}): Promise<SessionLayout | null> => {

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
