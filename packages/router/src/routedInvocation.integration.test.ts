//? Integration proof for ADR 0037: one browser Socket.io connection terminates
//? on a remote `system`, while typed API/sync invocations travel over routed
//? HTTP to the locally-owned `admin` preset. Sync fanout returns through shared
//? Redis to that remote system socket; non-local services use staging fallback.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { Server as IOServer, type Socket as ServerSocket } from 'socket.io';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import {
  getRedisConnectionOptions,
  registerDeployConfig,
  registerProjectConfig,
  registerServicesConfig,
  socketEventNames,
  tryCatchSync,
} from '@luckystack/core';
import { invokeRoutedHttp } from '../../core/src/routedHttpInvocation';
import { startRouter, type RunningRouter } from './startRouter';

const ROOM = 'routed-admin-room';
const ENV_KEY = `routedtest-${String(Date.now())}`;
const FALLBACK_ENV_KEY = `${ENV_KEY}-staging`;

interface Instance {
  http: HttpServer;
  io: IOServer;
  port: number;
  redis: Redis[];
}

const instances: Instance[] = [];
let browserSocket: ClientSocket | null = null;
let router: RunningRouter | null = null;
let routerPort = 0;
let redisAvailable = false;
let localApiExecutions = 0;
let remoteAdminExecutions = 0;
let localSyncExecutions = 0;
let fallbackExecutions = 0;
let remoteSystemConnections = 0;
let localAdminConnections = 0;
let restoreFetch: (() => void) | null = null;

const makeRedis = (): Redis => {
  const options = getRedisConnectionOptions();
  const redis = new Redis({
    host: options.host,
    port: options.port,
    ...(options.username ? { username: options.username } : {}),
    ...(options.password ? { password: options.password } : {}),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on('error', () => {});
  return redis;
};

const listen = (server: HttpServer): Promise<number> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address() as AddressInfo | null;
    resolve(address?.port ?? 0);
  });
});

const grabFreePort = async (): Promise<number> => {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve) => { probe.close(() => { resolve(); }); });
  return port;
};

const readJsonBody = (req: IncomingMessage): Promise<Record<string, unknown>> => new Promise((resolve) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => { chunks.push(chunk); });
  req.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    const [parseError, parsedValue] = tryCatchSync(() => text.length > 0 ? JSON.parse(text) as unknown : {});
    const parsed = parseError ? {} : parsedValue;
    resolve(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {});
  });
});

const writeJson = (res: ServerResponse, body: unknown, status = 200): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const buildInstance = async ({
  handler,
  onConnection,
}: {
  handler: (req: IncomingMessage, res: ServerResponse, io: IOServer) => Promise<void> | void;
  onConnection: (socket: ServerSocket) => void;
}): Promise<Instance> => {
  let io: IOServer;
  const http = createServer((req, res) => { void handler(req, res, io); });
  io = new IOServer(http, { cors: { origin: '*' } });
  const pub = makeRedis();
  const sub = pub.duplicate();
  sub.on('error', () => {});
  await pub.connect();
  await sub.connect();
  io.adapter(createAdapter(pub, sub));
  io.on('connection', onConnection);
  const port = await listen(http);
  const instance = { http, io, port, redis: [pub, sub] };
  instances.push(instance);
  return instance;
};

const connectBrowser = (url: string): Promise<ClientSocket> => new Promise((resolve, reject) => {
  const socket = connectClient(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  const timer = setTimeout(() => { reject(new Error('browser socket connect timeout')); }, 8000);
  socket.on('connect', () => { clearTimeout(timer); resolve(socket); });
  socket.on('connect_error', (error: Error) => { clearTimeout(timer); reject(error); });
});

const waitForSyncFanout = (socket: ClientSocket): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { reject(new Error('routed sync fanout timeout')); }, 8000);
  socket.once(socketEventNames.sync, (payload: Record<string, unknown>) => {
    clearTimeout(timer);
    resolve(payload);
  });
});

const assertRedisWasNotRequired = (): void => {
  if (process.env.LUCKYSTACK_REQUIRE_REDIS !== '1') return;
  const options = getRedisConnectionOptions();
  throw new Error(
    `LUCKYSTACK_REQUIRE_REDIS=1, but Redis at ${options.host}:${String(options.port)} is unreachable. `
    + 'The routed invocation integration test cannot prove remote Redis fanout without it.',
  );
};

