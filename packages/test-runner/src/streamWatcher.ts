//? Second-socket harness for Layer 5 custom tests. Opens a separate
//? socket.io-client connection (socket B), joins the receiver room as a
//? pure subscriber, and exposes the broadcast/streamTo chunk stream for
//? assertions. Without this, `ctx.callSync` only surfaces the final
//? envelope — chunks (LLM tokens, progress ticks) emitted via
//? `broadcastStream` / `streamTo` flow on the `sync` event channel to
//? room members other than the request originator's socket.
//?
//? Spec: see `docs/contract-tests.md` §watchStream and CLAUDE Rule 21
//? (no `as unknown as X` / `as any` — typed generics throughout).
//?
//? Wire shape, sourced from `@luckystack/sync` `_shared/streamEmitters.ts`:
//?   io.to(receiver).emit('sync', { ...payload, cb, fullName, status: 'stream' })
//? where `fullName` = `sync/<page>/<name>/<version>`. We filter incoming
//? frames by that `fullName` so a watcher only sees chunks for the route
//? its test file lives next to.

import { io as createSocketIoClient, Socket } from 'socket.io-client';
import {
  buildJoinRoomResponseEventName,
  socketEventNames,
  tryCatch,
  getProjectConfig,
} from '@luckystack/core';

export interface StreamChunkFrame {
  /** Per-request correlation id stamped by the server. */
  cb?: string;
  /** Full route name (`sync/<page>/<name>/<version>`). */
  fullName?: string;
  /** Always `'stream'` for chunk frames. */
  status?: 'stream';
  /** Payload fields spread on top of the envelope. */
  [key: string]: unknown;
}

export interface StreamWatcher<TChunk extends StreamChunkFrame = StreamChunkFrame> {
  /** Chunks received so far. Array reference is stable; entries are pushed in arrival order. */
  readonly chunks: TChunk[];
  /** Wait until `predicate(chunks)` returns true, or until timeout (default 5000ms). */
  stopAt(predicate: (chunks: TChunk[]) => boolean, timeoutMs?: number): Promise<void>;
  /** Wait until N total chunks received, or until timeout. */
  waitForCount(n: number, timeoutMs?: number): Promise<void>;
  /** Close socket B. Tests SHOULD call this in cleanup; ctx auto-closes all watchers when the test ends. */
  close(): Promise<void>;
}

