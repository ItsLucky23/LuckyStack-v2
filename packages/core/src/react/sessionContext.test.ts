import { afterEach, describe, expect, it, vi } from 'vitest';

import { _resetClientHooksForTests, registerClientHook } from '../clientHookBus';
import { getCurrentSession, proposeLogin, setLatestSession } from './sessionContext';

describe('proposeLogin preLogin veto', () => {
  afterEach(() => {
    _resetClientHooksForTests();
    setLatestSession(null);
  });

  it('runs preLogin on the null -> session transition', async () => {
    const preLogin = vi.fn(() => ({ stop: true as const, errorCode: 'auth.suspended' }));
    registerClientHook('preLogin', preLogin);

    const result = await proposeLogin({ id: 'user-1' });

    expect(preLogin).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ stopped: true, committed: false });
    expect(getCurrentSession()).toBeNull();
  });

  it('does not run preLogin for an update of the already signed-in user', async () => {
    setLatestSession({ id: 'user-1' });
    const preLogin = vi.fn(() => ({ stop: true as const, errorCode: 'auth.suspended' }));
    registerClientHook('preLogin', preLogin);

    const updated = { id: 'user-1', roomCodes: ['room-a'] };
    const result = await proposeLogin(updated);

    expect(preLogin).not.toHaveBeenCalled();
    expect(result).toEqual({ stopped: false, committed: true });
    expect(getCurrentSession()).toBe(updated);
  });

  it('runs preLogin again when a different user replaces the session', async () => {
    setLatestSession({ id: 'user-1' });
    const preLogin = vi.fn(() => undefined);
    registerClientHook('preLogin', preLogin);

    await proposeLogin({ id: 'user-2' });

    expect(preLogin).toHaveBeenCalledTimes(1);
  });
});
