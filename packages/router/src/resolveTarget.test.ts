import { describe, it, expect, vi, beforeEach } from "vitest";

import type {
  DeployConfigShape,
  DeployEnvironmentShape,
  ServicesConfigShape,
} from "@luckystack/core";
import type { RedisHealthStore } from "./redisHealthStore";

import {
  parseServiceFromPath,
  createServiceTargetResolver,
  registerServiceResolver,
  resolveServiceKey,
  type ServiceResolver,
} from "./resolveTarget";

//? resolveTarget.ts now calls `getLogger()` for the healthStore error path, so
//? we mock @luckystack/core to provide a silent logger. All other core symbols
//? remain unused by this module — the deploy + services topology is passed in
//? as plain objects on `ResolveTargetInput`. The `registeredResolver`
//? module-level latch IS reset between tests.
const mockLoggerError = vi.fn();
vi.mock("@luckystack/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@luckystack/core")>();
  return {
    ...actual,
    getLogger: () => ({ error: mockLoggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  };
});

const makeEnv = (overrides: Partial<DeployEnvironmentShape> = {}): DeployEnvironmentShape => ({
  redis: "redis://localhost:6379",
  mongo: "mongodb://localhost:27017",
  bindings: {},
  ...overrides,
});

const makeServices = (
  presets: ServicesConfigShape["presets"] = {},
): ServicesConfigShape => ({
  services: {},
  presets,
});

describe("parseServiceFromPath", () => {
  it("strips the /api/ prefix and returns the next segment", () => {
    expect(parseServiceFromPath("/api/vehicles/getAll")).toBe("vehicles");
  });

  it("strips the /sync/ prefix and returns the next segment", () => {
    expect(parseServiceFromPath("/sync/billing/foo")).toBe("billing");
  });

  it("returns the first segment verbatim for non-transport paths", () => {
    expect(parseServiceFromPath("/pages/home")).toBe("pages");
  });

  it("handles a single non-transport segment with no trailing slash", () => {
    expect(parseServiceFromPath("/admin")).toBe("admin");
  });

  it("returns the service even when the path has no segment after the service", () => {
    expect(parseServiceFromPath("/api/vehicles")).toBe("vehicles");
  });

  it("returns null when /api/ is followed by nothing", () => {
    //? remainder after stripping 'api/' is empty -> parseFirstSegment -> null.
    expect(parseServiceFromPath("/api/")).toBeNull();
  });

  it("returns null when /sync/ is followed by nothing", () => {
    expect(parseServiceFromPath("/sync/")).toBeNull();
  });

  it("returns null for the root path", () => {
    expect(parseServiceFromPath("/")).toBeNull();
  });

  it("returns null for an empty pathname", () => {
    expect(parseServiceFromPath("")).toBeNull();
  });

  it("parses a path that has no leading slash", () => {
    expect(parseServiceFromPath("api/vehicles/getAll")).toBe("vehicles");
  });

  it("parses a non-transport path that has no leading slash", () => {
    expect(parseServiceFromPath("pages/home")).toBe("pages");
  });

  it("treats 'apiv2' (api as a substring, not the segment) as a normal service", () => {
    //? 'apiv2' !== 'api', so the transport-strip branch is skipped and the
    //? whole first segment is returned unchanged.
    expect(parseServiceFromPath("/apiv2/things")).toBe("apiv2");
  });

  it("treats a deeper /api/<service>/<rest> path by returning only the service", () => {
    expect(parseServiceFromPath("/api/orders/v1/create/extra")).toBe("orders");
  });

  it("returns null for a bare /api with no service after it", () => {
    //? first segment === 'api' always enters the strip branch: the remainder
    //? after 'api' is '' -> parseFirstSegment('') -> null. The transport word
    //? is never returned as a service even when it stands alone.
    expect(parseServiceFromPath("/api")).toBeNull();
  });

  it("returns null for a bare /sync with no service after it", () => {
    expect(parseServiceFromPath("/sync")).toBeNull();
  });

  it("decodes a percent-encoded transport prefix and still extracts the service", () => {
    //? `%73ync` decodes to `sync`. Slicing the still-encoded remainder by the
    //? decoded length (4) used to misroute to `nc/...`; decoding the whole path
    //? once keeps the slice index consistent with what was decoded.
    expect(parseServiceFromPath("/%73ync/billing/foo")).toBe("billing");
  });

  it("decodes a percent-encoded /api prefix and still extracts the service", () => {
    expect(parseServiceFromPath("/%61pi/vehicles/getAll")).toBe("vehicles");
  });

  it("decodes a percent-encoded service name under a transport prefix", () => {
    expect(parseServiceFromPath("/api/my%2Dservice/x")).toBe("my-service");
  });

  it("returns null for a malformed percent-encoded path", () => {
    expect(parseServiceFromPath("/api/%ZZ")).toBeNull();
  });
});

