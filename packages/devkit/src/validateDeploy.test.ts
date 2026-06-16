import { describe, it, expect } from "vitest";

import type {
  DeployConfigShape,
  ServicesConfigShape,
} from "@luckystack/core";

import { validateDeploy, type ValidationFinding } from "./validateDeploy";

//? `validateDeploy` is a pure function over `{ services, deploy, env }`. The
//? only `@luckystack/core` imports it carries are `import type`, which the
//? compiler erases — so no core registry / infra is touched at runtime and no
//? mock is required. Each test crafts the MINIMAL input that trips exactly one
//? rule (or proves a rule does NOT fire) so the asserted finding code is
//? unambiguously caused by the branch under test.

//? Helper: collect the `code` strings present in a result, for set-style
//? assertions that don't care about ordering or message text.
const codesOf = (findings: ValidationFinding[]): string[] => findings.map((f) => f.code);

//? A fully-valid baseline: one service, assigned to one preset, bound in one
//? environment with an explicit port, redis + mongo resources present, and all
//? env vars satisfied. Tests clone + mutate one slice of this to isolate a
//? single failing rule.
const validServices = (): ServicesConfigShape => ({
  services: { api: { source: "api" } },
  presets: { apiPreset: { services: ["api"] } },
});

const validDeploy = (): DeployConfigShape => ({
  resources: {
    redisMain: { type: "redis", urlEnvKey: "REDIS_URL" },
    mongoMain: { type: "mongo", urlEnvKey: "MONGO_URL" },
  },
  environments: {
    production: {
      redis: "redisMain",
      mongo: "mongoMain",
      bindings: { api: "http://10.0.0.1:4001" },
    },
  },
});

const validEnv = (): Record<string, string | undefined> => ({
  REDIS_URL: "redis://localhost:6379",
  MONGO_URL: "mongodb://localhost:27017",
});

//? Typed narrow helpers so tests can mutate known-present fixture properties
//? without triggering no-non-null-assertion warnings.
type EnvMap = NonNullable<DeployConfigShape['environments']>;
type EnvEntry = NonNullable<EnvMap[string]>;

const getEnvs = (deploy: DeployConfigShape): EnvMap => {
  if (!deploy.environments) throw new Error('test fixture missing environments');
  return deploy.environments;
};

const getProd = (deploy: DeployConfigShape): EnvEntry => {
  const prod = getEnvs(deploy).production;
  if (!prod) throw new Error('test fixture missing production environment');
  return prod;
};

const getResource = (deploy: DeployConfigShape, key: string): NonNullable<DeployConfigShape['resources'][string]> => {
  const r = deploy.resources[key];
  if (!r) throw new Error(`test fixture missing resource: ${key}`);
  return r;
};

