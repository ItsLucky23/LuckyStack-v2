import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http, { type IncomingMessage } from 'node:http';
import { type AddressInfo } from 'node:net';
import { clearAllHooks, registerHook } from '@luckystack/core';

import { createHttpProxy } from './httpProxy';
import type { ServiceTargetResolver, ResolveTargetResult } from './resolveTarget';

//? Minimal stub resolver. The HTTP proxy only calls `resolve(service)`; the
//? other methods exist to satisfy the interface.
const makeResolver = (result: ResolveTargetResult | null): ServiceTargetResolver => ({
  resolve: () => result,
  setLocalHealth: () => { /* noop */ },
  getLocalHealth: () => true,
  getLocallyOwnedServices: () => [],
});

interface Harness {
  server: http.Server;
  port: number;
  upstream: http.Server;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

beforeEach(() => {
  clearAllHooks();
});

//? Boot a router HTTP server fronting an upstream that accepts the request but
//? never responds, simulating a backend that pins the socket without the
//? upstream timeout under test.
const boot = async (options: {
  upstreamRequestTimeoutMs?: number;
  maxRequestBodyBytes?: number;
  //? When true, the upstream answers every request with a 200.
  upstreamResponds?: boolean;
  //? Send headers + a partial body, then reset the backend socket.
  upstreamAbortsAfterHeaders?: boolean;
}): Promise<Harness> => {
  const upstream = http.createServer((_req: IncomingMessage, res) => {
    if (options.upstreamAbortsAfterHeaders) {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '100' });
      res.write('partial');
      setImmediate(() => { res.socket?.destroy(); });
      return;
    }
    if (options.upstreamResponds) {
      res.statusCode = 200;
      res.end('ok');
    }
    //? Default: deliberately never call `res.end()` — the request hangs open.
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;

  const resolver = makeResolver({
    target: `http://127.0.0.1:${String(upstreamPort)}`,
    viaFallback: false,
    resolvedEnvKey: 'test',
  });
  const proxy = createHttpProxy({
    resolver,
    missingServiceErrorCode: 'serviceNotAssigned',
    upstreamRequestTimeoutMs: options.upstreamRequestTimeoutMs ?? 30_000,
    maxRequestBodyBytes: options.maxRequestBodyBytes,
  });
  const server = http.createServer(proxy);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  cleanups.push(() => { server.close(); upstream.close(); });
  return { server, port, upstream };
};

//? Helper: send a POST request with the given body and collect the response.
const postRequest = (port: number, body: string | Buffer, headers?: Record<string, string>): Promise<{ statusCode: number; body: string }> =>
  new Promise((resolve, reject) => {
    const bodyBuf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    const req = http.request(
      { method: 'POST', host: '127.0.0.1', port, path: '/api/system/upload/v1', headers: { 'content-length': String(bodyBuf.length), ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
        res.on('end', () => { resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }); });
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('client timeout')); });
    req.end(bodyBuf);
  });

