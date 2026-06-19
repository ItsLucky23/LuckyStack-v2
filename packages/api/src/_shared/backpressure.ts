import type { Socket } from 'socket.io';
import { getLogger } from '@luckystack/core';
import type { ApiFlushPressure, ApiFlushPressureOptions } from './apiTypes';
import { shouldLogDev } from './logFlags';

//? B2 — backpressure helper factory for the SOCKET API transport. Same shape
//? as the sync variant; resolves once the originator socket's pending write
//? buffer drops below the threshold. Default 1 MB (≈1024 packets at ~1KB each).
//? Extracted from `handleApiRequest` per the `api` package audit (solid-isp).

interface EngineIoConnLike {
  writeBuffer?: { length: number };
  transport?: { writable?: boolean };
}

export const createApiFlushPressure = (socket: Socket, abortSignal: AbortSignal): ApiFlushPressure => {
  return async ({ thresholdBytes }: ApiFlushPressureOptions = {}): Promise<void> => {
    const effectiveThresholdBytes = typeof thresholdBytes === 'number' && thresholdBytes > 0
      ? thresholdBytes
      : 1_048_576;
    const packetThreshold = Math.max(1, Math.ceil(effectiveThresholdBytes / 1024));
    //? Polls until the originator's socket write-buffer drains below the packet
    //? threshold, or the request aborts (loop condition), or the transport goes
    //? unwritable. Same exit conditions as the inline socket-handler original.
    while (!abortSignal.aborted) {
      //? Reading engine.io internals (writeBuffer / transport.writable) is the
      //? only way to measure socket backpressure; the cast is the documented
      //? boundary to those untyped internals. Moved verbatim from the socket
      //? handler — same access pattern, no behavioral change.
      // luckystack-allow no-as-unknown: engine.io internal — `conn` is not typed on Socket; this is the documented access pattern
      // eslint-disable-next-line no-restricted-syntax -- engine.io internals boundary
      const conn = (socket as unknown as { conn?: EngineIoConnLike }).conn;
      //? API-O15 — if engine.io renames `conn` this silently becomes a no-op
      //? (buffer always 0, writable always true). Warn in dev so a rename is
      //? caught before backpressure is broken in production.
      if (shouldLogDev() && !conn) {
        getLogger().warn('api: socket.conn absent — engine.io internal may have been renamed; backpressure is a no-op');
      }
      const packets = conn?.writeBuffer?.length ?? 0;
      const writable = conn?.transport?.writable ?? true;
      if (!writable) return;
      if (packets < packetThreshold) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  };
};

//? HTTP/SSE has no socket write-buffer to measure — `flushPressure` is a no-op
//? on that transport. Shared at module scope so per-request allocation stays
//? cheap and the handler param shape stays consistent across transports.
export const httpApiFlushPressureNoop: ApiFlushPressure = async () => {
  /* SSE backpressure is the caller's responsibility (res.write returns bool) */
};
