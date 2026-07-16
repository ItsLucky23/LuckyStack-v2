//? Integration test (opt-in: `npm run test:integration`). Closes the gap the
//? Bun-feasibility ledger's B7 row named out loud: the router's WebSocket proxy
//? had only ever been proven to BOOT AND LISTEN. No WebSocket had ever actually
//? been upgraded THROUGH it — the single most Bun-sensitive code in the repo
//? (raw `node:http` + `node:net` + a hand-written 101 handshake) was carried on
//? unit tests with mocked sockets alone.
//?
//? What this drives is the real thing: a real `socket.io-client`, through a real
//? `startRouter()`, into a real Socket.io server, with a second Socket.io server
//? on the same Redis proving cross-instance fan-out still reaches a client whose
//? socket lives behind the proxy.
//?
//? RUNTIME ASSERTION — do not remove. Set `LUCKYSTACK_EXPECT_RUNTIME=bun|node`
//? and the suite fails unless it is REALLY running there. This is not
//? belt-and-braces: on Windows `bun run <bin>` resolves through npm's generated
//? `.cmd` shim, which hardcodes a `node` call, so a "Bun run" silently executes
//? on Node and passes. That exact trap (ledger B6) hid a HIGH-severity bug for
//? an entire session behind a green log.
//?
//? Needs a reachable Redis (read via `getRedisConnectionOptions()`); skips
//? gracefully when there is none so a Redis-less CI never goes red.
//? See docs/ARCHITECTURE_MULTI_INSTANCE.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer, type IncomingHttpHeaders } from 'node:http';
import { AddressInfo } from 'node:net';
import { Server as IOServer, type Socket as ServerSocket } from 'socket.io';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import {
  getRedisConnectionOptions,
  registerDeployConfig,
  registerServicesConfig,
} from '@luckystack/core';
import { startRouter, type RunningRouter } from './startRouter';

const ROOM = 'router-ws-smoke';
const EVENT = 'router-ws-event';
const ENV_KEY = 'routertest';

const detectedRuntime = 'Bun' in globalThis ? 'bun' : 'node';

interface Instance {
  http: HttpServer;
  io: IOServer;
  port: number;
  /** Handshake headers the backend actually saw, keyed by socket id. */
  seenHeaders: Map<string, IncomingHttpHeaders>;
}

let redisAvailable = false;
const redisClients: Redis[] = [];
const instances: Instance[] = [];
const clients: ClientSocket[] = [];

let instanceA: Instance;
let instanceB: Instance;
let router: RunningRouter | null = null;
let routerPort = 0;

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

const listen = (http: HttpServer, port: number): Promise<number> =>
  new Promise((resolve) => {
    http.listen(port, '127.0.0.1', () => {
      const addr = http.address() as AddressInfo | null;
      resolve(addr ? addr.port : 0);
    });
  });

//? `startRouter` takes a port and cannot report back the one it actually bound,
//? so port 0 (let the OS pick) is not usable here — we have to hand it a
//? concrete free port. Grab one by binding :0, reading it back, releasing it.
//? Inherently a small TOCTOU window; acceptable for a local test and vastly
//? better than hardcoding 4000 and colliding with a dev router.
const grabFreePort = async (): Promise<number> => {
  const probe = createServer();
  const port = await listen(probe, 0);
  await new Promise<void>((resolve) => { probe.close(() => { resolve(); }); });
  return port;
};

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

  const seenHeaders = new Map<string, IncomingHttpHeaders>();
  io.on('connection', (socket: ServerSocket) => {
    seenHeaders.set(socket.id, socket.request.headers);
    void socket.join(ROOM);
  });

  const port = await listen(http, 0);
  return { http, io, port, seenHeaders };
};

