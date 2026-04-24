import http from 'node:http';
import deployConfig from '../../../deploy.config';
import servicesConfig from '../../../services.config';
import { createServiceTargetResolver } from './resolveTarget';
import type { ServiceTargetResolver } from './resolveTarget';
import type { EnvironmentDefinition } from '../../../deploy.config';
import { startHealthPoller } from './healthPoller';
import type { HealthPoller } from './healthPoller';
import { createHttpProxy } from './httpProxy';

/**
 * Starts the LuckyStack load-balancer backend.
 *
 * Responsibilities (per ARCHITECTURE_PACKAGING.md §9.6):
 *   1. Parse first route segment as service key.
 *   2. Forward to the configured service backend URL (from deploy.config.ts).
 *   3. Return `serviceNotAssigned` when no binding can be resolved.
 *   4. Mix local + remote targets (dev: `environment.fallback` points at staging).
 *   5. Poll local targets in dev mode; switch new traffic to local when healthy.
 *
 * Not yet implemented (tracked as follow-ups in §34):
 *   - Socket.io / WebSocket proxying.
 *   - Redis-backed health state (currently in-memory).
 *   - Zero-loss reconnect when local health flips.
 */
export interface StartRouterInput {
  /**
   * Which `deploy.config.ts -> environments` key describes the environment
   * this router instance runs in. Typically mirrors `process.env.NODE_ENV`
   * but can be overridden for staging/preview deploys.
   */
  currentEnvKey: string;
  /**
   * Preset key that the locally-running backend bundle contains. When set,
   * only services in this preset are treated as "owned locally"; requests
   * for any other service bypass the local env and go straight to fallback.
   * Not set → every service with a binding in the current env is local.
   */
  localPresetKey?: string;
  /**
   * TCP port the router listens on. Defaults to `process.env.ROUTER_PORT`
   * or `4000`.
   */
  port?: number;
  onReady?: (info: { port: number; localHealth: Record<string, boolean> }) => void;
  onHealthChange?: (service: string, healthy: boolean) => void;
}

export interface RunningRouter {
  port: number;
  resolver: ServiceTargetResolver;
  healthPoller: HealthPoller | null;
  stop: () => Promise<void>;
}

export const startRouter = async (input: StartRouterInput): Promise<RunningRouter> => {
  const resolver = createServiceTargetResolver({
    deploy: deployConfig,
    services: servicesConfig,
    currentEnvKey: input.currentEnvKey,
    localPresetKey: input.localPresetKey,
  });

  const port = input.port ?? Number(process.env.ROUTER_PORT ?? 4000);
  const missingServiceErrorCode = deployConfig.routing?.missingServiceErrorCode ?? 'serviceNotAssigned';

  const proxy = createHttpProxy({ resolver, missingServiceErrorCode });
  const server = http.createServer(proxy);

  // `deploy.config.ts` types `environments` with a literal union of env keys
  // for `fallback` reference safety, but the router accepts any string at
  // runtime (validated against the config by `createServiceTargetResolver`
  // earlier). Widen for the lookup here.
  const envMap = deployConfig.environments as Record<string, EnvironmentDefinition | undefined>;
  const currentEnv = envMap[input.currentEnvKey];
  const enableFallbackRouting = deployConfig.development?.enableFallbackRouting ?? false;
  const healthPollMs = deployConfig.development?.healthPollMs ?? 5000;
  const isDevMode = input.currentEnvKey === 'development';

  let healthPoller: HealthPoller | null = null;

  if (isDevMode && enableFallbackRouting && currentEnv) {
    healthPoller = startHealthPoller({
      resolver,
      localBindings: currentEnv.bindings,
      intervalMs: healthPollMs,
      onStateChange: (service, healthy) => {
        console.log(`[router] local service '${service}' is now ${healthy ? 'healthy' : 'unhealthy'}`);
        input.onHealthChange?.(service, healthy);
      },
    });
  }

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      resolve();
    });
  });

  const localHealth: Record<string, boolean> = {};
  for (const service of resolver.getLocallyOwnedServices()) {
    localHealth[service] = resolver.getLocalHealth(service);
  }
  input.onReady?.({ port, localHealth });
  console.log(`[router] listening on http://0.0.0.0:${port}/ (env: ${input.currentEnvKey}${input.localPresetKey ? `, preset: ${input.localPresetKey}` : ''})`);

  return {
    port,
    resolver,
    healthPoller,
    stop: async () => {
      healthPoller?.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
};
