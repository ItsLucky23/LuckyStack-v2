import http from 'node:http';
import deployConfig from '../../../deploy.config';
import servicesConfig from '../../../services.config';
import { createServiceTargetResolver } from './resolveTarget';
import type { ServiceTargetResolver } from './resolveTarget';
import type { EnvironmentDefinition } from '../../../deploy.config';
import { startHealthPoller } from './healthPoller';
import type { HealthPoller } from './healthPoller';
import { createHttpProxy } from './httpProxy';
import { createWsProxy } from './wsProxy';
import { createRedisHealthStore } from './redisHealthStore';
import type { RedisHealthStore } from './redisHealthStore';
import { runBootHandshake } from './bootHandshake';

/**
 * Starts the LuckyStack load-balancer backend.
 *
 * Responsibilities (per ARCHITECTURE_PACKAGING.md §9.6):
 *   1. Parse first route segment as service key (HTTP + WS).
 *   2. Forward to the configured service backend URL (from deploy.config.ts).
 *   3. Return `serviceNotAssigned` when no binding can be resolved.
 *   4. Mix local + remote targets (dev: `environment.fallback` points at staging).
 *   5. Poll local targets in dev mode; switch new traffic to local when healthy.
 *   6. Share health state across router instances via Redis (split/fallback mode).
 *   7. Hard-fail startup when Redis is unavailable in split/fallback mode.
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
  /**
   * Opt out of the Redis-backed health store. Useful for single-instance dev
   * setups without Redis. Ignored when the current env declares a `fallback`
   * (split/fallback mode always requires shared Redis).
   */
  disableSharedHealthState?: boolean;
  onReady?: (info: { port: number; localHealth: Record<string, boolean> }) => void;
  onHealthChange?: (service: string, healthy: boolean) => void;
}

export interface RunningRouter {
  port: number;
  resolver: ServiceTargetResolver;
  healthPoller: HealthPoller | null;
  healthStore: RedisHealthStore | null;
  stop: () => Promise<void>;
}

export const startRouter = async (input: StartRouterInput): Promise<RunningRouter> => {
  const port = input.port ?? Number(process.env.ROUTER_PORT ?? 4000);
  const missingServiceErrorCode = deployConfig.routing?.missingServiceErrorCode ?? 'serviceNotAssigned';

  const envMap = deployConfig.environments as Record<string, EnvironmentDefinition | undefined>;
  const currentEnv = envMap[input.currentEnvKey];
  const hasFallback = Boolean(currentEnv?.fallback);
  const enableFallbackRouting = deployConfig.development?.enableFallbackRouting ?? false;
  const healthPollMs = deployConfig.development?.healthPollMs ?? 5000;
  const isDevMode = input.currentEnvKey === 'development';

  //? Split/fallback mode = `environment.fallback` is set on the current env.
  //? Per §9.6 #7, shared Redis is mandatory in that mode; we bypass the opt-out.
  const requireSharedHealth = hasFallback;
  const wantSharedHealth = requireSharedHealth || !input.disableSharedHealthState;

  let healthStore: RedisHealthStore | null = null;
  let healthPoller: HealthPoller | null = null;

  //? Placeholder resolver reference so `onExternalChange` can close over it.
  //? Resolver is created right after the store to avoid the chicken/egg.
  let resolverRef: ServiceTargetResolver | null = null;

  if (wantSharedHealth) {
    try {
      healthStore = await createRedisHealthStore({
        envKey: input.currentEnvKey,
        onExternalChange: (service, healthy) => {
          //? Mirror Redis-published changes into the resolver's local map too,
          //? so `getLocalHealth` returns a consistent view for tests/inspectors.
          resolverRef?.setLocalHealth(service, healthy);
          input.onHealthChange?.(service, healthy);
        },
      });
    } catch (err) {
      if (requireSharedHealth) {
        throw new Error(
          `[router] split/fallback mode requires shared Redis, but the store failed to initialize: ${(err as Error).message}`,
        );
      }
      console.warn(`[router] shared health state unavailable, falling back to in-memory: ${(err as Error).message}`);
    }
  }

  const resolver = createServiceTargetResolver({
    deploy: deployConfig,
    services: servicesConfig,
    currentEnvKey: input.currentEnvKey,
    localPresetKey: input.localPresetKey,
    healthStore: healthStore ?? undefined,
  });
  resolverRef = resolver;

  if (healthStore) {
    await healthStore.hydrate(resolver.getLocallyOwnedServices());
  }

  //? Catches two Redis URLs that both respond — writes a boot UUID and, when
  //? the current env has a fallback, probes its /health and compares.
  if (healthStore && currentEnv?.fallback) {
    await runBootHandshake({
      envKey: input.currentEnvKey,
      fallbackEnvKey: currentEnv.fallback,
      fallbackBaseUrl: envMap[currentEnv.fallback]?.bindings['system'],
      strict: deployConfig.routing?.strictBootHandshake ?? false,
    });
  }

  const proxy = createHttpProxy({ resolver, missingServiceErrorCode });
  const wsProxy = createWsProxy({ resolver });
  const server = http.createServer(proxy);
  server.on('upgrade', wsProxy);

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
  const sharedLabel = healthStore ? ' shared-health=redis' : ' shared-health=in-memory';
  console.log(`[router] listening on http://0.0.0.0:${port}/ (env: ${input.currentEnvKey}${input.localPresetKey ? `, preset: ${input.localPresetKey}` : ''}${sharedLabel})`);

  return {
    port,
    resolver,
    healthPoller,
    healthStore,
    stop: async () => {
      healthPoller?.stop();
      if (healthStore) await healthStore.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
};
