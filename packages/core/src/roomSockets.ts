//? The one short path to "who is in this room" (multi-instance handoff,
//? DEV-376). Three things go wrong, independently, when consumer code resolves
//? a room by hand: it reads a per-instance map instead of `fetchSockets()`, it
//? uses the RAW room code where sockets joined the FORMATTED one, and it hands
//? a user id to the formatter for a shared room. This helper does all three the
//? way the framework's own fan-out does (`@luckystack/sync` handleSyncRequest /
//? handleHttpSyncRequest), so the correct call is also the shortest one.

import type { Server as SocketIOServer } from 'socket.io';
import { getIoInstance } from './socketTypes';
import { formatRoomName } from './roomNameFormatterRegistry';

/** A recipient as returned by Socket.io's adapter-aware `fetchSockets()`. */
export type RoomSocket = Awaited<ReturnType<SocketIOServer['fetchSockets']>>[number];

export interface GetRoomSocketsOptions {
  /**
   * User id forwarded to the room-name formatter as CONTEXT. Leave it out (or
   * pass `null`) for a shared room — the formatter contract forbids folding it
   * into a content room's physical name, so it only matters to a formatter that
   * logs or branches on it.
   */
  userId?: string | null;
}

/**
 * Resolve every socket currently in `room`, on EVERY instance sharing the
 * Redis adapter. `room` is the LOGICAL code (what the client joined); it is
 * routed through the registered room-name formatter under the canonical
 * `'broadcast'` purpose exactly like the sync fan-out. The `'all'` sentinel
 * returns every connected socket everywhere.
 *
 * Throws when no Socket.io server is registered: a silent `[]` is precisely the
 * failure class this helper exists to remove.
 */
export const getRoomSockets = async (room: string, options: GetRoomSocketsOptions = {}): Promise<RoomSocket[]> => {
  const io = getIoInstance({ raw: true });
  if (io === null) {
    throw new Error('getRoomSockets: no Socket.io server is registered (setIoInstance was never called), so the sockets of a room cannot be resolved.');
  }
  const logicalRoom = room.trim();
  if (logicalRoom === '') {
    throw new Error('getRoomSockets: `room` must be a non-empty room code.');
  }
  if (logicalRoom === 'all') return io.fetchSockets();
  const physicalRoom = formatRoomName(logicalRoom, { purpose: 'broadcast', userId: options.userId ?? null });
  return io.in(physicalRoom).fetchSockets();
};
