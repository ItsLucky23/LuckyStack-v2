import type { Socket } from 'socket.io';
import {
  buildApiStreamEventName,
  getLogger,
  registerApiAbortController,
  unregisterApiAbortController,
  socketEventNames,
} from '@luckystack/core';
import type { ApiStreamPayload, ApiFlushPressure } from './apiTypes';
import { shouldLogStream } from './logFlags';
import { createApiFlushPressure } from './backpressure';

//? Per-request lifecycle bundle for the SOCKET API transport. Extracted from
//? `handleApiRequest` per the `api` package audit (god-function decomposition).
//? Keeps the abortController / cleanup / emitStream / flushPressure closures
//? together and intact — the orchestrator wires them once and threads the
//? returned handles through the pipeline. Behaviour is identical to the former
//? inline closures:
//?   • B1 — per-request AbortController. Aborts on `apiCancel { responseIndex }`
//?     from the originator OR socket disconnect. `cleanupRequest()` runs in
//?     every exit path (errors, validation rejects, completion) to remove the
//?     disconnect listener and drop the cancel-registry entry. The signal is
//?     also handed to `emitStream` so chunks queued after an abort never hit
//?     the wire.
//?   • B2 — backpressure helper bound to the originator socket.

export interface ApiRequestLifecycle {
  abortController: AbortController;
  abortSignal: AbortSignal;
  emitStream: (payload?: ApiStreamPayload) => void;
  flushPressure: ApiFlushPressure;
  cleanupRequest: () => void;
}

export const createApiRequestLifecycle = ({ socket, responseIndex, resolvedName }: {
  socket: Socket;
  responseIndex: number;
  resolvedName: string;
}): ApiRequestLifecycle => {
  const abortController = new AbortController();
  const abortKey = registerApiAbortController(socket.id, responseIndex, abortController);
  const onSocketDisconnect = () => { abortController.abort(); };
  socket.once(socketEventNames.disconnect, onSocketDisconnect);

  let cleanupDone = false;
  const cleanupRequest = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    socket.off(socketEventNames.disconnect, onSocketDisconnect);
    unregisterApiAbortController(abortKey);
  };

  const emitStream = (payload: ApiStreamPayload = {}) => {
    if (abortController.signal.aborted) {
      if (shouldLogStream()) {
        getLogger().debug(`api: ${resolvedName} stream skipped — request aborted`);
      }
      return;
    }
    if (shouldLogStream()) {
      getLogger().debug(`api: ${resolvedName} stream`, { payload });
    }
    socket.emit(buildApiStreamEventName(responseIndex), payload);
  };

  //? B2 — backpressure helper for API handlers. Same shape as the sync variant
  //? but always scoped to a single originator socket. Polls the engine.io
  //? writeBuffer length every 10ms until the buffer drains below threshold
  //? (default 1 MB ≈ 1024 packets at ~1KB each).
  const flushPressure = createApiFlushPressure(socket, abortController.signal);

  return { abortController, abortSignal: abortController.signal, emitStream, flushPressure, cleanupRequest };
};
