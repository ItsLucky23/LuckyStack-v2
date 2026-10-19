import { formatRoomName } from '@luckystack/core';

//? The physical Socket.io room a sync receiver addresses — single-sourced for the
//? membership check, the recipient fetch on both transports and broadcastStream,
//? so the four sites cannot drift apart again.
//?
//? - `'all'` is the every-socket sentinel, never a room name.
//? - The caller's OWN token room is joined RAW (`loadSocket` runs
//?   `socket.join(token)` without the formatter), so it must be addressed raw. A
//?   non-identity `registerRoomNameFormatter` would otherwise turn a sync to your
//?   own session into `sync.notRoomMember` (socket) or `sync.noReceiversFound`
//?   (HTTP), although it works under the identity formatter.
//? - Every other room goes through the formatter with the same `broadcast`
//?   context sockets joined under (PRESENCE-1).
export const resolvePhysicalReceiver = (
  receiver: string,
  { token, userId }: { token: string | null; userId: string | null },
): string => {
  if (receiver === 'all') return 'all';
  if (token && receiver === token) return receiver;
  return formatRoomName(receiver, { purpose: 'broadcast', userId });
};
