import { getProjectConfig } from '@luckystack/core';

//? Stream-chunk throttle. Coalesces tiny pieces of data (e.g. AI-provider
//? tokens of 3-10 characters each) into bigger chunks before they're sent
//? over the wire, cutting message count by 10-100x with no perceptible
//? latency hit.
//?
//? Two flush triggers:
//?   - `flushAtChars` — buffered length crossed the byte threshold.
//?   - `flushEveryMs` — the throttle's internal timer fired.
//?
//? Whichever happens first flushes the buffer. The author calls `push(text, emit)`
//? in the AI loop and `flush(emit)` once after the loop finishes. The `emit`
//? argument is whichever stream callback the route is using (`stream`,
//? `broadcastStream`, `streamTo` partial, etc.) — the throttle stays
//? agnostic so it works with any of the three primitives.

export interface CreateStreamThrottleOptions {
  /**
   * Flush buffered text once it crosses this many characters. Default: 32.
   * Lower = more updates, more network traffic.
   * Higher = fewer updates, choppier UI.
   */
  flushAtChars?: number;
  /**
   * Flush buffered text after this many milliseconds even if the char
   * threshold hasn't been hit. Default: 50ms — fast enough that the user
   * perceives "live typing", slow enough that 50–100 tokens batch into a
   * single message on a fast LLM stream.
   *
   * Set to `false` to disable the timer (only flush at char threshold or
   * on explicit `flush()`).
   */
  flushEveryMs?: number | false;
  /**
   * Field name on the emitted payload that carries the buffered text.
   * Default: `'chunk'`. Override if your stream payload uses a different
   * key (e.g. `'text'`, `'delta'`).
   */
  field?: string;
}

export interface StreamThrottle {
  /** Append text to the buffer. May trigger a flush. */
  push: (text: string, emit: (payload: Record<string, unknown>) => void) => void;
  /** Force-flush whatever is in the buffer right now. Call after the source loop ends. */
  flush: (emit: (payload: Record<string, unknown>) => void) => void;
  /** Drop the buffered text without emitting. Useful on abort. */
  reset: () => void;
}

/**
 * Build a chunk throttle for streaming use cases. Designed for LLM token
 * streams where the provider yields very small pieces (3–10 chars) and you
 * don't want to send a separate socket message for each one.
 *
 * @example
 *   const throttle = createStreamThrottle({ flushEveryMs: 50, flushAtChars: 32 });
 *   for await (const chunk of openaiStream) {
 *     throttle.push(chunk.text, broadcastStream);
 *   }
 *   throttle.flush(broadcastStream);
 */
export const createStreamThrottle = (
  options: CreateStreamThrottleOptions = {},
): StreamThrottle => {
  const defaults = getProjectConfig().sync.streamThrottle;
  const flushAtChars = options.flushAtChars ?? defaults.flushAtChars;
  const flushEveryMs = options.flushEveryMs ?? defaults.flushEveryMs;
  const field = options.field ?? defaults.field;

  let buffer = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flushNow = (emit: (payload: Record<string, unknown>) => void) => {
    if (buffer.length === 0) {
      clearTimer();
      return;
    }
    const payload: Record<string, unknown> = { [field]: buffer };
    buffer = '';
    clearTimer();
    emit(payload);
  };

  return {
    push: (text, emit) => {
      if (!text) return;
      buffer += text;

      if (buffer.length >= flushAtChars) {
        flushNow(emit);
        return;
      }

      if (flushEveryMs !== false && timer === null) {
        timer = setTimeout(() => {
          flushNow(emit);
        }, flushEveryMs);
        //? Allow process exit even if the throttle has a pending flush.
        //? Prevents tests + short scripts from hanging waiting on a timer.
        if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
          (timer as { unref: () => void }).unref();
        }
      }
    },
    flush: (emit) => {
      flushNow(emit);
    },
    reset: () => {
      buffer = '';
      clearTimer();
    },
  };
};
