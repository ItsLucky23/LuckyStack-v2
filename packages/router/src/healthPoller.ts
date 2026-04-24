import type { ServiceTargetResolver } from './resolveTarget';

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
 * State is in-memory for now. A future iteration will persist health state
 * in the shared Redis (per §9.6 #5 in ARCHITECTURE_PACKAGING.md) so multiple
 * router instances share the same picture.
 */
export interface StartHealthPollerInput {
  resolver: ServiceTargetResolver;
  localBindings: Record<string, string>;
  intervalMs: number;
  onStateChange?: (service: string, healthy: boolean) => void;
}

export interface HealthPoller {
  stop: () => void;
  checkNow: () => Promise<void>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 2000;

const probeTarget = async (url: string): Promise<boolean> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

export const startHealthPoller = ({
  resolver,
  localBindings,
  intervalMs,
  onStateChange,
}: StartHealthPollerInput): HealthPoller => {
  const services = resolver.getLocallyOwnedServices()
    .filter((service) => Boolean(localBindings[service]));

  const checkService = async (service: string): Promise<void> => {
    const url = localBindings[service];
    if (!url) return;
    const healthy = await probeTarget(url);
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
