import {
  dispatchHook,
  getIoInstance,
  getLogger,
  getProjectConfig,
  socketEventNames,
} from '@luckystack/core';
import type { Socket } from 'socket.io';

//? Counter of chunks per (routeName, recipient) pair so postSyncStream
//? consumers can index streams. Cleared on receiver-room teardown.
const chunkCounters = new Map<string, number>();
const counterKey = (routeName: string, recipient: string): string => `${routeName}|${recipient}`;
const bumpChunkIndex = (routeName: string, recipient: string): number => {
  const key = counterKey(routeName, recipient);
  const next = (chunkCounters.get(key) ?? 0) + 1;
  chunkCounters.set(key, next);
  return next;
};
const dispatchStreamHooks = (routeName: string, recipient: string, chunk: unknown): void => {
  //? Fire-and-forget — stream emitters are sync and consumer hooks must
  //? not block chunk delivery. Errors inside hooks are swallowed by the
  //? hook dispatcher's own tryCatch.
  void dispatchHook('preSyncStream', { routeName, chunk, recipient });
  const chunkIndex = bumpChunkIndex(routeName, recipient);
  void dispatchHook('postSyncStream', { routeName, chunk, recipient, chunkIndex });
};

export type SyncStreamPayload = Record<string, unknown>;

//? Optional helper passed to consumer handlers so an LLM/long stream can
//? `await flushPressure()` between chunks. Resolves once the underlying
//? Socket.io transport's pending write buffer drops below `thresholdBytes`
//? (measured in packets, not bytes — engine.io exposes a writeBuffer of
//? packet objects, not byte length, so we approximate via packet count).
//? Default threshold = 1 MB ≈ 1024 packets at ~1KB each. Handlers opt in;
//? omitting the call is fine for handlers that don't stream a lot.
export interface FlushPressureOptions {
  /**
   * Drain threshold in bytes. Used as a packet-count approximation —
   * we assume an average packet size of ~1024 bytes and resolve once the
   * engine.io writeBuffer length is below `thresholdBytes / 1024`.
   * Default: 1_048_576 (1 MB).
   */
  thresholdBytes?: number;
}

export type FlushPressure = (options?: FlushPressureOptions) => Promise<void>;

export interface SyncStreamEmitters {
  emitServerSyncStream: (payload?: SyncStreamPayload) => void;
  emitBroadcastSyncStream: (payload?: SyncStreamPayload) => void;
  emitStreamToTokens: (tokens: string | string[], payload?: SyncStreamPayload) => void;
  buildBroadcastFrame: (payload: SyncStreamPayload) => Record<string, unknown>;
  flushPressure: FlushPressure;
}

const shouldLogStream = () => getProjectConfig().logging.stream;

//? Default 1 MB threshold (per spec B2). Packet count = bytes / avg-packet-size.
const DEFAULT_THRESHOLD_BYTES = 1_048_576;
const AVG_PACKET_BYTES = 1024;
const POLL_INTERVAL_MS = 10;
//? Cap sockets considered for worst-case pressure so a `receiver: 'all'`
//? broadcast doesn't degrade to O(n). First 32 — see spec B2.
const MAX_SOCKETS_FOR_PRESSURE_SAMPLE = 32;

//? Read the engine.io write-buffer length defensively — the underlying
//? `socket.conn` and `transport` are present at runtime but `writeBuffer`
//? is marked private in the engine.io typings. Narrow the shape via a
//? runtime guard (vs `as unknown as` double-cast) to satisfy the
//? boundary-helper lint rule.
interface EngineIoConnLike {
  writeBuffer?: { length: number };
  transport?: { writable?: boolean };
}

const isEngineConnLike = (value: unknown): value is EngineIoConnLike =>
  typeof value === 'object' && value !== null;

const readSocketPressure = (socket: Socket): { packets: number; writable: boolean } => {
  const maybeConn: unknown = (socket as { conn?: unknown }).conn;
  if (!isEngineConnLike(maybeConn)) return { packets: 0, writable: true };
  const packets = maybeConn.writeBuffer?.length ?? 0;
  const writable = maybeConn.transport?.writable ?? true;
  return { packets, writable };
};

//? Poll-based drain — engine.io doesn't surface a per-socket `drain` event
//? in the Socket.io public API. Poll every POLL_INTERVAL_MS until either
//? buffer drops below threshold, transport is no longer writable (in
//? which case waiting is pointless), or `isAborted()` returns true.
const waitUntilSocketDrained = async (
  socket: Socket,
  packetThreshold: number,
  isAborted: () => boolean,
): Promise<void> => {
  let { packets, writable } = readSocketPressure(socket);
  while (writable && packets >= packetThreshold && !isAborted()) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    ({ packets, writable } = readSocketPressure(socket));
  }
};

const collectRoomSocketsForPressure = (receiver: string): Socket[] => {
  const io = getIoInstance();
  if (!io) return [];
  if (!receiver) return [];

  if (receiver === 'all') {
    const out: Socket[] = [];
    let i = 0;
    for (const [, sock] of io.sockets.sockets) {
      if (i >= MAX_SOCKETS_FOR_PRESSURE_SAMPLE) break;
      out.push(sock);
      i++;
    }
    return out;
  }

  const ids = io.sockets.adapter.rooms.get(receiver);
  if (!ids || ids.size === 0) return [];
  const out: Socket[] = [];
  let i = 0;
  for (const id of ids) {
    if (i >= MAX_SOCKETS_FOR_PRESSURE_SAMPLE) break;
    const sock = io.sockets.sockets.get(id);
    if (sock) out.push(sock);
    i++;
  }
  return out;
};