const connect = (url: string, transports: ('websocket' | 'polling')[]): Promise<ClientSocket> =>
  new Promise((resolve, reject) => {
    const socket = connectClient(url, {
      transports,
      forceNew: true,
      reconnection: false,
    });
    const timer = setTimeout(() => { reject(new Error(`client connect timeout (${url})`)); }, 8000);
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

//? The engine's negotiated transport, which is the whole point of this file: a
//? 101 that never completed leaves this at 'polling'.
const transportOf = (socket: ClientSocket): string => socket.io.engine.transport.name;

//? Turn the graceful Redis skip into a hard failure when the caller declared
//? that Redis MUST be there (`LUCKYSTACK_REQUIRE_REDIS=1`).
//?
//? The skip itself is deliberate — a Redis-less CI should not go red. But it is
//? indistinguishable from success in the summary line, and that is not
//? hypothetical: this whole suite (and core's, which predates it) reported
//? "Tests 5 skipped" as a PASS for as long as it has existed, because the
//? machine's `.env.local` points at a Redis whose credentials the local one
//? rejects. Green, running nothing. If you are trying to PROVE something, set
//? the flag; the run then fails loudly instead of quietly proving nothing.
const assertRedisWasNotRequired = (): void => {
  if (process.env.LUCKYSTACK_REQUIRE_REDIS !== '1') return;
  const opts = getRedisConnectionOptions();
  throw new Error(
    `LUCKYSTACK_REQUIRE_REDIS=1, but Redis at ${opts.host}:${String(opts.port)} is unreachable `
    + `(auth: ${opts.username || opts.password ? 'yes' : 'none'}). This suite proves nothing without it. `
    + 'Start Redis, or point REDIS_HOST/REDIS_PORT at a reachable one.',
  );
};

beforeAll(async () => {
  const probe = makeRedis();
  try {
    await probe.connect();
    await probe.ping();
    redisAvailable = true;
  } catch {
    redisAvailable = false;
    assertRedisWasNotRequired();
    return;
  }

  instanceA = await buildInstance();
  instanceB = await buildInstance();
  instances.push(instanceA, instanceB);

  //? Only `system` is bound: WS upgrades pin to it by convention
  //? (wsProxy.ts DEFAULT_WS_SERVICE), so instance A is the socket-owning
  //? backend and instance B is the "other instance" that must still reach it.
  registerServicesConfig({
    services: { system: { source: 'root' } },
    presets: { 'core-preset': { services: ['system'] } },
  });
  registerDeployConfig({
    resources: {},
    environments: {
      [ENV_KEY]: {
        redis: 'redisShared',
        mongo: 'mongoShared',
        //? No `fallback` on purpose: this file is about the WS proxy, and a
        //? fallback would drag in the mandatory shared-health store + the boot
        //? handshake, coupling the assertion to machinery it is not testing.
        bindings: { system: `http://127.0.0.1:${String(instanceA.port)}` },
      },
    },
  });

  routerPort = await grabFreePort();
  router = await startRouter({
    currentEnvKey: ENV_KEY,
    port: routerPort,
    disableSharedHealthState: true,
  });

  //? Let the adapter propagate room joins across instances before asserting.
  await new Promise((r) => setTimeout(r, 300));
}, 30000);

afterAll(async () => {
  for (const c of clients) c.disconnect();
  if (router) await router.stop();
  for (const inst of instances) {
    inst.io.close();
    await new Promise<void>((r) => { inst.http.close(() => { r(); }); });
  }
  for (const c of redisClients) {
    try { c.disconnect(); } catch { /* already closed */ }
  }
});

describe('runtime guard', () => {
  it('really runs under the runtime the caller expected', () => {
    const expected = process.env.LUCKYSTACK_EXPECT_RUNTIME;
    if (!expected) return;
    expect(
      detectedRuntime,
      `LUCKYSTACK_EXPECT_RUNTIME=${expected} but this suite is executing on ${detectedRuntime}. `
      + 'On Windows `bun run <bin>` goes through npm\'s .cmd shim, which hardcodes node — '
      + 'a "bun" run that is silently node proves nothing (ledger B6).',
    ).toBe(expected);
  });
});

describe('router WS proxy — a real socket.io client upgrades through it', () => {
  it('completes a websocket-transport connection through the router', async (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }
    //? `transports: ['websocket']` skips polling entirely, so the connection
    //? EITHER completes a raw 101 through `server.on('upgrade')` or fails. No
    //? silent fall-back to polling can mask a broken proxy.
    const socket = await connect(`http://127.0.0.1:${String(routerPort)}`, ['websocket']);
    expect(socket.connected).toBe(true);
    expect(transportOf(socket)).toBe('websocket');
  });

  it('also upgrades via the default polling->websocket path a browser uses', async (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }
    //? The realistic browser path: socket.io opens on polling (the HTTP proxy)
    //? then upgrades (the WS proxy). Exercises BOTH proxies in one connection,
    //? and would catch an upgrade that only works when polling never ran.
    const socket = await connect(`http://127.0.0.1:${String(routerPort)}`, ['polling', 'websocket']);
    expect(socket.connected).toBe(true);
    await expect.poll(() => transportOf(socket), { timeout: 8000 }).toBe('websocket');
  });

  it('supports a client that never upgrades and stays on long-polling', async (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }
    //? The fallback path, and the one that fails silently: a network that blocks
    //? WebSockets (corporate proxies, some mobile carriers) leaves socket.io on
    //? polling forever. That exercises the HTTP proxy for the FULL engine
    //? lifecycle — handshake, held GET, and the POST back — not just the
    //? handshake the other tests pass through on their way to an upgrade.
    const socket = await connect(`http://127.0.0.1:${String(routerPort)}`, ['polling']);
    expect(socket.connected).toBe(true);
    expect(transportOf(socket)).toBe('polling');

    //? Round-trip a real event over polling to prove data flows both ways, not
    //? merely that the handshake returned.
    await expect.poll(() => instanceA.seenHeaders.has(socket.id ?? ''), { timeout: 5000 }).toBe(true);
    const received = waitForEvent(socket, EVENT, 6000);
    instanceA.io.to(ROOM).emit(EVENT, { hello: 'over-polling' });
    await expect(received).resolves.toMatchObject({ hello: 'over-polling' });
  });

  it('lands the router-connected client on the `system` backend (instance A)', async (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }
    const socket = await connect(`http://127.0.0.1:${String(routerPort)}`, ['websocket']);
    await expect.poll(() => instanceA.seenHeaders.has(socket.id ?? ''), { timeout: 5000 }).toBe(true);
    expect(instanceB.seenHeaders.has(socket.id ?? '')).toBe(false);
  });

  it('forwards router-authoritative x-forwarded-* headers on the upgrade', async (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }
    const socket = await connect(`http://127.0.0.1:${String(routerPort)}`, ['websocket']);
    await expect.poll(() => instanceA.seenHeaders.has(socket.id ?? ''), { timeout: 5000 }).toBe(true);

    const headers = instanceA.seenHeaders.get(socket.id ?? '');
    expect(headers).toBeTruthy();
    //? The router is authoritative for these — it strips the client's copies and
    //? writes its own peer view, so a client cannot forge its source IP.
    expect(headers?.['x-forwarded-for']).toBeTruthy();
    expect(headers?.['x-forwarded-proto']).toBe('http');
    expect(headers?.['x-luckystack-resolved-env']).toBe(ENV_KEY);
    expect(headers?.['x-luckystack-via-fallback']).toBe('0');
  });
});

