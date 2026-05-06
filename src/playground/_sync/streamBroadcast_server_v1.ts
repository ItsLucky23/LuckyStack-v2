/* eslint-disable */
//? Playground: streams fake "AI tokens" to EVERYONE in the receiver room
//? via `broadcastStream`. Use this from two browsers joined to the same
//? room to confirm live cross-tab streaming works exactly like the AI
//? chatbot scenario described in `docs/ARCHITECTURE_SYNC.md` §Streaming.
//?
//? Also demonstrates `createStreamThrottle` — toggle the throttle option
//? from the playground UI to see batching kick in.
//?
//? IMPORTANT for the throttle demo: the simulated source must be FASTER
//? than the throttle's flush window for batching to be visible. With
//? `flushEveryMs: 50` and an `intervalMs` of e.g. 60, the timer always
//? fires before the next push and you see one chunk per token (the
//? throttle works correctly, it just has nothing to coalesce). The
//? default `intervalMs` here is 20ms, faster than the flush window, so
//? 2-3 tokens batch per emit when the throttle is on.

import { AuthProps, SessionLayout } from '../../../config';
import {
  Functions,
  SyncServerResponse,
  SyncServerStreamEmitter,
  SyncBroadcastStreamEmitter,
  SyncStreamToEmitter,
} from '../../_sockets/apiTypes.generated';
import { sleep } from '@luckystack/core';
import { createStreamThrottle } from '@luckystack/sync';

export const auth: AuthProps = {
  login: false,
};

export interface SyncParams {
  clientInput: {
    /** Pretend "AI" message to stream out token-by-token. */
    text: string;
    /**
     * ms between simulated tokens. Default 20 (faster than the throttle's
     * 50ms flush window so batching is visible). Real LLM streams sit at
     * 10-30ms. Min 5, max 1000.
     */
    intervalMs?: number;
    /** Coalesce small pieces with createStreamThrottle. */
    throttle?: boolean;
  };
  user: SessionLayout | null;
  functions: Functions;
  roomCode: string;
  stream: SyncServerStreamEmitter;
  broadcastStream: SyncBroadcastStreamEmitter;
  streamTo: SyncStreamToEmitter;
}

//? Simulates LLM tokenization. Real providers emit pieces of 3-10 chars
//? (not whole words). Splitting at fixed lengths with whitespace breaks
//? gives a "chopped tokens" feel and produces the high-frequency stream
//? the throttle is designed for.
const tokenize = (text: string, maxChars = 4): string[] => {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i]!)) {
      //? Whitespace run as its own piece — preserves natural cadence.
      let j = i;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      out.push(text.slice(i, j));
      i = j;
      continue;
    }
    //? Up to `maxChars` non-whitespace at a time, snapping to the next
    //? whitespace boundary if one falls inside the window.
    const end = Math.min(i + maxChars, text.length);
    let cut = end;
    for (let k = i + 1; k < end; k++) {
      if (/\s/.test(text[k]!)) { cut = k; break; }
    }
    out.push(text.slice(i, cut));
    i = cut;
  }
  return out;
};

export const main = async ({ clientInput, broadcastStream, user }: SyncParams): Promise<SyncServerResponse> => {
  const intervalMs = Math.max(5, Math.min(1000, clientInput.intervalMs ?? 20));
  const text = clientInput.text || 'Hello from the playground broadcast stream.';
  const tokens = tokenize(text);

  const throttle = clientInput.throttle
    ? createStreamThrottle({ flushEveryMs: 50, flushAtChars: 16 })
    : null;

  let sent = 0;
  for (const token of tokens) {
    if (throttle) {
      throttle.push(token, broadcastStream);
    } else {
      broadcastStream({ chunk: token });
    }
    sent++;
    await sleep(intervalMs);
  }
  if (throttle) throttle.flush(broadcastStream);

  return {
    status: 'success',
    message: text,
    senderId: user?.id ?? 'anonymous',
    tokenCount: sent,
    throttled: Boolean(clientInput.throttle),
  };
};
