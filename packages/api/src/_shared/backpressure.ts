import type { Socket } from 'socket.io';
import type { ApiFlushPressure, ApiFlushPressureOptions } from './apiTypes';

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
      // eslint-disable-next-line no-restricted-syntax -- engine.io internals boundary
      const conn = (socket as unknown as { conn?: EngineIoConnLike }).conn;
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