describe('router WS proxy — cross-instance fan-out still reaches a proxied client', () => {
  it('delivers io.to(room).emit() fired on instance B to a client behind the router on A', async (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }
    //? THE multi-instance claim, end to end: the client never talked to B, and
    //? its socket is two hops away (client -> router -> A). B reaches it anyway,
    //? purely through the Redis adapter.
    const socket = await connect(`http://127.0.0.1:${String(routerPort)}`, ['websocket']);
    await expect.poll(() => instanceA.seenHeaders.has(socket.id ?? ''), { timeout: 5000 }).toBe(true);

    const received = waitForEvent(socket, EVENT, 6000);
    instanceB.io.to(ROOM).emit(EVENT, { hello: 'from-B-through-router' });
    await expect(received).resolves.toMatchObject({ hello: 'from-B-through-router' });
  });

  it('enumerates the proxied client from instance B via fetchSockets() (the sync fan-out path)', async (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }
    //? Exactly what `handleSyncRequest` does: `io.in(room).fetchSockets()` from
    //? the OTHER instance must see the router-connected socket, then reach it
    //? with a per-recipient `RemoteSocket.emit()`.
    const socket = await connect(`http://127.0.0.1:${String(routerPort)}`, ['websocket']);
    await expect.poll(() => instanceA.seenHeaders.has(socket.id ?? ''), { timeout: 5000 }).toBe(true);

    const members = await instanceB.io.in(ROOM).fetchSockets();
    const remote = members.find((s) => s.id === socket.id);
    expect(remote, 'instance B cannot see the router-connected socket').toBeTruthy();

    const received = waitForEvent(socket, EVENT, 6000);
    remote?.emit(EVENT, { hello: 'targeted-through-router' });
    await expect(received).resolves.toMatchObject({ hello: 'targeted-through-router' });
  });
});
