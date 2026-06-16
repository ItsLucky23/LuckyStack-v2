//? Optional room-name formatter seam (presence socket-room-formatter handoff).
//? Socket.io room names are global within an io instance; in a multi-tenant or
//? multi-feature deployment two features can collide on the same raw room code.
//? A consumer registers a formatter to namespace room names (e.g. prefix with a
//? workspace id) at the single point every framework join/leave/broadcast site
//? routes through — mirroring `registerRedisKeyFormatter` for Redis keys.
//?
//? The DEFAULT is identity (return the raw room name unchanged), so a missing
//? registration keeps today's behavior byte-for-byte. The formatter MUST be a
//? pure, synchronous function (it runs on the socket hot path) and MUST be
//? deterministic so join and leave produce the same physical room.

import { createRegistry } from './createRegistry';

export interface RoomNameFormatterContext {
  /** Why the room name is being formatted — so a formatter can branch if needed. */
  purpose: 'join' | 'leave' | 'broadcast' | 'presence';
  /** Session user id when known (join/leave by an authenticated socket), else null. */
  userId?: string | null;
}

export type RoomNameFormatter = (rawRoomName: string, ctx: RoomNameFormatterContext) => string;

const identityFormatter: RoomNameFormatter = (rawRoomName) => rawRoomName;

const registry = createRegistry<RoomNameFormatter>(identityFormatter);

/** Override how every framework room name is namespaced (multi-tenant prefixing). */
export const registerRoomNameFormatter = (formatter: RoomNameFormatter): void => {
  registry.register(formatter);
};

/** Read the active formatter (defaults to identity). */
export const getRoomNameFormatter = (): RoomNameFormatter => registry.get();

/** Apply the active formatter — the single helper framework room-sites call. */
export const formatRoomName = (rawRoomName: string, ctx: RoomNameFormatterContext): string =>
  registry.get()(rawRoomName, ctx);

/** The built-in identity formatter (exported for tests / explicit reset). */
export const defaultRoomNameFormatter = identityFormatter;
