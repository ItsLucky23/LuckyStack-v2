import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { URL } from 'node:url';
import { tryCatchSync } from '@luckystack/core';

//? Hop-by-hop headers are connection-scoped and must NOT be forwarded to the
//? upstream (RFC 7230 §6.1). This is the set common to both the HTTP and the
//? WebSocket proxy. The HTTP proxy additionally strips `upgrade` (it never
//? proxies upgrades through the request path); the WS proxy deliberately keeps
//? `upgrade` so the handshake completes — see `WS_HOP_BY_HOP_HEADERS`.
export const BASE_HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
]);

/** HTTP-proxy hop-by-hop set: the base set plus `upgrade`. */
export const HTTP_HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
  ...BASE_HOP_BY_HOP_HEADERS,
  'upgrade',
]);

/** WebSocket-proxy REQUEST hop-by-hop set: the base set (keeps `upgrade` for the handshake). */
export const WS_HOP_BY_HOP_HEADERS: ReadonlySet<string> = BASE_HOP_BY_HOP_HEADERS;

//? WebSocket-proxy RESPONSE hop-by-hop set. `connection` is hop-by-hop by RFC
//? 7230 §6.1 in general, but on a 101 it is the header that MAKES the response
//? an upgrade: RFC 6455 §4.2.2 requires `Connection: Upgrade` alongside
//? `Upgrade: websocket`, and every client enforces it — Node's own HTTP parser
//? will not emit `'upgrade'` without it, and socket.io/ws reject the handshake.
//?
//? Applying the REQUEST set to the RESPONSE is exactly how the WS proxy shipped
//? BROKEN from 2026-06-19 (0252a74, a security sweep) until this fix: the client
//? received `HTTP/1.1 101 Switching Protocols` with `Connection` stripped, which
//? is not a completable handshake, so NO WebSocket could cross the router at
//? all. The unit test missed it for three weeks because it asserted only that
//? the status line contained "101" — true, and useless.
//?
//? The sweep's actual intent is preserved: `set-cookie` and `x-luckystack-*` are
//? still stripped in the response loop, and the genuinely connection-scoped
//? headers below still go.
export const WS_RESPONSE_HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set(
  [...BASE_HOP_BY_HOP_HEADERS].filter((header) => header !== 'connection'),
);

//? Service key that socket.io traffic pins to by convention. A socket.io client
//? connects to ONE url whose path is `/socket.io/?...` — the first path segment
//? is the transport's own name, never a service name — so neither half of the
//? connection can be routed by the usual first-segment rule. Overridable via
//? `deploy.routing.websocketService`.
export const DEFAULT_WS_SERVICE = 'system';

//? Socket.io's engine path. `@luckystack/server` never passes a `path` option to
//? `new SocketIOServer(...)`, so the library default is what the framework
//? actually serves; if that ever becomes configurable, this must follow it.
const SOCKET_IO_PATH = '/socket.io';

/**
 * Is this the socket.io engine path (either half of a socket.io connection)?
 *
 * A socket.io connection is TWO requests on the same path: an XHR polling
 * handshake (plain HTTP -> the HTTP proxy) and then the upgrade (-> the WS
 * proxy). The WS proxy has always pinned upgrades to the websocket service; the
 * HTTP proxy had no matching rule, so it fed "socket.io" to the first-segment
 * resolver, found no such service, and answered `502 serviceNotAssigned`.
 *
 * That broke the DEFAULT client outright: socket.io's default transport list is
 * `['polling', 'websocket']`, and LuckyStack's own `socketInitializer.ts` sets no
 * `transports`, so every browser opens with the poll that the router rejects and
 * never reaches the upgrade at all. `loadSocket.ts` spells the requirement out —
 * "Socket.io *must* complete that origin-less HTTP handshake before it can
 * upgrade to WebSocket" — in the very comment describing the with-router
 * topology.
 *
 * Both halves must also land on the SAME backend, which pinning to one service
 * gives for free (a single binding per service), so no sticky-session layer is
 * needed.
 */
export const isSocketIoPath = (pathname: string): boolean => {
  const queryStart = pathname.indexOf('?');
  const path = queryStart === -1 ? pathname : pathname.slice(0, queryStart);
  return path === SOCKET_IO_PATH || path.startsWith(`${SOCKET_IO_PATH}/`);
};

/**
 * Extract the extra hop-by-hop header names listed in the `Connection` header
 * per RFC 7230 §6.1. A client can declare any header as connection-scoped by
 * including its name as a `Connection` token (e.g. `Connection: close, x-my-token`).
 * Those headers are hop-by-hop and must NOT be forwarded to the upstream.
 */
