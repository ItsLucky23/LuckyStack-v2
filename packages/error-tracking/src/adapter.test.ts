import { describe, it, expect, vi, beforeEach } from "vitest";

//? The adapter registry fan-out functions live in `@luckystack/core`
//? (`errorTrackerRegistry.ts`) and are re-exported through this package's
//? `./adapter` barrel. We import them via the RELATIVE barrel so the test
//? exercises the package's public surface, while the underlying registry
//? implementation (resolved through tsconfig paths to core's source) is the
//? real one — no mocking of the fan-out logic itself. That is the behavior
//? under test: register -> fan-out -> per-tracker throws swallowed.
import {
  registerErrorTracker,
  registerErrorTrackers,
  getActiveErrorTrackers,
  captureExceptionAcrossTrackers,
  captureMessageAcrossTrackers,
  setErrorTrackerUser,
  recordMetricAcrossTrackers,
  startSpanAcrossTrackers,
} from "./adapter";
import type { ErrorTracker } from "./adapter";

//? Build a fully-stubbed tracker. Optional members (`startSpan`,
//? `recordMetric`) are spread in only when supplied so we can assert the
//? "no tracker supports spans" fallback branch cleanly.
const makeTracker = (
  name: string,
  overrides: Partial<ErrorTracker> = {},
): ErrorTracker => ({
  name,
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  ...overrides,
});

//? `vi.fn` cannot directly satisfy the generic `startSpan?: <T>(...) => T`
//? member (the generic erases to a `Mock` that TS won't accept). We instead
//? wrap a plain call-recording spy in a properly-generic function that
//? matches the member signature exactly. The returned `spy` is asserted
//? against; `onCall` lets a test observe ordering around the inner `fn`.
const makeSpan = (
  onCall?: (phase: "before" | "after") => void,
): { startSpan: NonNullable<ErrorTracker["startSpan"]>; spy: ReturnType<typeof vi.fn> } => {
  const spy = vi.fn();
  const startSpan = <T>(name: string, op: string, fn: () => T): T => {
    spy(name, op);
    onCall?.("before");
    const result = fn();
    onCall?.("after");
    return result;
  };
  return { startSpan, spy };
};

