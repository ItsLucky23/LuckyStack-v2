/* eslint-disable */
//? Playground: streams progress updates to the ORIGINATOR ONLY (not the
//? room) via the cheap unicast `stream(...)` helper. Use this when you
//? want to confirm originator-only streaming is intact and isolated from
//? broadcastStream's room-wide path.

import { AuthProps, SessionLayout } from '../../../config';
import {
  Functions,
  SyncServerResponse,
  SyncServerStreamEmitter,
  SyncBroadcastStreamEmitter,
  SyncStreamToEmitter,
} from '../../_sockets/apiTypes.generated';
import { sleep } from '@luckystack/core';

export const auth: AuthProps = {
  login: false,
};

export interface SyncParams {
  clientInput: {
    /** Number of progress ticks to emit. Default 10, max 50. */
    steps?: number;
    /** ms between ticks. Default 150, min 30, max 2000. */
    intervalMs?: number;
  };
  user: SessionLayout | null;
  functions: Functions;
  roomCode: string;
  stream: SyncServerStreamEmitter;
  broadcastStream: SyncBroadcastStreamEmitter;
  streamTo: SyncStreamToEmitter;
}

export const main = async ({ clientInput, stream, user }: SyncParams): Promise<SyncServerResponse> => {
  const steps = Math.max(1, Math.min(50, clientInput.steps ?? 10));
  const intervalMs = Math.max(30, Math.min(2000, clientInput.intervalMs ?? 150));

  for (let i = 1; i <= steps; i++) {
    stream({
      step: i,
      total: steps,
      progress: Math.round((i / steps) * 100),
      phase: i === steps ? 'done' : 'working',
    });
    if (i < steps) await sleep(intervalMs);
  }

  return {
    status: 'success',
    senderId: user?.id ?? 'anonymous',
    completedSteps: steps,
  };
};
