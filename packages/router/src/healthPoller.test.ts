import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceTargetResolver, ResolveTargetResult } from './resolveTarget';
import { startHealthPoller } from './healthPoller';
import { DEFAULT_HEALTHY_STATUS_PREDICATE } from './healthConfig';

//? The health poller probes each locally-owned service with `HEAD /` and flips
//? `resolver.setLocalHealth` on a state change. The regression under test: a
//? backend that ANSWERS with a 4xx (401/403/404/...) is NOT serving correctly
//? and must be treated as UNHEALTHY — only 2xx/3xx count as up. Earlier the
//? predicate was `response.ok || response.status < 500`, which wrongly marked
//? every 4xx as healthy.

//? Minimal in-memory resolver: one locally-owned service whose health starts
//? healthy (matches the resolver's absent-key default).
const makeResolver = (services: string[]): ServiceTargetResolver => {
  const health = new Map<string, boolean>(services.map((s) => [s, true]));
  return {
    resolve: (): ResolveTargetResult | null => null,
    setLocalHealth: (service, healthy) => { health.set(service, healthy); },
    getLocalHealth: (service) => health.get(service) ?? true,
    getLocallyOwnedServices: () => [...services],
  };
};

//? `startHealthPoller` kicks off an immediate `checkNow()` and a (unref'd)
//? interval. We drive `checkNow()` explicitly and stop the poller after each
//? test so the interval can't bleed into the next case. `probeTarget` only
//? reads `response.status`, so a minimal stub is enough.
const mockFetchStatus = (status: number): void => {
  const fakeResponse: { ok: boolean; status: number } = {
    ok: status >= 200 && status < 300,
    status,
  };
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse)));
};

describe('startHealthPoller — health predicate (2xx/3xx healthy, 4xx/5xx unhealthy)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([401, 403, 404, 429])('marks a %i response as UNHEALTHY', async (status) => {
    mockFetchStatus(status);
    const resolver = makeResolver(['api']);
    const onStateChange = vi.fn();

    const poller = startHealthPoller({
      resolver,
      localBindings: { api: 'http://localhost:5001' },
      intervalMs: 5000,
      onStateChange,
      isHealthyStatus: DEFAULT_HEALTHY_STATUS_PREDICATE,
    });

    await poller.checkNow();
    poller.stop();

    expect(resolver.getLocalHealth('api')).toBe(false);
    expect(onStateChange).toHaveBeenCalledWith('api', false);
  });

  it.each([200, 204, 301, 302, 399])('keeps a %i response HEALTHY', async (status) => {
    mockFetchStatus(status);
    const resolver = makeResolver(['api']);
    const onStateChange = vi.fn();

    const poller = startHealthPoller({
      resolver,
      localBindings: { api: 'http://localhost:5001' },
      intervalMs: 5000,
      onStateChange,
      isHealthyStatus: DEFAULT_HEALTHY_STATUS_PREDICATE,
    });

    await poller.checkNow();
    poller.stop();

    expect(resolver.getLocalHealth('api')).toBe(true);
    //? No state change fired: it started healthy and stayed healthy.
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('marks a 5xx response as UNHEALTHY', async () => {
    mockFetchStatus(503);
    const resolver = makeResolver(['api']);

    const poller = startHealthPoller({
      resolver,
      localBindings: { api: 'http://localhost:5001' },
      intervalMs: 5000,
      isHealthyStatus: DEFAULT_HEALTHY_STATUS_PREDICATE,
    });

    await poller.checkNow();
    poller.stop();

    expect(resolver.getLocalHealth('api')).toBe(false);
  });

  it('marks a probe network failure as UNHEALTHY', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    const resolver = makeResolver(['api']);

    const poller = startHealthPoller({
      resolver,
      localBindings: { api: 'http://localhost:5001' },
      intervalMs: 5000,
      isHealthyStatus: DEFAULT_HEALTHY_STATUS_PREDICATE,
    });

    await poller.checkNow();
    poller.stop();

    expect(resolver.getLocalHealth('api')).toBe(false);
  });

  it('honors a custom predicate that accepts a 401 liveness probe', async () => {
    mockFetchStatus(401);
    const resolver = makeResolver(['api']);

    const poller = startHealthPoller({
      resolver,
      localBindings: { api: 'http://localhost:5001' },
      intervalMs: 5000,
      //? Backend answers liveness with 401 but is serving — opt 401 into healthy.
      isHealthyStatus: (s) => s === 401 || (s >= 200 && s < 400),
    });

    await poller.checkNow();
    poller.stop();

    expect(resolver.getLocalHealth('api')).toBe(true);
  });
});

describe('DEFAULT_HEALTHY_STATUS_PREDICATE', () => {
  it('accepts only 2xx/3xx', () => {
    expect(DEFAULT_HEALTHY_STATUS_PREDICATE(200)).toBe(true);
    expect(DEFAULT_HEALTHY_STATUS_PREDICATE(399)).toBe(true);
    expect(DEFAULT_HEALTHY_STATUS_PREDICATE(400)).toBe(false);
    expect(DEFAULT_HEALTHY_STATUS_PREDICATE(401)).toBe(false);
    expect(DEFAULT_HEALTHY_STATUS_PREDICATE(404)).toBe(false);
    expect(DEFAULT_HEALTHY_STATUS_PREDICATE(500)).toBe(false);
    expect(DEFAULT_HEALTHY_STATUS_PREDICATE(199)).toBe(false);
  });
});