describe("registerServiceResolver + resolveServiceKey", () => {
  beforeEach(() => {
    //? Reset the module-level registeredResolver latch so each test starts
    //? from the default-resolver state.
    registerServiceResolver(null);
  });

  const baseInput = {
    pathname: "/api/vehicles/getAll",
    headers: {} as Record<string, string | string[] | undefined>,
    host: "example.com",
  };

  it("falls back to parseServiceFromPath when no resolver is registered", () => {
    expect(resolveServiceKey(baseInput)).toBe("vehicles");
  });

  it("uses a registered resolver's non-null return value", () => {
    const resolver: ServiceResolver = vi.fn(() => "custom-service");
    registerServiceResolver(resolver);
    expect(resolveServiceKey(baseInput)).toBe("custom-service");
    expect(resolver).toHaveBeenCalledWith(baseInput);
  });

  it("defers to the default resolver when the custom resolver returns null", () => {
    const resolver: ServiceResolver = vi.fn(() => null);
    registerServiceResolver(resolver);
    expect(resolveServiceKey(baseInput)).toBe("vehicles");
    expect(resolver).toHaveBeenCalledOnce();
  });

  it("returns an empty-string service from the resolver verbatim (only null defers)", () => {
    //? The guard is `custom !== null`, so an empty string is a valid override
    //? and is returned as-is rather than deferring to the default.
    const resolver: ServiceResolver = vi.fn(() => "");
    registerServiceResolver(resolver);
    expect(resolveServiceKey(baseInput)).toBe("");
  });

  it("can route by host header via a custom resolver", () => {
    registerServiceResolver(({ host }) => (host === "admin.example.com" ? "admin" : null));
    expect(resolveServiceKey({ ...baseInput, host: "admin.example.com" })).toBe("admin");
    expect(resolveServiceKey({ ...baseInput, host: "api.example.com" })).toBe("vehicles");
  });

  it("unregisters the resolver when passed null and reverts to default", () => {
    registerServiceResolver(() => "custom");
    expect(resolveServiceKey(baseInput)).toBe("custom");
    registerServiceResolver(null);
    expect(resolveServiceKey(baseInput)).toBe("vehicles");
  });

  it("returns null when default resolver yields nothing and no custom resolver is set", () => {
    expect(resolveServiceKey({ ...baseInput, pathname: "/" })).toBeNull();
  });
});

