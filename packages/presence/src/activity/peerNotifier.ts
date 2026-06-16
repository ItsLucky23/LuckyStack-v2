import { Server } from 'socket.io';
import type { RemoteSocket, DefaultEventsMap } from 'socket.io';

import { dispatchHook, extractTokenFromSocket, formatRoomName, getIoInstance, getLogger, socketEventNames, readSession } from '@luckystack/core';
import { ensureIo } from './state';

//? A peer socket as returned by `io.in(room).fetchSockets()` — adapter-aware, so
//? this is a `RemoteSocket` (which also covers locally-connected sockets).
type RoomPeerSocket = RemoteSocket<DefaultEventsMap, unknown>;

//? Shared room-peer fan-out used by every presence broadcast site
//? (`informRoomPeers` userAfk/userBack + `informRoomPeersLeft` userLeft).
//? Walks each room code through the core room-name formatter (default identity,
//? multi-tenant prefix otherwise — M2/D4), pulls the adapter-aware peer list
//? (RemoteSockets span instances under the Redis adapter), de-dupes a socket
//? seen in multiple rooms via a single shared `handledSockets` Set keyed on
//? `peerSocket.id`, and invokes `onPeer` once per first-seen peer.
//?
//? Behaviour contract (must stay identical to the inlined loops it replaces):
//?  - a peer is marked handled BEFORE `onPeer` runs, so a peer the callback
//?    chooses to skip is still never visited again from another room;
//?  - the per-room formatter context carries the resolved `userId`;
//?  - iteration order is roomCodes order, then `fetchSockets()` order.
//? The skip-self decision + the emit + the recipient bookkeeping live in the
//? callback because they differ per call site (conditional vs always skip-self,
//? different event payloads), and those differences ARE real behaviour.
const forEachRoomPeer = async ({
  io,
  roomCodes,
  userId,
  onPeer,
}: {
  io: Server,
  roomCodes: string[],
  userId: string | null,
  onPeer: (peerSocket: RoomPeerSocket) => void,
}): Promise<void> => {
  const handledSockets = new Set<string>();

  for (const room of roomCodes) {
    //? Route the raw room code through the core room-name formatter (default
    //? identity) so a multi-tenant consumer's prefix applies here exactly as it
    //? does at the join/leave sites — otherwise two tenants sharing a room-code
    //? string would share presence fan-out (M2/D4).
    const physicalRoom = formatRoomName(room, { purpose: 'presence', userId });
    //? `fetchSockets()` is adapter-aware: with the Redis adapter attached it
    //? returns RemoteSockets for peers on OTHER instances too, so presence
    //? broadcasts cross the instance boundary. A plain
    //? `io.sockets.adapter.rooms.get(room)` only sees locally-connected sockets.
    const roomSockets = await io.in(physicalRoom).fetchSockets();

    for (const peerSocket of roomSockets) {
      const socketKey = peerSocket.id;
      if (handledSockets.has(socketKey)) { continue; }
      handledSockets.add(socketKey);

      onPeer(peerSocket);
    }
  }
};

export const informRoomPeers = async ({
  token,
  io = getIoInstance(),
  event,
  extraData,
}: {
  token: string,
  io?: Server | null,
  event: typeof socketEventNames.userAfk | typeof socketEventNames.userBack,
  extraData?: { ignoreSelf?: boolean; time?: number }
}) => {
  if (!ensureIo(io)) {
    getLogger().warn('presence: no io instance found to inform room peers');
    return;
  }

  const session = await readSession(token);
  const roomCodes = Array.isArray(session?.roomCodes)
    ? session.roomCodes.filter((room: unknown): room is string => typeof room === 'string' && room.length > 0)
    : [];

  if (!session || roomCodes.length === 0) { return; }

  const kind: 'afk' | 'back' = event === socketEventNames.userAfk ? 'afk' : 'back';
  //? `session.id` is the project session id (non-null per `BaseSessionLayout`);
  //? the hook payloads still type `userId` as `string | null` for the lifecycle
  //? path where the session may have been deleted out from under us.
  const userId: string | null = session.id;

  //? `prePresenceUpdate` is a veto seam (symmetric with `preRoomJoin`/`preRoomLeave`):
  //? a handler returning a stop signal suppresses the fan-out, enabling per-user
  //? invisible / DND / hidden-observer modes without forking. We still fire
  //? `postPresenceUpdate` (recipientCount 0) so audit consumers see the suppressed event.
  const pre = await dispatchHook('prePresenceUpdate', { token, userId, kind, roomCodes });
  if (pre.stopped) {
    await dispatchHook('postPresenceUpdate', { token, userId, kind, roomCodes, recipientCount: 0 });
    return;
  }

  let recipientCount = 0;

  await forEachRoomPeer({
    io,
    roomCodes,
    userId,
    onPeer: (peerSocket) => {
      if (extraData?.ignoreSelf) {
        const tempToken = extractTokenFromSocket(peerSocket);
        if (token === tempToken) { return; }
      }

      if (event === socketEventNames.userAfk) {
        peerSocket.emit(socketEventNames.userAfk, { userId: session.id, endTime: Date.now() + (extraData?.time ?? 0) });
      } else {
        peerSocket.emit(socketEventNames.userBack, { userId: session.id });
      }
      recipientCount++;
    },
  });

  await dispatchHook('postPresenceUpdate', { token, userId, kind, roomCodes, recipientCount });
};

//? Broadcast `userLeft` to a room's remaining members when a peer is gone for
//? good — hard disconnect (socket close) or grace-window expiry (MIS-003). The
//? session has already been torn down at the call site, so `userId`/`roomCodes`
//? are passed in (resolved BEFORE teardown) rather than re-read here. Without
//? this, peers would show a departed user as present forever (presence only ever
//? emitted `userAfk`/`userBack`). Returns the recipient count for the caller.
export const informRoomPeersLeft = async ({
  token,
  userId,
  roomCodes,
  io = getIoInstance(),
}: {
  token: string,
  userId: string | null,
  roomCodes: string[],
  io?: Server | null,
}): Promise<number> => {
  if (!ensureIo(io)) {
    getLogger().warn('presence: no io instance found to inform room peers of userLeft');
    return 0;
  }
  if (roomCodes.length === 0) { return 0; }

  let recipientCount = 0;

  await forEachRoomPeer({
    io,
    roomCodes,
    userId,
    onPeer: (peerSocket) => {
      //? Never notify the departing user's own lingering sockets (e.g. a second
      //? tab) that they themselves left.
      if (token === extractTokenFromSocket(peerSocket)) { return; }

      peerSocket.emit(socketEventNames.userLeft, { userId });
      recipientCount++;
    },
  });

  return recipientCount;
};