export const extractConnectionTokens = (
  headers: IncomingMessage['headers'],
): ReadonlySet<string> => {
  const raw = headers.connection;
  if (!raw) return new Set();
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  return new Set(
    value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
};

/**
 * Copy request headers, dropping the hop-by-hop entries in `hopByHopSet`,
 * any headers dynamically listed in the `Connection` value (RFC 7230 §6.1),
 * and any `undefined` values.
 */
export const stripHopByHopHeaders = (
  headers: IncomingMessage['headers'],
  hopByHopSet: ReadonlySet<string>,
): Record<string, string | string[]> => {
  //? RFC 7230 §6.1: any token listed in `Connection` is hop-by-hop for this
  //? hop and must be stripped. This covers dynamic tokens like bearer
  //? nonces that intermediaries sometimes inject into the Connection header.
  const connectionTokens = extractConnectionTokens(headers);
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (hopByHopSet.has(lower)) continue;
    if (connectionTokens.has(lower)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
};

/** Destroy a socket without letting a teardown error escape. */
export const safeDestroy = (socket: Socket): void => {
  //? Swallow any error — a socket that is already destroyed or has an
  //? in-progress teardown may throw; we never want a cleanup path to throw.
  tryCatchSync(() => { socket.destroy(); });
};

/**
 * A request target is routable only when it is in strict origin-form: it must
 * start with a single `/`. Absolute-form (`http://host/...`), authority-form
 * (`host:port`), and protocol-relative (`//host/...`) targets are rejected so a
 * later `new URL(pathname, base)` cannot re-host the upstream to an
 * attacker-controlled origin (SSRF). Both proxies call this before building the
 * upstream URL so the host-pinning invariant lives in one place.
 */
export const isOriginFormTarget = (pathname: string): boolean =>
  pathname.startsWith('/') && !pathname.startsWith('//');

/**
 * Defense-in-depth host pinning. After `new URL(pathname, base)` the resolved
 * URL's protocol+host MUST equal the target backend's — a custom
 * `ServiceResolver` or a malformed path must never be able to move the upstream
 * off the backend the resolver chose. Returns false on any divergence (treat as
 * a 502).
 */
export const isHostPinned = (targetUrl: URL, backendTarget: string): boolean => {
  const [error, backendUrl] = tryCatchSync(() => new URL(backendTarget));
  if (error || !backendUrl) return false;
  return targetUrl.protocol === backendUrl.protocol && targetUrl.host === backendUrl.host;
};

/**
 * Normalize an inbound `x-forwarded-proto`. The router does not terminate TLS,
 * so it must NOT trust a client-asserted scheme (a client could spoof `https`
 * to a plain-HTTP backend, flipping secure-cookie / redirect logic). Only the
 * literal `http` / `https` values are honored; anything else collapses to
 * `http`. The inbound header is dropped by `stripForwardedHeaders` first, so the
 * value returned here is the only one forwarded.
 */
export const normalizeForwardedProto = (value: string | string[] | undefined): 'http' | 'https' => {
  const first = Array.isArray(value) ? value[0] : value;
  return first === 'https' ? 'https' : 'http';
};

//? Client-supplied copies of router-authoritative forwarding headers MUST be
//? dropped before we set our own — otherwise a client could pre-seed
//? `x-forwarded-for` (IP spoof → rate-limit/ban evasion), `x-forwarded-proto`
//? (scheme spoof), `x-forwarded-host`, or the internal `x-luckystack-*` routing
//? markers and have them survive via object-spread ordering. We delete them
//? explicitly so the security invariant does not depend on spread order.
const ROUTER_AUTHORITATIVE_HEADER_PREFIXES: readonly string[] = ['x-forwarded-', 'x-luckystack-'];
const ROUTER_AUTHORITATIVE_HEADER_NAMES: ReadonlySet<string> = new Set(['x-real-ip', 'forwarded']);

const isRouterAuthoritativeHeader = (key: string): boolean => {
  const lower = key.toLowerCase();
  if (ROUTER_AUTHORITATIVE_HEADER_NAMES.has(lower)) return true;
  return ROUTER_AUTHORITATIVE_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

/**
 * Return a copy of the forwarded-header map with every client-supplied
 * forwarding / router-authoritative header removed. Call after
 * `stripHopByHopHeaders`, before setting the router's own authoritative values.
 */
export const stripForwardedHeaders = (
  headers: Record<string, string | string[]>,
): Record<string, string | string[]> => {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isRouterAuthoritativeHeader(key)) continue;
    out[key] = value;
  }
  return out;
};

/**
 * Compute the `x-forwarded-for` value the router forwards upstream. The router
 * is the trust boundary: it sets XFF to its own peer view of the client
 * (`req.socket.remoteAddress`) rather than trusting any inbound chain, so a
 * client cannot forge its source IP to defeat per-IP rate-limiting, ban lists,
 * or audit. Backends must trust ONLY this router-set value.
 */
export const buildForwardedFor = (remoteAddress: string | undefined): string => remoteAddress ?? '';