describe("createServiceTargetResolver — startup validation", () => {
  it("throws when the current environment is not defined", () => {
    const deploy: DeployConfigShape = { resources: {}, environments: {} };
    expect(() =>
      createServiceTargetResolver({
        deploy,
        services: makeServices(),
        currentEnvKey: "production",
      }),
    ).toThrow(/Current environment 'production' not found/);
  });

  it("throws when the declared fallback env is missing", () => {
    const deploy: DeployConfigShape = {
      resources: {},
      environments: {
        dev: makeEnv({ fallback: "staging", bindings: {} }),
      },
    };
    expect(() =>
      createServiceTargetResolver({
        deploy,
        services: makeServices(),
        currentEnvKey: "dev",
      }),
    ).toThrow(/declares fallback 'staging' which is not defined/);
  });

  it("throws when a current-env binding URL is not a valid URL", () => {
    const deploy: DeployConfigShape = {
      resources: {},
      environments: {
        dev: makeEnv({ bindings: { vehicles: "not a url" } }),
      },
    };
    expect(() =>
      createServiceTargetResolver({
        deploy,
        services: makeServices(),
        currentEnvKey: "dev",
      }),
    ).toThrow(/Binding for service "vehicles" in env "dev" is not a valid URL/);
  });

  it("throws when a current-env binding URL has no explicit port", () => {
    const deploy: DeployConfigShape = {
      resources: {},
      environments: {
        dev: makeEnv({ bindings: { vehicles: "http://localhost" } }),
      },
    };
    expect(() =>
      createServiceTargetResolver({
        deploy,
        services: makeServices(),
        currentEnvKey: "dev",
      }),
    ).toThrow(/Binding for service "vehicles" in env "dev" is missing an explicit port/);
  });

  //? THE BUG THIS PINS: the check used `new URL(...).port`, which is EMPTY for a
  //? protocol's DEFAULT port — `new URL('https://h.com:443').port === ''`, exactly
  //? like the port-less `https://h.com`. So an operator who wrote `:443` was told
  //? their port was "missing" and had no way to comply short of picking a
  //? non-default port. Unsatisfiable for the most common production shape, and
  //? shipped that way since v0.2.0. The check now reads the raw URL text.
  it.each([
    ["https + explicit :443 (the default port — the case that was impossible)", "https://api.example.com:443/system"],
    ["http + explicit :80 (same trap on the other protocol)", "http://api.example.com:80/system"],
    ["a non-default port still passes", "https://api.example.com:8443/system"],
    ["IPv6 literal with an explicit port", "http://[::1]:4100/system"],
    ["userinfo containing '@' does not confuse the host split", "http://user:p@ss@api.example.com:4100/system"],
  ])("accepts %s", (_label, binding) => {
    const deploy: DeployConfigShape = {
      resources: {},
      environments: { dev: makeEnv({ bindings: { vehicles: binding } }) },
    };
    expect(() =>
      createServiceTargetResolver({ deploy, services: makeServices(), currentEnvKey: "dev" }),
    ).not.toThrow();
  });

  it.each([
    ["https with no port at all", "https://api.example.com/system"],
    ["http with no port at all", "http://api.example.com/system"],
    ["IPv6 literal with no port — its own colons are not a port", "http://[::1]/system"],
  ])("still rejects %s", (_label, binding) => {
    const deploy: DeployConfigShape = {
      resources: {},
      environments: { dev: makeEnv({ bindings: { vehicles: binding } }) },
    };
    expect(() =>
      createServiceTargetResolver({ deploy, services: makeServices(), currentEnvKey: "dev" }),
    ).toThrow(/missing an explicit port/);
  });

  it("throws when a FALLBACK-env binding URL has no explicit port", () => {
    //? Current env is port-clean; the missing port lives in the fallback env,
    //? which is validated separately.
    const deploy: DeployConfigShape = {
      resources: {},
      environments: {
        dev: makeEnv({ fallback: "staging", bindings: { vehicles: "http://localhost:4001" } }),
        staging: makeEnv({ bindings: { billing: "https://staging.example.com" } }),
      },
    };
    expect(() =>
      createServiceTargetResolver({
        deploy,
        services: makeServices(),
        currentEnvKey: "dev",
      }),
    ).toThrow(/Binding for service "billing" in env "staging" is missing an explicit port/);
  });

  it("does not throw when every binding declares an explicit port", () => {
    const deploy: DeployConfigShape = {
      resources: {},
      environments: {
        dev: makeEnv({ bindings: { vehicles: "http://localhost:4001" } }),
      },
    };
    expect(() =>
      createServiceTargetResolver({
        deploy,
        services: makeServices(),
        currentEnvKey: "dev",
      }),
    ).not.toThrow();
  });

  it("does not validate ports when environments is undefined and the current key is absent", () => {
    //? environments ?? {} -> {} -> currentEnv undefined -> throws not-found.
    const deploy: DeployConfigShape = { resources: {} };
    expect(() =>
      createServiceTargetResolver({
        deploy,
        services: makeServices(),
        currentEnvKey: "dev",
      }),
    ).toThrow(/Current environment 'dev' not found/);
  });
});

