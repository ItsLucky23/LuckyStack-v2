import type {
  DeployConfigShape,
  DeployEnvironmentShape,
  ServicesConfigShape,
} from '@luckystack/core';
import type { RedisHealthStore } from './redisHealthStore';

type DeployConfig = DeployConfigShape;
type EnvironmentDefinition = DeployEnvironmentShape;
type ServicesConfig = ServicesConfigShape;

/**
 * Resolves the target URL for a given service key, using the
 * deploy.config.ts topology. Returns null when no target can be resolved
 * (unknown service, no binding in the current environment, no fallback).
 *
 * Resolution order:
 *   1. If the service is "owned" by the locally running preset, return the
 *      current environment's binding.
 *   2. If the current env declares a `fallback`, try the fallback env's
 *      binding for that service.
 *   3. Otherwise return null — the HTTP handler emits `serviceNotAssigned`.
 *
 * The resolver is also the single entry point for the `switch new traffic
 * to local when healthy` behavior. The health poller mutates the in-memory
 * health map shared with this resolver via `setLocalHealth(service, healthy)`.
 * When a service is marked unhealthy and `enableUnhealthyFallback` is on in
 * `deploy.config.ts`, the resolver skips the local binding and returns the
 * fallback binding instead.
 */
export interface ResolveTargetInput {
  deploy: DeployConfig;
  services: ServicesConfig;
  currentEnvKey: string;
  /**
   * Preset that the locally-running backend bundle contains. When set, only
   * services in this preset are treated as "owned locally"; other services
   * fall through to the fallback env directly.
   *
   * Not provided → every service with a binding in the current env is "owned".
   */
  localPresetKey?: string;
  /**
   * Optional shared-state store. When provided, the resolver reads/writes
   * health through it so multiple router instances see the same view and
   * propagate changes via pub/sub. Not provided → in-memory per-process.
   */
  healthStore?: RedisHealthStore;
}

export interface ResolveTargetResult {
  target: string;
  /** Was this resolved via the fallback environment? (informational) */
  viaFallback: boolean;
  /** Key of the environment that owns this binding. */
  resolvedEnvKey: string;
}

export interface ServiceTargetResolver {
  resolve: (service: string) => ResolveTargetResult | null;
  setLocalHealth: (service: string, healthy: boolean) => void;
  getLocalHealth: (service: string) => boolean;
  /** Services considered "owned locally" — the set the health poller probes. */
  getLocallyOwnedServices: () => string[];
}

const parseFirstSegment = (pathname: string): string | null => {
  const trimmed = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const firstSlash = trimmed.indexOf('/');
  const segment = firstSlash === -1 ? trimmed : trimmed.slice(0, firstSlash);
  if (!segment) return null;
  return segment;
};

/**
 * Default service resolver: first non-transport path segment.
 *   /api/vehicles/getAll → 'vehicles'
 *   /sync/billing/foo    → 'billing'
 *   /pages/home          → 'pages'
 *
 * Consumers needing host-based or header-based routing register a custom
 * resolver via `registerServiceResolver(...)`.
 */
export const parseServiceFromPath = (pathname: string): string | null => {
  const first = parseFirstSegment(pathname);
  if (!first) return null;

  if (first === 'api' || first === 'sync') {
    const afterTransport = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    const remainder = afterTransport.slice(first.length + 1);
    return parseFirstSegment(remainder);
  }

  return first;
};

/**
 * Pluggable service-resolution function. The router invokes this for
 * every incoming request to figure out which service the request maps to.
 *
 * Implementations receive the full request (path, headers, host) and
 * return the service key or null. Returning null falls through to the
 * default resolver — useful for "try custom rules first, default
 * otherwise" flows.
 */
export type ServiceResolver = (input: {
  pathname: string;
  /** Lowercase header map; same shape Node passes via `req.headers`. */
  headers: Record<string, string | string[] | undefined>;
  /** Host header value (already pulled out for convenience). */
  host: string;
}) => string | null;

let registeredResolver: ServiceResolver | null = null;

/**
 * Replace the default first-path-segment service resolver with a custom
 * function. Common use cases:
 *
 *  - Host-based routing: `api.example.com` → `api`, `admin.example.com` → `admin`.
 *  - Header-based routing: `X-Tenant-Service` header picks the service.
 *  - Prefix rules: paths starting with `/v2/` go to a v2 service.
 *
 * Return null to defer to the default resolver. Pass `null` to unregister.
 */
export const registerServiceResolver = (resolver: ServiceResolver | null): void => {
  registeredResolver = resolver;
};

