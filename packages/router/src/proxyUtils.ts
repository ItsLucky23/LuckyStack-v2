import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

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
