//? Integration test (opt-in: `npm run test:integration`). Proves that
//? `@socket.io/redis-adapter` actually links sockets across SEPARATE server
//? instances — the cross-instance fan-out the framework relies on — and
//? contrasts it with the per-instance-local room view that explains why
//? LuckyStack's regular `syncRequest` fan-out is local-only.
//? See docs/ARCHITECTURE_MULTI_INSTANCE.md.
//?
//? Needs a reachable Redis (the same one the app uses, read via
//? `getRedisConnectionOptions()`). Skips gracefully when Redis is unreachable
//? so it never fails in a Redis-less CI.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket as ServerSocket } from 'socket.io';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { getRedisConnectionOptions } from './redis';

const ROOM = 'cross-instance-smoke';
const EVENT = 'smoke-event';
const EVENT2 = 'smoke-remote-emit';

interface Instance {
  http: HttpServer;
  io: IOServer;
  port: number;
}

let redisAvailable = false;
const redisClients: Redis[] = [];
const instances: Instance[] = [];
const clients: ClientSocket[] = [];

let ioA: IOServer;
let ioB: IOServer;
let clientA: ClientSocket;
let clientB: ClientSocket;

const makeRedis = (): Redis => {
  const opts = getRedisConnectionOptions();
  const client = new Redis({
    host: opts.host,
    port: opts.port,
    ...(opts.username ? { username: opts.username } : {}),
    ...(opts.password ? { password: opts.password } : {}),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    //? Fail fast in tests — never sit in an infinite reconnect loop.
    retryStrategy: () => null,
  });
  //? Swallow async errors so a dropped connection mid-teardown doesn't crash the run.
  client.on('error', () => {});
  redisClients.push(client);
  return client;
};

const listen = (http: HttpServer): Promise<number> =>
  new Promise((resolve) => {
    http.listen(0, () => {
      const addr = http.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });

const buildInstance = async (): Promise<Instance> => {
  const http = createServer();
  const io = new IOServer(http, { cors: { origin: '*' } });
  const pub = makeRedis();
  const sub = pub.duplicate();
  sub.on('error', () => {});
  redisClients.push(sub);
  await pub.connect();
  await sub.connect();
  io.adapter(createAdapter(pub, sub));
  //? Each instance joins ONLY its own connecting sockets to the room. With the
  //? adapter, `io.to(room).emit()` still reaches the other instance's members.
  io.on('connection', (socket: ServerSocket) => {
    void socket.join(ROOM);
  });
  const port = await listen(http);
  return { http, io, port };
};

const connect = (port: number): Promise<ClientSocket> =>
  new Promise((resolve, reject) => {
    const socket = connectClient(`http://localhost:${String(port)}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    const timer = setTimeout(() => { reject(new Error('client connect timeout')); }, 5000);
    socket.on('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.on('connect_error', (err: Error) => { clearTimeout(timer); reject(err); });
    clients.push(socket);
  });

const waitForEvent = (socket: ClientSocket, event: string, timeoutMs: number): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const handler = (payload: unknown) => { clearTimeout(timer); socket.off(event, handler); resolve(payload); };
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timeout waiting for "${event}"`)); }, timeoutMs);
    socket.on(event, handler);
  });

const expectNoEvent = (socket: ClientSocket, event: string, windowMs: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const handler = () => { clearTimeout(timer); socket.off(event, handler); reject(new Error(`unexpectedly received "${event}"`)); };
    const timer = setTimeout(() => { socket.off(event, handler); resolve(); }, windowMs);
    socket.on(event, handler);
  });

beforeAll(async () => {
  const probe = makeRedis();
  try {
    await probe.connect();
    await probe.ping();
    redisAvailable = true;
  } catch {
    redisAvailable = false;
    return;
  }

  const a = await buildInstance();
  const b = await buildInstance();
  instances.push(a, b);
  ioA = a.io;
  ioB = b.io;
  clientA = await connect(a.port);
  clientB = await connect(b.port);

  //? Let the adapter propagate the room joins across instances before asserting.
  await new Promise((r) => setTimeout(r, 300));
}, 20000);

afterAll(async () => {
  for (const c of clients) c.disconnect();
  for (const inst of instances) {
    inst.io.close();
    await new Promise<void>((r) => { inst.http.close(() => { r(); }); });
  }
  for (const c of redisClients) {
    try { c.disconnect(); } catch { /* already closed */ }
  }
});

describe('@socket.io/redis-adapter cross-instance fan-out', () => {
  it('delivers io.to(room).emit() fired on instance B to a client on instance A', (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }
    const received = waitForEvent(clientA, EVENT, 4000);
    ioB.to(ROOM).emit(EVENT, { hello: 'from-B' });
    return expect(received).resolves.toMatchObject({ hello: 'from-B' });
  });

  it('keeps each instance\'s LOCAL room view local-only (adapter.rooms is per-process)', (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }
    //? `adapter.rooms` is a per-process map: each side sees exactly its OWN
    //? joined client, never the remote one. This is WHY the old local-only
    //? sync fan-out (which iterated this map) missed remote members. The fix
    //? uses `fetchSockets()` instead (next test), which spans instances.
    expect(ioA.sockets.adapter.rooms.get(ROOM)?.size).toBe(1);
    expect(ioB.sockets.adapter.rooms.get(ROOM)?.size).toBe(1);
  });

  it('fetchSockets() returns room members from ALL instances (the fix\'s enumeration)', async (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }
    //? This is exactly what handleSyncRequest now does: `io.in(room).fetchSockets()`
    //? returns BOTH clients (local + remote) — so the sync fan-out reaches everyone.
    const members = await ioA.in(ROOM).fetchSockets();
    expect(members.length).toBe(2);
    const ids = members.map((s) => s.id).sort();
    expect(ids).toEqual([clientA.id, clientB.id].sort());
  });

  it('RemoteSocket.emit() from instance A reaches a client on instance B (the fix\'s delivery)', async (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }
    //? Per-recipient emit on a RemoteSocket routes via the adapter to the owning
    //? instance — this is how the cross-instance fan-out delivers per-recipient frames.
    const members = await ioA.in(ROOM).fetchSockets();
    const remoteForB = members.find((s) => s.id === clientB.id);
    expect(remoteForB).toBeTruthy();

    const received = waitForEvent(clientB, EVENT2, 4000);
    remoteForB?.emit(EVENT2, { hello: 'targeted-remote' });
    await expect(received).resolves.toMatchObject({ hello: 'targeted-remote' });
  });

  it('a direct per-socket emit on instance A does NOT reach a client on instance B', async (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }
    const localIds = ioA.sockets.adapter.rooms.get(ROOM);
    const localId = localIds ? [...localIds][0] : undefined;
    const localServerSocket = localId ? ioA.sockets.sockets.get(localId) : undefined;
    expect(localServerSocket).toBeTruthy();

    const notReceived = expectNoEvent(clientB, EVENT, 800);
    localServerSocket?.emit(EVENT, { hello: 'local-only' });
    await expect(notReceived).resolves.toBeUndefined();
  });
});