export interface OpenStreamWatcherInput {
  /** Server URL (same as `ctx`'s `baseUrl`). */
  baseUrl: string;
  /** Room to join as a pure subscriber. */
  roomCode: string;
  /** Active session token (used for `joinRoom` auth). May be null for routes that don't require auth. */
  token: string | null;
  /**
   * Resolved route name `sync/<page>/<name>/<version>` — chunk frames are
   * filtered by their `fullName` property so a watcher only surfaces chunks
   * for the route its test is bound to.
   */
  routeFullName: string;
  /** Default 5000ms — overridable per `stopAt` / `waitForCount` call. */
  defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const JOIN_RESPONSE_TIMEOUT_MS = 3000;
const CONNECT_TIMEOUT_MS = 3000;

interface JoinRoomResponse {
  status?: string;
  errorCode?: string;
}

const isJoinRoomResponse = (value: unknown): value is JoinRoomResponse =>
  typeof value === 'object' && value !== null;

const isStreamChunkFrame = (value: unknown): value is StreamChunkFrame =>
  typeof value === 'object' && value !== null;

//? Monotonic counter — each watcher uses a fresh responseIndex so the
//? `buildJoinRoomResponseEventName(...)` listener doesn't collide with a
//? sibling watcher on the same process.
let responseIndexCounter = 0;
const nextResponseIndex = (): number => {
  responseIndexCounter += 1;
  return responseIndexCounter;
};

const waitForConnect = (socket: Socket): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`watchStream: socket failed to connect within ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);
    const onConnect = (): void => {
      cleanup();
      resolve();
    };
    const onConnectError = (err: Error): void => {
      cleanup();
      reject(new Error(`watchStream: connect_error — ${err.message}`));
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

const waitForJoinAck = (socket: Socket, responseIndex: number): Promise<void> => {
  const eventName = buildJoinRoomResponseEventName(responseIndex);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onAck);
      reject(new Error(`watchStream: joinRoom ack timeout after ${JOIN_RESPONSE_TIMEOUT_MS}ms`));
    }, JOIN_RESPONSE_TIMEOUT_MS);
    const onAck = (payload: unknown): void => {
      clearTimeout(timer);
      socket.off(eventName, onAck);
      if (isJoinRoomResponse(payload) && payload.status === 'error') {
        reject(new Error(`watchStream: joinRoom rejected — ${payload.errorCode ?? 'unknown'}`));
        return;
      }
      resolve();
    };
    socket.on(eventName, onAck);
  });
};

export const openStreamWatcher = async <TChunk extends StreamChunkFrame = StreamChunkFrame>(
  input: OpenStreamWatcherInput,
): Promise<StreamWatcher<TChunk>> => {
  const defaultTimeoutMs = input.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const chunks: TChunk[] = [];
  const waiters: { predicate: (chunks: TChunk[]) => boolean; resolve: () => void }[] = [];

  //? Authenticate the observer socket in BOTH token modes. `auth.token` is the
  //? sessionBasedToken (sessionStorage) path; in the DEFAULT cookie mode the
  //? server reads the token ONLY from the session cookie (extractTokenFromSocket
  //? ignores handshake.auth.token unless `acceptBearerInCookieMode`), so without
  //? the Cookie header the observer socket connects anonymously and every
  //? `joinRoom` is rejected with `auth.required`. In Node, socket.io-client honours
  //? `extraHeaders` on the websocket handshake, so we set the cookie there.
  const sessionCookieName = getProjectConfig().http.sessionCookieName;
  const socket: Socket = createSocketIoClient(input.baseUrl, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: input.token ? { token: input.token } : undefined,
    extraHeaders: input.token ? { Cookie: `${sessionCookieName}=${input.token}` } : undefined,
  });

  const handleChunk = (raw: unknown): void => {
    if (!isStreamChunkFrame(raw)) return;
    if (raw.status !== 'stream') return;
    if (raw.fullName !== input.routeFullName) return;
    //? Server emits chunk frames typed as `StreamChunkFrame` — caller's
    //? `TChunk` narrows the payload shape (e.g. `{ chunk: string }` for
    //? `streamBroadcast`). The runtime guards above confirm the wire shape;
    //? narrowing the static type is the test author's responsibility.
    const chunk = raw as TChunk;
    chunks.push(chunk);
    //? Drain waiters whose predicates are now satisfied. Iterate in reverse
    //? so we can splice without breaking indices.
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i];
      if (!waiter) continue;
      if (waiter.predicate(chunks)) {
        waiters.splice(i, 1);
        waiter.resolve();
      }
    }
  };

  socket.on(socketEventNames.sync, handleChunk);

  //? On a connect timeout / connect_error the socket (and its `sync` listener)
  //? must be torn down — otherwise every failed attempt leaks one socket that
  //? is never auto-closed (the caller only tracks the watcher after this
  //? resolves). Mirror the join-ack cleanup path below.
  const [connectError] = await tryCatch(() => waitForConnect(socket));
  if (connectError) {
    socket.off(socketEventNames.sync, handleChunk);
    socket.disconnect();
    throw connectError;
  }

  const responseIndex = nextResponseIndex();
  socket.emit(socketEventNames.joinRoom, {
    group: input.roomCode,
    responseIndex,
  });
  const [joinError] = await tryCatch(() => waitForJoinAck(socket, responseIndex));
  if (joinError) {
    socket.off(socketEventNames.sync, handleChunk);
    socket.disconnect();
    throw joinError;
  }

  let closed = false;
  const close = (): Promise<void> => {
    if (closed) return Promise.resolve();
    closed = true;
    socket.off(socketEventNames.sync, handleChunk);
    //? Drain any outstanding waiters so callers don't hang past test end.
    for (const waiter of waiters) waiter.resolve();
    waiters.length = 0;
    socket.disconnect();
    return Promise.resolve();
  };

  const stopAt = (
    predicate: (chunks: TChunk[]) => boolean,
    timeoutMs: number = defaultTimeoutMs,
  ): Promise<void> => {
    if (predicate(chunks)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const waiter = {
        predicate,
        resolve: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = waiters.indexOf(waiter);
        if (idx !== -1) waiters.splice(idx, 1);
        reject(new Error(
          `watchStream.stopAt: predicate not satisfied within ${timeoutMs}ms (received ${chunks.length} chunks)`,
        ));
      }, timeoutMs);
      waiters.push(waiter);
    });
  };

  const waitForCount = (n: number, timeoutMs: number = defaultTimeoutMs): Promise<void> => {
    return stopAt((current) => current.length >= n, timeoutMs);
  };

  return {
    chunks,
    stopAt,
    waitForCount,
    close,
  };
};