/** Resolve a service key for an incoming request, honoring the registered resolver. */
export const resolveServiceKey = (input: {
  pathname: string;
  headers: Record<string, string | string[] | undefined>;
  host: string;
}): string | null => {
  if (registeredResolver) {
    const custom = registeredResolver(input);
    if (custom !== null) return custom;
  }
  return parseServiceFromPath(input.pathname);
};

const assertBindingsHaveExplicitPorts = (env: EnvironmentDefinition, envKey: string): void => {
  for (const [service, target] of Object.entries(env.bindings)) {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new Error(
        `[router] Binding for service "${service}" in env "${envKey}" is not a valid URL: "${target}".`,
      );
    }
    if (!url.port) {
      throw new Error(
        `[router] Binding for service "${service}" in env "${envKey}" is missing an explicit port: "${target}". ` +
        `Port-less URLs silently fall through to the protocol default (80/443) which is rarely what a multi-instance deploy wants. ` +
        `Set an explicit port in deploy.config.ts → environments.${envKey}.bindings.${service}.`,
      );
    }
  }
};

export const createServiceTargetResolver = (input: ResolveTargetInput): ServiceTargetResolver => {
  const { deploy, services, currentEnvKey, localPresetKey, healthStore } = input;

  const environments = deploy.environments ?? {};
  const currentEnv = environments[currentEnvKey];
  if (!currentEnv) {
    throw new Error(`[router] Current environment '${currentEnvKey}' not found in deploy.config.ts`);
  }

  const fallbackEnvKey = currentEnv.fallback;
  const fallbackEnv = fallbackEnvKey
    ? (environments[fallbackEnvKey])
    : undefined;
  if (fallbackEnvKey && !fallbackEnv) {
    throw new Error(`[router] Current environment '${currentEnvKey}' declares fallback '${fallbackEnvKey}' which is not defined.`);
  }

  //? Every binding MUST declare an explicit port. The RFC default for `http://`
  //? URLs without a port is 80 (HTTPS: 443), but in a multi-instance LuckyStack
  //? deploy that "default" almost always means "wrong service" — the user
  //? forgot to specify which backend handles this preset. Fail fast at boot so
  //? a missing port shows up before any request reaches a stranger.
  assertBindingsHaveExplicitPorts(currentEnv, currentEnvKey);
  if (fallbackEnv && fallbackEnvKey) {
    assertBindingsHaveExplicitPorts(fallbackEnv, fallbackEnvKey);
  }

  // Services owned by the local bundle. When a preset is passed, only those
  // services count as local; otherwise every known service does.
  const locallyOwnedServices = localPresetKey
    ? (services.presets[localPresetKey]?.services ?? [])
    : Object.keys(currentEnv.bindings);

  const locallyOwnedSet = new Set(locallyOwnedServices);
  const healthState = new Map<string, boolean>(
    locallyOwnedServices.map(service => [service, true]),
  );

  const enableUnhealthyFallback = deploy.routing?.enableUnhealthyFallback ?? true;

  const readHealth = (service: string): boolean => {
    if (healthStore) return healthStore.get(service);
    return healthState.get(service) ?? true;
  };

  const resolve = (service: string): ResolveTargetResult | null => {
    // Try the local env binding first when this service is owned locally.
    if (locallyOwnedSet.has(service)) {
      const localBinding = currentEnv.bindings[service];
      const isHealthy = readHealth(service);

      if (localBinding && (isHealthy || !enableUnhealthyFallback)) {
        return { target: localBinding, viaFallback: false, resolvedEnvKey: currentEnvKey };
      }
    }

    // Fall through to the fallback env.
    if (fallbackEnv && fallbackEnvKey) {
      const fallbackBinding = fallbackEnv.bindings[service];
      if (fallbackBinding) {
        return { target: fallbackBinding, viaFallback: true, resolvedEnvKey: fallbackEnvKey };
      }
    }

    return null;
  };

  const setLocalHealth = (service: string, healthy: boolean): void => {
    if (!locallyOwnedSet.has(service)) return;
    healthState.set(service, healthy);
    //? Fire-and-forget Redis write + publish. The in-memory cache already has
    //? the new value, so local reads stay fast; sibling routers get notified
    //? via pub/sub in the next event loop tick.
    if (healthStore) {
      void healthStore.set(service, healthy).catch((error: unknown) => {
        console.error('[router] failed to publish health change:', error);
      });
    }
  };

  const getLocalHealth = (service: string): boolean => readHealth(service);

  const getLocallyOwnedServices = (): string[] => [...locallyOwnedServices];

  return { resolve, setLocalHealth, getLocalHealth, getLocallyOwnedServices };
};