beforeAll(async () => {
  const probe = makeRedis();
  try {
    await probe.connect();
    await probe.ping();
    redisAvailable = true;
  } catch {
    probe.disconnect();
    assertRedisWasNotRequired();
    return;
  }
  probe.disconnect();

  const remoteSystem = await buildInstance({
    handler: async (req, res) => {
      if (req.url === '/_health') {
        writeJson(res, { bootUuid: null, envHashes: {} });
        return;
      }
      if (req.url?.startsWith('/api/admin/localOnly/v1')) {
        remoteAdminExecutions += 1;
        writeJson(res, { status: 'success', httpStatus: 200, executedBy: 'remote-system' });
        return;
      }
      if (req.url?.startsWith('/api/other/fallback/v1')) {
        fallbackExecutions += 1;
        writeJson(res, { status: 'success', httpStatus: 200, executedBy: 'staging-fallback' });
        return;
      }
      writeJson(res, { status: 'error', errorCode: 'notFound' }, 404);
    },
    onConnection: (socket) => {
      remoteSystemConnections += 1;
      void socket.join(ROOM);
    },
  });

  const localAdmin = await buildInstance({
    handler: async (req, res, io) => {
      if (req.method === 'HEAD' && req.url === '/') {
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.url?.startsWith('/api/admin/localOnly/v1')) {
        localApiExecutions += 1;
        const payload = await readJsonBody(req);
        writeJson(res, {
          status: 'success',
          httpStatus: 200,
          executedBy: 'admin-local',
          marker: payload.marker,
        });
        return;
      }
      if (req.url?.startsWith('/sync/admin/localFanout/v1')) {
        localSyncExecutions += 1;
        const payload = await readJsonBody(req);
        const data = payload.data && typeof payload.data === 'object'
          ? payload.data as Record<string, unknown>
          : {};
        const members = await io.in(ROOM).fetchSockets();
        for (const member of members) {
          member.emit(socketEventNames.sync, {
            cb: 'admin/localFanout/v1',
            fullName: 'sync/admin/localFanout/v1',
            status: 'success',
            serverOutput: { status: 'success', executedBy: 'admin-local', marker: data.marker },
            clientOutput: {},
          });
        }
        writeJson(res, {
          status: 'success',
          message: 'sync/admin/localFanout/v1 sync success',
          result: { status: 'success', executedBy: 'admin-local', marker: data.marker },
        });
        return;
      }
      writeJson(res, { status: 'error', errorCode: 'notFound' }, 404);
    },
    onConnection: () => {
      localAdminConnections += 1;
    },
  });

  registerProjectConfig({
    transport: { invocation: 'routed-http' },
    session: { basedToken: true },
    rateLimiting: { enabled: false },
    sync: { requireRoomMembership: false },
  });
  registerServicesConfig({
    services: {
      system: { source: 'root' },
      admin: { source: 'admin' },
      other: { source: 'other' },
    },
    presets: {
      system: { services: ['system'] },
      admin: { services: ['admin'] },
      other: { services: ['other'] },
    },
  });
  registerDeployConfig({
    resources: {},
    environments: {
      [ENV_KEY]: {
        redis: 'shared',
        mongo: 'shared',
        fallback: FALLBACK_ENV_KEY,
        bindings: { admin: `http://127.0.0.1:${String(localAdmin.port)}` },
      },
      [FALLBACK_ENV_KEY]: {
        redis: 'shared',
        mongo: 'shared',
        bindings: {
          system: `http://127.0.0.1:${String(remoteSystem.port)}`,
          admin: `http://127.0.0.1:${String(remoteSystem.port)}`,
          other: `http://127.0.0.1:${String(remoteSystem.port)}`,
        },
      },
    },
    routing: { strictBootHandshake: false },
    development: { enableFallbackRouting: true, healthPollMs: 50 },
  });

  routerPort = await grabFreePort();
  router = await startRouter({
    currentEnvKey: ENV_KEY,
    localPresetKey: 'admin',
    port: routerPort,
  });
  browserSocket = await connectBrowser(`http://127.0.0.1:${String(routerPort)}`);

  const nativeFetch = globalThis.fetch;
  vi.stubGlobal('window', {});
  vi.stubGlobal('location', { origin: `http://127.0.0.1:${String(routerPort)}` });
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, globalThis.location.origin);
    return nativeFetch(url, init);
  });
  restoreFetch = () => { vi.unstubAllGlobals(); };

  await new Promise((resolve) => { setTimeout(resolve, 300); });
}, 30000);

afterAll(async () => {
  browserSocket?.disconnect();
  restoreFetch?.();
  if (router) await router.stop();
  for (const instance of instances) {
    instance.io.close();
    await new Promise<void>((resolve) => { instance.http.close(() => { resolve(); }); });
    for (const redis of instance.redis) redis.disconnect();
  }
});

describe('hybrid routed invocation topology', () => {
  it('routes local admin API/sync, fans out through Redis, and falls back without a second browser socket', async (ctx) => {
    if (!redisAvailable) { ctx.skip(); return; }

    const apiResponse = await invokeRoutedHttp<{
      status: 'success';
      executedBy: 'admin-local';
      marker: string;
    }>({
      path: '/api/admin/localOnly/v1',
      method: 'POST',
      data: { marker: 'api-local' },
    });
    expect(apiResponse).toMatchObject({
      kind: 'response',
      response: { status: 'success', executedBy: 'admin-local', marker: 'api-local' },
    });
    expect(localApiExecutions).toBe(1);
    expect(remoteAdminExecutions).toBe(0);

    if (!browserSocket) throw new Error('browser socket was not initialized');
    const fanout = waitForSyncFanout(browserSocket);
    const syncResponse = await invokeRoutedHttp<{
      status: 'success';
      result: { executedBy: 'admin-local'; marker: string };
    }>({
      path: '/sync/admin/localFanout/v1',
      method: 'POST',
      data: { data: { marker: 'sync-local' }, receiver: ROOM, ignoreSelf: false },
    });
    expect(syncResponse).toMatchObject({
      kind: 'response',
      response: { status: 'success', result: { executedBy: 'admin-local', marker: 'sync-local' } },
    });
    await expect(fanout).resolves.toMatchObject({
      fullName: 'sync/admin/localFanout/v1',
      serverOutput: { executedBy: 'admin-local', marker: 'sync-local' },
    });
    expect(localSyncExecutions).toBe(1);

    const fallbackResponse = await invokeRoutedHttp<{
      status: 'success';
      executedBy: 'staging-fallback';
    }>({
      path: '/api/other/fallback/v1',
      method: 'POST',
      data: {},
    });
    expect(fallbackResponse).toMatchObject({
      kind: 'response',
      response: { status: 'success', executedBy: 'staging-fallback' },
    });
    expect(fallbackExecutions).toBe(1);

    expect(remoteSystemConnections).toBe(1);
    expect(localAdminConnections).toBe(0);
  });
});