interface BuildSyncStreamEmittersArgs {
  cb: string | undefined;
  receiver: string;
  resolvedName: string;
  emitOriginatorChunk: (payload: SyncStreamPayload) => void;
  logLabel: string;
  /**
   * AbortSignal sourced from the per-request controller in `handleSyncRequest`
   * / `handleHttpSyncRequest`. When aborted (client disconnect, explicit
   * `syncCancel`), every emit is short-circuited with a single dev-log line
   * and `flushPressure()` resolves immediately.
   */
  signal?: AbortSignal;
  /**
   * Originator socket — used to drive `flushPressure` measurement when the
   * stream targets only the originator. Optional because the HTTP/SSE
   * transport has no originator socket (SSE response writer is the sink).
   */
  originatorSocket?: Socket;
}

//? Shared between socket (`handleSyncRequest`) and HTTP/SSE
//? (`handleHttpSyncRequest`) transports. The only divergence is the originator
//? sink: socket transport unicasts a progress event back to the requesting
//? socket; HTTP transport pipes the chunk through the SSE writer. Caller
//? supplies that as `emitOriginatorChunk`. Broadcast/streamTo paths use
//? Socket.io regardless of transport because recipients always live on sockets.
export const buildSyncStreamEmitters = ({
  cb,
  receiver,
  resolvedName,
  emitOriginatorChunk,
  logLabel,
  signal,
  originatorSocket,
}: BuildSyncStreamEmittersArgs): SyncStreamEmitters => {
  const buildBroadcastFrame = (payload: SyncStreamPayload) => ({
    ...payload,
    cb,
    fullName: resolvedName,
    status: 'stream' as const,
  });

  const isAborted = (): boolean => signal?.aborted === true;
  const logAbortedDrop = (kind: string): void => {
    if (shouldLogStream()) {
      getLogger().debug(`${logLabel}: ${resolvedName} ${kind} skipped — request aborted`);
    }
  };

  const emitServerSyncStream = (payload: SyncStreamPayload = {}) => {
    if (isAborted()) { logAbortedDrop('server stream'); return; }
    if (shouldLogStream()) {
      getLogger().debug(`${logLabel}: ${resolvedName} server stream`, { payload });
    }
    dispatchStreamHooks(resolvedName, 'originator', payload);
    emitOriginatorChunk(payload);
  };

  const emitBroadcastSyncStream = (payload: SyncStreamPayload = {}) => {
    if (isAborted()) { logAbortedDrop('broadcastStream'); return; }
    if (shouldLogStream()) {
      getLogger().debug(`${logLabel}: ${resolvedName} broadcastStream`, { payload });
    }
    if (!receiver) return;
    const io = getIoInstance();
    if (!io) return;

    dispatchStreamHooks(resolvedName, receiver, payload);

    const frame = buildBroadcastFrame(payload);
    const roomMembers = io.sockets.adapter.rooms.get(receiver);
    if (!roomMembers || roomMembers.size === 0) return;

    if (roomMembers.size <= 1) {
      const onlyId = roomMembers.values().next().value;
      const onlySocket = onlyId ? io.sockets.sockets.get(onlyId) : undefined;
      if (onlySocket) {
        onlySocket.emit(socketEventNames.sync, frame);
      }
      return;
    }

    io.to(receiver).emit(socketEventNames.sync, frame);
  };

  const emitStreamToTokens = (
    tokens: string | string[],
    payload: SyncStreamPayload = {},
  ) => {
    if (isAborted()) { logAbortedDrop('streamTo'); return; }
    const list = Array.isArray(tokens) ? tokens : [tokens];
    const filtered = list.filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (filtered.length === 0) return;
    if (shouldLogStream()) {
      getLogger().debug(`${logLabel}: ${resolvedName} streamTo`, { tokens: filtered, payload });
    }
    const io = getIoInstance();
    if (!io) return;
    for (const recipient of filtered) {
      dispatchStreamHooks(resolvedName, recipient, payload);
    }
    const frame = buildBroadcastFrame(payload);
    io.to(filtered).emit(socketEventNames.sync, frame);
  };

  //? Backpressure helper. Resolves once the worst-case pending write-buffer
  //? across the affected sockets drops below the configured threshold. Used
  //? opt-in by handlers streaming many small chunks (LLM tokens, telemetry).
  //?
  //? Sockets considered (in order of preference):
  //?   1. Originator socket (if provided)              — covers `stream(payload)`.
  //?   2. Room sockets for `receiver` (up to 32)       — covers `broadcastStream` / `streamTo`.
  //? If neither is available we return immediately — there's nothing to
  //? measure pressure on (e.g. HTTP/SSE only, empty room).
  const flushPressure: FlushPressure = async ({ thresholdBytes } = {}) => {
    if (isAborted()) return;
    const effectiveThresholdBytes = typeof thresholdBytes === 'number' && thresholdBytes > 0
      ? thresholdBytes
      : DEFAULT_THRESHOLD_BYTES;
    const packetThreshold = Math.max(1, Math.ceil(effectiveThresholdBytes / AVG_PACKET_BYTES));

    const targets: Socket[] = [];
    if (originatorSocket) targets.push(originatorSocket);
    for (const sock of collectRoomSocketsForPressure(receiver)) {
      //? Avoid duplicating the originator if it's also in the receiver room.
      if (sock !== originatorSocket) targets.push(sock);
    }
    if (targets.length === 0) return;

    //? Wait on every target in parallel — worst-case latency wins. Abort
    //? mid-wait short-circuits via `isAborted()` check inside the loop body.
    await Promise.all(targets.map((sock) => waitUntilSocketDrained(sock, packetThreshold, isAborted)));
  };

  return {
    emitServerSyncStream,
    emitBroadcastSyncStream,
    emitStreamToTokens,
    buildBroadcastFrame,
    flushPressure,
  };
};
