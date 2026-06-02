import { describe, it, expect, vi, beforeEach } from 'vitest';

import tryCatch from './tryCatch';

//? `tryCatch` calls `captureException` on the error path. Mock the seam so the
//? test asserts the capture happened without pulling in the real tracker fan-out.
const captureException = vi.fn<(error: unknown, context?: Record<string, unknown>) => void>();
vi.mock('./sentrySetup', () => ({
  captureException: (error: unknown, context?: Record<string, unknown>): void => {
    captureException(error, context);
  },
}));

describe('tryCatch', () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  it('returns [null, result] when the async function resolves', async () => {
    const [error, result] = await tryCatch(() => Promise.resolve(42));

    expect(error).toBeNull();
    expect(result).toBe(42);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('returns [null, result] for a synchronous (non-promise) return value', async () => {
    const [error, result] = await tryCatch(() => 'sync-value');

    expect(error).toBeNull();
    expect(result).toBe('sync-value');
  });

  it('passes params through to the wrapped function', async () => {
    const [error, result] = await tryCatch(
      (params: { n: number }) => params.n * 2,
      { n: 21 },
    );

    expect(error).toBeNull();
    expect(result).toBe(42);
  });

  it('returns [error, null] when the function throws and captures the exception', async () => {
    const thrown = new Error('boom');

    const [error, result] = await tryCatch(() => {
      throw thrown;
    });

    expect(error).toBe(thrown);
    expect(result).toBeNull();
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(thrown, undefined);
  });

  it('returns [error, null] when an async function rejects', async () => {
    const thrown = new Error('async-boom');

    const [error, result] = await tryCatch(async () => {
      await Promise.resolve();
      throw thrown;
    });

    expect(error).toBe(thrown);
    expect(result).toBeNull();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('forwards the context object to captureException', async () => {
    const thrown = new Error('with-context');
    const context = { route: 'examples/getData', userId: '123' };

    await tryCatch(
      () => {
        throw thrown;
      },
      undefined,
      context,
    );

    expect(captureException).toHaveBeenCalledWith(thrown, context);
  });

  it('preserves a falsy resolved value (0) without confusing it for an error', async () => {
    const [error, result] = await tryCatch(() => Promise.resolve(0));

    expect(error).toBeNull();
    expect(result).toBe(0);
  });
});
