import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

//? `apiMeta.ts` only needs `inferHttpMethod` + `tryCatchSync` from core; stub
//? them so the test runs without a core build. `tryCatchSync` mirrors the real
//? `[error, result]` tuple contract the extractors rely on.
vi.mock("@luckystack/core", () => ({
  inferHttpMethod: vi.fn(() => "POST"),
  tryCatchSync: <T>(fn: () => T): [unknown, T | undefined] => {
    try {
      return [null, fn()];
    } catch (error) {
      return [error, undefined];
    }
  },
}));

import { extractAuth } from "./apiMeta";

const tmpFiles: string[] = [];

const writeTmp = (source: string): string => {
  const file = path.join(os.tmpdir(), `ls-apimeta-${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(file, source, "utf8");
  tmpFiles.push(file);
  return file;
};

afterEach(() => {
  while (tmpFiles.length > 0) {
    const file = tmpFiles.pop();
    if (file) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  }
});

describe("extractAuth — public-by-default (DK-05)", () => {
  it("honors an explicit login: true", () => {
    const file = writeTmp(`export const auth = { login: true };`);
    expect(extractAuth(file)).toEqual({ login: true });
  });

  it("honors an explicit login: false (public route)", () => {
    const file = writeTmp(`export const auth = { login: false };`);
    expect(extractAuth(file)).toEqual({ login: false });
  });

  it("defaults to public when the auth export is missing", () => {
    const file = writeTmp(`export const main = async () => ({ status: 'success' });`);
    expect(extractAuth(file)).toEqual({ login: false });
  });

  it("treats a non-boolean-literal login initializer as public (auth-indeterminate)", () => {
    //? An imported const / ternary can't be statically resolved — it defaults
    //? to public, matching the runtime loader (a route is protected only when
    //? it declares a literal `login: true`).
    const file = writeTmp(
      `import { needsLogin } from './cfg';\nexport const auth = { login: needsLogin };`,
    );
    expect(extractAuth(file)).toEqual({ login: false });
  });

  it("treats a ternary login initializer as public", () => {
    const file = writeTmp(`export const auth = { login: 1 > 0 ? true : false };`);
    expect(extractAuth(file)).toEqual({ login: false });
  });

  it("unwraps `as const` on an explicit literal", () => {
    const file = writeTmp(`export const auth = { login: false as const };`);
    expect(extractAuth(file)).toEqual({ login: false });
  });
});
