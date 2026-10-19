import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

//? REGRESSION (sweep 012). `startRouter` wired the health store's
//? `onExternalChange` to `resolver.setLocalHealth`, which writes through the
//? store (SET + PUBLISH). Redis delivers every PUBLISH to every subscriber —
//? including the instance that sent it — so the router's own message came back,
//? was published again, and so on forever: one health flip became a pub/sub
//? storm on `router:health:events:<env>`.
//?
//? ioredis is replaced by an in-memory bus that behaves like Redis on that one
//? point: a published message is delivered to every subscribed connection,
//? the publisher's own subscriber included.

type MessageHandler = (channel: string, raw: string) => void;

const subscribers = new Map<string, MessageHandler[]>();
const published: { channel: string; raw: string }[] = [];

vi.mock('ioredis', () => {
  class FakeRedis {
    private handlers: MessageHandler[] = [];
    connect = (): Promise<void> => Promise.resolve();
    disconnect = (): void => undefined;
    quit = (): Promise<string> => Promise.resolve('OK');
    unsubscribe = (): Promise<void> => Promise.resolve();
    mget = (...keys: string[]): Promise<(string | null)[]> => Promise.resolve(keys.map(() => null));
    on = (event: string, handler: MessageHandler): this => {
      if (event === 'message') this.handlers.push(handler);
      return this;
    };
    subscribe = (channel: string): Promise<void> => {
      const list = subscribers.get(channel) ?? [];
      list.push((ch, raw) => { for (const h of this.handlers) h(ch, raw); });
      subscribers.set(channel, list);
      return Promise.resolve();
    };
    multi = () => {
      const queued: { channel: string; raw: string }[] = [];
      const pipeline = {
        set: () => pipeline,
        publish: (channel: string, raw: string) => { queued.push({ channel, raw }); return pipeline; },
        exec: () => {
          for (const message of queued) {
            published.push(message);
            //? Async delivery, as with a real Redis round trip.
            setImmediate(() => {
              for (const deliver of subscribers.get(message.channel) ?? []) deliver(message.channel, message.raw);
            });
          }
          return Promise.resolve(queued.map(() => [null, 'OK']));
        },
      };
      return pipeline;
    };
  }
  return { default: FakeRedis };
});

vi.mock('@luckystack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luckystack/core')>();
  return {
    ...actual,
    getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  };
});

import { registerDeployConfig, registerServicesConfig } from '@luckystack/core';
import { startRouter, type RunningRouter } from './startRouter';

const ENV_KEY = 'healthstoretest';

const grabFreePort = async (): Promise<number> => {
  const probe = http.createServer();
  await new Promise<void>((resolve) => { probe.listen(0, '127.0.0.1', () => { resolve(); }); });
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => { probe.close(() => { resolve(); }); });
  return port;
};

let router: RunningRouter | null = null;

afterEach(async () => {
  if (router) await router.stop();
  router = null;
  subscribers.clear();
  published.length = 0;
});

describe('startRouter — shared health store wiring', () => {
  it('publishes a local health flip once instead of re-publishing its own message forever', async () => {
    registerServicesConfig({
      services: { system: { source: 'root' } },
      presets: { 'core-preset': { services: ['system'] } },
    });
    registerDeployConfig({
      resources: {},
      environments: {
        [ENV_KEY]: {
          redis: 'redisShared',
          mongo: 'mongoShared',
          bindings: { system: 'http://127.0.0.1:65001' },
        },
      },
    });

    const healthChanges: [string, boolean][] = [];
    router = await startRouter({
      currentEnvKey: ENV_KEY,
      port: await grabFreePort(),
      onHealthChange: (service, healthy) => { healthChanges.push([service, healthy]); },
    });
    expect(router.healthStore).not.toBeNull();

    //? What the health poller does when the local backend stops answering.
    router.resolver.setLocalHealth('system', false);

    //? Give the bus plenty of event-loop turns; the old wiring published once
    //? per turn.
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));

    expect(published).toHaveLength(1);
    expect(router.resolver.getLocalHealth('system')).toBe(false);
    //? The echoed message still reaches the change hook, exactly once.
    expect(healthChanges).toEqual([['system', false]]);
  });
});
