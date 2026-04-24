import type { Socket } from 'socket.io-client';

// Shared, mutable socket-client state. Single source of truth for the socket
// instance, consumed by transport helpers in @luckystack/core (apiRequest)
// and @luckystack/sync (syncRequest), and written by the project's React
// hook wiring in `src/_sockets/socketInitializer.ts` via `setSocket(io(...))`.
//
// The `export let socket` form gives importers a live binding — they always
// see the current value after `setSocket` replaces it.

// eslint-disable-next-line import-x/no-mutable-exports
export let socket: Socket | null = null;

export const setSocket = (next: Socket | null): void => {
  socket = next;
};

let responseIndex = 0;
const WAIT_FOR_SOCKET_INTERVAL_MS = 10;
const WAIT_FOR_SOCKET_MAX_ITERATIONS = 500;

export const incrementResponseIndex = (): number => {
  responseIndex = responseIndex + 1;
  return responseIndex;
};

export const waitForSocket = async (): Promise<Socket | null> => {
  let i = 0;
  while (!socket) {
    await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_SOCKET_INTERVAL_MS));
    i++;
    if (i > WAIT_FOR_SOCKET_MAX_ITERATIONS) {
      return null;
    }
  }
  return socket;
};
