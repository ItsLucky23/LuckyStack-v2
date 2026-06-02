import { describe, it, expect, beforeEach } from "vitest";

import {
  registerSentryConfig,
  getSentryConfig,
  DEFAULT_SENTRY_CONFIG,
} from "./sentryConfig";

describe("sentry config registry", () => {
  beforeEach(() => {
    //? `registerSentryConfig` deep-merges over DEFAULT_SENTRY_CONFIG, so
    //? re-registering the empty object restores the module-level active
    //? config to a value structurally equal to the default before each test.
    registerSentryConfig({});
  });

  describe("DEFAULT_SENTRY_CONFIG", () => {
    it("filters the documented default noise errors on the server side", () => {
      expect(DEFAULT_SENTRY_CONFIG.server?.ignoreErrors).toEqual([
        "Socket connection timeout",
        "ECONNREFUSED",
      ]);
    });

    it("has no client block by default", () => {
      expect(DEFAULT_SENTRY_CONFIG.client).toBeUndefined();
    });
  });

  describe("getSentryConfig before any explicit registration", () => {
    it("returns a value structurally equal to the default", () => {
      expect(getSentryConfig()).toEqual(DEFAULT_SENTRY_CONFIG);
    });
  });

  describe("registerSentryConfig deep-merge", () => {
    it("merges a server sample-rate block while preserving default ignoreErrors", () => {
      registerSentryConfig({
        server: { tracesSampleRate: { development: 1, production: 0.1 } },
      });
      const cfg = getSentryConfig();
      expect(cfg.server?.tracesSampleRate).toEqual({ development: 1, production: 0.1 });
      //? ignoreErrors came from the default and must survive the merge because
      //? we only overrode a sibling key inside `server`.
      expect(cfg.server?.ignoreErrors).toEqual([
        "Socket connection timeout",
        "ECONNREFUSED",
      ]);
    });

    it("overrides ignoreErrors when explicitly supplied (arrays replace, not merge)", () => {
      registerSentryConfig({ server: { ignoreErrors: ["MyOwnNoise"] } });
      expect(getSentryConfig().server?.ignoreErrors).toEqual(["MyOwnNoise"]);
    });

    it("can set ignoreErrors to an empty array to disable filtering", () => {
      registerSentryConfig({ server: { ignoreErrors: [] } });
      expect(getSentryConfig().server?.ignoreErrors).toEqual([]);
    });

    it("adds a client block without disturbing the default server block", () => {
      registerSentryConfig({
        client: {
          tracesSampleRate: { development: 1, production: 0.05 },
          replaysSessionSampleRate: { development: 0, production: 0.1 },
        },
      });
      const cfg = getSentryConfig();
      expect(cfg.client?.tracesSampleRate).toEqual({ development: 1, production: 0.05 });
      expect(cfg.client?.replaysSessionSampleRate).toEqual({ development: 0, production: 0.1 });
      //? server defaults untouched by a client-only registration.
      expect(cfg.server?.ignoreErrors).toEqual([
        "Socket connection timeout",
        "ECONNREFUSED",
      ]);
    });

    it("each registration re-merges from the default (not cumulative across calls)", () => {
      registerSentryConfig({ server: { ignoreErrors: ["First"] } });
      registerSentryConfig({ client: { tracesSampleRate: { development: 1, production: 1 } } });
      const cfg = getSentryConfig();
      //? The second call started from DEFAULT_SENTRY_CONFIG again, so the
      //? `First` override from the first call is gone — ignoreErrors is back
      //? to the default. This documents the replace-from-default semantics.
      expect(cfg.server?.ignoreErrors).toEqual([
        "Socket connection timeout",
        "ECONNREFUSED",
      ]);
      expect(cfg.client?.tracesSampleRate).toEqual({ development: 1, production: 1 });
    });

    it("does not mutate DEFAULT_SENTRY_CONFIG when merging overrides", () => {
      registerSentryConfig({ server: { ignoreErrors: ["MutationProbe"] } });
      //? The exported default object must remain pristine — deepMerge clones.
      expect(DEFAULT_SENTRY_CONFIG.server?.ignoreErrors).toEqual([
        "Socket connection timeout",
        "ECONNREFUSED",
      ]);
    });
  });
});
