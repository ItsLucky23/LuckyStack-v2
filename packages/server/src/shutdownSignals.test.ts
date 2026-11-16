import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installShutdownSignalHandlers, validateShutdownTimeout } from './shutdownSignals';
import { runGracefulShutdown, type GracefulShutdownDeps } from './stopServer';

const { hook, flush } = vi.hoisted(() => ({ hook: vi.fn(), flush: vi.fn() }));
vi.mock('@luckystack/core', () => ({
  dispatchHook: hook,
  flushErrorTrackers: flush,
  getLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
  tryCatch: async (fn: () => Promise<unknown>) => {
    try { return [null, await fn()]; } catch (error) { return [error, null]; }
  },
}));

let signals: Map<string | symbol, () => void>;
beforeEach(() => {
  vi.useFakeTimers();
  signals = new Map();
  vi.spyOn(process, 'on').mockImplementation((event, listener) => {
    signals.set(event, listener);
    return process;
  });
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  hook.mockReset().mockImplementation(() => new Promise(() => {}));
  flush.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

const deps = () => ({
  httpServer: { close: (cb: () => void) => cb() },
  ioServer: { close: (cb: () => void) => cb() },
  adapterClients: {
    pubClient: { quit: vi.fn().mockResolvedValue('OK') },
    subClient: { quit: vi.fn().mockResolvedValue('OK') },
  },
}) as unknown as GracefulShutdownDeps; // luckystack-allow no-as-any: minimal HTTP/socket/Redis test doubles avoid real network handles; no typed API call is bypassed.

describe('framework signal shutdown', () => {
  it.each([undefined, 180_000])('bounds the production hook with budget %s', async (timeoutMs) => {
    const budget = timeoutMs ?? 10_000;
    const stop = vi.fn((options) => runGracefulShutdown(deps(), options));
    installShutdownSignalHandlers({ timeoutMs, stop });
    signals.get('SIGTERM')?.();
    expect(hook).toHaveBeenCalledWith('preServerStop', { reason: 'SIGTERM', timeoutMs: budget });
    await vi.advanceTimersByTimeAsync(budget - 1);
    expect(process.exit).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it.each([undefined, 180_000])('bounds the dev hook with budget %s', async (timeoutMs) => {
    const budget = timeoutMs ?? 2000;
    installShutdownSignalHandlers({ timeoutMs });
    signals.get('SIGINT')?.();
    expect(hook).toHaveBeenCalledWith('preServerStop', { reason: 'SIGINT', timeoutMs: budget });
    await vi.advanceTimersByTimeAsync(budget - 1);
    expect(process.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it.each([true, false])('exits as soon as a hook completes (production=%s)', async (production) => {
    hook.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 25_000)));
    installShutdownSignalHandlers({ timeoutMs: 180_000,
      stop: production ? (options) => runGracefulShutdown(deps(), options) : undefined });
    signals.get('SIGTERM')?.();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['SIGINT', 'SIGTERM'])('forces exit when %s repeats in both modes', (signal) => {
    for (const production of [true, false]) {
      vi.mocked(process.exit).mockClear();
      installShutdownSignalHandlers({ timeoutMs: 180_000,
        stop: production ? () => new Promise(() => {}) : undefined });
      signals.get(signal)?.();
      expect(process.exit).not.toHaveBeenCalled();
      signals.get(signal)?.();
      expect(process.exit).toHaveBeenCalledWith(1);
    }
  });

  //? Ctrl+C reaches the child as SIGINT and again as the supervisor's SIGTERM.
  it.each([['SIGINT', 'SIGTERM'], ['SIGTERM', 'SIGINT']])('keeps draining when %s is followed by %s', async (first, second) => {
    installShutdownSignalHandlers({ timeoutMs: 180_000 });
    signals.get(first)?.();
    signals.get(second)?.();
    expect(process.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it.each([true, false])('announces the configured ceiling (production=%s)', (production) => {
    const send = vi.fn();
    vi.stubGlobal('process', { ...process, connected: true, send });
    installShutdownSignalHandlers({ timeoutMs: 180_000, stop: production ? vi.fn() : undefined });
    expect(send).toHaveBeenCalledWith({ type: 'luckystack:shutdown-grace', graceMs: production ? 901_000 : 181_000 }, undefined, undefined, expect.any(Function));
  });

  it('leaves supervisor defaults alone when unconfigured', () => {
    const send = vi.fn();
    vi.stubGlobal('process', { ...process, connected: true, send });
    installShutdownSignalHandlers({});
    expect(send).not.toHaveBeenCalled();
  });

  it('still exits cleanly if a dev hook throws', async () => {
    hook.mockRejectedValue(new Error('hook failed'));
    installShutdownSignalHandlers({ timeoutMs: 180_000 });
    signals.get('SIGTERM')?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, NaN, Infinity, 1.5, 2_147_483_648])('rejects invalid budget %s', (budget) => {
    expect(() => validateShutdownTimeout(budget)).toThrow(RangeError);
  });
});
