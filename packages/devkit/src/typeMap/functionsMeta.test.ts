import { describe, it, expect, vi } from "vitest";

//? `functionsMeta.ts` pulls `@luckystack/core` (generated-path + function-dir
//? helpers) at the top, and its sibling imports (`./tsProgram`, `./typeContext`)
//? reference `ROOT_DIR` / `getGeneratedSocketTypesPath`. None of those are
//? touched at module load or by the pure string helpers under test here, so we
//? stub the bound symbols to keep the test free of a core build. (Mirrors
//? routeMeta.test.ts.)
vi.mock("@luckystack/core", () => ({
  getGeneratedSocketTypesPath: vi.fn(() => "/project/src/_sockets/apiTypes.generated.ts"),
  getServerFunctionDirs: vi.fn(() => []),
  ROOT_DIR: "/project",
}));

import { normalizeInlineType, stripLineComments } from "./functionsMeta";

//? Both helpers are pure text transforms feeding the emitted `Functions`
//? interface. The keystone bug: an inline `//` in an extracted type signature
//? survives the whitespace-collapse and comments out the rest of the line,
//? yielding malformed generated TS (`unresolved type identifiers: [""]`).

describe("stripLineComments", () => {
  it("removes an inline // comment from a multi-line type fragment", () => {
    const input = "data: {\n  name: string; // the user's name\n  email: string;\n}";
    const out = stripLineComments(input);
    expect(out).not.toContain("//");
    expect(out).toContain("name: string;");
    expect(out).toContain("email: string;");
  });

  it("preserves // inside a single-quoted string literal type (e.g. a URL)", () => {
    const input = "{ url: 'https://example.com/path' }";
    expect(stripLineComments(input)).toContain("'https://example.com/path'");
  });

  it("leaves block comments intact", () => {
    const input = "{ a: number /* keep me */ }";
    expect(stripLineComments(input)).toContain("/* keep me */");
  });
});

describe("normalizeInlineType", () => {
  it("does not eat the rest of the signature after an inline // (the keystone bug)", () => {
    //? Before the fix, collapsing this to one line turned `// note` into a
    //? comment that swallowed `email` and everything after it.
    const out = normalizeInlineType("name: string; // note\nemail: string;");
    expect(out).toBe("name: string; email: string;");
  });

  it("keeps a URL string literal whole through the collapse", () => {
    const input = "{ url: 'https://api.example.com' }";
    expect(normalizeInlineType(input)).toBe("{ url: 'https://api.example.com' }");
  });

  it("collapses surrounding whitespace to single spaces", () => {
    expect(normalizeInlineType("  Foo<\n  Bar\n>  ")).toBe("Foo< Bar >");
  });
});
