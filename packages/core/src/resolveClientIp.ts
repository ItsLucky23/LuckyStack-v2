import { createHash } from 'node:crypto';
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
  /**
   * Number of proxy hops to skip from the RIGHT of `X-Forwarded-For` when
   * `trustProxy` is on (CORE-O3). The rightmost entries are appended by your own
   * trusted proxies; the resolved client IP is the entry that many hops in from
   * the end. The leftmost hop is client-controlled and is never trusted. DEFAULT
   * 1 (the immediate upstream proxy). Clamped to the list length so an over-large
   * count falls back to the leftmost trusted hop rather than the spoofable entry.
   */
  trustedProxyHopCount?: number;
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
 * Flatten an `X-Forwarded-For` header into its ordered list of non-empty,
 * trimmed hops. Handles both the comma-joined list form ("client, proxy1") and
 * the repeated-header (string[]) form, and a mix of the two. Order is preserved:
 * leftmost (client-controlled) first, rightmost (closest trusted proxy) last.
 */
const forwardedForHops = (raw: string | string[] | undefined): string[] => {
  if (raw === undefined) return [];
  const parts = Array.isArray(raw) ? raw : [raw];
  return parts
    .flatMap((part) => (typeof part === 'string' ? part.split(',') : []))
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);
};

/**
 * Resolve the real client IP for per-IP rate-limit keying.
 *
 * - `trustProxy === false` (default): returns the raw peer address with only
 *   IPv4-mapped IPv6 canonicalization applied; falls back to
 *   {@link UNKNOWN_CLIENT_IP} when the raw address is missing. This preserves
 *   the framework's historical behaviour (`address ?? 'unknown'`) byte-for-byte
 *   for non-mapped addresses.
 * - `trustProxy === true`: skips `trustedProxyHopCount` hops from the RIGHT of
 *   `X-Forwarded-For` (the rightmost entries are appended by YOUR trusted
 *   proxies), then `X-Real-IP`, and only then the raw peer address.
 *
 * CORE-O3: the leftmost `X-Forwarded-For` hop is CLIENT-CONTROLLED and is never
 * trusted (it enables per-IP rate-limit evasion + audit-IP spoofing). With the
 * default `trustedProxyHopCount: 1` and a single trusted proxy, the resolved IP
 * is the immediate upstream peer (the rightmost real hop).
 */
const resolveRaw = ({ rawAddress, headers, trustProxy, trustedProxyHopCount }: ResolveClientIpParams & { trustProxy: boolean; trustedProxyHopCount: number }): string => {
  const rawFallback = rawAddress && rawAddress.length > 0
    ? canonicalizeIp(rawAddress)
    : UNKNOWN_CLIENT_IP;

  if (!trustProxy) return rawFallback;

  const hops = forwardedForHops(headers['x-forwarded-for']);
  if (hops.length > 0) {
    //? Count from the RIGHT — the rightmost entry is the one your own trusted
    //? proxy appended. Clamp so an over-large count lands on the leftmost
    //? available trusted hop instead of underflowing past the start.
    const skip = Math.max(1, Math.floor(trustedProxyHopCount));
    const index = Math.max(0, hops.length - skip);
    const chosen = hops[index];
    if (chosen && chosen.length > 0) return canonicalizeIp(chosen);
  }

  const realIp = firstHeaderValue(headers['x-real-ip']);
  if (realIp) return canonicalizeIp(realIp);

  return rawFallback;
};

/**
 * Whether a resolved client IP is a loopback / unresolved address — used by the
 * api/sync transports to honour `rateLimiting.skipLoopbackInDev` (api F5/F11).
 * Matches IPv4 loopback (`127.0.0.0/8`), IPv6 loopback (`::1`), the IPv4-mapped
 * form (`::ffff:127.0.0.1`, already canonicalized away by {@link resolveClientIp}),
 * and the {@link UNKNOWN_CLIENT_IP} sentinel. Pass an already-resolved IP.
 */
export const isLoopbackIp = (ip: string): boolean => {
  if (ip === UNKNOWN_CLIENT_IP) return true;
  const canonical = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  if (canonical === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(canonical);
};

const TOKEN_HASH_LENGTH = 32;

/**
 * Derive the deterministic, non-reversible bucket component for a session
 * token. The same token always yields the same value (bucket identity is
 * preserved) while the raw token never appears in the returned string.
 * Used by api AND sync rate-limit key builders — lives in core so both
 * packages can share one implementation without a cross-package dependency.
 */
export const deriveTokenBucketId = (token: string): string =>
  createHash('sha256').update(token).digest('hex').slice(0, TOKEN_HASH_LENGTH);

export const resolveClientIp = ({ rawAddress, headers, trustProxy = false, trustedProxyHopCount = 1 }: ResolveClientIpParams): string => {
  const resolved = resolveRaw({ rawAddress, headers, trustProxy, trustedProxyHopCount });
  if (resolved === UNKNOWN_CLIENT_IP) {
    //? M-8 — surface the shared fallback bucket. A burst of these usually means
    //? a reverse proxy is in front but `trustProxy` is off (every request then
    //? collapses here), or the connection was torn down before keying. Rare in
    //? a correctly-configured deployment, so a plain warn is not spammy.
    getLogger().warn('rate-limit: client IP unresolved — keyed into the shared "unknown" bucket', { trustProxy });
  }
  return resolved;
};
