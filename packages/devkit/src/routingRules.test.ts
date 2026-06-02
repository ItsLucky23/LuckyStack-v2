import { describe, it, expect, beforeEach, vi } from "vitest";

//? `routingRules.ts` does a VALUE import of `validatePagePath` (and types)
//? from `@luckystack/core`. None of the predicates under test call it, but the
//? import must resolve, so we stub the single symbol the module binds. Keeping
//? the mock minimal means a real `@luckystack/core` build is never required.
vi.mock("@luckystack/core", () => ({
  validatePagePath: vi.fn(() => ({ valid: true })),
}));

import {
  isApiFileName,
  isSyncFileName,
  isSyncServerFileName,
  isSyncClientFileName,
  isRouteTestFile,
  registerRoutingRules,
  getRoutingRules,
  apiMarkerSegment,
  syncMarkerSegment,
} from "./routingRules";
import {
  API_VERSION_TOKEN_REGEX,
  SYNC_VERSION_TOKEN_REGEX,
} from "./routeConventions";

//? `registerRoutingRules` mutates module-level state by replacing the active
//? rules. Reset to defaults before every test so override-tests don't leak.
beforeEach(() => {
  registerRoutingRules({});
});

describe("route-naming predicates (default rules)", () => {
  describe("isApiFileName", () => {
    it("accepts a versioned API filename", () => {
      expect(isApiFileName("getUser_v1.ts")).toBe(true);
      expect(isApiFileName("getUser_v12.ts")).toBe(true);
    });

    it("rejects a filename without a version suffix", () => {
      expect(isApiFileName("getUser.ts")).toBe(false);
    });

    it("rejects a non-.ts file even when versioned", () => {
      expect(isApiFileName("getUser_v1.js")).toBe(false);
      expect(isApiFileName("getUser_v1.tsx")).toBe(false);
    });

    it("also matches a sync server filename (its stem still ends in _v<n>)", () => {
      //? The API regex only anchors `_v<n>` to the END of the stem. A sync
      //? server filename ends in `_server_v1`, whose stem terminates in `_v1`,
      //? so `isApiFileName` returns true. Disambiguation between API and sync
      //? files is done by FOLDER marker (`_api/` vs `_sync/`), not by filename
      //? alone — these predicates are intentionally name-only.
      expect(isApiFileName("updateCounter_server_v1.ts")).toBe(true);
    });

    it("rejects a version token that is not at the end of the stem", () => {
      expect(isApiFileName("get_v1_user.ts")).toBe(false);
    });
  });

  describe("isSyncServerFileName", () => {
    it("accepts a sync server filename", () => {
      expect(isSyncServerFileName("updateCounter_server_v1.ts")).toBe(true);
    });

    it("rejects a sync client filename", () => {
      expect(isSyncServerFileName("updateCounter_client_v1.ts")).toBe(false);
    });

    it("rejects a plain API filename", () => {
      expect(isSyncServerFileName("getUser_v1.ts")).toBe(false);
    });

    it("rejects a non-.ts extension", () => {
      expect(isSyncServerFileName("updateCounter_server_v1.tsx")).toBe(false);
    });
  });

  describe("isSyncClientFileName", () => {
    it("accepts a sync client filename", () => {
      expect(isSyncClientFileName("updateCounter_client_v1.ts")).toBe(true);
    });

    it("rejects a sync server filename", () => {
      expect(isSyncClientFileName("updateCounter_server_v1.ts")).toBe(false);
    });
  });

  describe("isSyncFileName (server OR client)", () => {
    it("accepts both server and client sync filenames", () => {
      expect(isSyncFileName("updateCounter_server_v1.ts")).toBe(true);
      expect(isSyncFileName("updateCounter_client_v2.ts")).toBe(true);
    });

    it("rejects a plain API filename (no _server/_client token)", () => {
      expect(isSyncFileName("getUser_v1.ts")).toBe(false);
    });

    it("rejects a non-.ts extension", () => {
      expect(isSyncFileName("updateCounter_server_v1.js")).toBe(false);
    });
  });

  describe("isRouteTestFile", () => {
    it("recognizes per-route test files by the .tests.ts suffix", () => {
      expect(isRouteTestFile("getUser_v1.tests.ts")).toBe(true);
      expect(isRouteTestFile("src/foo/_api/getUser_v1.tests.ts")).toBe(true);
    });

    it("does not treat a normal route file as a test file", () => {
      expect(isRouteTestFile("getUser_v1.ts")).toBe(false);
    });
  });
});

describe("routing rules registry", () => {
  it("getRoutingRules returns the default markers and regexes", () => {
    const rules = getRoutingRules();
    expect(rules.apiMarker).toBe("_api");
    expect(rules.syncMarker).toBe("_sync");
    expect(rules.privateFolderPrefix).toBe("_");
    expect(rules.scaffoldIgnoredFolders).toContain("_api");
    expect(rules.scaffoldIgnoredFolders).toContain("_server");
  });

  it("apiMarkerSegment / syncMarkerSegment wrap the marker in slashes", () => {
    expect(apiMarkerSegment()).toBe("/_api/");
    expect(syncMarkerSegment()).toBe("/_sync/");
  });

  it("registerRoutingRules overrides markers and the predicates honor it", () => {
    registerRoutingRules({ apiMarker: "_routes" });
    expect(getRoutingRules().apiMarker).toBe("_routes");
    expect(apiMarkerSegment()).toBe("/_routes/");
    //? The version regex was not overridden, so default API matching persists.
    expect(isApiFileName("getUser_v1.ts")).toBe(true);
  });

  it("registerRoutingRules can swap the API version regex", () => {
    //? Require a literal `_version<n>` suffix instead of `_v<n>`.
    registerRoutingRules({ apiVersionRegex: /_version(\d+)$/ });
    expect(isApiFileName("getUser_version1.ts")).toBe(true);
    expect(isApiFileName("getUser_v1.ts")).toBe(false);
  });

  it("registerRoutingRules merges over defaults (untouched fields keep defaults)", () => {
    registerRoutingRules({ apiMarker: "_routes" });
    //? syncMarker was not provided, so it falls back to the default.
    expect(getRoutingRules().syncMarker).toBe("_sync");
  });
});

describe("version token regexes", () => {
  it("API_VERSION_TOKEN_REGEX captures the trailing version number", () => {
    const match = "getUser_v7".match(API_VERSION_TOKEN_REGEX);
    expect(match?.[1]).toBe("7");
    expect("getUser".match(API_VERSION_TOKEN_REGEX)).toBeNull();
  });

  it("SYNC_VERSION_TOKEN_REGEX captures kind + version number", () => {
    const serverMatch = "updateCounter_server_v3".match(SYNC_VERSION_TOKEN_REGEX);
    expect(serverMatch?.[1]).toBe("server");
    expect(serverMatch?.[2]).toBe("3");
    const clientMatch = "updateCounter_client_v9".match(SYNC_VERSION_TOKEN_REGEX);
    expect(clientMatch?.[1]).toBe("client");
    expect(clientMatch?.[2]).toBe("9");
  });
});
