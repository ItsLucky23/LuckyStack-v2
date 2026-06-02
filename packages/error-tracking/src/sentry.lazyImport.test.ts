import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

//? Regression guard for the "lazy Sentry peer" hardening: importing the
//? package entry must NOT throw when `@sentry/node` is absent, because the
//? SDK is now resolved lazily (only inside `initializeSentry()` / the default
//? proxy / `createSentryAdapter`). We simulate the missing peer by mocking
//? `node:module` so `createRequire(...).resolve("@sentry/node")` throws, then
//? confirm the module import still succeeds and `initializeSentry()` stays a
//? no-op when no DSN is configured (so the lazy loader is never reached).

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    createRequire: () => {
      //? `resolve` typed to return `string` (RequireResolve's call shape) even
      //? though it always throws — avoids the `never`-overlap cast.
      const resolve = (id: string): string => {
        throw new Error(`Cannot find module '${id}'`);
      };
      const req = ((id: string): string => {
        throw new Error(`Cannot find module '${id}'`);
      }) as unknown as NodeRequire;
      req.resolve = resolve as NodeRequire["resolve"];
      return req;
    },
  };
});

describe("sentry entry is import-safe without @sentry/node", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    //? Ensure no DSN / enable override leaks from the ambient environment so
    //? `initializeSentry()` takes the no-op (no-DSN) branch deterministically.
    delete process.env.SENTRY_DSN;
    delete process.env.VITE_SENTRY_DSN;
    delete process.env.SENTRY_ENABLED;
    delete process.env.VITE_SENTRY_ENABLED;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("importing the sentry module does not throw when the peer is missing", async () => {
    //? If the SDK were resolved at module top-level, this dynamic import would
    //? reject. Lazy resolution keeps it import-safe.
    await expect(import("./sentry")).resolves.toBeDefined();
  });

  it("exposes initializeSentry as a callable export after import", async () => {
    const mod = await import("./sentry");
    expect(typeof mod.initializeSentry).toBe("function");
  });

  it("initializeSentry is a no-op (does not throw) when no DSN is set", async () => {
    const { initializeSentry } = await import("./sentry");
    //? No DSN ⇒ early return before `loadSentry()` is ever called, so the
    //? throwing resolve mock is never hit.
    expect(() => initializeSentry()).not.toThrow();
  });
});
