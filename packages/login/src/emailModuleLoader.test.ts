import { describe, it, expect, vi } from "vitest";

//? Characterization test for the extracted `loadEmailModule()` helper (finding
//? 37). It pins the two behaviors the former inline import blocks relied on:
//?   1. On success it resolves to a module exposing the `sendEmail` function
//?      that BOTH callers destructure.
//?   2. On a failed import it REJECTS (does NOT swallow) — `forgotPassword`
//?      depends on `.catch(...)` working, `emailChangeNotification` depends on
//?      the rejection bubbling out. Centralizing a catch here would break one.

import { loadEmailModule } from "./emailModuleLoader";

describe("loadEmailModule", () => {
  it("resolves to the @luckystack/email module exposing sendEmail", async () => {
    const mod = await loadEmailModule();
    expect(mod).toBeTruthy();
    expect(typeof mod.sendEmail).toBe("function");
  });

  it("returns a fresh promise on each call (no shared memoized state)", () => {
    const a = loadEmailModule();
    const b = loadEmailModule();
    expect(a).toBeInstanceOf(Promise);
    expect(b).toBeInstanceOf(Promise);
    expect(a).not.toBe(b);
  });

  it("REJECTS rather than swallowing when the optional peer is absent", async () => {
    //? Simulate the package not being installed: the dynamic import rejects.
    //? The helper must propagate that rejection unchanged (callers own the
    //? recovery — forgotPassword catches, emailChangeNotification lets it throw).
    vi.resetModules();
    vi.doMock("@luckystack/email", () => Promise.reject(new Error("module-load-failed")));
    const { loadEmailModule: loadWithMock } = await import("./emailModuleLoader");
    //? The helper must NOT resolve to null / a stub — it must reject so each
    //? caller's own recovery (catch vs throw) fires. We assert rejection only,
    //? not the message (vitest may wrap the underlying module error).
    await expect(loadWithMock()).rejects.toBeTruthy();
    vi.doUnmock("@luckystack/email");
    vi.resetModules();
  });
});
