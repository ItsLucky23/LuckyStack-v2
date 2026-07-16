import { describe, it, expect } from 'vitest';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { closeServerGracefully } from './startRouter';

//? REGRESSION. `stop()` used to be a bare `server.close()`, which waits for every
//? open connection to end on its own — and an upgraded WebSocket pipe never does.
//? So the router NEVER shut down once a single client was connected, which for a
//? socket-first framework's router is always. `scripts/router.ts` awaits `stop()`
//? before `process.exit(0)` on SIGTERM, so every deploy sat until the platform's
//? grace period expired and SIGKILLed it. Measured before the fix: still hanging
//? after 8s with one WebSocket client.
//?
//? Only surfaced once a REAL client was connected — no unit test had ever had one.

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

//? Boot a server that upgrades anything asked of it, tracking the sockets exactly
//? as `startRouter` does.
const bootUpgradingServer = async (): Promise<{ server: http.Server; port: number; sockets: Set<Duplex> }> => {
  const server = http.createServer((_req, res) => { res.statusCode = 200; res.end('ok'); });
  const sockets = new Set<Duplex>();
  server.on('upgrade', (_req, socket) => {
    sockets.add(socket);
    socket.on('close', () => { sockets.delete(socket); });
    socket.on('error', () => { /* teardown races are not the subject here */ });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  });
  const port = await listen(server);
  return { server, port, sockets };
};

const upgradeClient = (port: number): Promise<net.Socket> =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        'GET /socket.io/?EIO=4 HTTP/1.1\r\n'
        + `Host: 127.0.0.1:${String(port)}\r\n`
        + 'Connection: Upgrade\r\nUpgrade: websocket\r\n'
        + 'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
      );
    });
    socket.on('error', reject);
    socket.once('data', () => { resolve(socket); });
    setTimeout(() => { reject(new Error('upgrade timeout')); }, 3000);
  });

describe('closeServerGracefully', () => {
  it('terminates even while an upgraded WebSocket pipe is still open', async () => {
    const { server, port, sockets } = await bootUpgradingServer();
    const client = await upgradeClient(port);
    expect(sockets.size, 'the upgrade was not tracked').toBe(1);

    //? A short drain so the test is quick; the production window is 10s.
    const started = Date.now();
    await closeServerGracefully(server, 50, sockets);
    const elapsed = Date.now() - started;

    //? The assertion is simply that it RETURNS. Before the fix this promise never
    //? settled at all.
    expect(elapsed).toBeLessThan(3000);
    client.destroy();
  });

  it('does not wait out the drain window when nothing is connected', async () => {
    //? A clean shutdown must not cost 10s of deploy time for no reason.
    const { server, sockets } = await bootUpgradingServer();
    const started = Date.now();
    await closeServerGracefully(server, 10_000, sockets);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('lets an in-flight HTTP request finish rather than cutting it instantly', async () => {
    //? The drain window exists so ordinary requests are not severed mid-flight;
    //? the force-close is a backstop for pipes that never end, not the policy.
    const server = http.createServer((_req, res) => {
      setTimeout(() => { res.statusCode = 200; res.end('finished'); }, 150);
    });
    const port = await listen(server);

    const responseBody = new Promise<string>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/slow' }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => { body += c.toString('utf8'); });
        res.on('end', () => { resolve(body); });
      }).on('error', reject);
    });

    //? Give the request time to actually reach the server before shutting down.
    await new Promise((r) => setTimeout(r, 30));
    await closeServerGracefully(server, 5000, new Set());
    await expect(responseBody).resolves.toBe('finished');
  });

  it('resolves rather than throwing when the server is already stopped', async () => {
    //? A shutdown path must be idempotent — a double SIGTERM is not an error.
    const { server, sockets } = await bootUpgradingServer();
    await closeServerGracefully(server, 50, sockets);
    await expect(closeServerGracefully(server, 50, sockets)).resolves.toBeUndefined();
  });
});
