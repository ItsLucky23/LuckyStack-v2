import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { IncomingMessage, ClientRequest } from 'node:http';
import type { Socket } from 'node:net';
import { dispatchHook, getDeployConfig } from '@luckystack/core';
import type { ServiceTargetResolver } from './resolveTarget';
import {
  WS_HOP_BY_HOP_HEADERS,
  stripHopByHopHeaders,
  stripForwardedHeaders,
  safeDestroy,
  isOriginFormTarget,
  isHostPinned,
  normalizeForwardedProto,
  buildForwardedFor,
} from './proxyUtils';

//? Service key used for WebSocket upgrades. Socket.io clients connect to a
//? single URL with path `/socket.io/?...`, so the first path segment doesn't
//? carry a service name. We route WS to the `system` service by convention.
//? With the Socket.io Redis adapter attached on every backend, rooms fan out
//? across instances regardless of which one holds the WS connection.
const DEFAULT_WS_SERVICE = 'system';

//? Bound the upstream-handshake leg. A backend that accepts the TCP connection
//? but never answers the WS upgrade would otherwise pin both the client and the
//? upstream socket indefinitely (unauth-reachable resource-exhaustion DoS).
//? On expiry we reap the in-flight upstream request and cleanly fail the client
//? leg. Built-in (not a deploy-config knob) to keep the change inside this
//? package, mirroring the slow-loris timeouts in `startRouter.ts`.
const UPSTREAM_HANDSHAKE_TIMEOUT_MS = 30_000;

//? Conservative configurable defaults for the WS resource caps. All three are
//? overridable via `deploy.routing.{wsMaxHeadBytes,wsIdleTimeoutMs,
//? wsMaxBytesPerConnection}` (read through `getDeployConfig()`), mirroring how
//? the HTTP proxy reads `upstreamTimeoutMs` / `maxRequestBodyBytes`.
//? Reject an upgrade whose pre-101 `head` buffer exceeds this many bytes (#77).
const DEFAULT_WS_MAX_HEAD_BYTES = 64 * 1024; // 64 KiB
//? Tear down an upgraded pipe after this many ms with no traffic either way (#76).
const DEFAULT_WS_IDLE_TIMEOUT_MS = 120_000; // 2 min
//? Tear down an upgraded pipe once this many total bytes have flowed across both
//? legs (#76). Generous enough for normal sync traffic but bounded; `false` off.
const DEFAULT_WS_MAX_BYTES_PER_CONNECTION: number | false = 100 * 1024 * 1024; // 100 MiB

export interface CreateWsProxyInput {
  resolver: ServiceTargetResolver;
  wsTargetService?: string;
  /**
   * Upstream-handshake timeout in ms. A backend that accepts TCP but never
   * answers the WS upgrade is reaped after this window (client gets 504).
   * Defaults to `UPSTREAM_HANDSHAKE_TIMEOUT_MS`.
   */
  upstreamHandshakeTimeoutMs?: number;
}

//? Write a minimal HTTP status line to a not-yet-upgraded client socket, then
//? destroy it. Used on every pre-101 rejection path (bad path, unresolved
//? service, host-pin failure, non-101 upstream, upstream error). `safeDestroy`
//? swallows a write-after-destroy race when the client already vanished.
const writeStatusAndDestroy = (socket: Socket, statusCode: number, statusMessage: string): void => {
  if (!socket.destroyed) {
    socket.write(`HTTP/1.1 ${String(statusCode)} ${statusMessage}\r\n\r\n`);
  }
  safeDestroy(socket);
};

