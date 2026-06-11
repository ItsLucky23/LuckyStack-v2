import type { IncomingHttpHeaders } from 'node:http';

import { getLogger } from './loggerRegistry';

/**
 * Stable sentinel returned when no usable client address could be resolved.
 * Kept as a single exported constant so every rate-limit key-site funnels
 * missing addresses into one deterministic bucket instead of ad-hoc literals.
 */
export const UNKNOWN_CLIENT_IP = 'unknown';

export interface ResolveClientIpParams {
  /**
   * The raw transport peer address — `socket.handshake.address` (Socket.io)
   * or `req.socket.remoteAddress` (raw HTTP). May be `undefined`/`null` when
   * the connection has already been torn down.
   */
  rawAddress: string | null | undefined;
  /** Request / handshake headers. Only consulted when `trustProxy` is true. */
  headers: IncomingHttpHeaders;
  /**
   * Whether a known reverse proxy sits in front of this server. DEFAULT false.
   * When false the raw peer address is returned verbatim (only IPv4-mapped
   * IPv6 canonicalization is applied), preserving historical behaviour. Only
   * enable when a trusted proxy populates `X-Forwarded-For` / `X-Real-IP`,
   * otherwise a client can spoof its own IP via those headers.
   */
  trustProxy?: boolean;
}

/**
 * Canonicalize an address so variant spellings of the same host collapse into
 * one rate-limit bucket (M-7):
 * - strip the IPv4-mapped IPv6 prefix (`::ffff:1.2.3.4` -> `1.2.3.4`);
 * - drop an IPv6 zone id (`fe80::1%eth0` -> `fe80::1`);
 * - lowercase IPv6 (case-insensitive hex) so `2001:DB8::1` == `2001:db8::1`.
 *
 * IPv4 + hostnames are returned untouched. NOTE: this is the lightweight,
 * dependency-free normalization — it does NOT expand/compress IPv6 (`2001:db8::1`
 * vs `2001:0db8:0:0:0:0:0:1`); use a dedicated `ip-address` parser if that
 * edge-case bucket-spreading matters for your threat model.
 */
const canonicalizeIp = (value: string): string => {
  let ip = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);
  return ip.includes(':') ? ip.toLowerCase() : ip;
};

/**
 * Normalize a single header value (string | string[] | undefined) to its
 * first non-empty string, trimmed. `X-Forwarded-For` may legitimately arrive
 * as a comma-joined list ("client, proxy1, proxy2") OR as a repeated header
 * (string[]); both are handled.
 */
const firstHeaderValue = (raw: string | string[] | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const single = Array.isArray(raw) ? raw[0] : raw;
  if (typeof single !== 'string') return undefined;
  const trimmed = single.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Resolve the real client IP for per-IP rate-limit keying.
 *
 * - `trustProxy === false` (default): returns the raw peer address with only
 *   IPv4-mapped IPv6 canonicalization applied; falls back to
 *   {@link UNKNOWN_CLIENT_IP} when the raw address is missing. This preserves
 *   the framework's historical behaviour (`address ?? 'unknown'`) byte-for-byte
 *   for non-mapped addresses.
 * - `trustProxy === true`: prefers the leftmost (originating) entry of
 *   `X-Forwarded-For`, then `X-Real-IP`, and only then the raw peer address.
 *
 * The leftmost `X-Forwarded-For` hop is the original client when exactly one
 * trusted proxy populates the header (the documented deployment topology).
 */
const resolveRaw = ({ rawAddress, headers, trustProxy }: ResolveClientIpParams & { trustProxy: boolean }): string => {
  const rawFallback = rawAddress && rawAddress.length > 0
    ? canonicalizeIp(rawAddress)
    : UNKNOWN_CLIENT_IP;

  if (!trustProxy) return rawFallback;

  const forwardedFor = firstHeaderValue(headers['x-forwarded-for']);
  if (forwardedFor) {
    //? Leftmost hop = the originating client when a single trusted proxy
    //? prepends. Split on comma to handle the comma-joined list form.
    const leftmost = forwardedFor.split(',')[0]?.trim();
    if (leftmost && leftmost.length > 0) return canonicalizeIp(leftmost);
  }

  const realIp = firstHeaderValue(headers['x-real-ip']);
  if (realIp) return canonicalizeIp(realIp);

  return rawFallback;
};

export const resolveClientIp = ({ rawAddress, headers, trustProxy = false }: ResolveClientIpParams): string => {
  const resolved = resolveRaw({ rawAddress, headers, trustProxy });
  if (resolved === UNKNOWN_CLIENT_IP) {
    //? M-8 — surface the shared fallback bucket. A burst of these usually means
    //? a reverse proxy is in front but `trustProxy` is off (every request then
    //? collapses here), or the connection was torn down before keying. Rare in
    //? a correctly-configured deployment, so a plain warn is not spammy.
    getLogger().warn('rate-limit: client IP unresolved — keyed into the shared "unknown" bucket', { trustProxy });
  }
  return resolved;
};
