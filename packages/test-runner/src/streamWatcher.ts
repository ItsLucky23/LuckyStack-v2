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

import { socketEventNames, tryCatch } from '@luckystack/core';

import { connectTestSocket, joinTestRoom } from './testSocket';

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
const LABEL = 'watchStream';

const isStreamChunkFrame = (value: unknown): value is StreamChunkFrame =>
  typeof value === 'object' && value !== null;

export const openStreamWatcher = async <TChunk extends StreamChunkFrame = StreamChunkFrame>(
  input: OpenStreamWatcherInput,
): Promise<StreamWatcher<TChunk>> => {
  const defaultTimeoutMs = input.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const chunks: TChunk[] = [];
  const waiters: { predicate: (chunks: TChunk[]) => boolean; resolve: () => void }[] = [];

  //? `connectTestSocket` tears the socket down itself when the connect fails,
  //? so a failed attempt never leaks a socket the caller cannot close.
  const socket = await connectTestSocket({ baseUrl: input.baseUrl, token: input.token, label: LABEL });

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

  //? A rejected / unanswered join must tear the socket (and its `sync`
  //? listener) down — the caller only tracks the watcher after this resolves.
  const [joinError] = await tryCatch(() => joinTestRoom(socket, input.roomCode, { label: LABEL }));
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
