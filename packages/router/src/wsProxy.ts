import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { ServiceTargetResolver } from './resolveTarget';
import { WS_HOP_BY_HOP_HEADERS, stripHopByHopHeaders, safeDestroy } from './proxyUtils';

//? Service key used for WebSocket upgrades. Socket.io clients connect to a
//? single URL with path `/socket.io/?...`, so the first path segment doesn't
//? carry a service name. We route WS to the `system` service by convention.
//? With the Socket.io Redis adapter attached on every backend, rooms fan out
//? across instances regardless of which one holds the WS connection.
const DEFAULT_WS_SERVICE = 'system';

export interface CreateWsProxyInput {
  resolver: ServiceTargetResolver;
  wsTargetService?: string;
}

export const createWsProxy = ({ resolver, wsTargetService }: CreateWsProxyInput) => {
  const service = wsTargetService ?? DEFAULT_WS_SERVICE;

  return (req: IncomingMessage, clientSocket: Socket, head: Buffer): void => {
    const resolved = resolver.resolve(service);
    if (!resolved) {
      clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\n\r\n`);
      safeDestroy(clientSocket);
      return;
    }

    const targetUrl = new URL(req.url ?? '/', resolved.target);
    const transport = targetUrl.protocol === 'https:' ? https : http;

    const upstreamRequest = transport.request({
      hostname: targetUrl.hostname,
      //? Boot-time guard in `resolveTarget.ts` ensures every binding URL has
      //? an explicit port. `targetUrl.port` is always a non-empty numeric
      //? string at this point.
      port: Number(targetUrl.port),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: {
        ...stripHopByHopHeaders(req.headers, WS_HOP_BY_HOP_HEADERS),
        //? These two must be preserved verbatim to complete the WS handshake.
        connection: 'Upgrade',
        upgrade: 'websocket',
        'x-forwarded-host': req.headers.host ?? '',
        'x-forwarded-proto': req.headers['x-forwarded-proto'] ?? 'http',
        'x-luckystack-resolved-env': resolved.resolvedEnvKey,
        'x-luckystack-via-fallback': resolved.viaFallback ? '1' : '0',
      },
    });

    upstreamRequest.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      //? Forward the 101 Switching Protocols response and any trailing bytes
      //? the upstream already sent, then bidirectionally pipe the raw sockets.
      const statusLine = `HTTP/1.1 ${upstreamRes.statusCode ?? 101} ${upstreamRes.statusMessage ?? 'Switching Protocols'}`;
      const headerLines: string[] = [statusLine];
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined) continue;
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
      clientSocket.on('error', teardown);
      clientSocket.on('close', teardown);
    });

    upstreamRequest.on('error', () => {
      clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\n\r\n`);
      safeDestroy(clientSocket);
    });

    upstreamRequest.end(head);
  };
};
