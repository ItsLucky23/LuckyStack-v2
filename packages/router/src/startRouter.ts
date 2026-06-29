import http from 'node:http';
import { getDeployConfig, getLogger, getServicesConfig, tryCatch, type DeployEnvironmentShape } from '@luckystack/core';
import { createServiceTargetResolver } from './resolveTarget';
import type { ServiceTargetResolver } from './resolveTarget';
import { startHealthPoller } from './healthPoller';
import type { HealthPoller } from './healthPoller';
import { createHttpProxy } from './httpProxy';
import { createWsProxy } from './wsProxy';
import { createRedisHealthStore } from './redisHealthStore';
import type { RedisHealthStore } from './redisHealthStore';
import { runBootHandshake } from './bootHandshake';

type EnvironmentDefinition = DeployEnvironmentShape;

//? Slow-loris hardening for the listening HTTP server (internet-facing edge).
//? `headersTimeout` reaps a client dribbling request headers; `keepAliveTimeout`
//? reaps an idle kept-alive connection; `requestTimeout` reaps a client that
//? finishes headers but never completes the body (the remaining slow-loris
//? surface). Built-in (not a deploy-config knob) to keep the change inside
//? this package.
const ROUTER_HEADERS_TIMEOUT_MS = 60_000;
const ROUTER_KEEP_ALIVE_TIMEOUT_MS = 5000;
const ROUTER_REQUEST_TIMEOUT_MS = 300_000;

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
   * this router instance runs in. Typically mirrors the resolved env mode
   * (`LUCKYSTACK_ENV ?? NODE_ENV`, via `resolveEnvKey()` in the CLI) but can be
   * overridden for staging/preview deploys.
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
  const deployConfig = getDeployConfig();
  const servicesConfig = getServicesConfig();
  const defaultRouterPort = deployConfig.routing?.defaultRouterPort ?? 4000;
  const envPort = process.env.ROUTER_PORT === undefined ? undefined : Number(process.env.ROUTER_PORT);
  if (envPort !== undefined && !Number.isFinite(envPort)) {
    throw new Error(`[router] ROUTER_PORT env var is not a valid number: "${process.env.ROUTER_PORT}"`);
  }
  const port = input.port ?? envPort ?? defaultRouterPort;
  const missingServiceErrorCode = deployConfig.routing?.missingServiceErrorCode ?? 'serviceNotAssigned';
  //? Honour the deploy-config knob; both proxy factories fall back to their own
  //? built-in 30 s default when the value is unset (undefined pass-through).
  const upstreamTimeoutMs = deployConfig.routing?.upstreamTimeoutMs;
  //? Pass-through: undefined → httpProxy uses its built-in 100 MiB default.
  const maxRequestBodyBytes = deployConfig.routing?.maxRequestBodyBytes;
  //? WS upgrades pin to this service when set (else createWsProxy's
  //? DEFAULT_WS_SERVICE = 'system'). The key was declared + documented in
  //? deploy.config.routing but never threaded into createWsProxy — so a consumer
  //? terminating Socket.io on a non-system service was silently ignored.
  const websocketService = deployConfig.routing?.websocketService;

  const envMap = (deployConfig.environments ?? {}) as Record<string, EnvironmentDefinition | undefined>;
  const currentEnv = envMap[input.currentEnvKey];
  const hasFallback = Boolean(currentEnv?.fallback);
  const enableFallbackRouting = deployConfig.development?.enableFallbackRouting ?? false;
  const defaultHealthPollMs = deployConfig.routing?.defaultHealthPollMs ?? 5000;
  const healthPollMs = deployConfig.development?.healthPollMs ?? defaultHealthPollMs;
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
    const [storeError, store] = await tryCatch(() => createRedisHealthStore({
      envKey: input.currentEnvKey,
      onExternalChange: (service, healthy) => {
        //? Mirror Redis-published changes into the resolver's local map too,
        //? so `getLocalHealth` returns a consistent view for tests/inspectors.
        resolverRef?.setLocalHealth(service, healthy);
        input.onHealthChange?.(service, healthy);
      },
    }));
    if (storeError) {
      if (requireSharedHealth) {
        throw new Error(
          `[router] split/fallback mode requires shared Redis, but the store failed to initialize: ${storeError.message}`,
        );
      }
      getLogger().warn('[router] shared health state unavailable, falling back to in-memory', { message: storeError.message });
    } else {
      healthStore = store ?? null;
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
      fallbackBaseUrl: envMap[currentEnv.fallback]?.bindings.system,
      strict: deployConfig.routing?.strictBootHandshake ?? false,
    });
  }

  const proxy = createHttpProxy({ resolver, missingServiceErrorCode, upstreamRequestTimeoutMs: upstreamTimeoutMs, maxRequestBodyBytes });
  const wsProxy = createWsProxy({ resolver, upstreamHandshakeTimeoutMs: upstreamTimeoutMs, wsTargetService: websocketService });
  const server = http.createServer(proxy);

  //? Slow-loris / idle-hold hardening for an internet-facing edge. Node's `http`
  //? server bounds this loosely; set the header + keep-alive idle limits
  //? explicitly so a client dribbling request headers or holding an idle
  //? connection is reaped instead of pinning a router worker indefinitely.
  server.headersTimeout = ROUTER_HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = ROUTER_KEEP_ALIVE_TIMEOUT_MS;
  server.requestTimeout = ROUTER_REQUEST_TIMEOUT_MS;

  server.on('upgrade', wsProxy);

  if (isDevMode && enableFallbackRouting && currentEnv) {
    healthPoller = startHealthPoller({
      resolver,
      localBindings: currentEnv.bindings,
      intervalMs: healthPollMs,
      onStateChange: (service, healthy) => {
        getLogger().info(`[router] local service '${service}' is now ${healthy ? 'healthy' : 'unhealthy'}`);
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
  getLogger().info(`[router] listening on http://0.0.0.0:${port}/ (env: ${input.currentEnvKey}${input.localPresetKey ? `, preset: ${input.localPresetKey}` : ''}${sharedLabel})`);

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