describe('httpProxy', () => {
  it('fails with 502 routing.upstreamUnreachable when the upstream accepts TCP but never responds', async () => {
    const h = await boot({ upstreamRequestTimeoutMs: 100 });

    const { statusCode, body } = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${String(h.port)}/api/system/ping/v1`, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
        res.on('end', () => { resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }); });
      });
      req.on('error', reject);
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('client timeout')); });
    });

    expect(statusCode).toBe(502);
    expect(body).toContain('routing.upstreamUnreachable');
  });

  it('contains an upstream response reset after headers instead of emitting an uncaught error', async () => {
    const h = await boot({ upstreamAbortsAfterHeaders: true });

    const outcome = await new Promise<'aborted' | 'response-error' | 'request-error'>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${String(h.port)}/api/system/ping/v1`, (res) => {
        res.resume();
        res.once('aborted', () => { resolve('aborted'); });
        res.once('error', () => { resolve('response-error'); });
      });
      req.once('error', () => { resolve('request-error'); });
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('client timeout')); });
    });

    expect(['aborted', 'response-error', 'request-error']).toContain(outcome);
  });

  // --- DD-ROUTER-DD1: body size cap ---

  it('rejects with 413 routing.requestBodyTooLarge when content-length exceeds the cap', async () => {
    //? Use a very small cap (10 bytes) so the test body (20 bytes) trips it.
    const h = await boot({ maxRequestBodyBytes: 10, upstreamResponds: true });

    const { statusCode, body } = await postRequest(h.port, 'x'.repeat(20));

    expect(statusCode).toBe(413);
    expect(body).toContain('routing.requestBodyTooLarge');
  });

  it('forwards requests within the body size cap to the upstream', async () => {
    const h = await boot({ maxRequestBodyBytes: 100, upstreamResponds: true });

    const { statusCode } = await postRequest(h.port, 'x'.repeat(50));

    expect(statusCode).toBe(200);
  });

  // --- DD-ROUTER-DD2: proxyRequestGate hook ---

  it('allows the request when no proxyRequestGate handler is registered', async () => {
    const h = await boot({ upstreamResponds: true });

    const { statusCode } = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${String(h.port)}/api/system/ping/v1`, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
        res.on('end', () => { resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }); });
      });
      req.on('error', reject);
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('client timeout')); });
    });

    expect(statusCode).toBe(200);
  });

  it('rejects with 403 when a proxyRequestGate handler returns a stop signal', async () => {
    registerHook('proxyRequestGate', () => ({
      stop: true as const,
      errorCode: 'routing.gateDenied',
      httpStatus: 403,
    }));

    const h = await boot({ upstreamResponds: true });

    const { statusCode, body } = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${String(h.port)}/api/system/ping/v1`, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
        res.on('end', () => { resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }); });
      });
      req.on('error', reject);
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('client timeout')); });
    });

    expect(statusCode).toBe(403);
    expect(body).toContain('routing.gateDenied');
  });

  it('rejects with a custom httpStatus from the gate stop signal', async () => {
    registerHook('proxyRequestGate', () => ({
      stop: true as const,
      errorCode: 'routing.tenantDenied',
      httpStatus: 451,
    }));

    const h = await boot({ upstreamResponds: true });

    const { statusCode, body } = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${String(h.port)}/api/system/ping/v1`, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
        res.on('end', () => { resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }); });
      });
      req.on('error', reject);
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('client timeout')); });
    });

    expect(statusCode).toBe(451);
    expect(body).toContain('routing.tenantDenied');
  });

  it('passes service and pathname to the gate handler', async () => {
    let capturedService: string | undefined;
    let capturedPathname: string | undefined;
    registerHook('proxyRequestGate', ({ service, pathname }) => {
      capturedService = service;
      capturedPathname = pathname;
    });

    const h = await boot({ upstreamResponds: true });
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${String(h.port)}/api/system/ping/v1`, (res) => { res.resume(); resolve(); });
      req.on('error', reject);
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('client timeout')); });
    });

    expect(capturedService).toBe('system');
    expect(capturedPathname).toBe('/api/system/ping/v1');
  });
});

describe('httpProxy — socket.io polling handshake pins to the websocket service', () => {
  //? REGRESSION. socket.io opens with an XHR poll on `/socket.io/?EIO=4...`
  //? before it can upgrade, and the first path segment is the TRANSPORT's name,
  //? not a service. The proxy fed it to the first-segment resolver, got
  //? "socket.io", found no such binding and answered 502 — so a DEFAULT client
  //? (socket.io's transports default to `['polling','websocket']`, and
  //? `socketInitializer.ts` sets none) could never connect through the router,
  //? never reaching the upgrade the WS proxy was so carefully hardened for.
  //? Proven with a real socket.io client in `wsProxy.integration.test.ts`.

  //? Spy resolver: records the key it was asked for and refuses to resolve, so
  //? the assertion is about WHICH service the proxy picked, nothing downstream.
  const bootSpy = async (websocketService?: string): Promise<{ port: number; asked: string[] }> => {
    const asked: string[] = [];
    const resolver: ServiceTargetResolver = {
      resolve: (service: string) => { asked.push(service); return null; },
      setLocalHealth: () => { /* noop */ },
      getLocalHealth: () => true,
      getLocallyOwnedServices: () => [],
    };
    const proxy = createHttpProxy({ resolver, missingServiceErrorCode: 'serviceNotAssigned', websocketService });
    const server = http.createServer(proxy);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    cleanups.push(() => { server.close(); });
    return { port, asked };
  };

  const get = (port: number, path: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path }, (res) => { res.resume(); res.on('end', () => { resolve(); }); });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('client timeout')); });
    });

  it('routes the polling handshake to `system`, not to a service named "socket.io"', async () => {
    const h = await bootSpy();
    await get(h.port, '/socket.io/?EIO=4&transport=polling');
    expect(h.asked, 'the router asked for a service named "socket.io" — that binding will never exist').toEqual(['system']);
  });

  it('honours the deploy.routing.websocketService override so both halves agree', async () => {
    //? The WS proxy already threads this key; the HTTP half must pin to the SAME
    //? service or the handshake and the upgrade land on different backends.
    const h = await bootSpy('realtime');
    await get(h.port, '/socket.io/?EIO=4&transport=polling');
    expect(h.asked).toEqual(['realtime']);
  });

  it('still routes a normal /api/<service>/ path by its first segment', async () => {
    //? Guard the blast radius: the socket.io rule must not swallow normal routing.
    const h = await bootSpy();
    await get(h.port, '/api/vehicles/listVehicles/v1');
    expect(h.asked).toEqual(['vehicles']);
  });

  it('does not mistake a service legitimately named "socket.iox" for the engine path', async () => {
    //? Prefix matching must be segment-exact, or `/socket.iox/...` would be
    //? hijacked to the websocket service.
    const h = await bootSpy();
    await get(h.port, '/socket.iox/thing');
    expect(h.asked).toEqual(['socket.iox']);
  });
});
