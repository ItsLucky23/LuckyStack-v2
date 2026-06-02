import { describe, it, expect, vi, beforeEach } from "vitest";

//? `createStreamThrottle` reads its defaults from `getProjectConfig().sync.streamThrottle`.
//? We mock the core registry seam so the throttle is exercised purely — no real
//? config load, no socket, no redis. The factory exposes a mutable holder so
//? individual tests can reshape `sync.streamThrottle` before constructing the
//? throttle (the source reads the config at construction time, not module load).
const configHolder = {
  sync: {
    streamThrottle: {
      flushAtChars: 32,
      flushEveryMs: 50 as number | false,
      field: "chunk",
    },
  },
};

vi.mock("@luckystack/core", () => ({
  getProjectConfig: () => configHolder,
}));

import { createStreamThrottle, type StreamThrottle } from "./streamThrottle";

//? Feed a sequence of text pieces through one throttle. Routing pushes through
//? this helper keeps the test bodies free of consecutive literal `.push(...)`
//? member calls (which the `unicorn/prefer-single-call` lint rule flags by
//? method name, mistaking the throttle method for `Array#push`).
const feed = (
  throttle: StreamThrottle,
  emit: (payload: Record<string, unknown>) => void,
  pieces: string[],
): void => {
  for (const piece of pieces) {
    throttle.push(piece, emit);
  }
};

