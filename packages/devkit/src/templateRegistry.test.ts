import { describe, it, expect, beforeEach } from "vitest";

import {
  resolveTemplateKind,
  registerTemplateRule,
  registerTemplateKind,
  clearTemplateRules,
  getTemplateRules,
  registerDefaultTemplateRules,
  resetTemplateRegistryForTests,
  registerTemplate,
  getRegisteredTemplate,
  clearTemplateOverrides,
  listRegisteredTemplateKinds,
  DEFAULT_DASHBOARD_PATH_PATTERN,
  type TemplateMatchContext,
} from "./templateRegistry";

//? The registry is module-level mutable state, and the module arms the
//? built-in defaults on import. `resetTemplateRegistryForTests()` clears rules
//? + content overrides AND re-arms the defaults guard so each test starts from
//? a deterministic blank slate (no default rules unless the test asks for them).

//? Minimal context builder. Defaults to a non-matching page-less shape so each
//? test overrides only the fields the rule it exercises reads.
const ctx = (overrides: Partial<TemplateMatchContext> = {}): TemplateMatchContext => ({
  filePath: "C:/proj/src/foo/_api/getThing_v1.ts",
  fileKind: "api",
  hasPairedServer: false,
  srcRelativePath: "foo/_api/getThing_v1.ts",
  ...overrides,
});

