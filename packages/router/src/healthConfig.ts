import { getDeployConfig } from '@luckystack/core';

//? Router-owned health config keys. Declared here (NOT in @luckystack/core's
//? canonical DeployRoutingShape) via interface declaration-merging — the same
//? ownership-respecting pattern hookPayloads.ts uses to augment HookPayloads.
//? Core stays the single source of the deploy *shape*; the router contributes
//? the keys IT consumes. A missing key keeps prior behavior (additive).

declare module '@luckystack/core' {
  interface DeployRoutingShape {
    /**
     * Predicate deciding whether a backend HTTP status counts as HEALTHY for the
     * dev fallback health poller. DEFAULT (key absent) → only 2xx/3xx are healthy;
     * a 4xx (401/403/404/...) or 5xx is UNHEALTHY. Supply a custom predicate to
     * widen/narrow the success band (e.g. accept a backend's `401` liveness probe).
     */
    healthyStatusPredicate?: (status: number) => boolean;
    /**
     * TTL (seconds) applied to every `router:health:<env>:<service>` key written
     * to the shared Redis health store. Gives stale health a self-heal horizon:
     * if the writing router dies without flipping a service back, the key expires
     * and siblings fall back to the absent-key default instead of pinning a dead
     * verdict forever. DEFAULT (key absent / non-positive) → 60s.
     */
    healthStoreTtlSeconds?: number;
  }
}

/** Built-in: only 2xx/3xx responses are healthy. 4xx + 5xx are unhealthy. */
export const DEFAULT_HEALTHY_STATUS_PREDICATE = (status: number): boolean =>
  status >= 200 && status < 400;

/** Built-in TTL for shared-health Redis keys when no config override is set. */
export const DEFAULT_HEALTH_STORE_TTL_SECONDS = 60;

/**
 * Resolve the configured "is this status healthy?" predicate, falling back to
 * the 2xx/3xx default. Read at call time (never cached) so a re-registered
 * deploy config is honored.
 */
export const getHealthyStatusPredicate = (): ((status: number) => boolean) =>
  getDeployConfig().routing?.healthyStatusPredicate ?? DEFAULT_HEALTHY_STATUS_PREDICATE;

/**
 * Resolve the shared-health Redis key TTL in seconds. A missing or non-positive
 * configured value collapses to the built-in default so a key always gets a TTL.
 */
export const getHealthStoreTtlSeconds = (): number => {
  const configured = getDeployConfig().routing?.healthStoreTtlSeconds;
  if (typeof configured === 'number' && configured > 0) return configured;
  return DEFAULT_HEALTH_STORE_TTL_SECONDS;
};
