import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Server } from 'socket.io';
import { buildApiResponseEventName, socketEventNames } from '@luckystack/core';

import { buildCallApi } from './customTests';
import type { CaseSyncSocket } from './customTests';
import { connectTestSocket } from './testSocket';

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const emptyState = (): Parameters<typeof buildCallApi>[2] => ({
  token: null,
  userId: null,
  csrfToken: null,
  lastResponse: null,
});

//? HTTP-only tests must never open a socket.
const noSocket: CaseSyncSocket = {
  get: () => Promise.reject(new Error('socket must not be used for an HTTP call')),
  close: () => undefined,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildCallApi over HTTP', () => {
  it('sends GET input as the reserved __luckystack_data query value and no body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);

    const callApi = buildCallApi('http://localhost:80/', 'admin/ai/getBehaviorVersion/v1', emptyState(), 'session', 'GET', noSocket);
    await callApi({ versionId: 'abc', nested: { enabled: true } }, { transport: 'http' });

    const [requestedUrl, init] = fetchMock.mock.calls[0] ?? [];
    const parsed = new URL(String(requestedUrl));
    expect(parsed.pathname).toBe('/api/admin/ai/getBehaviorVersion/v1');
    expect(JSON.parse(parsed.searchParams.get('__luckystack_data') ?? 'null')).toEqual({
      versionId: 'abc',
      nested: { enabled: true },
    });
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
  });

  it('keeps sending non-GET input as the JSON body with a bare URL', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);

    const callApi = buildCallApi('http://localhost:80', 'admin/ai/saveThing/v1', emptyState(), 'session', 'POST', noSocket);
    await callApi({ id: 'abc' }, { transport: 'http' });

    const [requestedUrl, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(requestedUrl)).toBe('http://localhost:80/api/admin/ai/saveThing/v1');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ id: 'abc' }));
  });
});

//? Default `transport.invocation: 'socket'`: the real client sends API calls
//? over Socket.io (`apiRequest`), so `ctx.callApi` must too. A stand-in server
//? records the frame and answers on `apiResponse-<n>` like the real one.
describe('buildCallApi over the socket (default socket mode)', () => {
  const received: { name: unknown; data: unknown }[] = [];
  let server: http.Server;
  let io: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer();
    io = new Server(server);
    io.on('connection', (socket) => {
      socket.on(socketEventNames.apiRequest, (msg: { name: string; data: unknown; responseIndex: number }) => {
        received.push({ name: msg.name, data: msg.data });
        socket.emit(buildApiResponseEventName(msg.responseIndex), { status: 'success', result: { echoed: msg.data } });
      });
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await io.close();
  });

  it('emits apiRequest with the real client shape and returns the reply, without any HTTP fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const socket = await connectTestSocket({ baseUrl, token: null, label: 'test', sessionCookieName: 'session' });
    const caseSocket: CaseSyncSocket = {
      get: () => Promise.resolve({ socket, joinedRooms: new Set<string>() }),
      close: () => { socket.disconnect(); },
    };
    const state = emptyState();

    const callApi = buildCallApi(baseUrl, 'user/getProfile/v1', state, 'session', 'GET', caseSocket);
    const reply = await callApi({ id: 'abc' });
    caseSocket.close();

    expect(received.at(-1)).toStrictEqual({ name: 'api/user/getProfile/v1', data: { id: 'abc' } });
    expect(reply).toStrictEqual({ status: 'success', result: { echoed: { id: 'abc' } } });
    expect(state.lastResponse).toStrictEqual(reply);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
