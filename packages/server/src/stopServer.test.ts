import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Server as HttpServer } from 'node:http';
import type { Server as SocketIOServer } from 'socket.io';
import type { Redis as RedisClient } from 'ioredis';

//? MIS-016: graceful shutdown. These tests pin that `runGracefulShutdown`:
//?  - dispatches the core `preServerStop` hook (with reason + timeoutMs),
//?  - calls `flushErrorTrackers()`,
//?  - closes io + http + quits both redis-adapter clients,
//?  - and CANNOT hang: a step that never resolves still lets shutdown finish
//?    within the per-step timeout (the timeout race wins).
const { mocks } = vi.hoisted(() => ({
  mocks: {
    dispatchHook: vi.fn<(name: string, payload: unknown) => Promise<unknown>>(),
    flushErrorTrackers: vi.fn<() => Promise<void>>(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock('@luckystack/core', async () => {
  const actual = await vi.importActual<typeof import('@luckystack/core')>('@luckystack/core');
  return {
    ...actual,
    dispatchHook: mocks.dispatchHook,
    flushErrorTrackers: mocks.flushErrorTrackers,
    getLogger: () => mocks.logger,
  };
});

import { runGracefulShutdown } from './stopServer';

const makeDeps = (overrides: {
  httpClose?: (cb: () => void) => void;
  ioClose?: (cb: () => void) => void;
  pubQuit?: () => Promise<string>;
  subQuit?: () => Promise<string>;
} = {}) => {
  const httpClose = vi.fn((cb: () => void) => { overrides.httpClose ? overrides.httpClose(cb) : cb(); });
  const ioClose = vi.fn((cb: () => void) => { overrides.ioClose ? overrides.ioClose(cb) : cb(); });
  const pubQuit = vi.fn(() => overrides.pubQuit?.() ?? Promise.resolve('OK'));
  const subQuit = vi.fn(() => overrides.subQuit?.() ?? Promise.resolve('OK'));

  const httpServer = { close: httpClose } as unknown as HttpServer;
  const ioServer = { close: ioClose } as unknown as SocketIOServer;
  const pubClient = { quit: pubQuit } as unknown as RedisClient;
  const subClient = { quit: subQuit } as unknown as RedisClient;

  return {
    deps: { httpServer, ioServer, adapterClients: { pubClient, subClient } },
    spies: { httpClose, ioClose, pubQuit, subQuit },
  };
};

beforeEach(() => {
  mocks.dispatchHook.mockReset().mockResolvedValue({ stopped: false });
  mocks.flushErrorTrackers.mockReset().mockResolvedValue(undefined);
  mocks.logger.info.mockReset();
  mocks.logger.warn.mockReset();
  mocks.logger.error.mockReset();
});

describe('runGracefulShutdown — happy path', () => {
  it('fires preServerStop hook, flushes trackers, closes io+http, quits redis clients', async () => {
    const { deps, spies } = makeDeps();

    await runGracefulShutdown(deps, { reason: 'SIGTERM', timeoutMs: 5000 });

    expect(mocks.dispatchHook).toHaveBeenCalledWith('preServerStop', {
      reason: 'SIGTERM',
      timeoutMs: 5000,
    });
    expect(mocks.flushErrorTrackers).toHaveBeenCalledOnce();
    expect(spies.ioClose).toHaveBeenCalledOnce();
    expect(spies.httpClose).toHaveBeenCalledOnce();
    expect(spies.pubQuit).toHaveBeenCalledOnce();
    expect(spies.subQuit).toHaveBeenCalledOnce();
  });

  it('defaults reason to "manual" and uses the default timeout', async () => {
    const { deps } = makeDeps();
    await runGracefulShutdown(deps);
    expect(mocks.dispatchHook).toHaveBeenCalledWith('preServerStop', {
      reason: 'manual',
      timeoutMs: 10000,
    });
  });
});

describe('runGracefulShutdown — isolation + bounded timeout', () => {
  it('a hanging flush step still lets shutdown complete within the timeout', async () => {
    //? `flushErrorTrackers` never resolves — the timeout race must win so the
    //? remaining steps (io/http close, redis quit) still run and the whole
    //? shutdown settles.
    mocks.flushErrorTrackers.mockReturnValue(new Promise<void>(() => { /* never resolves */ }));
    const { deps, spies } = makeDeps();

    const start = Date.now();
    await runGracefulShutdown(deps, { timeoutMs: 50 });
    const elapsed = Date.now() - start;

    //? Settled — the hanging flush did NOT hang shutdown.
    expect(spies.ioClose).toHaveBeenCalledOnce();
    expect(spies.httpClose).toHaveBeenCalledOnce();
    expect(spies.pubQuit).toHaveBeenCalledOnce();
    //? Bounded: shutdown finished close to the per-step deadline, not indefinitely.
    expect(elapsed).toBeLessThan(2000);
    expect(mocks.logger.warn).toHaveBeenCalled();
  });

  it('a throwing hook does not abort the rest of the sequence', async () => {
    mocks.dispatchHook.mockRejectedValue(new Error('hook boom'));
    const { deps, spies } = makeDeps();

    await runGracefulShutdown(deps, { timeoutMs: 5000 });

    expect(mocks.flushErrorTrackers).toHaveBeenCalledOnce();
    expect(spies.httpClose).toHaveBeenCalledOnce();
    expect(spies.pubQuit).toHaveBeenCalledOnce();
  });

  it('a hanging http-close does not block the io-close / redis-quit steps', async () => {
    //? `httpServer.close()` callback never fires (slow keep-alive client). The
    //? race bounds the await; io-close + redis-quit must still run.
    const { deps, spies } = makeDeps({ httpClose: () => { /* never calls cb */ } });

    await runGracefulShutdown(deps, { timeoutMs: 50 });

    expect(spies.ioClose).toHaveBeenCalledOnce();
    expect(spies.pubQuit).toHaveBeenCalledOnce();
    expect(spies.subQuit).toHaveBeenCalledOnce();
  });
});
