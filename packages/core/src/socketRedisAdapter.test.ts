import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Redis as RedisClient } from 'ioredis';
import type { Server as SocketIOServer } from 'socket.io';
import type { RedisAdapterOptions } from '@socket.io/redis-adapter';
import { getProjectName } from './projectConfig';

//? The adapter itself is not under test here (see the integration suite); only
//? WHAT the framework asks it for. `createAdapter` returns a sentinel so the
//? `io.adapter(...)` call can be asserted without a real Socket.io server.
const ADAPTER_SENTINEL = Symbol('adapter');
const createAdapter = vi.fn((_pub: unknown, _sub: unknown, _opts?: Partial<RedisAdapterOptions>) => ADAPTER_SENTINEL);
vi.mock('@socket.io/redis-adapter', () => ({
  createAdapter: (pub: unknown, sub: unknown, opts?: Partial<RedisAdapterOptions>) => createAdapter(pub, sub, opts),
}));
const optionsOfCall = (index: number): Partial<RedisAdapterOptions> | undefined => createAdapter.mock.calls[index]?.[2];

import { attachSocketRedisAdapter, resolveSocketAdapterKey } from './socketRedisAdapter';

//? Structural doubles: the code touches `on` on the clients and `adapter` on the
//? server — nothing else. The single boundary assertion is the documented seam.
const makeClient = (): RedisClient =>
  // eslint-disable-next-line no-restricted-syntax, @typescript-eslint/consistent-type-assertions -- ioredis test double boundary; only `on` is touched
  ({ on: vi.fn() }) as unknown as RedisClient;
const makeIo = (): { adapter: ReturnType<typeof vi.fn>; io: SocketIOServer } => {
  const adapter = vi.fn();
  // eslint-disable-next-line no-restricted-syntax, @typescript-eslint/consistent-type-assertions -- socket.io Server test double boundary; only `adapter` is touched
  const io = { adapter } as unknown as SocketIOServer;
  return { adapter, io };
};

const ORIGINAL_LUCKYSTACK_ENV = process.env.LUCKYSTACK_ENV;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe('resolveSocketAdapterKey', () => {
  afterEach(() => {
    if (ORIGINAL_LUCKYSTACK_ENV === undefined) delete process.env.LUCKYSTACK_ENV;
    else process.env.LUCKYSTACK_ENV = ORIGINAL_LUCKYSTACK_ENV;
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it('separates environments of the same project: LUCKYSTACK_ENV is part of the key', () => {
    process.env.LUCKYSTACK_ENV = 'staging';
    const staging = resolveSocketAdapterKey();
    process.env.LUCKYSTACK_ENV = 'production';
    const production = resolveSocketAdapterKey();

    expect(staging).toBe(`${getProjectName()}:staging:socket.io`);
    expect(production).toBe(`${getProjectName()}:production:socket.io`);
    expect(staging).not.toBe(production);
  });

  it('falls back to NODE_ENV when LUCKYSTACK_ENV is unset, so a dev laptop never shares a key with a deploy', () => {
    delete process.env.LUCKYSTACK_ENV;
    process.env.NODE_ENV = 'development';
    expect(resolveSocketAdapterKey()).toBe(`${getProjectName()}:development:socket.io`);
  });

  it('never yields the upstream default "socket.io" on its own', () => {
    delete process.env.LUCKYSTACK_ENV;
    expect(resolveSocketAdapterKey()).not.toBe('socket.io');
  });
});

describe('attachSocketRedisAdapter', () => {
  beforeEach(() => {
    createAdapter.mockClear();
    process.env.LUCKYSTACK_ENV = 'staging';
  });
  afterEach(() => {
    if (ORIGINAL_LUCKYSTACK_ENV === undefined) delete process.env.LUCKYSTACK_ENV;
    else process.env.LUCKYSTACK_ENV = ORIGINAL_LUCKYSTACK_ENV;
  });

  it('passes the derived key to createAdapter when no adapterOptions are given (the server bootstrap path)', () => {
    const { adapter, io } = makeIo();
    attachSocketRedisAdapter(io, { pubClient: makeClient(), subClient: makeClient() });

    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(optionsOfCall(0)?.key).toBe(resolveSocketAdapterKey());
    expect(adapter).toHaveBeenCalledWith(ADAPTER_SENTINEL);
  });

  it('keeps the other adapterOptions and still fills in the key when only they are given', () => {
    const { io } = makeIo();
    attachSocketRedisAdapter(io, { pubClient: makeClient(), subClient: makeClient(), adapterOptions: { requestsTimeout: 1234 } });

    expect(optionsOfCall(0)?.requestsTimeout).toBe(1234);
    expect(optionsOfCall(0)?.key).toBe(resolveSocketAdapterKey());
  });

  it('an explicit adapterOptions.key wins over the derived one', () => {
    const { io } = makeIo();
    attachSocketRedisAdapter(io, { pubClient: makeClient(), subClient: makeClient(), adapterOptions: { key: 'my-cluster' } });

    expect(optionsOfCall(0)?.key).toBe('my-cluster');
  });
});
