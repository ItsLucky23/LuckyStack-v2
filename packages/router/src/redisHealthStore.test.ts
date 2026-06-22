import { beforeEach, describe, expect, it, vi } from 'vitest';

//? Regression test for the FD-leak fix in createRedisHealthStore: when the
//? subscriber connection fails AFTER the command client already connected, the
//? command client must be disconnected so its socket/FD isn't leaked.
//?
//? ioredis is mocked so no real Redis is needed. Each `new Redis(...)` returns
//? a fresh fake whose `connect`/`disconnect`/`on`/`subscribe` are spies; the
//? constructor records instances in call order (client first, subscriber
//? second — matching the source).

interface FakePipeline {
  set: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
}

interface FakeRedis {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  //? multi() returns a chainable pipeline; we track pipelines per client so
  //? tests can inspect .set()/.publish()/.exec() calls on the right pipeline.
  multi: ReturnType<typeof vi.fn>;
  _pipeline: FakePipeline;
  mget: ReturnType<typeof vi.fn>;
}

const instances: FakeRedis[] = [];
const connectImpls: (() => Promise<void>)[] = [];

const noop = (): undefined => undefined;
const resolveNoop = (): Promise<void> => Promise.resolve();
const resolveEmptyMget = (): Promise<(string | null)[]> => Promise.resolve([]);

//? Build a fresh chainable pipeline mock for each Redis instance.
const makePipeline = (): FakePipeline => {
  const pipeline: FakePipeline = {
    set: vi.fn(),
    publish: vi.fn(),
    exec: vi.fn(() => Promise.resolve([[null, 'OK'], [null, 1]])),
  };
  //? Chainable: each method returns the pipeline itself so .set().publish().exec() works.
  pipeline.set.mockReturnValue(pipeline);
  pipeline.publish.mockReturnValue(pipeline);
  return pipeline;
};

vi.mock('ioredis', () => {
  return {
    default: class {
      connect: ReturnType<typeof vi.fn>;
      disconnect = vi.fn(resolveNoop);
      quit = vi.fn(resolveNoop);
      on = vi.fn();
      subscribe = vi.fn(resolveNoop);
      unsubscribe = vi.fn(resolveNoop);
      mget = vi.fn(resolveEmptyMget);
      _pipeline: FakePipeline;
      multi: ReturnType<typeof vi.fn>;

      constructor() {
        const impl = connectImpls[instances.length] ?? resolveNoop;
        this.connect = vi.fn(impl);
        this._pipeline = makePipeline();
        this.multi = vi.fn(() => this._pipeline);
        instances.push(this as unknown as FakeRedis);
      }
    },
  };
});

//? Silence the logger so the error listener doesn't print during the test.
vi.mock('@luckystack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luckystack/core')>();
  return {
    ...actual,
    getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  };
});

import { createRedisHealthStore } from './redisHealthStore';

const expectInstance = (index: number): FakeRedis => {
  const instance = instances[index];
  if (!instance) throw new Error(`expected Redis instance ${index} to exist`);
  return instance;
};

describe('createRedisHealthStore — FD-leak on subscriber connect failure', () => {
  //? Spies live on per-construction instances, so resetting the `instances`
  //? + `connectImpls` arrays between tests is enough — a global
  //? `vi.clearAllMocks()` would wipe the just-recorded calls before the
  //? assertions read them (the constructor runs during the awaited factory).
  beforeEach(() => {
    instances.length = 0;
    connectImpls.length = 0;
  });

  it('disconnects the already-connected client when the subscriber fails to connect', async () => {
    //? client (instance 0) connects fine; subscriber (instance 1) rejects.
    connectImpls[0] = resolveNoop;
    connectImpls[1] = () => Promise.reject(new Error('subscriber ECONNREFUSED'));

    await expect(
      createRedisHealthStore({ envKey: 'staging', onExternalChange: noop }),
    ).rejects.toThrow('subscriber ECONNREFUSED');

    const client = expectInstance(0);
    const subscriber = expectInstance(1);
    //? The leak fix: the connected client is torn down rather than abandoned.
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
  });

  it('attaches an error listener to both clients before connecting', async () => {
    connectImpls[0] = resolveNoop;
    connectImpls[1] = resolveNoop;

    const store = await createRedisHealthStore({
      envKey: 'staging',
      onExternalChange: noop,
    });

    const client = expectInstance(0);
    const subscriber = expectInstance(1);
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(subscriber.on).toHaveBeenCalledWith('error', expect.any(Function));

    await store.close();
  });
});

describe('createRedisHealthStore — health-key TTL (self-healing stale health)', () => {
  beforeEach(() => {
    instances.length = 0;
    connectImpls.length = 0;
  });

  it('writes every health key with an EX TTL (default 60s) so it self-heals', async () => {
    connectImpls[0] = resolveNoop;
    connectImpls[1] = resolveNoop;

    const store = await createRedisHealthStore({
      envKey: 'staging',
      onExternalChange: noop,
    });

    await store.set('api', false);

    const client = expectInstance(0);
    //? The key MUST carry an expiry so a router that dies without flipping the
    //? service back can't pin the 'unhealthy' verdict forever.
    //? set() now goes through multi().set().publish().exec() atomically.
    expect(client.multi).toHaveBeenCalledTimes(1);
    expect(client._pipeline.set).toHaveBeenCalledWith(
      'router:health:staging:api',
      'unhealthy',
      'EX',
      60,
    );
    expect(client._pipeline.publish).toHaveBeenCalledWith(
      'router:health:events:staging',
      JSON.stringify({ service: 'api', healthy: false }),
    );
    expect(client._pipeline.exec).toHaveBeenCalledTimes(1);

    await store.close();
  });

  it('honors an explicit ttlSeconds override', async () => {
    connectImpls[0] = resolveNoop;
    connectImpls[1] = resolveNoop;

    const store = await createRedisHealthStore({
      envKey: 'staging',
      onExternalChange: noop,
      ttlSeconds: 15,
    });

    await store.set('api', true);

    const client = expectInstance(0);
    expect(client._pipeline.set).toHaveBeenCalledWith(
      'router:health:staging:api',
      'healthy',
      'EX',
      15,
    );

    await store.close();
  });

  it('falls back to the 60s default when ttlSeconds is non-positive', async () => {
    connectImpls[0] = resolveNoop;
    connectImpls[1] = resolveNoop;

    const store = await createRedisHealthStore({
      envKey: 'staging',
      onExternalChange: noop,
      ttlSeconds: 0,
    });

    await store.set('api', true);

    const client = expectInstance(0);
    expect(client._pipeline.set).toHaveBeenCalledWith(
      'router:health:staging:api',
      'healthy',
      'EX',
      60,
    );

    await store.close();
  });
});
