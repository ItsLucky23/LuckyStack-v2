import { afterEach, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import { setSocket } from '@luckystack/core/client';

import { initSyncRequest } from './syncRequest';

type Listener = (...args: unknown[]) => void;

//? Minimal emitter pair standing in for socket.io-client's Socket and its
//? Manager (`socket.io`): only on/off/emit are exercised by initSyncRequest.
const createEmitter = () => {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on: (event: string, listener: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
    },
    off: (event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    count: (event: string) => listeners.get(event)?.size ?? 0,
  };
};

interface SelfStatus { status: string; reconnectAttempt?: number }

describe('initSyncRequest lifecycle listeners', () => {
  afterEach(() => {
    setSocket(null);
  });

  it('shows RECONNECTING with the attempt number when the Manager emits reconnect_attempt', async () => {
    const manager = createEmitter();
    const fakeSocket = { ...createEmitter(), io: manager };
    // luckystack-allow no-as-any: initSyncRequest only touches on/off and the Manager's on/off
    setSocket(fakeSocket as unknown as Socket);

    let state: { self: SelfStatus } = { self: { status: 'CONNECTED' } };
    const setSocketStatus = (update: unknown) => {
      if (typeof update === 'function') state = (update as (prev: typeof state) => typeof state)(state);
    };

    await initSyncRequest({ setSocketStatus, sessionRef: { current: null } });
    manager.emit('reconnect_attempt', 3);

    expect(state.self).toMatchObject({ status: 'RECONNECTING', reconnectAttempt: 3 });

    //? Re-initialising is idempotent: the previous Manager listener is removed.
    await initSyncRequest({ setSocketStatus, sessionRef: { current: null } });
    expect(manager.count('reconnect_attempt')).toBe(1);
  });
});