describe("createServiceTargetResolver — resolve() order", () => {
  const buildDeploy = (
    overrides: Partial<DeployConfigShape> = {},
  ): DeployConfigShape => ({
    resources: {},
    environments: {
      dev: makeEnv({
        fallback: "staging",
        bindings: { vehicles: "http://localhost:4001", billing: "http://localhost:4002" },
      }),
      staging: makeEnv({
        bindings: {
          vehicles: "https://staging.example.com:8443",
          billing: "https://staging.example.com:8443",
          reporting: "https://staging.example.com:8443",
        },
      }),
    },
    ...overrides,
  });

  it("returns the local binding for an owned + healthy service (no fallback)", () => {
    const resolver = createServiceTargetResolver({
      deploy: buildDeploy(),
      services: makeServices(),
      currentEnvKey: "dev",
    });
    expect(resolver.resolve("vehicles")).toEqual({
      target: "http://localhost:4001",
      viaFallback: false,
      resolvedEnvKey: "dev",
    });
  });

  it("falls back to the fallback env binding when the service is unhealthy", () => {
    const resolver = createServiceTargetResolver({
      deploy: buildDeploy(),
      services: makeServices(),
      currentEnvKey: "dev",
    });
    resolver.setLocalHealth("vehicles", false);
    expect(resolver.resolve("vehicles")).toEqual({
      target: "https://staging.example.com:8443",
      viaFallback: true,
      resolvedEnvKey: "staging",
    });
  });

  it("keeps serving the local binding for an unhealthy service when enableUnhealthyFallback is false", () => {
    const resolver = createServiceTargetResolver({
      deploy: buildDeploy({ routing: { enableUnhealthyFallback: false } }),
      services: makeServices(),
      currentEnvKey: "dev",
    });
    resolver.setLocalHealth("vehicles", false);
    expect(resolver.resolve("vehicles")).toEqual({
      target: "http://localhost:4001",
      viaFallback: false,
      resolvedEnvKey: "dev",
    });
  });

  it("routes a service that is NOT locally owned straight to the fallback env", () => {
    //? 'reporting' has no binding in dev but exists in staging.
    const resolver = createServiceTargetResolver({
      deploy: buildDeploy(),
      services: makeServices(),
      currentEnvKey: "dev",
    });
    expect(resolver.resolve("reporting")).toEqual({
      target: "https://staging.example.com:8443",
      viaFallback: true,
      resolvedEnvKey: "staging",
    });
  });

  it("returns null when the service resolves nowhere (no local binding, no fallback match)", () => {
    const resolver = createServiceTargetResolver({
      deploy: buildDeploy(),
      services: makeServices(),
      currentEnvKey: "dev",
    });
    expect(resolver.resolve("ghost")).toBeNull();
  });

  it("returns null when there is no fallback env and the local binding is unhealthy", () => {
    const deploy: DeployConfigShape = {
      resources: {},
      environments: {
        dev: makeEnv({ bindings: { vehicles: "http://localhost:4001" } }),
      },
    };
    const resolver = createServiceTargetResolver({
      deploy,
      services: makeServices(),
      currentEnvKey: "dev",
    });
    resolver.setLocalHealth("vehicles", false);
    expect(resolver.resolve("vehicles")).toBeNull();
  });

  //? Regression: a service key derived from an attacker-controlled URL segment
  //? must never resolve an INHERITED object member. `bindings['__proto__']` /
  //? `['constructor']` / `['toString']` would otherwise return a truthy
  //? non-string that becomes a bogus `target`, crashing `new URL()` in the HTTP
  //? proxy. Own-property guarding makes all of these resolve to null.
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"])(
    "returns null for the inherited-property key %s (proto-pollution guard)",
    (key) => {
      const resolver = createServiceTargetResolver({
        deploy: buildDeploy(),
        services: makeServices(),
        currentEnvKey: "dev",
      });
      expect(resolver.resolve(key)).toBeNull();
    },
  );
});

describe("createServiceTargetResolver — preset-scoped ownership", () => {
  const deploy: DeployConfigShape = {
    resources: {},
    environments: {
      dev: makeEnv({
        fallback: "staging",
        bindings: { vehicles: "http://localhost:4001", billing: "http://localhost:4002" },
      }),
      staging: makeEnv({
        bindings: {
          vehicles: "https://staging.example.com:8443",
          billing: "https://staging.example.com:8443",
        },
      }),
    },
  };

  it("treats only services in the named preset as locally owned", () => {
    const resolver = createServiceTargetResolver({
      deploy,
      services: makeServices({ apiBundle: { services: ["vehicles"] } }),
      currentEnvKey: "dev",
      localPresetKey: "apiBundle",
    });
    expect(resolver.getLocallyOwnedServices()).toEqual(["vehicles"]);
    //? vehicles is owned -> local binding.
    expect(resolver.resolve("vehicles")?.resolvedEnvKey).toBe("dev");
    //? billing is NOT in the preset -> straight to fallback even though dev
    //? has a binding for it.
    expect(resolver.resolve("billing")).toEqual({
      target: "https://staging.example.com:8443",
      viaFallback: true,
      resolvedEnvKey: "staging",
    });
  });

  it("owns every current-env binding when no preset is supplied", () => {
    const resolver = createServiceTargetResolver({
      deploy,
      services: makeServices(),
      currentEnvKey: "dev",
    });
    expect(resolver.getLocallyOwnedServices().sort()).toEqual(["billing", "vehicles"]);
  });

  it("throws at startup when the named preset is not registered", () => {
    //? An unknown preset silently collapsing to an empty owned-set was the bug:
    //? all traffic would route through fallback with no error. Fail fast instead.
    expect(() =>
      createServiceTargetResolver({
        deploy,
        services: makeServices(),
        currentEnvKey: "dev",
        localPresetKey: "missing",
      }),
    ).toThrow(/Preset 'missing' is not defined in services.config.ts/);
  });

  it("returns a fresh array copy from getLocallyOwnedServices (no internal mutation)", () => {
    const resolver = createServiceTargetResolver({
      deploy,
      services: makeServices(),
      currentEnvKey: "dev",
    });
    const first = resolver.getLocallyOwnedServices();
    first.push("tampered");
    expect(resolver.getLocallyOwnedServices()).not.toContain("tampered");
  });
});

