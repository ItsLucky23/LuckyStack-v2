import { describe, it, expect, vi } from 'vitest';
import {
  registerSecretsResolvedListener,
  notifySecretsResolved,
} from './secretsResolved';

describe('secretsResolved registry', () => {
  it('fires every registered listener with the changed keys', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerSecretsResolvedListener(a);
    const offB = registerSecretsResolvedListener(b);

    notifySecretsResolved(['REDIS_PASSWORD', 'DATABASE_URL']);

    expect(a).toHaveBeenCalledWith(['REDIS_PASSWORD', 'DATABASE_URL']);
    expect(b).toHaveBeenCalledWith(['REDIS_PASSWORD', 'DATABASE_URL']);
    offA();
    offB();
  });

  it('passes undefined through when no keys are supplied', () => {
    const listener = vi.fn();
    const off = registerSecretsResolvedListener(listener);
    notifySecretsResolved();
    expect(listener).toHaveBeenCalledWith(undefined);
    off();
  });

  it('unsubscribe stops further notifications', () => {
    const listener = vi.fn();
    const off = registerSecretsResolvedListener(listener);
    off();
    notifySecretsResolved(['REDIS_PASSWORD']);
    expect(listener).not.toHaveBeenCalled();
  });

  it('a throwing listener never breaks the resolve path', () => {
    const boom = vi.fn(() => {
      throw new Error('listener blew up');
    });
    const ok = vi.fn();
    const offBoom = registerSecretsResolvedListener(boom);
    const offOk = registerSecretsResolvedListener(ok);

    expect(() => notifySecretsResolved(['REDIS_PASSWORD'])).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
    offBoom();
    offOk();
  });

  it('publishes notifySecretsResolved on the global-symbol channel so a decoupled package can fire it', () => {
    const SYMBOL = Symbol.for('luckystack.secretsResolved.listeners');
    const list = Reflect.get(globalThis, SYMBOL);
    expect(Array.isArray(list)).toBe(true);

    const received: (readonly string[] | undefined)[] = [];
    const off = registerSecretsResolvedListener((keys) => received.push(keys));
    //? Fire the way @luckystack/secret-manager does — via the global array, NOT
    //? a direct import — and confirm it reaches this in-process listener.
    for (const fn of list as Array<(keys: readonly string[]) => void>) {
      fn(['REDIS_PASSWORD']);
    }
    expect(received).toContainEqual(['REDIS_PASSWORD']);
    off();
  });
});
