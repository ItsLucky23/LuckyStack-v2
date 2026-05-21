//? Socket.io middleware registry. Lets consumers wedge their own
//? `io.use(...)` middlewares into the framework's socket bootstrap without
//? forking `loadSocket.ts`. Registration order is preservation order —
//? `applySocketMiddlewares(io)` calls each middleware in the order it was
//? registered, which is the same contract Socket.io's native `io.use(...)`
//? chain provides.
//?
//? Use cases: per-connection auth gates (JWT verification beyond the
//? framework's session cookie), rate-limit shedding before handlers run,
//? observability tags (Datadog span context, OpenTelemetry context),
//? license-key checks, allow-list IP filters.

import type { Socket, Server as SocketIOServer } from 'socket.io';

export type SocketMiddleware = (socket: Socket, next: (err?: Error) => void) => void;

const middlewares: SocketMiddleware[] = [];

/**
 * Register a Socket.io middleware that will be wired via `io.use(...)` when
 * the framework boots the socket server. Multiple middlewares can be
 * registered — they run in registration order before any `connect`
 * handler fires.
 */
export const registerSocketMiddleware = (mw: SocketMiddleware): void => {
  middlewares.push(mw);
};

/** Read the registered middleware list (read-only view). */
export const getSocketMiddlewares = (): readonly SocketMiddleware[] => middlewares;

/** Test-only / hot-reload helper. Drops every registered middleware. */
export const clearSocketMiddlewares = (): void => {
  middlewares.length = 0;
};

/**
 * Wire every registered middleware into the running Socket.io server.
 * Called by `@luckystack/server`'s `loadSocket` after the `SocketIOServer`
 * is constructed and before any `connect` handler is attached, so custom
 * middlewares run before framework handlers see the socket.
 */
export const applySocketMiddlewares = (io: SocketIOServer): void => {
  for (const mw of middlewares) {
    io.use(mw);
  }
};
