/**
 * Router WebSocket smoke test — runs on BOTH runtimes.
 *
 *   npm run smoke:ws            # node (via tsx)
 *   bun run smoke:ws            # bun
 *
 * WHY THIS EXISTS AS A SCRIPT and not only as a vitest file:
 *
 *   1. The claim under test is "the router proxies WebSockets on node AND bun".
 *      `@luckystack/router` runs under a bare runtime in production (the
 *      `luckystack-router` CLI / `scripts/router.ts`) — never under vitest. And
 *      vitest itself does not currently run under bun in this repo: `bun x --bun
 *      vitest` dies in `packages/core/src/env.ts` with `undefined is not an
 *      object (evaluating 'z.object')` — a vitest/bun module-interop artifact
 *      that says nothing about the router. Testing the runtime through a tool
 *      that cannot run on that runtime is not a test.
 *   2. `packages/router/src/wsProxy.integration.test.ts` covers the same ground
 *      on node for CI. This script is the cross-runtime half.
 *
 * WHAT IT PROVES (each step fails loudly; a green run cannot be hollow):
 *   - a real socket.io client completes a WebSocket upgrade THROUGH the router
 *   - the same works via the browser-realistic polling -> websocket path
 *   - a broadcast from a SECOND backend instance reaches that proxied client
 *     (cross-instance fan-out via the Redis adapter)
 *   - `fetchSockets()` from the other instance enumerates the proxied client
 *     (the regular syncRequest fan-out path)
 *
 * REQUIRES a reachable Redis. It does NOT skip when Redis is missing: a smoke
 * test whose entire point is proving something must never pass by proving
 * nothing (see the ledger — the integration suite silently skipped for weeks).
 */

import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as IOServer, type Socket as ServerSocket } from 'socket.io';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { getRedisConnectionOptions, registerDeployConfig, registerServicesConfig } from '@luckystack/core';
import { startRouter } from '@luckystack/router';

const ROOM = 'ws-smoke-room';
const EVENT = 'ws-smoke-event';
const ENV_KEY = 'wssmoke';

//? `'Bun' in globalThis`, not `typeof Bun` — the latter is a TS2868 error.
const RUNTIME = 'Bun' in globalThis ? 'bun' : 'node';

const write = (line: string): void => { process.stdout.write(`${line}\n`); };

let failures = 0;
const check = (label: string, ok: boolean, detail?: string): void => {
  if (ok) { write(`  PASS  ${label}`); return; }
  failures += 1;
  write(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
};

const redisClients: Redis[] = [];
const makeRedis = (): Redis => {
  const opts = getRedisConnectionOptions();
  const client = new Redis({
    host: opts.host,
    port: opts.port,
    ...(opts.username ? { username: opts.username } : {}),
    ...(opts.password ? { password: opts.password } : {}),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on('error', () => { /* handled by the connect() rejection */ });
  redisClients.push(client);
  return client;
};

const listen = (server: HttpServer, port: number): Promise<number> =>
  new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null;
      resolve(addr ? addr.port : 0);
    });
  });

interface Instance {
  http: HttpServer;
  io: IOServer;
  port: number;
  seen: Set<string>;
}

const buildInstance = async (): Promise<Instance> => {
  const http = createServer();
  const io = new IOServer(http, { cors: { origin: '*' } });
  const pub = makeRedis();
  const sub = pub.duplicate();
  sub.on('error', () => { /* handled by the connect() rejection */ });
  redisClients.push(sub);
  await pub.connect();
  await sub.connect();
  io.adapter(createAdapter(pub, sub));

  const seen = new Set<string>();
  io.on('connection', (socket: ServerSocket) => {
    seen.add(socket.id);
    void socket.join(ROOM);
  });

  const port = await listen(http, 0);
  return { http, io, port, seen };
};