describe("validateDeploy", () => {
  describe("happy path", () => {
    it("returns ok with zero findings for a fully-valid config", () => {
      const result = validateDeploy({
        services: validServices(),
        deploy: validDeploy(),
        env: validEnv(),
      });
      expect(result.ok).toBe(true);
      expect(result.findings).toEqual([]);
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
    });
  });

  describe("service-preset assignment (rule 1)", () => {
    it("flags a service declared but assigned to no preset", () => {
      const services = validServices();
      services.presets = {}; //? api now belongs to no preset
      const result = validateDeploy({
        services,
        deploy: validDeploy(),
        env: validEnv(),
      });
      const finding = result.findings.find((f) => f.code === "service-unassigned");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("api");
      expect(result.ok).toBe(false);
    });

    it("flags a service that appears in more than one preset", () => {
      const services = validServices();
      services.presets = {
        presetA: { services: ["api"] },
        presetB: { services: ["api"] },
      };
      const result = validateDeploy({
        services,
        deploy: validDeploy(),
        env: validEnv(),
      });
      const finding = result.findings.find((f) => f.code === "service-in-multiple-presets");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      //? Both owning presets are named in the message.
      expect(finding?.message).toContain("presetA");
      expect(finding?.message).toContain("presetB");
    });
  });

  describe("preset references unknown service (rule 2)", () => {
    it("flags a preset that lists a service absent from services.services", () => {
      const services = validServices();
      services.presets = { apiPreset: { services: ["api", "ghost"] } };
      const result = validateDeploy({
        services,
        deploy: validDeploy(),
        env: validEnv(),
      });
      const finding = result.findings.find(
        (f) => f.code === "preset-references-unknown-service",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("ghost");
    });
  });

  describe("binding references unknown service (rule 3)", () => {
    it("flags an environment binding for a service that does not exist", () => {
      const deploy = validDeploy();
      getProd(deploy).bindings = {
        api: "http://10.0.0.1:4001",
        phantom: "http://10.0.0.2:4002",
      };
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env: validEnv(),
      });
      const finding = result.findings.find(
        (f) => f.code === "binding-references-unknown-service",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("phantom");
    });
  });

  describe("binding URL validity (rules in environment loop)", () => {
    it("flags a binding URL that does not parse", () => {
      const deploy = validDeploy();
      getProd(deploy).bindings = { api: "not a url" };
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env: validEnv(),
      });
      const finding = result.findings.find((f) => f.code === "binding-invalid-url");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      //? An unparseable URL never reaches the port check, so no missing-port
      //? finding should accompany it.
      expect(codesOf(result.findings)).not.toContain("binding-missing-port");
    });

    it("flags a binding URL that parses but omits an explicit port", () => {
      const deploy = validDeploy();
      getProd(deploy).bindings = { api: "http://10.0.0.1" };
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env: validEnv(),
      });
      const finding = result.findings.find((f) => f.code === "binding-missing-port");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      //? A valid-but-port-less URL is NOT also reported as invalid.
      expect(codesOf(result.findings)).not.toContain("binding-invalid-url");
    });

    it("accepts a binding URL with an explicit port (no port/url findings)", () => {
      const result = validateDeploy({
        services: validServices(),
        deploy: validDeploy(),
        env: validEnv(),
      });
      expect(codesOf(result.findings)).not.toContain("binding-missing-port");
      expect(codesOf(result.findings)).not.toContain("binding-invalid-url");
    });
  });

  describe("unknown redis/mongo resources (rules 5)", () => {
    it("flags an environment that references a redis resource not in resources", () => {
      const deploy = validDeploy();
      getProd(deploy).redis = "missingRedis";
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env: validEnv(),
      });
      const finding = result.findings.find((f) => f.code === "unknown-redis-resource");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("missingRedis");
    });

    it("flags an environment that references a mongo resource not in resources", () => {
      const deploy = validDeploy();
      getProd(deploy).mongo = "missingMongo";
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env: validEnv(),
      });
      const finding = result.findings.find((f) => f.code === "unknown-mongo-resource");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("missingMongo");
    });
  });

  describe("fallback environment (rules 4 + 6)", () => {
    it("flags a fallback that names a non-existent environment", () => {
      const deploy = validDeploy();
      getProd(deploy).fallback = "ghostEnv";
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env: validEnv(),
      });
      const finding = result.findings.find((f) => f.code === "unknown-fallback-env");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("ghostEnv");
    });

    it("flags a fallback whose redis resource differs from the primary", () => {
      const deploy = validDeploy();
      deploy.resources.redisAlt = { type: "redis", urlEnvKey: "REDIS_URL" };
      getEnvs(deploy).staging = {
        redis: "redisAlt",
        mongo: "mongoMain",
        bindings: { api: "http://10.0.0.9:4009" },
      };
      getProd(deploy).fallback = "staging";
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env: validEnv(),
      });
      const finding = result.findings.find((f) => f.code === "fallback-redis-mismatch");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      //? Mongo matches here, so no mongo-mismatch should be raised.
      expect(codesOf(result.findings)).not.toContain("fallback-mongo-mismatch");
    });

    it("flags a fallback whose mongo resource differs from the primary", () => {
      const deploy = validDeploy();
      deploy.resources.mongoAlt = { type: "mongo", urlEnvKey: "MONGO_URL" };
      getEnvs(deploy).staging = {
        redis: "redisMain",
        mongo: "mongoAlt",
        bindings: { api: "http://10.0.0.9:4009" },
      };
      getProd(deploy).fallback = "staging";
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env: validEnv(),
      });
      const finding = result.findings.find((f) => f.code === "fallback-mongo-mismatch");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(codesOf(result.findings)).not.toContain("fallback-redis-mismatch");
    });

    it("raises no fallback findings when the fallback shares both resources", () => {
      const deploy = validDeploy();
      getEnvs(deploy).staging = {
        redis: "redisMain",
        mongo: "mongoMain",
        bindings: { api: "http://10.0.0.9:4009" },
      };
      getProd(deploy).fallback = "staging";
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env: validEnv(),
      });
      const codes = codesOf(result.findings);
      expect(codes).not.toContain("unknown-fallback-env");
      expect(codes).not.toContain("fallback-redis-mismatch");
      expect(codes).not.toContain("fallback-mongo-mismatch");
    });
  });

  describe("env-var presence (rules 7+8, warnings)", () => {
    it("warns when a resource's urlEnvKey is unset", () => {
      const env = validEnv();
      delete env.REDIS_URL;
      const result = validateDeploy({
        services: validServices(),
        deploy: validDeploy(),
        env,
      });
      const finding = result.findings.find((f) => f.code === "missing-resource-env-var");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("REDIS_URL");
      //? Warnings do not flip `ok`.
      expect(result.ok).toBe(true);
    });

    it("treats an empty-string env value the same as unset", () => {
      const env = validEnv();
      env.MONGO_URL = "";
      const result = validateDeploy({
        services: validServices(),
        deploy: validDeploy(),
        env,
      });
      const finding = result.findings.find(
        (f) => f.code === "missing-resource-env-var" && f.message.includes("MONGO_URL"),
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
    });

    it("warns when a synchronizedEnvKeys entry is unset", () => {
      const deploy = validDeploy();
      getResource(deploy, 'redisMain').synchronizedEnvKeys = ["SHARED_SECRET"];
      const env = validEnv(); //? SHARED_SECRET intentionally absent
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env,
      });
      const finding = result.findings.find(
        (f) => f.code === "missing-synchronized-env-var",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("SHARED_SECRET");
    });

    it("does not warn for a synchronized key that is present", () => {
      const deploy = validDeploy();
      getResource(deploy, 'redisMain').synchronizedEnvKeys = ["SHARED_SECRET"];
      const env = validEnv();
      env.SHARED_SECRET = "value";
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env,
      });
      expect(codesOf(result.findings)).not.toContain("missing-synchronized-env-var");
    });
  });

  describe("service bound in no environment (rule 9, warning)", () => {
    it("warns when an assigned service is never bound in any environment", () => {
      const deploy = validDeploy();
      //? Drop the binding so `api` is assigned to a preset but unbound.
      getProd(deploy).bindings = {};
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env: validEnv(),
      });
      const finding = result.findings.find(
        (f) => f.code === "service-bound-in-no-environment",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("api");
      //? Warning only — still ok.
      expect(result.ok).toBe(true);
    });
  });

  describe("counts + ok aggregation", () => {
    it("counts errors and warnings independently and sets ok from errors only", () => {
      const services = validServices();
      services.presets = {}; //? service-unassigned (error)
      const deploy = validDeploy();
      delete getProd(deploy).bindings.api; //? service-bound-in-no-environment (warning)
      const env = validEnv();
      delete env.REDIS_URL; //? missing-resource-env-var (warning)
      const result = validateDeploy({ services, deploy, env });
      expect(result.errorCount).toBeGreaterThanOrEqual(1);
      expect(result.warningCount).toBeGreaterThanOrEqual(2);
      expect(result.findings.length).toBe(result.errorCount + result.warningCount);
      expect(result.ok).toBe(false); //? any error flips ok
    });

    it("defaults environments to an empty object when omitted", () => {
      const deploy: DeployConfigShape = {
        resources: { redisMain: { type: "redis", urlEnvKey: "REDIS_URL" } },
        //? no `environments` key at all
      };
      const result = validateDeploy({
        services: validServices(),
        deploy,
        env: { REDIS_URL: "x" },
      });
      //? With no environments, `api` is assigned to a preset but bound nowhere.
      expect(codesOf(result.findings)).toContain("service-bound-in-no-environment");
      //? No environment-loop findings (redis/mongo/binding) should fire.
      expect(codesOf(result.findings)).not.toContain("unknown-redis-resource");
    });
  });
});
