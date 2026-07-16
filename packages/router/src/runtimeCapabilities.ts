import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { getLogger } from '@luckystack/core';

/**
 * Can this runtime actually complete an HTTP upgrade handshake?
 *
 * WHY THIS EXISTS
 *
 * Bun's `node:http` does not implement upgrade sockets. `server.on('upgrade')`
 * fires, the socket reports `writable === true`, `socket.write()` returns `true`
 * and its callback reports NO error — and not one byte reaches the client. The
 * client-side half is broken too: `http.request()` with an `Upgrade` header emits
 * neither `'upgrade'` nor `'response'`; it simply hangs. Both are the exact
 * primitives `wsProxy.ts` is built from, so on Bun the router accepts WebSocket
 * upgrades and silently black-holes every one of them while `/_health` stays
 * green and HTTP proxying works fine.
 *
 * Upstream: oven-sh/bun#28396 ("node:http is broken for proxies"), OPEN as of
 * 2026-07-15 — "After an HTTP upgrade, socket.write() is a no-op — the 101
 * handshake response is never sent". Four fix PRs are proposed, none merged into
 * a release. Reproduced here on Bun 1.3.14 (the latest) with a ~20-line script
 * containing no LuckyStack code. It breaks every WS proxy in the ecosystem
 * (http-proxy, vite, express-ws, ws) — it is not ours to fix.
 *
 * WHY A PROBE AND NOT A RUNTIME CHECK
 *
 * `'Bun' in globalThis` would answer "is this Bun", but the question that matters
 * is "does the upgrade path work". Those stop being the same the day Bun merges
 * the fix, and a hardcoded runtime ban would then lock out a runtime that works —
 * with no one left who remembers why. The probe measures the actual primitive, so
 * it heals itself: when Bun ships the fix, the router starts, no release of ours
 * required. It costs one loopback connection and only runs where the failure is
 * plausible (see `assertRuntimeCanProxyWebsockets`).
 */
export const probeUpgradeSocketDelivery = async (timeoutMs = 3000): Promise<boolean> => {
  const server = http.createServer((_req, res) => { res.statusCode = 200; res.end(); });

  //? Track the server-side upgrade socket so teardown can destroy it. An upgraded
  //? socket is detached from the HTTP server's request lifecycle but still counts
  //? as an open connection, so `server.close()` waits on it forever — on NODE,
  //? the very runtime the probe must return `true` for. Without this the router
  //? would hang at boot on Node: a self-inflicted outage strictly worse than the
  //? Bun bug being detected. (Found by running it; the failure is invisible on
  //? Bun, where the socket never opens in the first place.)
  //? `Duplex`, not `net.Socket`: that is what `http.Server`'s 'upgrade' event
  //? actually hands over. `destroy()` is all the teardown below needs.
  const serverSockets = new Set<Duplex>();

  //? The server half of the check: hand back a minimal 101 on the upgrade socket.
  server.on('upgrade', (_req, socket) => {
    serverSockets.add(socket);
    socket.on('error', () => { /* the probe reads the client side; ignore here */ });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  });

  const close = async (): Promise<void> => {
    for (const socket of serverSockets) socket.destroy();
    serverSockets.clear();
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  };

  try {
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve(); }); });
    const address = server.address() as AddressInfo | null;
    if (!address) return false;

    //? A raw socket, deliberately — not `http.request`. The client-side upgrade
    //? path is broken on the same runtimes, so using it would conflate two
    //? faults; raw bytes in, raw bytes out, no library in between.
    return await new Promise<boolean>((resolve) => {
      const client = net.connect(address.port, '127.0.0.1', () => {
        client.write(
          'GET /_luckystack_upgrade_probe HTTP/1.1\r\n'
          + `Host: 127.0.0.1:${String(address.port)}\r\n`
          + 'Connection: Upgrade\r\n'
          + 'Upgrade: websocket\r\n'
          + 'Sec-WebSocket-Version: 13\r\n'
          + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
        );
      });

      let settled = false;
      const finish = (result: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.destroy();
        resolve(result);
      };

      const timer = setTimeout(() => { finish(false); }, timeoutMs);
      let buffer = '';
      client.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        if (buffer.includes('\r\n\r\n')) finish(buffer.startsWith('HTTP/1.1 101'));
      });
      client.on('error', () => { finish(false); });
      client.on('close', () => { finish(false); });
    });
  } finally {
    await close();
  }
};

/** Escape hatch for an operator who knows their deployment sends no WebSockets. */
const OVERRIDE_ENV_KEY = 'LUCKYSTACK_ALLOW_BROKEN_WS_PROXY';

export interface RuntimeCapabilityDeps {
  /** Defaults to real detection. Injectable because Node cannot reproduce the Bun branch. */
  isBunRuntime?: boolean;
  /** Defaults to the real probe. Injectable so the verdict logic is testable without Bun. */
  probe?: () => Promise<boolean>;
}

/**
 * Refuse to start when the runtime cannot deliver a WebSocket upgrade.
 *
 * A silently WS-less router is the worst failure this package can have: HTTP
 * routing works, `/_health` is green, and every realtime feature is dead with no
 * error anywhere. LuckyStack already fails fast at boot for a missing binding
 * port on exactly this reasoning — surface it before it reaches a stranger.
 *
 * Set `LUCKYSTACK_ALLOW_BROKEN_WS_PROXY=1` to downgrade this to a warning (an
 * HTTP-only deployment that genuinely never upgrades).
 */
export const assertRuntimeCanProxyWebsockets = async (deps: RuntimeCapabilityDeps = {}): Promise<void> => {
  //? Only probe where the failure is plausible. Node's upgrade path has worked
  //? since forever, and this runs on every router boot — no reason to spend a
  //? connection proving it again. The probe still decides the answer; this only
  //? decides whether it is worth ASKING.
  const isBunRuntime = deps.isBunRuntime ?? 'Bun' in globalThis;
  if (!isBunRuntime) return;

  const canUpgrade = await (deps.probe ?? probeUpgradeSocketDelivery)();
  if (canUpgrade) return;

  const message =
    '[router] This runtime cannot proxy WebSockets: an HTTP upgrade handshake written to the '
    + 'upgrade socket never reaches the client (measured at boot, not assumed). On Bun this is '
    + 'oven-sh/bun#28396 — node:http upgrade sockets are a silent no-op, open upstream as of '
    + 'Bun 1.3.14. The router would still serve HTTP and report healthy while dropping EVERY '
    + 'WebSocket, so it refuses to start instead. Run the router on Node (the rest of LuckyStack '
    + `runs on Bun); or set ${OVERRIDE_ENV_KEY}=1 if this deployment never upgrades.`;

  if (process.env[OVERRIDE_ENV_KEY] === '1') {
    getLogger().warn(`${message} (continuing: ${OVERRIDE_ENV_KEY}=1)`);
    return;
  }
  throw new Error(message);
};
