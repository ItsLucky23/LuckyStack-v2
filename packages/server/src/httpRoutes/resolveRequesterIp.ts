import type { IncomingMessage } from 'node:http';
import { getProjectConfig, resolveClientIp } from '@luckystack/core';

/**
 * Resolve the real client IP for per-IP rate limiting on the HTTP api/sync
 * transports.
 *
 * Extracted verbatim from the previously-duplicated inline block in
 * `apiRoute.ts` and `syncRoute.ts` (both were byte-identical). Behaviour is
 * preserved exactly:
 *
 * - Reads `http.trustProxy` from the active project config. Default
 *   `trustProxy: false` returns the raw `req.socket.remoteAddress` (with only
 *   IPv4-mapped IPv6 canonicalization via `resolveClientIp`); a trusted proxy
 *   honours `X-Forwarded-For` / `X-Real-IP`.
 * - Preserves the historical `undefined` fallback when there is genuinely no
 *   address to resolve (no raw socket address AND — when proxied — no trusted
 *   forwarded header), so downstream `?? 'anonymous'` / `?? 'unknown'`
 *   bucketing stays byte-identical. This `undefined` short-circuit is the
 *   reason this helper exists rather than calling `resolveClientIp` directly:
 *   `resolveClientIp` would return the `'unknown'` sentinel here, which the
 *   api/sync transports historically did NOT key on.
 *
 * NOTE: the `/auth/api` route intentionally does NOT use this helper — it
 * keys on `resolveClientIp(...)` unconditionally (returning the `'unknown'`
 * sentinel when nothing resolves), which is a different, deliberate
 * contract. Unifying the two would change behaviour, so it is left as-is.
 */
export const resolveRequesterIp = (req: IncomingMessage): string | undefined => {
  const trustProxy = getProjectConfig().http.trustProxy;
  const rawRemoteAddress = req.socket.remoteAddress;
  return (rawRemoteAddress || (trustProxy && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])))
    ? resolveClientIp({ rawAddress: rawRemoteAddress, headers: req.headers, trustProxy })
    : undefined;
};
