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

/** WebSocket-proxy hop-by-hop set: the base set (keeps `upgrade` for the handshake). */
export const WS_HOP_BY_HOP_HEADERS: ReadonlySet<string> = BASE_HOP_BY_HOP_HEADERS;

/**
 * Copy request headers, dropping the hop-by-hop entries in `hopByHopSet` and
 * any `undefined` values.
 */
export const stripHopByHopHeaders = (
  headers: IncomingMessage['headers'],
  hopByHopSet: ReadonlySet<string>,
): Record<string, string | string[]> => {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (hopByHopSet.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
};

/** Destroy a socket without letting a teardown error escape. */
export const safeDestroy = (socket: Socket): void => {
  try {
    socket.destroy();
  } catch {
    /* noop — socket may already be torn down */
  }
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
