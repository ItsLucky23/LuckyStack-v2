import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

//? These tests cover the PURE helpers of the scaffold CLI. The module's
//? `main()` is guarded behind an `isCliEntry()` check (it only runs when this
//? file is the process entry point — i.e. the installed bin), so importing it
//? here for the unit tests does NOT touch the filesystem, spawn npm, or open a
//? readline prompt. We therefore exercise the helpers via their real exports
//? rather than running the full scaffold.
import {
  slugify,
  titleCase,
  replacePlaceholders,
  renameDotFile,
  isTextFile,
  parseArgs,
  readSelfVersion,
  buildOAuthEnvVars,
  VALID_FLAGS,
} from "./index";

describe("slugify", () => {
  it("lower-cases and keeps a simple alphanumeric name unchanged", () => {
    expect(slugify("myapp")).toBe("myapp");
  });

  it("lower-cases mixed-case input", () => {
    expect(slugify("MyApp")).toBe("myapp");
  });

  it("replaces spaces with dashes", () => {
    expect(slugify("my app")).toBe("my-app");
  });

  it("collapses runs of non-alphanumerics into a single dash", () => {
    expect(slugify("my   cool   app")).toBe("my-cool-app");
    expect(slugify("my___cool!!!app")).toBe("my-cool-app");
  });

  it("trims leading and trailing dashes produced by symbols", () => {
    expect(slugify("!!my-app!!")).toBe("my-app");
    expect(slugify("---my-app---")).toBe("my-app");
  });

  it("trims surrounding whitespace before slugifying", () => {
    expect(slugify("  my app  ")).toBe("my-app");
  });

  it("returns an empty string when the input has no alphanumerics", () => {
    //? Drives the `main()` 'invalid project name' guard.
    expect(slugify("!!!")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("preserves digits", () => {
    expect(slugify("App 2 You")).toBe("app-2-you");
  });
});

describe("titleCase", () => {
  it("title-cases a single lowercase word", () => {
    expect(titleCase("myapp")).toBe("Myapp");
  });

  it("splits on spaces and title-cases each part", () => {
    expect(titleCase("my cool app")).toBe("My Cool App");
  });

  it("splits on dashes", () => {
    expect(titleCase("my-cool-app")).toBe("My Cool App");
  });

  it("splits on underscores", () => {
    expect(titleCase("my_cool_app")).toBe("My Cool App");
  });

  it("splits on a mix of separators and drops empty parts", () => {
    expect(titleCase("  my -_ cool __ app  ")).toBe("My Cool App");
  });

  it("falls back to 'My LuckyStack App' for empty input", () => {
    expect(titleCase("")).toBe("My LuckyStack App");
  });

  it("falls back to 'My LuckyStack App' for separators-only input", () => {
    //? After splitting + filtering, no parts remain so the `|| fallback` fires.
    expect(titleCase("   ")).toBe("My LuckyStack App");
    expect(titleCase("-_-")).toBe("My LuckyStack App");
  });

  it("preserves an already-uppercase first letter without lowering the rest", () => {
    expect(titleCase("API gateway")).toBe("API Gateway");
  });
});

describe("renameDotFile", () => {
  it("returns a normal filename unchanged", () => {
    expect(renameDotFile("package.json")).toBe("package.json");
  });

  it("rewrites a single leading _dot_ to a dot", () => {
    expect(renameDotFile("_dot_gitignore")).toBe(".gitignore");
  });

  it("rewrites _dot_env_template", () => {
    expect(renameDotFile("_dot_env_template")).toBe(".env_template");
  });

  it("rewrites every occurrence of _dot_ in the name", () => {
    expect(renameDotFile("_dot_env_dot_local_template")).toBe(
      ".env.local_template",
    );
  });

  it("leaves a name without _dot_ untouched even if it contains 'dot'", () => {
    expect(renameDotFile("robot.txt")).toBe("robot.txt");
  });
});

describe("replacePlaceholders", () => {
  it("substitutes a known placeholder", () => {
    expect(replacePlaceholders("name: {{PROJECT_NAME}}", { PROJECT_NAME: "my-app" })).toBe(
      "name: my-app",
    );
  });

  it("substitutes multiple distinct placeholders", () => {
    const out = replacePlaceholders("{{A}}-{{B}}", { A: "x", B: "y" });
    expect(out).toBe("x-y");
  });

  it("substitutes every occurrence of a repeated placeholder", () => {
    expect(replacePlaceholders("{{X}} and {{X}}", { X: "z" })).toBe("z and z");
  });

  it("leaves an unknown placeholder verbatim", () => {
    //? Key not present in `vars` -> hasOwnProperty is false -> return match.
    expect(replacePlaceholders("hi {{UNKNOWN}}", { PROJECT_NAME: "my-app" })).toBe(
      "hi {{UNKNOWN}}",
    );
  });

  it("substitutes an empty-string value (empty is a valid replacement)", () => {
    //? Empty string is own-property + not undefined, so it replaces the token.
    expect(replacePlaceholders("[{{OAUTH_PROVIDERS}}]", { OAUTH_PROVIDERS: "" })).toBe(
      "[]",
    );
  });

  it("does not treat non-word-character braces as placeholders", () => {
    //? The pattern is {{(\w+)}} — content with spaces / dashes is not matched.
    expect(replacePlaceholders("{{ spaced }}", { spaced: "x" })).toBe("{{ spaced }}");
    expect(replacePlaceholders("{{a-b}}", { "a-b": "x" })).toBe("{{a-b}}");
  });

  it("returns content unchanged when there are no placeholders", () => {
    expect(replacePlaceholders("plain text", { PROJECT_NAME: "x" })).toBe("plain text");
  });

  it("does NOT pick up inherited prototype keys (uses hasOwnProperty)", () => {
    //? `toString` lives on Object.prototype, not as an own key, so it must
    //? remain a verbatim token rather than resolving to the function.
    expect(replacePlaceholders("{{toString}}", {})).toBe("{{toString}}");
  });
});

describe("isTextFile", () => {
  it.each([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".css",
    ".html",
    ".prisma",
  ])("treats %s as a text file", (ext) => {
    expect(isTextFile(`some/path/file${ext}`)).toBe(true);
  });

  it("returns true for a dotfile with no recognised extension", () => {
    //? `.env_template` has no known extension but its basename starts with a dot.
    expect(isTextFile("project/.env_template")).toBe(true);
    expect(isTextFile(".gitignore")).toBe(true);
  });

  it("returns false for a binary extension", () => {
    expect(isTextFile("assets/logo.png")).toBe(false);
    expect(isTextFile("assets/font.woff2")).toBe(false);
  });

  it("returns false for an extensionless, non-dot filename", () => {
    expect(isTextFile("bin/runner")).toBe(false);
    expect(isTextFile("Makefile")).toBe(false);
  });

  it("matches the extension regardless of directory depth", () => {
    expect(isTextFile("a/b/c/d/component.tsx")).toBe(true);
  });
});

describe("parseArgs", () => {
  //? `process.exit` is replaced with a throwing stub so control never falls
  //? through the unknown-flag branch (mirrors the real abort) and the assertion
  //? can catch it cleanly. `console.error` is silenced so the diagnostics the
  //? parser prints before exiting do not pollute the test output.
  const exitSpy = vi.fn<(code?: number) => never>((code?: number) => {
    throw new Error(`process.exit:${String(code)}`);
  });
  const errorSpy = vi.fn<(...args: unknown[]) => void>();

  beforeEach(() => {
    exitSpy.mockClear();
    errorSpy.mockClear();
    vi.spyOn(process, "exit").mockImplementation(exitSpy as never);
    vi.spyOn(console, "error").mockImplementation(errorSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  //? The flag fields added in CFG-01 all default to null (= "not passed →
  //? wizard asks / default applies"). Shared so the full-shape assertions stay
  //? readable as projectName + overrides.
  const CFG01_NULLS = {
    dbProvider: null,
    authMode: null,
    oauthProviders: null,
    emailProvider: null,
    monitoringProvider: null,
    aiInstructions: null,
  };

  it("returns defaults for empty argv (install + prompt on, no help, no name)", () => {
    expect(parseArgs([])).toEqual({
      projectName: "",
      install: true,
      prompt: true,
      help: false,
      presence: false,
      errorTracking: false,
      docsUi: false,
      secretManager: false,
      router: false,
      aiBrowserTooling: null,
      ...CFG01_NULLS,
    });
  });

  it("captures the first non-flag token as the project name", () => {
    expect(parseArgs(["my-app"])).toEqual({
      projectName: "my-app",
      install: true,
      prompt: true,
      help: false,
      presence: false,
      errorTracking: false,
      docsUi: false,
      secretManager: false,
      router: false,
      aiBrowserTooling: null,
      ...CFG01_NULLS,
    });
  });

  it("keeps the first positional and ignores a later positional (||= first wins)", () => {
    expect(parseArgs(["first", "second"]).projectName).toBe("first");
  });

  it("turns install off for --no-install", () => {
    const result = parseArgs(["my-app", "--no-install"]);
    expect(result.install).toBe(false);
    expect(result.prompt).toBe(true);
    expect(result.projectName).toBe("my-app");
  });

  it("turns prompt off for --no-prompt", () => {
    const result = parseArgs(["my-app", "--no-prompt"]);
    expect(result.prompt).toBe(false);
    expect(result.install).toBe(true);
  });

  it("sets presence for --presence (default false)", () => {
    expect(parseArgs(["my-app"]).presence).toBe(false);
    expect(parseArgs(["my-app", "--presence"]).presence).toBe(true);
  });

  it("parses --ai-browser=<value> (default null)", () => {
    expect(parseArgs(["my-app"]).aiBrowserTooling).toBeNull();
    expect(parseArgs(["my-app", "--ai-browser=all"]).aiBrowserTooling).toBe("all");
    expect(parseArgs(["my-app", "--ai-browser=agent-browser"]).aiBrowserTooling).toBe("agent-browser");
    expect(parseArgs(["my-app", "--ai-browser=none"]).aiBrowserTooling).toBe("none");
  });

  it("exits with code 2 on an invalid --ai-browser value", () => {
    expect(() => parseArgs(["my-app", "--ai-browser=bogus"])).toThrow("process.exit:2");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("combines --no-install and --no-prompt in any order", () => {
    expect(parseArgs(["--no-prompt", "my-app", "--no-install"])).toEqual({
      projectName: "my-app",
      install: false,
      prompt: false,
      help: false,
      presence: false,
      errorTracking: false,
      docsUi: false,
      secretManager: false,
      router: false,
      aiBrowserTooling: null,
      ...CFG01_NULLS,
    });
  });

  //? ───────── CFG-01: per-choice scaffold flags ─────────
  it("parses --db / --auth / --email / --monitoring value flags", () => {
    expect(parseArgs(["my-app"]).dbProvider).toBeNull();
    expect(parseArgs(["my-app", "--db=postgresql"]).dbProvider).toBe("postgresql");
    expect(parseArgs(["my-app", "--auth=none"]).authMode).toBe("none");
    expect(parseArgs(["my-app", "--auth=credentials+oauth"]).authMode).toBe("credentials+oauth");
    expect(parseArgs(["my-app", "--email=resend"]).emailProvider).toBe("resend");
    expect(parseArgs(["my-app", "--monitoring=sentry"]).monitoringProvider).toBe("sentry");
  });

  it("parses --oauth as a validated comma-separated list", () => {
    expect(parseArgs(["my-app"]).oauthProviders).toBeNull();
    expect(parseArgs(["my-app", "--oauth=google,github"]).oauthProviders).toEqual(["google", "github"]);
    expect(parseArgs(["my-app", "--oauth=google, microsoft "]).oauthProviders).toEqual(["google", "microsoft"]);
    //? Empty value → explicit empty list (distinct from null = not passed).
    expect(parseArgs(["my-app", "--oauth="]).oauthProviders).toEqual([]);
  });

  it("parses the --ai-docs / --no-ai-docs boolean flags", () => {
    expect(parseArgs(["my-app"]).aiInstructions).toBeNull();
    expect(parseArgs(["my-app", "--ai-docs"]).aiInstructions).toBe(true);
    expect(parseArgs(["my-app", "--no-ai-docs"]).aiInstructions).toBe(false);
  });

  it("exits with code 2 on an invalid value for a choice flag", () => {
    expect(() => parseArgs(["my-app", "--db=oracle"])).toThrow("process.exit:2");
    expect(() => parseArgs(["my-app", "--auth=magic"])).toThrow("process.exit:2");
    expect(() => parseArgs(["my-app", "--oauth=google,myspace"])).toThrow("process.exit:2");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("sets help for --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  it("sets help for the -h alias", () => {
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("exits with code 2 on an unknown long flag", () => {
    expect(() => parseArgs(["my-app", "--no-installl"])).toThrow("process.exit:2");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("exits with code 2 on an unknown short flag", () => {
    expect(() => parseArgs(["-x"])).toThrow("process.exit:2");
  });

  it("reports the offending flag and the valid-flag list before exiting", () => {
    expect(() => parseArgs(["--bogus"])).toThrow();
    expect(errorSpy).toHaveBeenCalledWith("Unknown flag: --bogus");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(VALID_FLAGS.join(", ")),
    );
  });

  it("treats a token that merely contains a dash (not leading) as a project name", () => {
    //? Only a LEADING '-' marks a flag; an embedded dash is part of the name.
    expect(parseArgs(["my-cool-app"]).projectName).toBe("my-cool-app");
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe("readSelfVersion", () => {
  it("reads a valid semver version from the package's own package.json", () => {
    //? No filesystem mocking — the package's real package.json ships a valid
    //? version, which is exactly what this helper is meant to surface. We only
    //? assert the SHAPE (so the test does not break on every version bump)
    //? while still proving the read + format guard pass on real data.
    const version = readSelfVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("buildOAuthEnvVars", () => {
  const ALL = ["google", "github", "discord", "facebook", "microsoft"] as const;

  it("emits a block for EVERY built-in provider even when none are selected", () => {
    const out = buildOAuthEnvVars([], "credentials+oauth");
    for (const p of ALL) {
      expect(out).toContain(`# ${p} (enable later)`);
    }
  });

  it("leaves selected providers uncommented and comments out the rest", () => {
    const out = buildOAuthEnvVars(["google"], "credentials+oauth");
    //? Selected: active header + uncommented key lines.
    expect(out).toContain("# google (active)");
    expect(out).toContain("\nDEV_GOOGLE_CLIENT_ID=");
    expect(out).toContain("\nGOOGLE_CLIENT_SECRET=");
    //? Unselected: enable-later header + commented key lines.
    expect(out).toContain("# github (enable later)");
    expect(out).toContain("# DEV_GITHUB_CLIENT_ID=");
    expect(out).toContain("# GITHUB_CLIENT_SECRET=");
    //? An unselected provider must NOT appear uncommented.
    expect(out).not.toContain("\nDEV_GITHUB_CLIENT_ID=");
  });

  it("includes a MICROSOFT_TENANT_ID line, commented when microsoft is not selected", () => {
    expect(buildOAuthEnvVars([], "credentials+oauth")).toContain("# MICROSOFT_TENANT_ID=common");
    expect(buildOAuthEnvVars(["microsoft"], "credentials+oauth")).toContain("\nMICROSOFT_TENANT_ID=common");
  });

  it("emits exactly the four credential keys per provider (dev + prod pair)", () => {
    const out = buildOAuthEnvVars(["discord"], "credentials+oauth");
    expect(out).toContain("DEV_DISCORD_CLIENT_ID=");
    expect(out).toContain("DEV_DISCORD_CLIENT_SECRET=");
    expect(out).toContain("DISCORD_CLIENT_ID=");
    expect(out).toContain("DISCORD_CLIENT_SECRET=");
  });

  it("replaces the credential block with an add-login pointer under authMode 'none'", () => {
    const out = buildOAuthEnvVars([], "none");
    //? authMode 'none' = @luckystack/login isn't installed, so no provider keys
    //? are emitted — just a pointer to add login first.
    expect(out).toContain("npx luckystack add login");
    expect(out).not.toContain("DEV_GOOGLE_CLIENT_ID=");
    expect(out).not.toContain("(enable later)");
  });
});
