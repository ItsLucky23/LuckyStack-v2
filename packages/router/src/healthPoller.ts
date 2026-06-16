import { tryCatch } from '@luckystack/core';
import type { ServiceTargetResolver } from './resolveTarget';
import { getHealthyStatusPredicate } from './healthConfig';

/**
 * Polls local service targets and flips their health state on the resolver.
 * Only active in dev (when `deploy.config.ts -> development.enableFallbackRouting`
 * is true). When a local target comes up healthy, new traffic routes there;
 * when it goes down, new traffic falls back to the env declared in
 * `environment.fallback`. The switch is request-level — already-inflight
 * requests are not forcibly redirected.
 *
 * Health check: a simple `HEAD /` against the service URL with a short
 * timeout. Services that don't expose a root endpoint can be added to a
 * skip list in a future iteration.
 *
 * State flips through `resolver.setLocalHealth(...)`, which writes the
 * in-memory map AND (when a shared Redis health store is wired into the
 * resolver) publishes the change so sibling router instances converge on the
 * same picture (per §9.6 #5 in ARCHITECTURE_PACKAGING.md; see
 * `redisHealthStore.ts`).
 */
export interface StartHealthPollerInput {
  resolver: ServiceTargetResolver;
  localBindings: Record<string, string>;
  intervalMs: number;
  onStateChange?: (service: string, healthy: boolean) => void;
  /**
   * Predicate that decides whether a probe's HTTP status counts as healthy.
   * Defaults to the deploy-config `routing.healthyStatusPredicate`, which itself
   * defaults to 2xx/3xx (see `healthConfig.ts`). Injectable for testing.
   */
  isHealthyStatus?: (status: number) => boolean;
}

export interface HealthPoller {
  stop: () => void;
  checkNow: () => Promise<void>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 2000;

const probeTarget = async (
  url: string,
  isHealthyStatus: (status: number) => boolean,
): Promise<boolean> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, DEFAULT_REQUEST_TIMEOUT_MS);
  const [error, response] = await tryCatch(() => fetch(url, {
    method: 'HEAD',
    signal: controller.signal,
  }));
  clearTimeout(timeout);
  //? A probe failure (network error / abort timeout) means the target is down.
  if (error || !response) return false;
  //? Only the configured success band counts as healthy. By default that is
  //? 2xx/3xx — a 4xx (401/403/404/...) means the backend answered but is NOT
  //? serving traffic correctly, so it must NOT be treated as up.
  return isHealthyStatus(response.status);
};

export const startHealthPoller = ({
  resolver,
  localBindings,
  intervalMs,
  onStateChange,
  isHealthyStatus,
}: StartHealthPollerInput): HealthPoller => {
  //? Resolve once at start; the predicate is config-driven and stable for the
  //? life of the poller. Injection wins over the deploy-config default.
  const healthyStatus = isHealthyStatus ?? getHealthyStatusPredicate();

  const services = resolver.getLocallyOwnedServices()
    .filter((service) => Boolean(localBindings[service]));

  const checkService = async (service: string): Promise<void> => {
    const url = localBindings[service];
    if (!url) return;
    const healthy = await probeTarget(url, healthyStatus);
    const previous = resolver.getLocalHealth(service);
    if (healthy !== previous) {
      resolver.setLocalHealth(service, healthy);
      onStateChange?.(service, healthy);
    }
  };

  const checkNow = async (): Promise<void> => {
    await Promise.all(services.map((service) => checkService(service)));
  };

  const interval = setInterval(() => {
    void checkNow();
  }, intervalMs);
  interval.unref();

  // Kick off an initial probe so the first few requests have real health data.
  void checkNow();

  return {
    stop: () => {
      clearInterval(interval);
    },
    checkNow,
  };
};