describe("error-tracker registry fan-out", () => {
  beforeEach(() => {
    //? Registry state is module-level in core. Reset to an empty list before
    //? each test so prior registrations don't leak across cases.
    registerErrorTrackers([]);
  });

  describe("registration", () => {
    it("registerErrorTracker replaces the list with a single tracker", () => {
      const a = makeTracker("a");
      const b = makeTracker("b");
      registerErrorTrackers([a, b]);
      registerErrorTracker(b);
      expect(getActiveErrorTrackers()).toEqual([b]);
    });

    it("registerErrorTrackers replaces the list with all supplied trackers", () => {
      const a = makeTracker("a");
      const b = makeTracker("b");
      registerErrorTrackers([a, b]);
      const active = getActiveErrorTrackers();
      expect(active).toHaveLength(2);
      expect(active.map((t) => t.name)).toEqual(["a", "b"]);
    });

    it("getActiveErrorTrackers returns an empty list before any registration", () => {
      expect(getActiveErrorTrackers()).toEqual([]);
    });
  });

  describe("captureExceptionAcrossTrackers", () => {
    it("fans out to every registered tracker with error + context", () => {
      const a = makeTracker("a");
      const b = makeTracker("b");
      registerErrorTrackers([a, b]);
      const err = new Error("boom");
      const ctx = { route: "api/x" };

      captureExceptionAcrossTrackers(err, ctx);

      expect(a.captureException).toHaveBeenCalledWith(err, ctx);
      expect(b.captureException).toHaveBeenCalledWith(err, ctx);
    });

    it("swallows a throwing tracker and still fires the others", () => {
      const thrower = makeTracker("thrower", {
        captureException: vi.fn(() => {
          throw new Error("tracker exploded");
        }),
      });
      const survivor = makeTracker("survivor");
      registerErrorTrackers([thrower, survivor]);
      const err = new Error("boom");

      expect(() => captureExceptionAcrossTrackers(err)).not.toThrow();
      expect(thrower.captureException).toHaveBeenCalledOnce();
      expect(survivor.captureException).toHaveBeenCalledWith(err, undefined);
    });

    it("is a no-op when no trackers are registered", () => {
      expect(() => captureExceptionAcrossTrackers(new Error("x"))).not.toThrow();
    });
  });

  describe("captureMessageAcrossTrackers", () => {
    it("fans out message + level + context to every tracker", () => {
      const a = makeTracker("a");
      const b = makeTracker("b");
      registerErrorTrackers([a, b]);

      captureMessageAcrossTrackers("hello", "warning", { tag: "1" });

      expect(a.captureMessage).toHaveBeenCalledWith("hello", "warning", { tag: "1" });
      expect(b.captureMessage).toHaveBeenCalledWith("hello", "warning", { tag: "1" });
    });

    it("swallows a throwing tracker and still fires the others", () => {
      const thrower = makeTracker("thrower", {
        captureMessage: vi.fn(() => {
          throw new Error("explode");
        }),
      });
      const survivor = makeTracker("survivor");
      registerErrorTrackers([thrower, survivor]);

      expect(() => captureMessageAcrossTrackers("m", "info")).not.toThrow();
      expect(survivor.captureMessage).toHaveBeenCalledWith("m", "info", undefined);
    });
  });

  describe("setErrorTrackerUser", () => {
    it("propagates the user to every tracker", () => {
      const a = makeTracker("a");
      const b = makeTracker("b");
      registerErrorTrackers([a, b]);
      const user = { id: "u1", email: "u@example.com" };

      setErrorTrackerUser(user);

      expect(a.setUser).toHaveBeenCalledWith(user);
      expect(b.setUser).toHaveBeenCalledWith(user);
    });

    it("propagates null (sign-out) to every tracker", () => {
      const a = makeTracker("a");
      registerErrorTrackers([a]);

      setErrorTrackerUser(null);

      expect(a.setUser).toHaveBeenCalledWith(null);
    });

    it("swallows a throwing tracker and still fires the others", () => {
      const thrower = makeTracker("thrower", {
        setUser: vi.fn(() => {
          throw new Error("explode");
        }),
      });
      const survivor = makeTracker("survivor");
      registerErrorTrackers([thrower, survivor]);

      expect(() => setErrorTrackerUser({ id: "u1" })).not.toThrow();
      expect(survivor.setUser).toHaveBeenCalledWith({ id: "u1" });
    });
  });

  describe("recordMetricAcrossTrackers", () => {
    it("only invokes trackers that implement recordMetric", () => {
      const withMetric = makeTracker("withMetric", { recordMetric: vi.fn() });
      const withoutMetric = makeTracker("withoutMetric");
      registerErrorTrackers([withMetric, withoutMetric]);

      recordMetricAcrossTrackers("latency", 42, { unit: "ms" });

      expect(withMetric.recordMetric).toHaveBeenCalledWith("latency", 42, { unit: "ms" });
      //? withoutMetric has no recordMetric member — nothing to assert beyond
      //? the call not throwing on the missing-member branch.
    });

    it("swallows a throwing recordMetric and still fires the others", () => {
      const thrower = makeTracker("thrower", {
        recordMetric: vi.fn(() => {
          throw new Error("explode");
        }),
      });
      const survivor = makeTracker("survivor", { recordMetric: vi.fn() });
      registerErrorTrackers([thrower, survivor]);

      expect(() => recordMetricAcrossTrackers("m", 1)).not.toThrow();
      expect(survivor.recordMetric).toHaveBeenCalledWith("m", 1, undefined);
    });
  });

  describe("startSpanAcrossTrackers", () => {
    it("runs fn inside the FIRST span-supporting tracker", () => {
      const order: string[] = [];
      const a = makeSpan((phase) => order.push(`spanA-${phase}`));
      const b = makeSpan();
      registerErrorTrackers([
        makeTracker("a", { startSpan: a.startSpan }),
        makeTracker("b", { startSpan: b.startSpan }),
      ]);

      const result = startSpanAcrossTrackers("op-name", "db.query", () => {
        order.push("fn");
        return 99;
      });

      expect(result).toBe(99);
      expect(a.spy).toHaveBeenCalledWith("op-name", "db.query");
      //? Only the first span-supporting tracker wins; the second is skipped.
      expect(b.spy).not.toHaveBeenCalled();
      expect(order).toEqual(["spanA-before", "fn", "spanA-after"]);
    });

    it("skips leading trackers without startSpan and uses the first that has it", () => {
      const b = makeSpan();
      registerErrorTrackers([
        makeTracker("a"), // no startSpan
        makeTracker("b", { startSpan: b.startSpan }),
      ]);

      const result = startSpanAcrossTrackers("n", "op", () => 7);

      expect(result).toBe(7);
      expect(b.spy).toHaveBeenCalledOnce();
    });

    it("falls back to direct fn() when NO tracker supports spans", () => {
      const a = makeTracker("a");
      const b = makeTracker("b");
      registerErrorTrackers([a, b]);

      const fn = vi.fn(() => "direct");
      const result = startSpanAcrossTrackers("n", "op", fn);

      expect(result).toBe("direct");
      expect(fn).toHaveBeenCalledOnce();
    });

    it("falls back to direct fn() when no trackers are registered", () => {
      const fn = vi.fn(() => "empty");
      expect(startSpanAcrossTrackers("n", "op", fn)).toBe("empty");
      expect(fn).toHaveBeenCalledOnce();
    });
  });
});