export const createWsProxy = ({ resolver, wsTargetService, upstreamHandshakeTimeoutMs }: CreateWsProxyInput) => {
  const service = wsTargetService ?? DEFAULT_WS_SERVICE;
  const handshakeTimeoutMs = upstreamHandshakeTimeoutMs ?? UPSTREAM_HANDSHAKE_TIMEOUT_MS;

  return (req: IncomingMessage, clientSocket: Socket, head: Buffer): void => {
    const pathname = req.url ?? '/';

    //? Tracks whether the upgrade completed (101 + bidirectional pipe). Until it
    //? does, the client socket has no upstream peer, so a client `'error'`/
    //? `'close'` during the handshake window must tear down the in-flight
    //? upstream request to avoid a half-open upstream socket leak.
    let upgraded = false;
    //? Guards the pre-101 rejection paths (handshake timeout, non-101 `'response'`,
    //? upstream `'error'`, client-gone, gate rejection) so only the FIRST one
    //? writes the status + tears both legs down.
    let settled = false;
    let upstreamRequest: ClientRequest | null = null;

    //? CRITICAL: attach client-socket listeners BEFORE any IO or awaiting.
    //? A client RST / disconnect mid-handshake emits `'error'` on the raw
    //? `net.Socket`; with no listener that throws an uncaught exception and
    //? crashes the whole router process (remote, unauthenticated DoS). The guard
    //? also reaps the in-flight upstream handshake so a disconnecting client
    //? cannot leak upstream sockets. This must run synchronously before the async
    //? gate check below so the socket is guarded during the await.
    const onClientGone = (): void => {
      settled = true;
      if (!upgraded && upstreamRequest) upstreamRequest.destroy();
      safeDestroy(clientSocket);
    };
    clientSocket.on('error', onClientGone);
    clientSocket.on('close', onClientGone);

    //? Head-buffer size cap (#77). The upgrade `head` is bytes the client already
    //? sent past the request line; it is forwarded verbatim to the upstream
    //? (`upstreamRequest.end(head)`). Reject an over-cap head BEFORE opening the
    //? upstream leg so a client can't push an unbounded pre-upgrade buffer through
    //? the router. The socket is already guarded by `onClientGone` above.
    const maxHeadBytes = getDeployConfig().routing?.wsMaxHeadBytes ?? DEFAULT_WS_MAX_HEAD_BYTES;
    if (head.length > maxHeadBytes) {
      settled = true;
      writeStatusAndDestroy(clientSocket, 431, 'Request Header Fields Too Large');
      return;
    }

    //? Reject anything but strict origin-form before building the upstream URL.
    //? Absolute-form (`GET http://evil:port/...`) or protocol-relative (`//evil`)
    //? targets would let `new URL(pathname, target)` re-host the upstream to an
    //? attacker-chosen host:port (SSRF / open TCP tunnel).
    if (!isOriginFormTarget(pathname)) {
      settled = true;
      writeStatusAndDestroy(clientSocket, 400, 'Bad Request');
      return;
    }

    const resolved = resolver.resolve(service);
    if (!resolved) {
      settled = true;
      writeStatusAndDestroy(clientSocket, 502, 'Bad Gateway');
      return;
    }

    const targetUrl = new URL(pathname, resolved.target);

    //? Defense-in-depth host pinning: the resolved upstream host MUST equal the
    //? backend the resolver chose. A custom `ServiceResolver` or a malformed
    //? path must never move the upstream off the chosen backend.
    if (!isHostPinned(targetUrl, resolved.target)) {
      settled = true;
      writeStatusAndDestroy(clientSocket, 502, 'Bad Gateway');
      return;
    }

    //? The async gate check runs AFTER the synchronous safety guards above.
    //? `clientSocket` is already guarded by `onClientGone`; if the client RSTs
    //? while we await, `settled` is flipped and the continuation below is a no-op.
    void openUpstream(req, clientSocket, head, {
      pathname,
      resolved,
      targetUrl,
      service,
      transport: targetUrl.protocol === 'https:' ? https : http,
      handshakeTimeoutMs,
      onClientGone,
      getSettled: () => settled,
      setSettled: (v) => { settled = v; },
      getUpgraded: () => upgraded,
      setUpgraded: (v) => { upgraded = v; },
      setUpstreamRequest: (r) => { upstreamRequest = r; },
    });
  };
};

interface OpenUpstreamCtx {
  pathname: string;
  resolved: { target: string; viaFallback: boolean; resolvedEnvKey: string };
  targetUrl: URL;
  service: string;
  transport: typeof http | typeof https;
  handshakeTimeoutMs: number;
  onClientGone: () => void;
  getSettled: () => boolean;
  setSettled: (v: boolean) => void;
  getUpgraded: () => boolean;
  setUpgraded: (v: boolean) => void;
  setUpstreamRequest: (r: ClientRequest) => void;
}

