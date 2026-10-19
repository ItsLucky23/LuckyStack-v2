import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';

import type { RoutedHttpInvocationInput, RoutedInvocationResult } from './routedHttpInvocation';

//? Each routed call stays pending until its own signal aborts or the test
//? settles it, so the test controls the order in which superseded requests
//? finish relative to their replacements.
interface PendingCall {
  signals: readonly (AbortSignal | null | undefined)[];
  settle: (result: RoutedInvocationResult<unknown>) => void;
}
const calls: PendingCall[] = [];

vi.mock('./routedHttpInvocation', () => ({
  invokeRoutedHttp: (input: RoutedHttpInvocationInput<unknown>) =>
    new Promise<RoutedInvocationResult<unknown>>((resolve) => {
      calls.push({ signals: input.signals ?? [], settle: resolve });
    }),
}));

const { apiRequest } = await import('./apiRequest');
const { registerProjectConfig } = await import('./projectConfig');
const { setSocket } = await import('./socketState');

type LooseApiRequest = (params: { name: string; version: string; data?: unknown; abortable?: boolean }) => Promise<unknown>;
// luckystack-allow no-as-any: core has no generated route map in isolation, so the typed signature accepts no route name
const callApi = apiRequest as unknown as LooseApiRequest;

const isAborted = (call: PendingCall | undefined): boolean =>
  call?.signals.some((signal) => signal?.aborted === true) ?? false;

const flush = async () => {
  for (let index = 0; index < 5; index++) await Promise.resolve();
};

describe('apiRequest routed-http replace-previous dedupe', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('navigator', { onLine: true });
    registerProjectConfig({ transport: { invocation: 'routed-http' } });
    // luckystack-allow no-as-any: the routed path only reads `connected`; a full Socket fake adds nothing
    setSocket({ connected: true } as unknown as Socket);
  });

  afterEach(() => {
    setSocket(null);
    vi.unstubAllGlobals();
  });

  it('keeps aborting the previous identical request after a superseded one settles', async () => {
    const request = () => callApi({ name: 'examples/getItems', version: 'v1', data: { q: 'x' }, abortable: true });

    const first = request();
    await flush();
    const second = request();
    await flush();
    expect(isAborted(calls[0])).toBe(true);

    //? The superseded first call settles AFTER the second registered its controller.
    calls[0]?.settle({ kind: 'aborted' });
    await expect(first).resolves.toMatchObject({ errorCode: 'request.aborted' });

    const third = request();
    await flush();
    expect(isAborted(calls[1])).toBe(true);

    calls[1]?.settle({ kind: 'aborted' });
    calls[2]?.settle({ kind: 'response', response: { status: 'success', httpStatus: 200 }, httpStatus: 200 });
    await expect(second).resolves.toMatchObject({ errorCode: 'request.aborted' });
    await expect(third).resolves.toMatchObject({ status: 'success' });
  });
});
