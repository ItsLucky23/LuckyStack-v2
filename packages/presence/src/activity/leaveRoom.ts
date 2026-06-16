import { Socket } from 'socket.io';

import { getLogger, readSession } from '@luckystack/core';
import { tokenFingerprint } from './tokenFingerprint';

//? NOTE: despite the name this does NOT call `socket.leave(...)` — it only
//? resolves the session for the departing token so the caller (grace-expiry
//? teardown) can fire its peer notifications / hooks with a real userId. The
//? `socket` / `newPath` params are part of the call-site contract but unused
//? here. Renaming/trimming the signature is deferred (a cross-package call site
//? in @luckystack/server passes the same shape) — see the merged presence
//? report finding #8.
//
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
    getLogger().warn('presence: no session data for given token', { tokenFingerprint: tokenFingerprint(token) });
    return null;
  }

  return user;
};
