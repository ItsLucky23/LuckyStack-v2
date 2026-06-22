import {
  dispatchHook,
  getIoInstance,
  getLogger,
  getProjectConfig,
  socketEventNames,
} from '@luckystack/core';
import type { Socket } from 'socket.io';
import { shouldLogStream } from './logFlags';
import { redactTokens } from './redactToken';

//? Chunk-index counters are intentionally per-request (built inside
//? `buildSyncStreamEmitters`) so they are garbage-collected with the
//? closure when the request ends. A module-level Map keyed on
//? `routeName|recipient` would grow unbounded for the process lifetime
//? because `bumpChunkIndex` only ever `set`s — there is no teardown
//? hook that reliably fires per room. (SYNC-N4)

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
   * When omitted, falls back to `projectConfig.sync.flushPressure.maxBufferedBytes`
   * (default 5 MiB as configured in the framework defaults).
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

//? SYNC-O13 / SYNC-O5 — LOCAL-ONLY. Uses `io.sockets.adapter.rooms` which
//? is the per-process room view. In a multi-instance cluster (Redis adapter)
//? members connected to OTHER instances are not visible here, so `flushPressure`
//? only drains the LOCAL subset (up to MAX_SOCKETS_FOR_PRESSURE_SAMPLE sockets).
//? Cross-instance backpressure cannot be measured via this API; callers should
//? treat a resolved `flushPressure()` as "local buffer cleared" not "all
//? recipients drained". For `streamTo` use cases the sampled room is the
//? ORIGINAL `receiver`, not the token-named rooms; the caller's own socket
//? (originatorSocket) is the primary pressure signal in that case.
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
  //? Per-request chunk counters keyed by recipient. Scoped to this closure
  //? so they are released when the request ends — no process-lifetime leak.
  const chunkCounters = new Map<string, number>();
  const bumpChunkIndex = (recipient: string): number => {
    const next = (chunkCounters.get(recipient) ?? 0) + 1;
    chunkCounters.set(recipient, next);
    return next;
  };
  const dispatchStreamHooks = (recipient: string, chunk: unknown): void => {
    //? Fire-and-forget — stream emitters are sync and consumer hooks must
    //? not block chunk delivery. Errors inside hooks are swallowed by the
    //? hook dispatcher's own tryCatch.
    void dispatchHook('preSyncStream', { routeName: resolvedName, chunk, recipient });
    const chunkIndex = bumpChunkIndex(recipient);
    void dispatchHook('postSyncStream', { routeName: resolvedName, chunk, recipient, chunkIndex });
  };

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
    dispatchStreamHooks('originator', payload);
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

    dispatchStreamHooks(receiver, payload);

    //? `io.to(room).emit` fans the chunk out across EVERY server instance via
    //? the Redis adapter, so room members connected to a different instance get
    //? it too. Do NOT gate on `adapter.rooms.get(receiver)` — that is the
    //? per-process room view; in a multi-instance cluster it only sees locally
    //? connected members, so the previous "size <= 1 ⇒ unicast to the lone
    //? socket" optimization mis-fired whenever the other room members lived on
    //? another instance and collapsed broadcastStream into an originator-only
    //? stream. `streamTo` always used `io.to(...).emit` and never had this bug;
    //? this aligns broadcastStream with it.
    io.to(receiver).emit(socketEventNames.sync, buildBroadcastFrame(payload));
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
      //? Redact the raw bearer session tokens before they reach the stream
      //? debug log — a verbatim token in logs is a usable credential. The
      //? 8-char prefix still correlates log lines.
      getLogger().debug(`${logLabel}: ${resolvedName} streamTo`, { tokens: redactTokens(filtered), payload });
    }
    const io = getIoInstance();
    if (!io) return;
    //? SYNC-N8 — hooks fire before `io.to(tokens).emit()` which is a cross-instance
    //? Redis broadcast; there is no local way to know whether any socket actually
    //? received the frame (the remote instance may have the token-holder). Hooks
    //? are therefore fire-and-forget observers, not delivery confirmations.
    for (const recipient of filtered) {
      dispatchStreamHooks(recipient, payload);
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
    //? SYNC-N1 — honour `sync.flushPressure.maxBufferedBytes` from projectConfig
    //? as the fallback so consumer tuning is not silently ignored. Caller-supplied
    //? `thresholdBytes` still wins; the hard-coded DEFAULT_THRESHOLD_BYTES is the
    //? last resort when config is not yet registered (early-boot / test context).
    const configuredBytes = getProjectConfig().sync.flushPressure.maxBufferedBytes;
    const effectiveThresholdBytes = typeof thresholdBytes === 'number' && thresholdBytes > 0
      ? thresholdBytes
      : (typeof configuredBytes === 'number' && configuredBytes > 0 ? configuredBytes : DEFAULT_THRESHOLD_BYTES);
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