describe("templateRegistry", () => {
  beforeEach(() => {
    resetTemplateRegistryForTests();
  });

  describe("resetTemplateRegistryForTests", () => {
    it("leaves the registry empty until defaults are explicitly re-armed", () => {
      expect(getTemplateRules()).toEqual([]);
      expect(listRegisteredTemplateKinds()).toEqual([]);
      expect(resolveTemplateKind(ctx())).toBeNull();
    });
  });

  describe("registerDefaultTemplateRules — kind selection per fileKind", () => {
    beforeEach(() => {
      registerDefaultTemplateRules();
    });

    it("selects `api` for an api file", () => {
      expect(resolveTemplateKind(ctx({ fileKind: "api" }))).toBe("api");
    });

    it("selects `sync_server` for a sync_server file", () => {
      expect(resolveTemplateKind(ctx({ fileKind: "sync_server" }))).toBe("sync_server");
    });

    it("selects `sync_client_paired` for a sync_client WITH a paired server", () => {
      expect(
        resolveTemplateKind(ctx({ fileKind: "sync_client", hasPairedServer: true })),
      ).toBe("sync_client_paired");
    });

    it("selects `sync_client_standalone` for a sync_client WITHOUT a paired server", () => {
      expect(
        resolveTemplateKind(ctx({ fileKind: "sync_client", hasPairedServer: false })),
      ).toBe("sync_client_standalone");
    });

    it("selects `page_dashboard` for a page under a dashboard-flavored path", () => {
      expect(
        resolveTemplateKind(
          ctx({ fileKind: "page", filePath: "C:/proj/src/admin/users/page.tsx" }),
        ),
      ).toBe("page_dashboard");
    });

    it("selects `page_plain` for a page that is NOT dashboard-flavored", () => {
      expect(
        resolveTemplateKind(
          ctx({ fileKind: "page", filePath: "C:/proj/src/marketing/page.tsx" }),
        ),
      ).toBe("page_plain");
    });

    it("matches each dashboard keyword (account/billing/profile/settings/dashboard)", () => {
      for (const keyword of ["account", "billing", "profile", "settings", "dashboard"]) {
        expect(
          resolveTemplateKind(
            ctx({ fileKind: "page", filePath: `C:/proj/src/${keyword}/page.tsx` }),
          ),
        ).toBe("page_dashboard");
      }
    });

    it("normalizes Windows backslashes before applying the dashboard heuristic", () => {
      //? Backslash separators must be normalized to `/` so the regex's
      //? `/admin/` boundary matches on Windows-style absolute paths.
      expect(
        resolveTemplateKind(
          ctx({ fileKind: "page", filePath: String.raw`C:\proj\src\Dashboard\page.tsx` }),
        ),
      ).toBe("page_dashboard");
    });
  });

  describe("registerDefaultTemplateRules idempotency", () => {
    it("does not duplicate rules when called twice", () => {
      registerDefaultTemplateRules();
      const afterFirst = getTemplateRules().length;
      registerDefaultTemplateRules();
      const afterSecond = getTemplateRules().length;
      expect(afterSecond).toBe(afterFirst);
      //? Six built-in rules: api, sync_server, sync_client_paired,
      //? sync_client_standalone, page_dashboard, page_plain.
      expect(afterFirst).toBe(6);
    });

    it("re-arms after a reset so defaults can be repopulated", () => {
      registerDefaultTemplateRules();
      expect(getTemplateRules().length).toBe(6);
      resetTemplateRegistryForTests();
      expect(getTemplateRules().length).toBe(0);
      registerDefaultTemplateRules();
      expect(getTemplateRules().length).toBe(6);
    });
  });

  describe("priority + newest-wins ordering", () => {
    it("evaluates higher-priority rules first", () => {
      registerTemplateRule({ kind: "low", priority: 0, match: () => true });
      registerTemplateRule({ kind: "high", priority: 100, match: () => true });
      expect(resolveTemplateKind(ctx())).toBe("high");
    });

    it("breaks priority ties in favor of the later registration (newest wins)", () => {
      registerTemplateRule({ kind: "first", priority: 10, match: () => true });
      registerTemplateRule({ kind: "second", priority: 10, match: () => true });
      expect(resolveTemplateKind(ctx())).toBe("second");
    });

    it("getTemplateRules returns rules sorted by priority desc then newest first", () => {
      registerTemplateRule({ kind: "a", priority: 5, match: () => true });
      registerTemplateRule({ kind: "b", priority: 10, match: () => true });
      registerTemplateRule({ kind: "c", priority: 5, match: () => true });
      const order = getTemplateRules().map((r) => r.kind);
      //? b (prio 10) first; then the two prio-5 rules with the LATER one (c)
      //? ahead of the earlier (a).
      expect(order).toEqual(["b", "c", "a"]);
    });

    it("lets a consumer override a built-in by registering a higher-priority rule", () => {
      registerDefaultTemplateRules();
      //? Built-ins use priority 10; a priority-50 rule wins for api files.
      registerTemplateRule({
        kind: "api_custom",
        priority: 50,
        match: (c) => c.fileKind === "api",
      });
      expect(resolveTemplateKind(ctx({ fileKind: "api" }))).toBe("api_custom");
    });
  });

  describe("resolveTemplateKind with no match", () => {
    it("returns null when no rule matches", () => {
      registerTemplateRule({ kind: "never", priority: 10, match: () => false });
      expect(resolveTemplateKind(ctx())).toBeNull();
    });
  });

  describe("registerTemplateKind", () => {
    it("registers both a selection rule and inline content", () => {
      registerTemplateKind("page_marketing", {
        match: (c) => c.fileKind === "page",
        content: "// marketing template",
      });
      expect(resolveTemplateKind(ctx({ fileKind: "page" }))).toBe("page_marketing");
      expect(getRegisteredTemplate("page_marketing")).toBe("// marketing template");
    });

    it("defaults the new kind to priority 100 so it beats the built-ins", () => {
      registerDefaultTemplateRules();
      registerTemplateKind("page_marketing", {
        match: (c) => c.fileKind === "page",
      });
      //? Built-in page rules are priority 10 / 0; the new kind at 100 wins.
      expect(
        resolveTemplateKind(
          ctx({ fileKind: "page", filePath: "C:/proj/src/admin/page.tsx" }),
        ),
      ).toBe("page_marketing");
      //? No content supplied → no content override registered.
      expect(getRegisteredTemplate("page_marketing")).toBeNull();
    });

    it("honors an explicit priority override", () => {
      registerTemplateRule({ kind: "winner", priority: 200, match: () => true });
      registerTemplateKind("loser", {
        match: () => true,
        priority: 50,
      });
      expect(resolveTemplateKind(ctx())).toBe("winner");
    });
  });

  describe("content overrides", () => {
    it("registerTemplate stores content readable via getRegisteredTemplate", () => {
      registerTemplate("api", "// custom api body");
      expect(getRegisteredTemplate("api")).toBe("// custom api body");
    });

    it("getRegisteredTemplate returns null for a kind with no override", () => {
      expect(getRegisteredTemplate("sync_server")).toBeNull();
    });

    it("listRegisteredTemplateKinds reflects every override", () => {
      registerTemplate("api", "a");
      registerTemplate("page_plain", "p");
      expect([...listRegisteredTemplateKinds()].toSorted()).toEqual(["api", "page_plain"]);
    });

    it("clearTemplateOverrides drops content but leaves selection rules intact", () => {
      registerDefaultTemplateRules();
      registerTemplate("api", "body");
      clearTemplateOverrides();
      expect(getRegisteredTemplate("api")).toBeNull();
      //? Rules untouched.
      expect(resolveTemplateKind(ctx({ fileKind: "api" }))).toBe("api");
    });

    it("clearTemplateRules drops rules but leaves content overrides intact", () => {
      registerDefaultTemplateRules();
      registerTemplate("api", "body");
      clearTemplateRules();
      expect(getTemplateRules()).toEqual([]);
      //? Override survives.
      expect(getRegisteredTemplate("api")).toBe("body");
    });
  });

  describe("DEFAULT_DASHBOARD_PATH_PATTERN", () => {
    it("matches dashboard-flavored segments and rejects unrelated paths", () => {
      expect(DEFAULT_DASHBOARD_PATH_PATTERN.test("/admin/")).toBe(true);
      expect(DEFAULT_DASHBOARD_PATH_PATTERN.test("/settings")).toBe(true);
      expect(DEFAULT_DASHBOARD_PATH_PATTERN.test("/marketing/")).toBe(false);
      //? Must be a path segment, not a substring (e.g. `administrate`).
      expect(DEFAULT_DASHBOARD_PATH_PATTERN.test("/administrate/")).toBe(false);
    });
  });
});