const openUpstream = async (
  req: IncomingMessage,
  clientSocket: Socket,
  head: Buffer,
  ctx: OpenUpstreamCtx,
): Promise<void> => {
  const {
    pathname, resolved, targetUrl, service, transport, handshakeTimeoutMs,
    onClientGone, getSettled, setSettled, getUpgraded, setUpgraded, setUpstreamRequest,
  } = ctx;

  //? `proxyRequestGate` is the fail-CLOSED deny gate for WebSocket upgrades.
  //? Any registered handler that returns a stop signal rejects the connection
  //? here, before the upstream leg is opened. Absence of handlers = allow.
  const gateResult = await dispatchHook('proxyRequestGate', {
    service,
    pathname,
    method: 'UPGRADE',
    target: resolved.target,
    viaFallback: resolved.viaFallback,
    remoteAddress: req.socket.remoteAddress,
  });

  //? If the client disconnected while we were awaiting the gate, bail out.
  if (getSettled()) return;

  if (gateResult.stopped) {
    setSettled(true);
    writeStatusAndDestroy(clientSocket, gateResult.signal.httpStatus ?? 403, 'Forbidden');
    return;
  }

  const forwardHeaders = stripForwardedHeaders(
    stripHopByHopHeaders(req.headers, WS_HOP_BY_HOP_HEADERS),
  );

  const upstreamRequest = transport.request({
    hostname: targetUrl.hostname,
    //? Boot-time guard in `resolveTarget.ts` ensures every binding URL has
    //? an explicit port. `targetUrl.port` is always a non-empty numeric
    //? string at this point.
    port: Number(targetUrl.port),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      ...forwardHeaders,
      //? These two must be preserved verbatim to complete the WS handshake.
      connection: 'Upgrade',
      upgrade: 'websocket',
      //? Router-authoritative forwarding values. The client's copies were
      //? stripped above; XFF is the router's own peer view of the client so a
      //? client cannot forge its source IP, and the scheme is normalized
      //? rather than trusted from the inbound header.
      'x-forwarded-for': buildForwardedFor(req.socket.remoteAddress),
      'x-forwarded-host': req.headers.host ?? '',
      'x-forwarded-proto': normalizeForwardedProto(req.headers['x-forwarded-proto']),
      'x-luckystack-resolved-env': resolved.resolvedEnvKey,
      'x-luckystack-via-fallback': resolved.viaFallback ? '1' : '0',
    },
  });

  //? Expose the upstream request to the `onClientGone` closure so a client
  //? RST after the gate but before the upgrade completes tears down the
  //? upstream too.
  setUpstreamRequest(upstreamRequest);

  //? Reap the upstream leg if the backend accepts TCP but never completes the
  //? upgrade handshake. `setTimeout` only schedules the `'timeout'` event — it
  //? does not destroy the socket — so we destroy the request (which surfaces
  //? on the `'error'` handler below, writing 504 + tearing down the client) and
  //? guard against firing after a successful upgrade, where the piped sockets
  //? own their own teardown.
  upstreamRequest.setTimeout(handshakeTimeoutMs, () => {
    if (getUpgraded() || getSettled()) return;
    setSettled(true);
    writeStatusAndDestroy(clientSocket, 504, 'Gateway Timeout');
    upstreamRequest.destroy();
  });

  upstreamRequest.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    setUpgraded(true);

    //? Forward the 101 Switching Protocols response and any trailing bytes
    //? the upstream already sent, then bidirectionally pipe the raw sockets.
    //? Strip hop-by-hop and internal `x-luckystack-*` headers from the upstream
    //? 101 response before writing to the client — a backend must not be able to
    //? inject Set-Cookie, x-luckystack-* routing markers, or other internal headers
    //? through the WS upgrade response into the browser's header context.
    const statusLine = `HTTP/1.1 ${upstreamRes.statusCode ?? 101} ${upstreamRes.statusMessage ?? 'Switching Protocols'}`;
    const headerLines: string[] = [statusLine];
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (lower === 'set-cookie') continue;
      if (WS_HOP_BY_HOP_HEADERS.has(lower)) continue;
      if (lower.startsWith('x-luckystack-')) continue;
      if (Array.isArray(value)) {
        for (const v of value) headerLines.push(`${key}: ${v}`);
      } else {
        headerLines.push(`${key}: ${value}`);
      }
    }
    clientSocket.write(`${headerLines.join('\r\n')}\r\n\r\n`);
    if (upstreamHead.length > 0) clientSocket.write(upstreamHead);

    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);

    const teardown = (): void => {
      safeDestroy(upstreamSocket);
      safeDestroy(clientSocket);
    };
    upstreamSocket.on('error', teardown);
    upstreamSocket.on('close', teardown);

    //? Idle-timeout (#76). Once upgraded the proxy pipes raw bytes with no
    //? lifetime bound; a client could hold an idle pipe open against the router
    //? indefinitely. `socket.setTimeout` auto-RESETS on read/write activity, so an
    //? active connection never trips it while a silent pipe is reaped after the
    //? window. `'timeout'` does NOT destroy the socket on its own — we tear the
    //? pair down. DEFAULT 120000 ms; `deploy.routing.wsIdleTimeoutMs = 0` disables.
    const idleTimeoutMs = getDeployConfig().routing?.wsIdleTimeoutMs ?? DEFAULT_WS_IDLE_TIMEOUT_MS;
    if (idleTimeoutMs > 0) {
      upstreamSocket.setTimeout(idleTimeoutMs);
      clientSocket.setTimeout(idleTimeoutMs);
      upstreamSocket.on('timeout', teardown);
      clientSocket.on('timeout', teardown);
    }

    //? Per-connection byte budget (#76). Cap the total bytes piped across BOTH
    //? legs so a single upgraded connection can't stream the router out of
    //? resources. The `'data'` listeners are observers — `.pipe()` keeps owning
    //? the actual transfer, they don't consume/steal the stream. DEFAULT 100 MiB;
    //? `deploy.routing.wsMaxBytesPerConnection = false` disables the cap.
    const maxBytesPerConnection = getDeployConfig().routing?.wsMaxBytesPerConnection ?? DEFAULT_WS_MAX_BYTES_PER_CONNECTION;
    if (maxBytesPerConnection !== false) {
      let bytesPiped = 0;
      const meter = (chunk: Buffer): void => {
        bytesPiped += chunk.length;
        if (bytesPiped > maxBytesPerConnection) teardown();
      };
      upstreamSocket.on('data', meter);
      clientSocket.on('data', meter);
    }

    //? Add post-upgrade teardown listeners BEFORE removing the pre-upgrade
    //? `onClientGone` listeners. An atomic swap ensures no window where the
    //? client socket has no error/close handler — a client RST between the two
    //? operations would otherwise be an uncaught exception that crashes the router.
    clientSocket.on('error', teardown);
    clientSocket.on('close', teardown);

    //? The pre-101 `onClientGone` handler has served its purpose (no upstream
    //? socket to leak anymore). Remove it now that the post-upgrade teardown
    //? is in place, so the same socket doesn't accumulate duplicate handlers on
    //? every connection (listener count grows unboundedly without this).
    clientSocket.off('error', onClientGone);
    clientSocket.off('close', onClientGone);
  });

  //? `http.request` only emits `'upgrade'` on a 101. A reachable backend that
  //? answers the upgrade with a normal HTTP response (200/400/404/500 — common
  //? on misroute / mid-boot / edge-auth) emits `'response'` instead. Without a
  //? handler the client socket would leak (never written or destroyed).
  upstreamRequest.on('response', (upstreamRes) => {
    if (getUpgraded() || getSettled()) { upstreamRes.resume(); return; }
    setSettled(true);
    const statusCode = upstreamRes.statusCode ?? 502;
    writeStatusAndDestroy(clientSocket, statusCode, upstreamRes.statusMessage ?? 'Bad Gateway');
    //? Drain + reap the upstream leg. Without consuming the body the upstream
    //? socket stays open (paused) until the handshake timeout reaps it ~30s
    //? later; resume() lets it close now and destroy() releases the request.
    upstreamRes.resume();
    upstreamRequest.destroy();
  });

  upstreamRequest.on('error', () => {
    if (getSettled()) return;
    setSettled(true);
    writeStatusAndDestroy(clientSocket, 502, 'Bad Gateway');
  });

  upstreamRequest.end(head);
};
