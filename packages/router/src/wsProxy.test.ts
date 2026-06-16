import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';

import { createWsProxy } from './wsProxy';
import type { ServiceTargetResolver, ResolveTargetResult } from './resolveTarget';

//? Minimal stub resolver. The WS proxy only calls `resolve(service)`; the other
//? methods exist to satisfy the interface.
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
  upstreamPort: number;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

//? Boot a router HTTP server whose `upgrade` handler is the WS proxy under test,
//? plus a real upstream HTTP server that completes the WS 101 handshake.
const boot = async (
  target: (upstreamPort: number) => ResolveTargetResult | null,
  options?: { upstreamHandshakeTimeoutMs?: number; silentUpgrade?: boolean },
): Promise<Harness> => {
  const upstream = http.createServer();
  upstream.on('upgrade', (_req, socket) => {
    //? `silentUpgrade` simulates a backend that accepts the TCP connection and
    //? the upgrade but never answers — the handshake-timeout path under test.
    if (options?.silentUpgrade) return;
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;

  const resolver = makeResolver(target(upstreamPort));
  const wsProxy = createWsProxy({ resolver, upstreamHandshakeTimeoutMs: options?.upstreamHandshakeTimeoutMs });
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end();
  });
  server.on('upgrade', wsProxy);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  cleanups.push(() => { server.close(); upstream.close(); });
  return { server, port, upstream, upstreamPort };
};

//? Send a raw upgrade request line + headers, returning the first status line.
const sendUpgrade = (port: number, requestTarget: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        `GET ${requestTarget} HTTP/1.1\r\n`
        + `Host: 127.0.0.1:${String(port)}\r\n`
        + 'Connection: Upgrade\r\n'
        + 'Upgrade: websocket\r\n'
        + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
        + 'Sec-WebSocket-Version: 13\r\n\r\n',
      );
    });
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (buf.includes('\r\n')) {
        resolve(buf.split('\r\n')[0] ?? '');
        socket.destroy();
      }
    });
    socket.on('error', reject);
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('timeout')); });
  });

describe('wsProxy', () => {
  it('completes a 101 upgrade for an origin-form path against a reachable upstream', async () => {
    const h = await boot((upstreamPort) => ({
      target: `http://127.0.0.1:${String(upstreamPort)}`,
      viaFallback: false,
      resolvedEnvKey: 'test',
    }));
    const statusLine = await sendUpgrade(h.port, '/socket.io/?EIO=4');
    expect(statusLine).toContain('101');
  });

  it('rejects an absolute-form target (SSRF) with a non-101 status and does not re-host', async () => {
    const h = await boot((upstreamPort) => ({
      target: `http://127.0.0.1:${String(upstreamPort)}`,
      viaFallback: false,
      resolvedEnvKey: 'test',
    }));
    //? Absolute-form request target — Node passes it verbatim to `req.url`.
    const statusLine = await sendUpgrade(h.port, 'http://attacker.example:9999/socket.io/');
    expect(statusLine).toContain('400');
    expect(statusLine).not.toContain('101');
  });

  it('rejects a protocol-relative target (//host) with a non-101 status', async () => {
    const h = await boot((upstreamPort) => ({
      target: `http://127.0.0.1:${String(upstreamPort)}`,
      viaFallback: false,
      resolvedEnvKey: 'test',
    }));
    const statusLine = await sendUpgrade(h.port, '//attacker.example/socket.io/');
    expect(statusLine).toContain('400');
  });

  it('returns 502 when the service does not resolve', async () => {
    const h = await boot(() => null);
    const statusLine = await sendUpgrade(h.port, '/socket.io/');
    expect(statusLine).toContain('502');
  });

  it('fails the client leg with 504 when the upstream accepts TCP but never answers the upgrade', async () => {
    //? Upstream completes the TCP + upgrade event but never writes the 101, so
    //? the handshake leg would pin both sockets forever without a timeout.
    const h = await boot(
      (upstreamPort) => ({
        target: `http://127.0.0.1:${String(upstreamPort)}`,
        viaFallback: false,
        resolvedEnvKey: 'test',
      }),
      { upstreamHandshakeTimeoutMs: 100, silentUpgrade: true },
    );
    const statusLine = await sendUpgrade(h.port, '/socket.io/?EIO=4');
    expect(statusLine).toContain('504');
    expect(statusLine).not.toContain('101');
  });

  it('survives a client RST mid-handshake without crashing the process', async () => {
    //? Point at an unroutable upstream port so the upstream handshake stays
    //? in-flight, then RST the client socket immediately. Before the fix this
    //? emitted an unhandled `'error'` on the raw client socket and crashed the
    //? whole router process.
    const h = await boot(() => ({
      //? Reserved-but-unlikely-open port; the upstream request will hang/err.
      target: 'http://127.0.0.1:1',
      viaFallback: false,
      resolvedEnvKey: 'test',
    }));

    await new Promise<void>((resolve) => {
      const socket = net.connect(h.port, '127.0.0.1', () => {
        socket.write(
          'GET /socket.io/ HTTP/1.1\r\n'
          + `Host: 127.0.0.1:${String(h.port)}\r\n`
          + 'Connection: Upgrade\r\n'
          + 'Upgrade: websocket\r\n'
          + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
          + 'Sec-WebSocket-Version: 13\r\n\r\n',
        );
        //? Hard RST right after sending — the upstream handshake has not resolved.
        socket.resetAndDestroy();
        resolve();
      });
      socket.on('error', () => { resolve(); });
    });

    //? Give the event loop a tick; if the process were going to crash from an
    //? unhandled socket error, it would have by now. A surviving server still
    //? answers a fresh request.
    await new Promise((r) => setTimeout(r, 50));
    const alive = await new Promise<boolean>((resolve) => {
      const req = http.get(`http://127.0.0.1:${String(h.port)}/_alive`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => { resolve(false); });
    });
    expect(alive).toBe(true);
  });
});
