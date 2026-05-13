/* eslint-disable */
//? Playground: token-targeted streaming. Demonstrates `streamTo(tokens, payload)`
//? — the third streaming primitive alongside `stream` (originator-only) and
//? `broadcastStream` (whole room). Useful for AI chatbot scenarios where you
//? want to deliver chunks to a specific set of recipients instead of the
//? whole room (e.g. only the requester + a moderator).
//?
//? How to test from the playground page:
//?   1. Open this playground in two browser tabs.
//?   2. Tab A: click "Copy socket id". Paste the value somewhere visible.
//?   3. Tab B: paste Tab A's socket id into the "Target token" field, type
//?      a message, click "Sync streamTo".
//?   4. Tab A receives the streamed chunks via its `upsertSyncEventStreamCallback`
//?      subscription. Tab B sees no chunks (Tab B didn't include its own token).
//?      The streamTo primitive bypasses the whole-room fan-out — Tab C joined
//?      to the same room would also see nothing.
//?
//? Socket.io auto-joins every socket into a room named after its own id, so
//? `streamTo([socketId])` works without the recipient being authenticated —
//? the id IS a room. For authenticated apps you can also pass session tokens
//? (every session has the framework auto-join a room named after the token).

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
    /** Comma-separated list of target tokens (or socket ids) to stream to. */
    targetTokens: string;
    /** Text to stream chunk-by-chunk. */
    text?: string;
    /** ms between chunks. Default 80, clamped 20-2000. */
    intervalMs?: number;
  };
  user: SessionLayout | null;
  functions: Functions;
  roomCode: string;
  stream: SyncServerStreamEmitter;
  broadcastStream: SyncBroadcastStreamEmitter;
  streamTo: SyncStreamToEmitter;
}

export const main = async ({ clientInput, streamTo, user }: SyncParams): Promise<SyncServerResponse> => {
  const tokens = clientInput.targetTokens
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return {
      status: 'error',
      errorCode: 'playground.streamTo.missingTargets',
    };
  }

  const intervalMs = Math.max(20, Math.min(2000, clientInput.intervalMs ?? 80));
  const text = clientInput.text || 'Hello — this is a targeted stream.';
  //? Chunk by words so the demo reads naturally; reuses no helpers since
  //? `streamBroadcast`'s tokenizer is split-on-char (faster, less readable
  //? for visual demo purposes).
  const words = text.split(/(\s+)/).filter(Boolean);

  let sent = 0;
  for (const word of words) {
    streamTo(tokens, { chunk: word });
    sent++;
    if (sent < words.length) await sleep(intervalMs);
  }

  return {
    status: 'success',
    message: text,
    senderId: user?.id ?? 'anonymous',
    targetCount: tokens.length,
    chunkCount: sent,
  };
};
