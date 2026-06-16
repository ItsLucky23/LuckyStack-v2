//? Deploy-time topology registered by the project at boot. Mirrors the
//? `projectConfig` / `runtimeMapsRegistry` / `notifier` pattern: framework
//? packages read deploy data through `getDeployConfig()` so they don't
//? `import '../../../deploy.config'`.
//?
//? Only the fields core actually consumes are declared here. The project's
//? richer `DeployConfig` (environments, bindings, routing, etc.) stays in
//? `deploy.config.ts` and is consumed directly by the router package, which
//? is project-glue (tier-B) and intentionally stays project-coupled.
//?
//? Project entrypoint registers via the direct file path
//? (`./packages/core/src/deployConfigRegistry`) — same Vite-bundle rule we
//? already use for projectConfig: importing the core barrel from a
//? client-bundled file pulls server-only modules (Redis, paths, etc.).

export interface DeployResourceShape {
  type: 'redis' | 'mongo';
  urlEnvKey: string;
  synchronizedEnvKeys?: string[];
}

export interface DeployEnvironmentShape {
  redis: string;
  mongo: string;
  fallback?: string;
  bindings: Record<string, string>;
}

export interface DeployRoutingShape {
  onMissingService?: 'hard-error' | 'proxy-fallback';
  missingServiceErrorCode?: string;
  enableUnhealthyFallback?: boolean;
  strictBootHandshake?: boolean;
  /** Default port the router listens on when ROUTER_PORT env var is unset (default 4000). */
  defaultRouterPort?: number;
  /** Default ms between health polls when not specified per-call (default 5000). */
  defaultHealthPollMs?: number;
  /** ms before the fallback `/_health` probe times out (default 3000). */
  healthProbeTimeoutMs?: number;
  /** Seconds the boot-UUID Redis key lives for (default 3600 = 1h). */
  bootKeyTtlSeconds?: number;
  /**
   * ms before the router gives up proxying to an upstream backend (SEC-30 /
   * router-DeployRoutingShape). Guards against slow-loris upstreams holding a
   * router worker open. The router reads this when building its proxy request.
   * DEFAULT undefined → router falls back to its own built-in default.
   */
  upstreamTimeoutMs?: number;
  /**
   * Name of the service that terminates websocket (Socket.io) traffic. The
   * router pins WS upgrade requests to this service (they cannot be load-balanced
   * round-robin without sticky sessions). DEFAULT undefined → router uses its
   * `system` convention.
   */
  websocketService?: string;
  /**
   * Path the router exposes for its OWN health/liveness (distinct from the
   * backend `/_health` boot-handshake endpoint). DEFAULT undefined → router
   * uses its built-in default.
   */
  routerHealthPath?: string;
  /**
   * Max request body size (bytes) the router will buffer/forward before
   * rejecting with 413. DEFAULT undefined → router uses its built-in default.
   */
  maxRequestBodyBytes?: number;
}

export interface DeployDevelopmentShape {
  enableFallbackRouting?: boolean;
  healthPollMs?: number;
  switchNewTrafficToLocalWhenHealthy?: boolean;
}

export interface DeployConfigShape {
  resources: Record<string, DeployResourceShape>;
  environments?: Record<string, DeployEnvironmentShape>;
  routing?: DeployRoutingShape;
  development?: DeployDevelopmentShape;
}

import { createRegistry } from './createRegistry';

const DEFAULT_DEPLOY_CONFIG: DeployConfigShape = {
  resources: {},
};

const registry = createRegistry<DeployConfigShape>(DEFAULT_DEPLOY_CONFIG);

export const registerDeployConfig = (config: DeployConfigShape): DeployConfigShape =>
  registry.register(config);

export const getDeployConfig = (): DeployConfigShape => registry.get();

export const isDeployConfigRegistered = (): boolean => registry.isRegistered();