const clients: ClientSocket[] = [];
const connect = (url: string, transports: ('websocket' | 'polling')[]): Promise<ClientSocket> =>
  new Promise((resolve, reject) => {
    const socket = connectClient(url, { transports, forceNew: true, reconnection: false });
    const timer = setTimeout(() => { reject(new Error(`connect timeout (${transports.join(',')})`)); }, 8000);
    socket.on('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.on('connect_error', (err: Error) => { clearTimeout(timer); reject(err); });
    clients.push(socket);
  });

const waitForEvent = (socket: ClientSocket, event: string, timeoutMs: number): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const handler = (payload: unknown): void => { clearTimeout(timer); socket.off(event, handler); resolve(payload); };
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timeout waiting for "${event}"`)); }, timeoutMs);
    socket.on(event, handler);
  });

const waitUntil = async (predicate: () => boolean, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
};

const main = async (): Promise<void> => {
  write(`\n[ws-smoke] runtime: ${RUNTIME}  (node ${process.version})`);

  const opts = getRedisConnectionOptions();
  const probe = makeRedis();
  try {
    await probe.connect();
    await probe.ping();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(`\n[ws-smoke] FATAL: Redis at ${opts.host}:${String(opts.port)} is unreachable (${message}).`);
    write('[ws-smoke] This smoke test requires Redis — it will not pass by skipping.');
    process.exit(1);
  }
  write(`[ws-smoke] redis: ${opts.host}:${String(opts.port)} reachable\n`);

  const a = await buildInstance();
  const b = await buildInstance();
  write(`[ws-smoke] backend A (system) :${String(a.port)} | backend B (2nd system instance) :${String(b.port)}`);

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
        bindings: { system: `http://127.0.0.1:${String(a.port)}` },
      },
    },
  });

  //? startRouter cannot report back an OS-assigned port, so pick a concrete one.
  const portProbe = createServer();
  const routerPort = await listen(portProbe, 0);
  await new Promise<void>((r) => { portProbe.close(() => { r(); }); });

  const router = await startRouter({
    currentEnvKey: ENV_KEY,
    port: routerPort,
    disableSharedHealthState: true,
  });
  write(`[ws-smoke] router      :${String(routerPort)} -> system\n`);

  const routerUrl = `http://127.0.0.1:${String(routerPort)}`;

  // 1. websocket-only: a raw 101 through the proxy, no polling fallback to hide behind.
  const wsClient = await connect(routerUrl, ['websocket']);
  check('websocket-only client connects through the router', wsClient.connected);
  check(
    'negotiated transport is websocket (the 101 completed)',
    wsClient.io.engine.transport.name === 'websocket',
    `got "${wsClient.io.engine.transport.name}"`,
  );
  check('the client landed on backend A', await waitUntil(() => a.seen.has(wsClient.id ?? ''), 5000));

  // 2. the path a real browser takes: polling handshake, then upgrade.
  const browserClient = await connect(routerUrl, ['polling', 'websocket']);
  check('default polling->websocket client connects through the router', browserClient.connected);
  check(
    'it upgrades to websocket through the router',
    await waitUntil(() => browserClient.io.engine.transport.name === 'websocket', 8000),
    `stuck on "${browserClient.io.engine.transport.name}"`,
  );

  // 3. cross-instance broadcast: B has never seen this client.
  const broadcastReceived = waitForEvent(wsClient, EVENT, 6000)
    .then(() => true).catch(() => false);
  b.io.to(ROOM).emit(EVENT, { hello: 'from-B' });
  check('a broadcast from instance B reaches the client proxied to A', await broadcastReceived);

  // 4. the regular syncRequest fan-out path: fetchSockets() + RemoteSocket.emit().
  const members = await b.io.in(ROOM).fetchSockets();
  const remote = members.find((s) => s.id === wsClient.id);
  check('instance B enumerates the proxied client via fetchSockets()', Boolean(remote));
  if (remote) {
    const targetedReceived = waitForEvent(wsClient, EVENT, 6000)
      .then(() => true).catch(() => false);
    remote.emit(EVENT, { hello: 'targeted' });
    check('a targeted RemoteSocket.emit() from B reaches it', await targetedReceived);
  }

  for (const c of clients) c.disconnect();
  await router.stop();
  a.io.close();
  b.io.close();
  await new Promise<void>((r) => { a.http.close(() => { r(); }); });
  await new Promise<void>((r) => { b.http.close(() => { r(); }); });
  for (const c of redisClients) {
    try { c.disconnect(); } catch { /* already closed */ }
  }

  write(`\n[ws-smoke] runtime=${RUNTIME}: ${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  write(`\n[ws-smoke] FATAL on ${RUNTIME}: ${message}\n`);
  process.exit(1);
});