describe("createServiceTargetResolver — setLocalHealth / getLocalHealth", () => {
  const deploy: DeployConfigShape = {
    resources: {},
    environments: {
      dev: makeEnv({ bindings: { vehicles: "http://localhost:4001" } }),
    },
  };

  it("defaults owned services to healthy", () => {
    const resolver = createServiceTargetResolver({
      deploy,
      services: makeServices(),
      currentEnvKey: "dev",
    });
    expect(resolver.getLocalHealth("vehicles")).toBe(true);
  });

  it("reflects a health flip through getLocalHealth", () => {
    const resolver = createServiceTargetResolver({
      deploy,
      services: makeServices(),
      currentEnvKey: "dev",
    });
    resolver.setLocalHealth("vehicles", false);
    expect(resolver.getLocalHealth("vehicles")).toBe(false);
    resolver.setLocalHealth("vehicles", true);
    expect(resolver.getLocalHealth("vehicles")).toBe(true);
  });

  it("ignores setLocalHealth for services that are not locally owned", () => {
    const resolver = createServiceTargetResolver({
      deploy,
      services: makeServices(),
      currentEnvKey: "dev",
    });
    resolver.setLocalHealth("not-owned", false);
    //? Unknown/unowned services read as healthy-by-default (?? true).
    expect(resolver.getLocalHealth("not-owned")).toBe(true);
  });

  it("reads an unknown service as healthy by default", () => {
    const resolver = createServiceTargetResolver({
      deploy,
      services: makeServices(),
      currentEnvKey: "dev",
    });
    expect(resolver.getLocalHealth("ghost")).toBe(true);
  });
});

describe("createServiceTargetResolver — healthStore integration", () => {
  const deploy: DeployConfigShape = {
    resources: {},
    environments: {
      dev: makeEnv({
        fallback: "staging",
        bindings: { vehicles: "http://localhost:4001" },
      }),
      staging: makeEnv({ bindings: { vehicles: "https://staging.example.com:8443" } }),
    },
  };

  const makeHealthStore = (overrides: Partial<RedisHealthStore> = {}): RedisHealthStore => ({
    hydrate: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
    get: vi.fn(() => true),
    close: vi.fn(async () => undefined),
    ...overrides,
  });

  it("reads health from the store instead of the in-memory map", () => {
    const store = makeHealthStore({ get: vi.fn(() => false) });
    const resolver = createServiceTargetResolver({
      deploy,
      services: makeServices(),
      currentEnvKey: "dev",
      healthStore: store,
    });
    //? store.get returns false -> unhealthy -> routes via fallback.
    expect(resolver.getLocalHealth("vehicles")).toBe(false);
    expect(resolver.resolve("vehicles")?.viaFallback).toBe(true);
    expect(store.get).toHaveBeenCalledWith("vehicles");
  });

  it("writes health changes through the store's set()", () => {
    const store = makeHealthStore();
    const resolver = createServiceTargetResolver({
      deploy,
      services: makeServices(),
      currentEnvKey: "dev",
      healthStore: store,
    });
    resolver.setLocalHealth("vehicles", false);
    expect(store.set).toHaveBeenCalledWith("vehicles", false);
  });

  it("does not call store.set for an unowned service", () => {
    const store = makeHealthStore();
    const resolver = createServiceTargetResolver({
      deploy,
      services: makeServices(),
      currentEnvKey: "dev",
      healthStore: store,
    });
    resolver.setLocalHealth("not-owned", false);
    expect(store.set).not.toHaveBeenCalled();
  });

  it("swallows a rejected store.set without throwing (fire-and-forget)", async () => {
    const store = makeHealthStore({ set: vi.fn(async () => { throw new Error("redis down"); }) });
    const resolver = createServiceTargetResolver({
      deploy,
      services: makeServices(),
      currentEnvKey: "dev",
      healthStore: store,
    });
    mockLoggerError.mockClear();
    //? The .catch handler logs via getLogger().error; the call itself must not throw.
    expect(() => resolver.setLocalHealth("vehicles", false)).not.toThrow();
    //? Let the rejected promise's .catch microtask run.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockLoggerError).toHaveBeenCalled();
  });
});
