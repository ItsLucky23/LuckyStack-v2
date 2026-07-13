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
});
