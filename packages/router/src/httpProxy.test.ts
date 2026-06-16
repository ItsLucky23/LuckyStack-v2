import { describe, it, expect, afterEach } from 'vitest';
import http, { type IncomingMessage } from 'node:http';
import { type AddressInfo } from 'node:net';

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

//? Boot a router HTTP server fronting an upstream that accepts the request but
//? never responds, simulating a backend that pins the socket without the
//? upstream timeout under test.
const boot = async (options: { upstreamRequestTimeoutMs: number }): Promise<Harness> => {
  const upstream = http.createServer((_req: IncomingMessage) => {
    //? Deliberately never call `res.end()` — the request hangs open.
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
    upstreamRequestTimeoutMs: options.upstreamRequestTimeoutMs,
  });
  const server = http.createServer(proxy);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  cleanups.push(() => { server.close(); upstream.close(); });
  return { server, port, upstream };
};

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
});
