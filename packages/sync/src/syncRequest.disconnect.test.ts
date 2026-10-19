import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import {
  buildSyncProgressEventName,
  buildSyncResponseEventName,
  registerProjectConfig,
  setSocket,
} from '@luckystack/core/client';

import { syncRequest } from './syncRequest';

type Listener = ((...args: unknown[]) => void) & { original?: Listener };

//? Connected Socket stand-in: on/once/off/emit are all the socket branch of
//? syncRequest uses. Like socket.io's emitter, `off(fn)` also removes a
//? `once(fn)` wrapper. `total` lets the test assert that no listener leaks.
const createFakeSocket = () => {
  const listeners = new Map<string, Set<Listener>>();
  const off = (event: string, listener: Listener) => {
    const set = listeners.get(event);
    if (!set) return;
    for (const registered of set) {
      if (registered === listener || registered.original === listener) set.delete(registered);
    }
  };
  const on = (event: string, listener: Listener) => {
    const set = listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(event, set);
  };
  return {
    connected: true,
    on,
    off,
    once: (event: string, listener: Listener) => {
      const wrapped: Listener = (...args) => {
        off(event, wrapped);
        listener(...args);
      };
      wrapped.original = listener;
      on(event, wrapped);
    },
    emit: () => true,
    trigger: (event: string, ...args: unknown[]) => {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
    },
    events: () => [...listeners.entries()].filter(([, set]) => set.size > 0).map(([event]) => event),
    total: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
};

type LooseSyncRequest = (params: { name: string; version: string; data?: unknown; receiver: string }) => Promise<unknown>;
// luckystack-allow no-as-any: sync has no generated route map in isolation, so the typed signature accepts no route name
const callSync = syncRequest as unknown as LooseSyncRequest;

describe('syncRequest socket branch on disconnect', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
    //? With the ack-timeout disabled, only the disconnect watcher can settle.
    registerProjectConfig({ transport: { invocation: 'socket' }, sync: { requestTimeoutMs: false } });
  });

  afterEach(() => {
    setSocket(null);
    vi.unstubAllGlobals();
  });

  it('settles with sync.disconnected and removes its listeners', async () => {
    const fakeSocket = createFakeSocket();
    // luckystack-allow no-as-any: the socket branch only uses connected/on/once/off/emit
    setSocket(fakeSocket as unknown as Socket);

    const pending = callSync({ name: 'examples/move', version: 'v1', data: {}, receiver: 'room-a' });
    await vi.waitFor(() => { expect(fakeSocket.total()).toBeGreaterThan(0); });

    fakeSocket.trigger('disconnect', 'transport close');

    await expect(pending).resolves.toMatchObject({ status: 'error', errorCode: 'sync.disconnected' });
    expect(fakeSocket.total()).toBe(0);
  });

  it('removes the disconnect watcher after a normal acknowledgement', async () => {
    const fakeSocket = createFakeSocket();
    // luckystack-allow no-as-any: the socket branch only uses connected/on/once/off/emit
    setSocket(fakeSocket as unknown as Socket);

    const pending = callSync({ name: 'examples/move', version: 'v1', data: {}, receiver: 'room-a' });
    await vi.waitFor(() => { expect(fakeSocket.total()).toBeGreaterThan(0); });

    const responseEvent = fakeSocket.events().find((event) =>
      event.startsWith(buildSyncResponseEventName('')) && !event.startsWith(buildSyncProgressEventName('')));
    expect(responseEvent).toBeDefined();
    fakeSocket.trigger(responseEvent ?? '', { status: 'success', result: {} });

    await expect(pending).resolves.toMatchObject({ status: 'success' });
    expect(fakeSocket.total()).toBe(0);
  });
});
