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

import { extractTokenFromSocket, formatKey, formatRoomName, getIoInstance, getLogger, readSession, redis, tryCatch, tryCatchSync } from '@luckystack/core';

import { getPresenceConfig } from '../presenceConfig';
import { clearActivityThrottle, dispatchActivitySample } from '../activityEvents';
import { lastAfkFireByToken } from './state';

const lastActivityBySocket = new Map<string, number>();

//? Per-socket last-activity is ALSO mirrored to Redis so OTHER instances can read
//? it — the local Map only sees this node's sockets, but the multi-tab AFK guard
//? (PRESENCE-5) + `getRoomPresence` remote peers need a cross-instance view. The
//? TTL is a backstop for a crashed instance (refreshed on every heartbeat; deleted
//? on disconnect); it is generous enough that an idle socket's timestamp survives
//? long enough to be read as AFK rather than vanishing.
const activityKey = (socketId: string): string => formatKey('-presence-activity', socketId);
const activityTtlMs = (): number => Math.max(getPresenceConfig().afkTimeoutMs, 60_000) * 2;

/** Mark a socket as active right now. Called on connect + every `activity` heartbeat. */
export const recordActivity = (socketId: string): void => {
  const now = Date.now();
  lastActivityBySocket.set(socketId, now);
  //? Fire-and-forget cross-instance mirror; a Redis blip must never break the
  //? local heartbeat path (the local Map still works single-instance).
  void tryCatch(() => redis.set(activityKey(socketId), String(now), 'PX', activityTtlMs()));
};

/**
 * Cross-instance last-activity read: the local Map first (this node's sockets),
 * else the Redis mirror (a socket living on another instance). Returns ms-epoch
 * or `undefined`. Used by the multi-tab AFK guard + `getRoomPresence`.
 */
export const getSharedLastActivity = async (socketId: string): Promise<number | undefined> => {
  const local = lastActivityBySocket.get(socketId);
  if (local !== undefined) return local;
  const [, raw] = await tryCatch(() => redis.get(activityKey(socketId)));
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Drop a socket's activity record. Called on disconnect.
 * `token` is optional but should be passed when available so the token-level
 * AFK refractory entry is cleared once the last socket for that token leaves
 * (prevents stale "last fired" timestamps surviving across sessions).
 */
export const clearActivity = (socketId: string, token?: string): void => {
  lastActivityBySocket.delete(socketId);
  //? Drop the Redis mirror too — a disconnected socket is no longer active anywhere.
  void tryCatch(() => redis.del(activityKey(socketId)));
  //? Purge the socket's refractory-throttle timestamps so the `activityEvents`
  //? `lastFired` map doesn't leak one entry per throttled event per socket forever.
  clearActivityThrottle(socketId);
  //? Clear the token-level AFK refractory only when no other local socket for
  //? this token remains — a multi-tab user closing one tab must not reset the
  //? refractory for their still-open tabs (PRESENCE-4).
  if (token) {
    const io = getIoInstance();
    const hasOtherSocket = io
      ? [...io.sockets.sockets.values()].some(
          (s) => s.id !== socketId && extractTokenFromSocket(s) === token,
        )
      : false;
    if (!hasOtherSocket) {
      lastAfkFireByToken.delete(token);
    }
  }
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
  //? The peer's userId (resolved from its session). NEVER the raw session token
  //? — a token is a usable credential and must not leak into a public snapshot.
  userId: string | null;
  /** Last recorded activity (ms epoch), or `undefined` if the socket is remote or has never been recorded. */
  lastActivity: number | undefined;
  /**
   * Idle longer than `afkTimeoutMs` at snapshot time, or `'unknown'` when the
   * socket lives on a different instance and this node has no activity record
   * for it (last-activity is tracked in a local-only Map).
   */
  afk: boolean | 'unknown';
}

/**
 * Snapshot the current presence of a room for a late joiner — presence itself
 * is delta-only (`userAfk`/`userBack`), so a client joining mid-session needs
 * this to render "who is here and who is idle" before the next delta. Walks the
 * socket.io adapter for `roomCode` (adapter-aware: with the Redis adapter
 * attached the peer list spans instances) and tags each peer with its activity
 * + AFK state.
 *
 * Sockets on OTHER instances are returned with `afk: 'unknown'` because
 * `lastActivityBySocket` is a local-only Map — no activity data exists for
 * remote peers on this node.
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

  return Promise.all(roomSockets.map(async (socket) => {
    //? Resolve the peer's userId from its session — never expose the raw token.
    const peerSession = await readSession(extractTokenFromSocket(socket));
    const userId = peerSession?.id ?? null;
    //? Cross-instance activity read (local Map first, else the Redis mirror), so a
    //? peer on ANOTHER instance gets a real AFK verdict instead of always
    //? `'unknown'`. `undefined` (no activity recorded anywhere — a never-recorded
    //? or long-expired socket) still maps to `'unknown'`.
    const lastActivity = await getSharedLastActivity(socket.id);
    const afk = lastActivity === undefined
      ? ('unknown' as const)
      : (afkTimeoutMs > 0 && now - lastActivity > afkTimeoutMs);
    return {
      socketId: socket.id,
      userId,
      lastActivity,
      afk,
    };
  }));
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
  //? dev-warn: if `afkTimeoutMs` is 0 (AFK detection disabled) but
  //? `activitySampleIntervalMs` is still positive, the sampler starts and cycles
  //? every socket every tick but no built-in event fires. Set
  //? `activitySampleIntervalMs: 0` alongside `afkTimeoutMs: 0` to disable the
  //? sampler entirely — unless custom activity events are registered (in which
  //? case the sampler is still needed).
  if (getPresenceConfig().afkTimeoutMs <= 0) {
    getLogger().debug('presence: activity sampler started but afkTimeoutMs is 0 — built-in AFK detection is disabled. Set activitySampleIntervalMs: 0 too if no custom activity events are registered.');
  }

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
