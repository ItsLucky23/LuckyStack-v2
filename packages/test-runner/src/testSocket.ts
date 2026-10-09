//? Socket.io client plumbing shared by every test-runner surface that speaks the
//? socket transport: `ctx.watchStream` (observer socket), `ctx.callSync` in
//? socket mode, and the sweep layers' socket probe transport. One place owns
//? the handshake auth, the connect wait, the `joinRoom` ack and the `sync`
//? request/response correlation, so the wire contract cannot drift between them.
//?
//? Wire contract (sourced from `@luckystack/sync` `syncRequest.ts`, the real
//? client): emit `sync` with `{ name, data, cb, receiver, responseIndex,
//? ignoreSelf }`; the server answers once on `sync-<responseIndex>`.

import { io as createSocketIoClient, Socket } from 'socket.io-client';
import {
  buildJoinRoomResponseEventName,
  buildSyncResponseEventName,
  getProjectConfig,
  socketEventNames,
  tryCatch,
} from '@luckystack/core';

const DEFAULT_CONNECT_TIMEOUT_MS = 3000;
const DEFAULT_JOIN_TIMEOUT_MS = 3000;

//? Monotonic per-process counter. Every request that needs a correlated reply
//? (`joinRoom-<n>`, `sync-<n>`) takes a fresh index so concurrent sockets and
//? sibling watchers in the same process never share a response event name.
let responseIndexCounter = 0;
export const nextResponseIndex = (): number => {
  responseIndexCounter += 1;
  return responseIndexCounter;
};

export interface ConnectTestSocketInput {
  baseUrl: string;
  /** Session token, or null for an anonymous socket. */
  token: string | null;
  /** Prefix for error messages (e.g. `watchStream`, `callSync`). */
  label: string;
  /** Session cookie name. Defaults to the project's configured cookie. */
  sessionCookieName?: string;
  connectTimeoutMs?: number;
}

const waitForConnect = (socket: Socket, label: string, timeoutMs: number): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label}: socket failed to connect within ${timeoutMs}ms`));
    }, timeoutMs);
    const onConnect = (): void => {
      cleanup();
      resolve();
    };
    const onConnectError = (err: Error): void => {
      cleanup();
      reject(new Error(`${label}: connect_error — ${err.message}`));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
    };
    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
  });
};

/**
 * Open a socket.io connection authenticated the way a browser would be, and
 * wait until it is connected. On a connect timeout / connect_error the socket
 * is torn down before the error is thrown, so a failed attempt never leaks.
 */
export const connectTestSocket = async (input: ConnectTestSocketInput): Promise<Socket> => {
  //? Authenticate in BOTH token modes. `auth.token` is the sessionBasedToken
  //? path; in the DEFAULT cookie mode the server reads the token ONLY from the
  //? session cookie (extractTokenFromSocket ignores handshake.auth.token unless
  //? `acceptBearerInCookieMode`), so without the Cookie header the socket would
  //? connect anonymously. In Node, socket.io-client honours `extraHeaders` on the
  //? websocket handshake, so the cookie is set there.
  const sessionCookieName = input.sessionCookieName ?? getProjectConfig().http.sessionCookieName;
  const socket: Socket = createSocketIoClient(input.baseUrl, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: input.token ? { token: input.token } : undefined,
    extraHeaders: input.token ? { Cookie: `${sessionCookieName}=${input.token}` } : undefined,
  });

  const [connectError] = await tryCatch(
    () => waitForConnect(socket, input.label, input.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS),
  );
  if (connectError) {
    socket.disconnect();
    throw connectError;
  }
  return socket;
};

const RELEASE_TIMEOUT_MS = 1000;

/**
 * Close a socket that runs on a session the runner does NOT own (the sweep's
 * `authToken`) without ending that session.
 *
 * With `@luckystack/presence` installed, a token whose last socket closes is
 * logged out once the short disconnect grace window expires — a closed browser
 * tab ends the session. A plain `disconnect()` therefore deleted the caller's
 * session seconds after every sweep. Sending `intentionalDisconnect` first is
 * the signal a real client sends on a tab switch: presence keeps the session
 * and the server closes the socket itself. Without presence nobody listens,
 * so the socket is closed locally after a short wait.
 */
export const releaseTestSocket = async (socket: Socket): Promise<void> => {
  if (!socket.connected) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      socket.off('disconnect', onDisconnect);
      resolve();
    }, RELEASE_TIMEOUT_MS);
    const onDisconnect = (): void => {
      clearTimeout(timer);
      resolve();
    };
    socket.once('disconnect', onDisconnect);
    socket.emit(socketEventNames.intentionalDisconnect);
  });
  socket.disconnect();
};

/**
 * Join `room` and wait for the server's ack. Rejects when the server refuses
 * the join (e.g. `auth.required` for an anonymous socket) or never answers.
 */
export const joinTestRoom = (
  socket: Socket,
  room: string,
  options: { label: string; timeoutMs?: number },
): Promise<void> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_JOIN_TIMEOUT_MS;
  const responseIndex = nextResponseIndex();
  const eventName = buildJoinRoomResponseEventName(responseIndex);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onAck);
      reject(new Error(`${options.label}: joinRoom ack timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    const onAck = (payload: unknown): void => {
      clearTimeout(timer);
      socket.off(eventName, onAck);
      if (typeof payload === 'object' && payload !== null && (payload as { status?: unknown }).status === 'error') {
        const errorCode = (payload as { errorCode?: unknown }).errorCode;
        reject(new Error(`${options.label}: joinRoom rejected — ${typeof errorCode === 'string' ? errorCode : 'unknown'}`));
        return;
      }
      resolve();
    };
    socket.on(eventName, onAck);
    socket.emit(socketEventNames.joinRoom, { group: room, responseIndex });
  });
};

export interface EmitSyncInput {
  /** `<page>/<name>/<version>` — the route path without the `sync/` prefix. */
  routePath: string;
  data: unknown;
  receiver: string | undefined;
  ignoreSelf?: boolean;
  timeoutMs: number;
}

export type EmitSyncOutcome =
  | { kind: 'response'; payload: unknown }
  | { kind: 'timeout' };

/**
 * Send one sync request over `socket` exactly like the real client does and
 * resolve with the server's single reply on `sync-<responseIndex>`.
 */
export const emitSyncOverSocket = (socket: Socket, input: EmitSyncInput): Promise<EmitSyncOutcome> => {
  const responseIndex = nextResponseIndex();
  const eventName = buildSyncResponseEventName(responseIndex);
  return new Promise<EmitSyncOutcome>((resolve) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onResponse);
      resolve({ kind: 'timeout' });
    }, input.timeoutMs);
    const onResponse = (payload: unknown): void => {
      clearTimeout(timer);
      socket.off(eventName, onResponse);
      resolve({ kind: 'response', payload });
    };
    socket.on(eventName, onResponse);
    socket.emit(socketEventNames.sync, {
      name: `sync/${input.routePath}`,
      //? Only `undefined` defaults — a fuzz probe's `null` must reach the server as-is.
      data: input.data === undefined ? {} : input.data,
      //? Same fallback cancel key the real client sends before the server's
      //? `__cancelId` handshake arrives; the runner never cancels, so it is
      //? only there to keep the request shape identical.
      cb: input.routePath,
      receiver: input.receiver,
      responseIndex,
      ignoreSelf: input.ignoreSelf ?? false,
    });
  });
};
