import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server } from 'socket.io';
import { buildJoinRoomResponseEventName, buildSyncResponseEventName, socketEventNames } from '@luckystack/core';

import { createSocketProbeTransport } from './socketProbeTransport';
import { walkSyncEndpoints } from './walkEndpoints';

//? Sync routes on the default `transport.invocation: 'socket'` run through the
//? socket pipeline, not `/sync/*` — so the runner must speak the real wire. A
//? stand-in socket.io server records what arrives and answers like the real
//? one (`joinRoom-<n>` ack, `sync-<n>` reply), so this pins the request shape,
//? the session identity, the room join and the reply mapping without booting
//? the whole framework (the live `npm run test` run covers the real server).

const COOKIE = 'session_test';
const received: { name: unknown; data: unknown; receiver: unknown; cb: unknown; member: boolean; cookie: string | undefined }[] = [];
let connections = 0;
let server: http.Server;
let io: Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer();
  io = new Server(server);
  io.on('connection', (socket) => {
    connections += 1;
    const cookie = socket.handshake.headers.cookie;
    socket.on(socketEventNames.joinRoom, ({ group, responseIndex }: { group: string; responseIndex: number }) => {
      if (!cookie) {
        socket.emit(buildJoinRoomResponseEventName(responseIndex), { status: 'error', errorCode: 'auth.required' });
        return;
      }
      void socket.join(group);
      socket.emit(buildJoinRoomResponseEventName(responseIndex), { status: 'success' });
    });
    socket.on(socketEventNames.sync, (msg: { name: string; data: unknown; receiver: string; cb: string; responseIndex: number }) => {
      const member = socket.rooms.has(msg.receiver);
      received.push({ name: msg.name, data: msg.data, receiver: msg.receiver, cb: msg.cb, member, cookie });
      socket.emit(
        buildSyncResponseEventName(msg.responseIndex),
        member ? { status: 'success', result: {} } : { status: 'error', errorCode: 'sync.notRoomMember' },
      );
    });
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await io.close();
});

const [syncEndpoint] = walkSyncEndpoints({ chat: { send: { v1: { auth: { login: true } } } } });

describe('createSocketProbeTransport', () => {
  it('sends the real sync request shape, joined to the receiver as the session user', async () => {
    if (!syncEndpoint) throw new Error('fixture endpoint missing');
    const transport = createSocketProbeTransport({ baseUrl, receiver: 'lstest-room-a', sessionCookieName: COOKIE });
    const response = await transport.send({
      endpoint: syncEndpoint,
      baseUrl,
      body: { message: 'hi' },
      headers: { Cookie: `${COOKIE}=tok1` },
      requestTimeoutMs: 2000,
    });
    await transport.close?.();

    expect(response).toStrictEqual({ parsed: { status: 'success', errorCode: undefined } });
    expect(received.at(-1)).toStrictEqual({
      name: 'sync/chat/send/v1',
      data: { message: 'hi' },
      receiver: 'lstest-room-a',
      cb: 'chat/send/v1',
      member: true,
      cookie: `${COOKIE}=tok1`,
    });
  });

  it('probes anonymously without a Cookie header — no join, the server rejection comes back', async () => {
    if (!syncEndpoint) throw new Error('fixture endpoint missing');
    const transport = createSocketProbeTransport({ baseUrl, receiver: 'lstest-room-b', sessionCookieName: COOKIE });
    const response = await transport.send({ endpoint: syncEndpoint, baseUrl, body: {}, requestTimeoutMs: 2000 });
    await transport.close?.();

    expect(response?.parsed?.errorCode).toBe('sync.notRoomMember');
    expect(received.at(-1)?.cookie).toBeUndefined();
  });

  it('reuses one socket per session identity across probes', async () => {
    if (!syncEndpoint) throw new Error('fixture endpoint missing');
    const transport = createSocketProbeTransport({ baseUrl, receiver: 'lstest-room-c', sessionCookieName: COOKIE });
    const before = connections;
    for (let i = 0; i < 3; i += 1) {
      await transport.send({ endpoint: syncEndpoint, baseUrl, body: {}, headers: { Cookie: `${COOKIE}=tok2` }, requestTimeoutMs: 2000 });
    }
    await transport.close?.();
    expect(connections - before).toBe(1);
  });
});
