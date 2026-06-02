import { describe, it, expect, vi, beforeEach } from "vitest";

//? Each built-in adapter resolves its optional peer-dep via a module-level
//? `localRequire = createRequire(import.meta.url)` and then calls
//? `localRequire.resolve(<peer>)` inside a boot-time guard. We mock
//? `node:module` so that `createRequire` returns a fake require whose
//? `.resolve` throws — simulating the peer-dep being absent — and assert each
//? factory surfaces its descriptive guard error rather than a raw
//? MODULE_NOT_FOUND. `resetModules` + dynamic import ensures the adapter
//? modules pick up the mocked `node:module` at evaluation time.

const makeFailingRequire = (): NodeRequire => {
  //? `resolve` is typed to return `string` (matching RequireResolve's call
  //? signature) even though it always throws — a throwing body is assignable
  //? to a string-returning signature, so no `never`-overlap cast is needed.
  const resolve = (id: string): string => {
    throw new Error(`Cannot find module '${id}'`);
  };
  const req = ((id: string): string => {
    throw new Error(`Cannot find module '${id}'`);
  }) as unknown as NodeRequire;
  req.resolve = resolve as NodeRequire["resolve"];
  return req;
};

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    createRequire: () => makeFailingRequire(),
  };
});

//? Minimal stub option objects — the guard fires BEFORE any of these handles
//? are touched, so empty shapes that satisfy the (compile-time) option types
//? are sufficient. No `as any` / `as unknown as T`: the adapters accept these
//? structurally for the fields the guard path never reads.
const datadogTracerStub = {
  startSpan: () => ({ setTag: () => {}, finish: () => {} }),
};

const posthogClientStub = {
  capture: () => {},
};

describe("adapter peer-dep guards (missing peer simulated)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("createSentryAdapter throws a descriptive error when @sentry/node is absent", async () => {
    const { createSentryAdapter } = await import("./sentry");
    expect(() => createSentryAdapter()).toThrow(/@sentry\/node` package is not installed/);
  });

  it("createDatadogAdapter throws a descriptive error when dd-trace is absent", async () => {
    const { createDatadogAdapter } = await import("./datadog");
    expect(() => createDatadogAdapter({ tracer: datadogTracerStub })).toThrow(
      /`dd-trace` package is not installed/,
    );
  });

  it("createPostHogAdapter throws a descriptive error when posthog-node is absent", async () => {
    const { createPostHogAdapter } = await import("./posthog");
    expect(() => createPostHogAdapter({ client: posthogClientStub })).toThrow(
      /`posthog-node` package is not installed/,
    );
  });
});