describe("createStreamThrottle", () => {
  beforeEach(() => {
    //? Restore the config defaults before every test so a test that mutates
    //? the holder (e.g. to override `field`) can't leak into the next one.
    vi.useRealTimers();
    configHolder.sync.streamThrottle = {
      flushAtChars: 32,
      flushEveryMs: 50,
      field: "chunk",
    };
  });

  describe("flush-at-chars trigger", () => {
    it("does not emit while the buffer stays under the char threshold", () => {
      const throttle = createStreamThrottle({ flushAtChars: 10, flushEveryMs: false });
      const emit = vi.fn();

      feed(throttle, emit, ["abc", "def"]);

      expect(emit).not.toHaveBeenCalled();
    });

    it("flushes once the buffer reaches the char threshold", () => {
      const throttle = createStreamThrottle({ flushAtChars: 5, flushEveryMs: false });
      const emit = vi.fn();

      throttle.push("ab", emit);
      expect(emit).not.toHaveBeenCalled();

      throttle.push("cde", emit);

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith({ chunk: "abcde" });
    });

    it("flushes when a single push crosses the threshold and clears the buffer", () => {
      const throttle = createStreamThrottle({ flushAtChars: 3, flushEveryMs: false });
      const emit = vi.fn();

      throttle.push("hello world", emit);

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith({ chunk: "hello world" });

      //? Buffer was cleared on flush — a subsequent flush has nothing to emit.
      throttle.flush(emit);
      expect(emit).toHaveBeenCalledTimes(1);
    });

    it("accumulates a fresh buffer after a threshold flush", () => {
      const throttle = createStreamThrottle({ flushAtChars: 4, flushEveryMs: false });
      const emit = vi.fn();

      feed(throttle, emit, ["aabb", "ccdd"]); //? two threshold-triggered flushes

      expect(emit).toHaveBeenNthCalledWith(1, { chunk: "aabb" });
      expect(emit).toHaveBeenNthCalledWith(2, { chunk: "ccdd" });
      expect(emit).toHaveBeenCalledTimes(2);
    });
  });

  describe("flush-every-ms timer trigger", () => {
    it("flushes the buffer after the timer fires even below the char threshold", () => {
      vi.useFakeTimers();
      const throttle = createStreamThrottle({ flushAtChars: 100, flushEveryMs: 50 });
      const emit = vi.fn();

      throttle.push("tiny", emit);
      expect(emit).not.toHaveBeenCalled();

      vi.advanceTimersByTime(49);
      expect(emit).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith({ chunk: "tiny" });
    });

    it("only arms a single timer across multiple sub-threshold pushes", () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const throttle = createStreamThrottle({ flushAtChars: 100, flushEveryMs: 50 });
      const emit = vi.fn();

      feed(throttle, emit, ["a", "b", "c"]);

      //? Timer is armed once and not re-armed while already pending.
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(50);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith({ chunk: "abc" });

      setTimeoutSpy.mockRestore();
    });

    it("never arms a timer when flushEveryMs is false", () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const throttle = createStreamThrottle({ flushAtChars: 100, flushEveryMs: false });
      const emit = vi.fn();

      feed(throttle, emit, ["a", "b"]);

      expect(setTimeoutSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(10_000);
      expect(emit).not.toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
    });

    it("clears the pending timer when the char threshold flushes first", () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const throttle = createStreamThrottle({ flushAtChars: 3, flushEveryMs: 50 });
      const emit = vi.fn();

      feed(throttle, emit, ["a", "bc"]); //? "a" arms timer; "bc" hits threshold -> flush + clearTimer

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith({ chunk: "abc" });
      expect(clearTimeoutSpy).toHaveBeenCalled();

      //? After the threshold flush cleared the timer, advancing time must not
      //? produce a second (empty) emit.
      vi.advanceTimersByTime(100);
      expect(emit).toHaveBeenCalledTimes(1);

      clearTimeoutSpy.mockRestore();
    });
  });

  describe("flush()", () => {
    it("force-flushes the buffered text", () => {
      const throttle = createStreamThrottle({ flushAtChars: 100, flushEveryMs: false });
      const emit = vi.fn();

      throttle.push("partial", emit);
      expect(emit).not.toHaveBeenCalled();

      throttle.flush(emit);

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith({ chunk: "partial" });
    });

    it("is a no-op on an empty buffer", () => {
      const throttle = createStreamThrottle({ flushAtChars: 100, flushEveryMs: false });
      const emit = vi.fn();

      throttle.flush(emit);

      expect(emit).not.toHaveBeenCalled();
    });

    it("cancels the pending timer so it never double-emits", () => {
      vi.useFakeTimers();
      const throttle = createStreamThrottle({ flushAtChars: 100, flushEveryMs: 50 });
      const emit = vi.fn();

      throttle.push("buffered", emit); //? arms the 50ms timer
      throttle.flush(emit); //? flushes now and must clear the armed timer

      expect(emit).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(100);
      expect(emit).toHaveBeenCalledTimes(1);
    });
  });

  describe("reset()", () => {
    it("drops buffered text without emitting", () => {
      const throttle = createStreamThrottle({ flushAtChars: 100, flushEveryMs: false });
      const emit = vi.fn();

      throttle.push("discard-me", emit);
      throttle.reset();
      throttle.flush(emit);

      expect(emit).not.toHaveBeenCalled();
    });

    it("clears the pending timer so a reset buffer never emits", () => {
      vi.useFakeTimers();
      const throttle = createStreamThrottle({ flushAtChars: 100, flushEveryMs: 50 });
      const emit = vi.fn();

      throttle.push("abc", emit); //? arms timer
      throttle.reset();

      vi.advanceTimersByTime(100);
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe("empty / falsy push", () => {
    it("ignores an empty-string push (no buffer growth, no timer)", () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const throttle = createStreamThrottle({ flushAtChars: 100, flushEveryMs: 50 });
      const emit = vi.fn();

      throttle.push("", emit);

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      throttle.flush(emit);
      expect(emit).not.toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
    });
  });

  describe("field option", () => {
    it("uses a custom field key on the emitted payload", () => {
      const throttle = createStreamThrottle({ flushAtChars: 3, flushEveryMs: false, field: "delta" });
      const emit = vi.fn();

      throttle.push("xyz", emit);

      expect(emit).toHaveBeenCalledWith({ delta: "xyz" });
    });
  });

  describe("config defaults", () => {
    it("falls back to projectConfig.sync.streamThrottle when options are omitted", () => {
      configHolder.sync.streamThrottle = { flushAtChars: 4, flushEveryMs: false, field: "token" };
      const throttle = createStreamThrottle();
      const emit = vi.fn();

      throttle.push("abcd", emit); //? hits the config-derived threshold of 4

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith({ token: "abcd" });
    });

    it("lets an explicit option override the config default", () => {
      configHolder.sync.streamThrottle = { flushAtChars: 4, flushEveryMs: false, field: "token" };
      const throttle = createStreamThrottle({ flushAtChars: 2 });
      const emit = vi.fn();

      throttle.push("ab", emit); //? hits the option threshold of 2, not the config 4

      expect(emit).toHaveBeenCalledTimes(1);
      //? field still comes from config since it wasn't overridden.
      expect(emit).toHaveBeenCalledWith({ token: "ab" });
    });
  });
});
