import type { DeployConfig, EnvironmentDefinition } from '../../../deploy.config';
import type { ServicesConfig } from '../../../services.config';

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

export const parseServiceFromPath = (pathname: string): string | null => {
  // Strip the `api/` or `sync/` transport prefix if present so that
  // `api/vehicles/getAll` and `vehicles/getAll` both resolve to `vehicles`.
  const first = parseFirstSegment(pathname);
  if (!first) return null;

  if (first === 'api' || first === 'sync') {
    const afterTransport = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    const remainder = afterTransport.slice(first.length + 1);
    return parseFirstSegment(remainder);
  }

  return first;
};

export const createServiceTargetResolver = (input: ResolveTargetInput): ServiceTargetResolver => {
  const { deploy, services, currentEnvKey, localPresetKey } = input;

  const currentEnv = deploy.environments[currentEnvKey] as EnvironmentDefinition | undefined;
  if (!currentEnv) {
    throw new Error(`[router] Current environment '${currentEnvKey}' not found in deploy.config.ts`);
  }

  const fallbackEnvKey = currentEnv.fallback;
  const fallbackEnv = fallbackEnvKey
    ? (deploy.environments[fallbackEnvKey] as EnvironmentDefinition | undefined)
    : undefined;
  if (fallbackEnvKey && !fallbackEnv) {
    throw new Error(`[router] Current environment '${currentEnvKey}' declares fallback '${fallbackEnvKey}' which is not defined.`);
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

  const resolve = (service: string): ResolveTargetResult | null => {
    // Try the local env binding first when this service is owned locally.
    if (locallyOwnedSet.has(service)) {
      const localBinding = currentEnv.bindings[service];
      const isHealthy = healthState.get(service) ?? true;

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
  };

  const getLocalHealth = (service: string): boolean => {
    return healthState.get(service) ?? true;
  };

  const getLocallyOwnedServices = (): string[] => [...locallyOwnedServices];

  return { resolve, setLocalHealth, getLocalHealth, getLocallyOwnedServices };
};
