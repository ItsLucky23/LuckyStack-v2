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

import { extractTokenFromSocket, getIoInstance, getLogger } from '@luckystack/core';

import { getPresenceConfig } from '../presenceConfig';
import { dispatchActivitySample } from '../activityEvents';

const lastActivityBySocket = new Map<string, number>();

/** Mark a socket as active right now. Called on connect + every `activity` heartbeat. */
export const recordActivity = (socketId: string): void => {
  lastActivityBySocket.set(socketId, Date.now());
};

/** Drop a socket's activity record. Called on disconnect. */
export const clearActivity = (socketId: string): void => {
  lastActivityBySocket.delete(socketId);
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
      const token = extractTokenFromSocket(socket);
      const lastActivity = lastActivityBySocket.get(socketId) ?? now;
      void dispatchActivitySample({ socketId, token, lastActivity, now });
    }
  }, effectiveInterval);

  return stopActivitySampler;
};
