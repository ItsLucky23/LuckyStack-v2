import { describe, it, expect, vi } from "vitest";

//? `routeMeta.ts` imports the version-token regexes from `../routeConventions`,
//? which transitively pulls `../routingRules` -> `@luckystack/core` (a value
//? import of `validatePagePath`). None of the parsers under test invoke it, so
//? we stub the single bound symbol to keep the test free of a core build.
vi.mock("@luckystack/core", () => ({
  validatePagePath: vi.fn(() => ({ valid: true })),
}));

import {
  extractPagePath,
  extractApiName,
  extractApiVersion,
  extractSyncPagePath,
  extractSyncName,
  extractSyncVersion,
} from "./routeMeta";

//? All six extractors are pure path/string parsers — no fs, no registry. They
//? normalize backslashes to forward slashes internally, so each is exercised
//? with both POSIX and Windows-style inputs where the path shape matters.

describe("routeMeta filename parsing", () => {
  describe("extractPagePath", () => {
    it("returns the folder segment between src/ and _api/", () => {
      expect(extractPagePath("project/src/dashboard/_api/getUser_v1.ts")).toBe(
        "dashboard",
      );
    });

    it("returns the nested folder path for a deeply-nested API", () => {
      expect(extractPagePath("project/src/admin/users/_api/list_v1.ts")).toBe(
        "admin/users",
      );
    });

    it("normalizes Windows backslashes before matching", () => {
      expect(extractPagePath("C:\\project\\src\\billing\\_api\\charge_v1.ts")).toBe(
        "billing",
      );
    });

    it("returns 'system' for an API directly under src/_api/", () => {
      expect(extractPagePath("project/src/_api/health_v1.ts")).toBe("system");
    });

    it("returns an empty string when no _api segment is present", () => {
      expect(extractPagePath("project/src/dashboard/page.tsx")).toBe("");
    });
  });

  describe("extractApiName", () => {
    it("strips the version suffix from the API name", () => {
      expect(extractApiName("src/dashboard/_api/getUser_v1.ts")).toBe("getUser");
    });

    it("keeps a multi-segment name after the _api marker", () => {
      //? Anything after `_api/` up to `.ts` is the raw name; nested folders
      //? become part of it before the version suffix is stripped.
      expect(extractApiName("src/admin/_api/users/list_v2.ts")).toBe("users/list");
    });

    it("falls back to the basename when no _api marker matches", () => {
      expect(extractApiName("some/loose/file_v3.ts")).toBe("file");
    });
  });

  describe("extractApiVersion", () => {
    it("extracts the version token as v<n>", () => {
      expect(extractApiVersion("src/dashboard/_api/getUser_v5.ts")).toBe("v5");
    });

    it("defaults to v1 when no version token is present", () => {
      expect(extractApiVersion("src/dashboard/_api/getUser.ts")).toBe("v1");
    });
  });

  describe("extractSyncPagePath", () => {
    it("returns the folder segment between src/ and _sync/", () => {
      expect(
        extractSyncPagePath("project/src/game/_sync/updateCounter_server_v1.ts"),
      ).toBe("game");
    });

    it("returns 'system' for a sync directly under src/_sync/", () => {
      //? Root syncs share the `'system'` sentinel with root APIs so the type-map
      //? key, the generated `FullSyncPath`, the dev loader's runtime route key,
      //? and the wire name the typed `syncRequest` sends all agree
      //? (`sync/system/<name>/v1`). A `'root'` sentinel silently broke root-sync
      //? dispatch.
      expect(extractSyncPagePath("project/src/_sync/ping_server_v1.ts")).toBe("system");
    });

    it("returns an empty string when no _sync segment is present", () => {
      expect(extractSyncPagePath("project/src/game/_api/getThing_v1.ts")).toBe("");
    });
  });

  describe("extractSyncName", () => {
    it("strips the _server_v<n> token from a sync server name", () => {
      expect(
        extractSyncName("src/game/_sync/updateCounter_server_v1.ts"),
      ).toBe("updateCounter");
    });

    it("strips the _client_v<n> token from a sync client name", () => {
      expect(
        extractSyncName("src/game/_sync/updateCounter_client_v2.ts"),
      ).toBe("updateCounter");
    });

    it("falls back to the basename (token-stripped) when no _sync marker matches", () => {
      expect(extractSyncName("loose/updateThing_server_v1.ts")).toBe("updateThing");
    });
  });

  describe("extractSyncVersion", () => {
    it("extracts the version from a server sync filename", () => {
      expect(
        extractSyncVersion("src/game/_sync/updateCounter_server_v4.ts"),
      ).toBe("v4");
    });

    it("extracts the version from a client sync filename", () => {
      expect(
        extractSyncVersion("src/game/_sync/updateCounter_client_v8.ts"),
      ).toBe("v8");
    });

    it("defaults to v1 when no version token is present", () => {
      expect(extractSyncVersion("src/game/_sync/updateCounter_server.ts")).toBe("v1");
    });
  });
});
