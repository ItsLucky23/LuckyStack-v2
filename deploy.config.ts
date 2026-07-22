//? `@luckystack/core/config`, NOT the main barrel: any client-bundled file that
//? pulls deploy.config.ts would otherwise drag server-only core modules (ioredis,
//? paths, bootUuid) into the browser. This used to reach straight into
//? `./packages/core/src/deployConfigRegistry` for that reason — but a deep source
//? import resolves to a SEPARATE module instance under Bun, so the registration
//? landed where the router never looked and `npm run router` died on "services
//? config has not been registered". The subpath is both client-safe and one
//? instance. Same rule as config.ts.
import { registerDeployConfig } from '@luckystack/core/config';

/**
 * DEPLOY CONFIG (per-environment runtime topology)
 *
 * Defines:
 *   - resources: named infrastructure handles (redis, mongo) referenced by key.
 *   - environments: per-env resource bindings, service URL bindings, and an
 *     optional fallback pointing at another environment by key.
 *
 * Shared-resource invariant (enforced by presetLoader):
 *   If environment A declares `fallback: 'B'`, then A and B MUST reference
 *   the SAME resource KEY for both redis and mongo. This makes "two different
 *   Redis URLs that both happen to respond" impossible to express.
 *
 * Fallback behavior at runtime:
 *   When a service route is not owned by the locally running bundle, requests
 *   are forwarded to the service URL declared by the fallback environment.
 *
 * Boot-time handshake (recommended, implemented alongside this config):
 *   On startup, write a UUID into Redis under a well-known key. Hit the
 *   fallback target's /health and assert it reads the same UUID. This catches
 *   divergent redis://... URLs that both respond.
 */

export type ResourceType = 'redis' | 'mongo';

export interface ResourceDefinition {
  type: ResourceType;
  /**
   * Name of the env var that identifies this resource instance. For Mongo this
   * is typically the full connection string (DATABASE_URL); for Redis this can
   * be REDIS_HOST when host+port+password are split across several env vars.
   */
  urlEnvKey: string;
  /**
   * Env keys whose values MUST match across every environment that references
   * this resource. Example: session/cookie secrets tied to a shared Redis.
   */
  synchronizedEnvKeys?: string[];
}

export interface EnvironmentDefinition<TEnvKey extends string = string> {
  /** Resource key from `resources` above. */
  redis: string;
  /** Resource key from `resources` above. */
  mongo: string;
  /**
   * Optional fallback environment key. If set, routes owned by services that
   * are NOT in the locally running bundle are proxied to this environment's
   * bindings. Must be a valid key of `environments`.
   */
  fallback?: TEnvKey;
  /**
   * Per-service URL bindings for this environment. A service without a binding
   * here cannot be reached from this environment.
   */
  bindings: Record<string, string>;
}

export interface DeployConfig<TEnvKey extends string = string> {
  resources: Record<string, ResourceDefinition>;
  environments: Record<TEnvKey, EnvironmentDefinition<TEnvKey>>;
  routing?: {
    onMissingService?: 'hard-error' | 'proxy-fallback';
    missingServiceErrorCode?: string;
    enableUnhealthyFallback?: boolean;
    /**
     * When true, the router's boot handshake (UUID cross-check against the
     * fallback env's /_health) throws on mismatch or unreachable, refusing
     * to start. Default is warning-only: the handshake logs but proceeds.
     * Flip to true once every service in your deployment is known to expose
     * /_health.
     */
    strictBootHandshake?: boolean;
    /** Immediate TLS proxy addresses/CIDRs trusted to set x-forwarded-proto. */
    trustedProxyCidrs?: string[];
  };
  development?: {
    enableFallbackRouting?: boolean;
    healthPollMs?: number;
    switchNewTrafficToLocalWhenHealthy?: boolean;
  };
}

// Helper that preserves the literal union of environment keys so
// `fallback` can be typed against it.
const defineDeploy = <T extends string>(config: DeployConfig<T>): DeployConfig<T> => config;

const deployConfig = defineDeploy<'development' | 'staging' | 'production'>({
  resources: {
    redisShared: {
      type: 'redis',
      urlEnvKey: 'REDIS_HOST',
      synchronizedEnvKeys: ['COOKIE_SECRET', 'PROJECT_NAME'],
    },
    mongoShared: {
      type: 'mongo',
      urlEnvKey: 'DATABASE_URL',
    },
  },

  environments: {
    development: {
      redis: 'redisShared',
      mongo: 'mongoShared',
      fallback: 'staging',
      bindings: {
        system: 'http://localhost:4100',
        vehicles: 'http://localhost:4101',
        billing: 'http://localhost:4102',
      },
    },
    staging: {
      redis: 'redisShared',
      mongo: 'mongoShared',
      //? Ports are explicit everywhere, including the protocol defaults. The
      //? router refuses a port-less binding on purpose: relying on 80/443 by
      //? omission is how a multi-instance topology silently collapses onto one
      //? target. Writing `:443` is how you say you meant it.
      bindings: {
        system: 'https://staging-api.luckystack.com:443/system',
        vehicles: 'https://staging-api.luckystack.com:443/vehicles',
        billing: 'https://staging-api.luckystack.com:443/billing',
      },
    },
    production: {
      redis: 'redisShared',
      mongo: 'mongoShared',
      bindings: {
        system: 'https://api.luckystack.com:443/system',
        vehicles: 'https://api.luckystack.com:443/vehicles',
        billing: 'https://api.luckystack.com:443/billing',
      },
    },
  },

  routing: {
    onMissingService: 'proxy-fallback',
    missingServiceErrorCode: 'serviceNotAssigned',
    enableUnhealthyFallback: true,
    //? Secure default: direct clients cannot claim HTTPS. Add only the immediate
    //? TLS load-balancer/nginx CIDRs when production terminates TLS upstream.
    trustedProxyCidrs: [],
  },

  development: {
    enableFallbackRouting: true,
    healthPollMs: 5000,
    switchNewTrafficToLocalWhenHealthy: true,
  },
});

//? Side-effect registration: any import of this file wires the deploy
//? topology into @luckystack/core so framework packages (router,
//? synchronizedEnvHashes, ...) can read it without
//? `import '../../../deploy.config'`.
registerDeployConfig({
  resources: deployConfig.resources,
  environments: deployConfig.environments,
  routing: deployConfig.routing,
  development: deployConfig.development,
});

export default deployConfig;
