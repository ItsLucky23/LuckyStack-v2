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

//? One-shot waiters: promises that resolve the moment a non-null socket is
//? set. Replacing the original `setInterval` poll (10 ms × 500 iterations)
//? with a subscribe-and-notify pattern eliminates the busy-loop overhead and
//? guarantees sub-tick delivery rather than up-to-10 ms latency.
let waiters: ((s: Socket) => void)[] = [];

//? Absolute deadline for `waitForSocket` — prevents a permanently-dangling
//? promise in environments where the socket is never created (SSR, tests).
const WAIT_FOR_SOCKET_TIMEOUT_MS = 5000;

export const setSocket = (next: Socket | null): void => {
  socket = next;
  //? Resolve all pending waiters the moment a real socket arrives.
  if (next) {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) {
      resolve(next);
    }
  }
};

let responseIndex = 0;

export const incrementResponseIndex = (): number => {
  responseIndex = responseIndex + 1;
  return responseIndex;
};

export const waitForSocket = (): Promise<Socket | null> => {
  if (socket) return Promise.resolve(socket);
  return new Promise<Socket | null>((resolve) => {
    const timer = setTimeout(() => {
      //? Time out: remove our waiter slot and resolve with null so the
      //? caller surfaces a "socket unavailable" path instead of hanging.
      waiters = waiters.filter((w) => w !== onSocket);
      resolve(null);
    }, WAIT_FOR_SOCKET_TIMEOUT_MS);

    const onSocket = (s: Socket): void => {
      clearTimeout(timer);
      resolve(s);
    };

    waiters.push(onSocket);
  });
};
