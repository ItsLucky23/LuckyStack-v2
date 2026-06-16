//? Production driver for the activity-event system. The client emits a
//? throttled `activity` heartbeat (mouse/keyboard/touch); the server records
//? the last-activity timestamp per socket here, and a single interval walks
//? every connected socket and feeds an `ActivitySample` to
//? `dispatchActivitySample`, which fires the registered events (the built-in
//? AFK detector, plus any consumer events for pause/kick/typing/etc.).
//?
//? Last-activity is tracked in a module-level Map keyed by socket id (not on
//? `socket.data`) so it stays fully typed without touching the socket.io
//? `SocketData` generic.

import { Server } from 'socket.io';

import { extractTokenFromSocket, formatRoomName, getIoInstance, getLogger, tryCatchSync } from '@luckystack/core';

import { getPresenceConfig } from '../presenceConfig';
import { clearActivityThrottle, dispatchActivitySample } from '../activityEvents';

const lastActivityBySocket = new Map<string, number>();

/** Mark a socket as active right now. Called on connect + every `activity` heartbeat. */
export const recordActivity = (socketId: string): void => {
  lastActivityBySocket.set(socketId, Date.now());
};

/** Drop a socket's activity record. Called on disconnect. */
export const clearActivity = (socketId: string): void => {
  lastActivityBySocket.delete(socketId);
  //? Also purge the socket's refractory-throttle timestamps so the
  //? `activityEvents` `lastFired` map doesn't leak one entry per throttled
  //? event per (per-connection) socket id forever.
  clearActivityThrottle(socketId);
};

/**
 * Read a socket's last-activity timestamp (ms epoch), or `undefined` if the
 * socket has no recorded activity. Exposed so a consumer `_api`/roster query can
 * compute AFK-ness without forking — `lastActivityBySocket` is module-private.
 */
export const getLastActivity = (socketId: string): number | undefined =>
  lastActivityBySocket.get(socketId);

/** A single peer in a room-presence snapshot (see `getRoomPresence`). */
export interface RoomPresenceEntry {
  socketId: string;
  token: string | null;
  /** Last recorded activity (ms epoch), or `undefined` if never recorded. */
  lastActivity: number | undefined;
  /** Idle longer than `afkTimeoutMs` at snapshot time. */
  afk: boolean;
}

/**
 * Snapshot the current presence of a room for a late joiner — presence itself
 * is delta-only (`userAfk`/`userBack`), so a client joining mid-session needs
 * this to render "who is here and who is idle" before the next delta. Walks the
 * socket.io adapter for `roomCode` (adapter-aware: with the Redis adapter
 * attached it spans instances) and tags each peer with its activity + AFK state.
 */
export const getRoomPresence = async (
  roomCode: string,
  { io = getIoInstance() }: { io?: Server | null } = {},
): Promise<RoomPresenceEntry[]> => {
  if (!io) {
    getLogger().warn('presence: cannot read room presence — no io instance');
    return [];
  }

  const now = Date.now();
  const afkTimeoutMs = getPresenceConfig().afkTimeoutMs;
  //? Route the raw room code through the core room-name formatter (default
  //? identity) so a multi-tenant consumer's prefix resolves the SAME physical
  //? room the peers actually joined — mirroring the broadcast side
  //? (`informRoomPeers`/`informRoomPeersLeft`). Without this, a non-identity
  //? formatter would make this late-joiner snapshot query the raw room nobody
  //? joined and return empty (M2/D4). No `userId` is in scope for a whole-room
  //? snapshot, so the context carries `userId: null`.
  const physicalRoom = formatRoomName(roomCode, { purpose: 'presence', userId: null });
  const roomSockets = await io.in(physicalRoom).fetchSockets();

  return roomSockets.map((socket) => {
    const lastActivity = lastActivityBySocket.get(socket.id);
    const afk = afkTimeoutMs > 0 && lastActivity !== undefined && now - lastActivity > afkTimeoutMs;
    return {
      socketId: socket.id,
      token: extractTokenFromSocket(socket),
      lastActivity,
      afk,
    };
  });
};

let samplerHandle: ReturnType<typeof setInterval> | null = null;

/** Stop the activity sampler interval (idempotent). */
export const stopActivitySampler = (): void => {
  if (samplerHandle !== null) {
    clearInterval(samplerHandle);
    samplerHandle = null;
  }
};

/**
 * Start the single activity-sampling interval. Idempotent — calling it again
 * while running is a no-op (so it can be triggered lazily from the first
 * socket connection). Returns the stop function.
 */
export const startActivitySampler = (
  { io = getIoInstance(), intervalMs }: { io?: Server | null; intervalMs?: number } = {},
): (() => void) => {
  if (!io) {
    getLogger().warn('presence: cannot start activity sampler — no io instance');
    return stopActivitySampler;
  }
  if (samplerHandle !== null) return stopActivitySampler;

  const effectiveInterval = intervalMs ?? getPresenceConfig().activitySampleIntervalMs;
  if (effectiveInterval <= 0) return stopActivitySampler;

  samplerHandle = setInterval(() => {
    const now = Date.now();
    for (const [socketId, socket] of io.sockets.sockets) {
      //? Per-socket isolation: a single malformed socket throwing in
      //? `extractTokenFromSocket` must not abort the whole sweep and starve AFK
      //? detection for every other socket this tick.
      const [error] = tryCatchSync(() => {
        //? Skip sockets with no recorded activity instead of defaulting to
        //? `now`: a never-recorded socket looked perpetually fresh and could
        //? NEVER be flagged AFK (silent false-negative), and the `?? now`
        //? default also disagreed with `getRoomPresence` (`undefined ⇒ not-afk`).
        //? `recordActivity` is wired on connect by @luckystack/server, so a
        //? missing entry signals a wiring gap rather than a fresh socket.
        const lastActivity = lastActivityBySocket.get(socketId);
        if (lastActivity === undefined) { return; }
        const token = extractTokenFromSocket(socket);
        void dispatchActivitySample({ socketId, token, lastActivity, now });
      });
      if (error) {
        getLogger().error('presence: activity sampler failed for socket', { socketId, error });
      }
    }
  }, effectiveInterval);

  return stopActivitySampler;
};
