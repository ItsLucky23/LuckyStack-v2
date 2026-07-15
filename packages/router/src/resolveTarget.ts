import { getLogger, tryCatchSync } from '@luckystack/core';
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

const firstSegment = (pathname: string): string | null => {
  const trimmed = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const firstSlash = trimmed.indexOf('/');
  const segment = firstSlash === -1 ? trimmed : trimmed.slice(0, firstSlash);
  return segment || null;
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
  //? Decode the FULL pathname ONCE up front, then parse + slice on the decoded
  //? string. Decoding only the first segment but slicing the still-ENCODED
  //? remainder by the DECODED length misroutes a percent-encoded transport
  //? prefix (e.g. `/%73ync/billing/foo` decodes to `sync` (4 chars) but the
  //? slice ran over `%73ync...` (6 chars)), so the router and backend would
  //? disagree on the service key. Decoding once keeps the slice index
  //? consistent with what was decoded. `tryCatchSync` guards malformed
  //? sequences like `%ZZ` — those resolve to no service (null).
  const [decodeError, decoded] = tryCatchSync(() => decodeURIComponent(pathname));
  if (decodeError || decoded === null) return null;

  const first = firstSegment(decoded);
  if (!first) return null;

  if (first === 'api' || first === 'sync') {
    const afterTransport = decoded.startsWith('/') ? decoded.slice(1) : decoded;
    const remainder = afterTransport.slice(first.length + 1);
    return firstSegment(remainder);
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

//? Env keys are forwarded verbatim to upstream backends in the
//? `x-luckystack-resolved-env` header (see httpProxy.ts). HTTP header values
//? must not carry control characters (CRLF would enable header injection), so
//? we constrain env keys to a safe identifier charset and fail fast at boot —
//? a bad value surfaces at startup, never silently at request time.
const ENV_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

const assertEnvKeyIsSafe = (envKey: string): void => {
  if (!ENV_KEY_PATTERN.test(envKey)) {
    throw new Error(
      `[router] Environment key "${envKey}" contains invalid characters. ` +
      `Env keys are forwarded to upstream backends as a header and must match ${ENV_KEY_PATTERN.toString()} ` +
      `(letters, digits, underscore, hyphen). Rename it in deploy.config.ts → environments.`,
    );
  }
};

/**
 * Does the RAW url text spell out a port?
 *
 * `new URL(...).port` cannot answer this: it is EMPTY for a protocol's default
 * port, so `https://h.com:443/x` and the port-less `https://h.com/x` are
 * indistinguishable through it. That made the check below unsatisfiable for the
 * single most common production shape — an operator who wrote `:443` was told
 * their port was "missing", with no way to comply short of picking a non-default
 * port. Shipped that way since v0.2.0.
 *
 * So read the text instead. The port, if present, is the trailing `:<digits>` of
 * the authority — after any `user:pass@`, and after the `]` of an IPv6 literal
 * (whose own colons must not be mistaken for a port separator).
 */
const hasExplicitPort = (target: string): boolean => {
  const schemeEnd = target.indexOf('://');
  if (schemeEnd === -1) return false;

  const authority = target.slice(schemeEnd + 3).split(/[/?#]/, 1)[0] ?? '';
  //? `lastIndexOf`: a password may itself contain '@'.
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);

  if (hostPort.startsWith('[')) {
    //? IPv6 literal — only what follows the closing bracket can be a port.
    return /^:\d+$/.test(hostPort.slice(hostPort.indexOf(']') + 1));
  }
  const colon = hostPort.lastIndexOf(':');
  return colon !== -1 && /^\d+$/.test(hostPort.slice(colon + 1));
};

const assertBindingsHaveExplicitPorts = (env: EnvironmentDefinition, envKey: string): void => {
  for (const [service, target] of Object.entries(env.bindings)) {
    const [urlError, url] = tryCatchSync(() => new URL(target));
    if (urlError || !url) {
      throw new Error(
        `[router] Binding for service "${service}" in env "${envKey}" is not a valid URL: "${target}".`,
      );
    }
    if (!hasExplicitPort(target)) {
      throw new Error(
        `[router] Binding for service "${service}" in env "${envKey}" is missing an explicit port: "${target}". ` +
        `Port-less URLs silently fall through to the protocol default (80/443) which is rarely what a multi-instance deploy wants. ` +
        `Write the port you mean — including ":443" for https or ":80" for http. ` +
        `Set it in deploy.config.ts → environments.${envKey}.bindings.${service}.`,
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
  assertEnvKeyIsSafe(currentEnvKey);
  assertBindingsHaveExplicitPorts(currentEnv, currentEnvKey);
  if (fallbackEnv && fallbackEnvKey) {
    assertEnvKeyIsSafe(fallbackEnvKey);
    assertBindingsHaveExplicitPorts(fallbackEnv, fallbackEnvKey);
  }

  // Services owned by the local bundle. When a preset is passed, only those
  // services count as local; otherwise every known service does.
  if (localPresetKey && !services.presets[localPresetKey]) {
    const known = Object.keys(services.presets);
    throw new Error(
      `[router] Preset '${localPresetKey}' is not defined in services.config.ts. ` +
      (known.length > 0
        ? `Known presets: ${known.join(', ')}.`
        : 'No presets are registered.'),
    );
  }
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

  //? Own-property-only binding lookup. `service` is derived from an
  //? attacker-controlled URL segment, so a plain `bindings[service]` would
  //? resolve inherited members: `bindings['__proto__']` yields Object.prototype
  //? and `bindings['constructor']` the Object function — both truthy non-strings
  //? that pass the `if (binding)` check and are returned as a bogus `target`.
  //? Downstream `new URL(pathname, target)` in the HTTP proxy then throws on the
  //? non-string base, crashing the process. Guarding with `hasOwnProperty` makes
  //? an unrecognized service resolve to `undefined` -> clean 502.
  const ownBinding = (bindings: Record<string, string>, service: string): string | undefined =>
    Object.prototype.hasOwnProperty.call(bindings, service) ? bindings[service] : undefined;

  const resolve = (service: string): ResolveTargetResult | null => {
    // Try the local env binding first when this service is owned locally.
    if (locallyOwnedSet.has(service)) {
      const localBinding = ownBinding(currentEnv.bindings, service);
      const isHealthy = readHealth(service);

      if (localBinding && (isHealthy || !enableUnhealthyFallback)) {
        return { target: localBinding, viaFallback: false, resolvedEnvKey: currentEnvKey };
      }
    }

    // Fall through to the fallback env.
    if (fallbackEnv && fallbackEnvKey) {
      const fallbackBinding = ownBinding(fallbackEnv.bindings, service);
      if (fallbackBinding) {
        return { target: fallbackBinding, viaFallback: true, resolvedEnvKey: fallbackEnvKey };
      }
    }

    return null;
  };

  const setLocalHealth = (service: string, healthy: boolean): void => {
    if (!locallyOwnedSet.has(service)) return;
    if (healthStore) {
      //? Delegate to the shared store; `readHealth` reads from it so the
      //? in-memory `healthState` map is irrelevant when a store is wired.
      //? Writing `healthState` too would be a dead write.
      void healthStore.set(service, healthy).catch((error: unknown) => {
        getLogger().error('[router] failed to publish health change:', { error });
      });
    } else {
      healthState.set(service, healthy);
    }
  };

  const getLocalHealth = (service: string): boolean => readHealth(service);

  const getLocallyOwnedServices = (): string[] => [...locallyOwnedServices];

  return { resolve, setLocalHealth, getLocalHealth, getLocallyOwnedServices };
};
