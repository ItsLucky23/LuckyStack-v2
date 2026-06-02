import { describe, it, expect, vi, beforeEach } from "vitest";

//? Target: the pure Redis key-builders `sessionKeyFor` / `activeUsersKeyFor`.
//? They depend only on `getProjectName()` from @luckystack/core. The rest of
//? session.ts (saveSession/getSession/...) drives sockets/redis/hooks and is
//? out of scope for a no-infrastructure unit test. We mock the entire core
//? surface session.ts imports at load time so importing the module is safe.
const getProjectNameMock = vi.fn<() => string>();

vi.mock("@luckystack/core", () => ({
  socketEventNames: {},
  dispatchHook: vi.fn(),
  getCsrfConfig: vi.fn(() => ({ tokenLength: 32 })),
  getLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() })),
  getProjectConfig: vi.fn(() => ({ session: { expiryDays: 1 } })),
  getProjectName: () => getProjectNameMock(),
  tryCatch: vi.fn(),
  redis: {},
}));

import { sessionKeyFor, activeUsersKeyFor } from "./session";

describe("session key-builders", () => {
  beforeEach(() => {
    getProjectNameMock.mockReset();
  });

  it("sessionKeyFor namespaces the token with the project name", () => {
    getProjectNameMock.mockReturnValue("luckystack");
    expect(sessionKeyFor("tok123")).toBe("luckystack-session:tok123");
  });

  it("activeUsersKeyFor namespaces the userId with the project name", () => {
    getProjectNameMock.mockReturnValue("luckystack");
    expect(activeUsersKeyFor("user-7")).toBe("luckystack-activeUsers:user-7");
  });

  it("resolves the project name at call time (not module load)", () => {
    getProjectNameMock.mockReturnValueOnce("alpha").mockReturnValueOnce("beta");
    expect(sessionKeyFor("t")).toBe("alpha-session:t");
    expect(sessionKeyFor("t")).toBe("beta-session:t");
  });

  it("produces distinct prefixes for sessions vs active-users", () => {
    getProjectNameMock.mockReturnValue("proj");
    expect(sessionKeyFor("x")).not.toBe(activeUsersKeyFor("x"));
  });
});
