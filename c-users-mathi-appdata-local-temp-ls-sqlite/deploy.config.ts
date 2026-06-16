//? Deploy-time topology. Single-instance projects can leave `environments`
//? empty — only `resources` is consumed by the framework's
//? synchronizedEnvHashes check. `environments` / `routing` / `development`
//? are read by the optional `@luckystack/router` for split/multi-instance
//? deployments; populate them when you add a router.

import { registerDeployConfig } from '@luckystack/core';

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
   * this resource (used by the router's boot handshake).
   */
  synchronizedEnvKeys?: string[];
}

export interface EnvironmentDefinition<TEnvKey extends string = string> {
  /** Resource key from `resources` above. */
  redis: string;
  /** Resource key from `resources` above. */
  mongo: string;
  /** Optional fallback environment key. Must be a valid key of `environments`. */
  fallback?: TEnvKey;
  /** Per-service URL bindings for this environment. */
  bindings: Record<string, string>;
}

export interface DeployConfig<TEnvKey extends string = string> {
  resources: Record<string, ResourceDefinition>;
  environments: Record<TEnvKey, EnvironmentDefinition<TEnvKey>>;
  routing?: {
    onMissingService?: 'hard-error' | 'proxy-fallback';
    missingServiceErrorCode?: string;
    enableUnhealthyFallback?: boolean;
    strictBootHandshake?: boolean;
  };
  development?: {
    enableFallbackRouting?: boolean;
    healthPollMs?: number;
    switchNewTrafficToLocalWhenHealthy?: boolean;
  };
}

const deployConfig: DeployConfig = {
  resources: {
    redisShared: {
      type: 'redis',
      urlEnvKey: 'REDIS_HOST',
      synchronizedEnvKeys: ['PROJECT_NAME'],
    },
    mongoShared: {
      type: 'mongo',
      urlEnvKey: 'DATABASE_URL',
    },
  },
  //? Single-instance default: no cross-environment routing. Add entries here
  //? (development / staging / production with their resource + service URL
  //? bindings) once you front the app with @luckystack/router.
  environments: {},
};

registerDeployConfig(deployConfig);

export default deployConfig;
