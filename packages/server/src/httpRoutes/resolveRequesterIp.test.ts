import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

//? Characterization test pinning the EXACT pre-refactor behaviour of the
//? inline trustProxy + resolveClientIp block that previously lived in both
//? `apiRoute.ts` and `syncRoute.ts` (byte-identical). The real
//? `resolveClientIp` is kept (via `importActual`) so the canonicalization +
//? sentinel semantics are exercised end-to-end; only `getProjectConfig` is
//? mocked to flip `http.trustProxy`.
const { trustProxyRef } = vi.hoisted(() => ({ trustProxyRef: { value: false } }));

vi.mock('@luckystack/core', async () => {
  const actual = await vi.importActual<typeof import('@luckystack/core')>('@luckystack/core');
  return {
    ...actual,
    getProjectConfig: () => ({ http: { trustProxy: trustProxyRef.value } }),
  };
});

import { resolveRequesterIp } from './resolveRequesterIp';

const makeReq = (rawAddress: string | undefined, headers: IncomingHttpHeaders = {}): IncomingMessage =>
  ({ socket: { remoteAddress: rawAddress }, headers } as unknown as IncomingMessage);

beforeEach(() => {
  trustProxyRef.value = false;
});

describe('resolveRequesterIp — trustProxy false (default)', () => {
  it('returns the raw socket address verbatim', () => {
    expect(resolveRequesterIp(makeReq('203.0.113.7'))).toBe('203.0.113.7');
  });

  it('canonicalizes an IPv4-mapped IPv6 socket address', () => {
    expect(resolveRequesterIp(makeReq('::ffff:203.0.113.7'))).toBe('203.0.113.7');
  });

  it('IGNORES forwarded headers when trustProxy is false', () => {
    const ip = resolveRequesterIp(makeReq('203.0.113.7', { 'x-forwarded-for': '1.2.3.4' }));
    expect(ip).toBe('203.0.113.7');
  });

  it('returns undefined (NOT the "unknown" sentinel) when there is no address and no trusted header', () => {
    expect(resolveRequesterIp(makeReq(undefined))).toBeUndefined();
  });

  it('returns undefined even when a forwarded header is present but trustProxy is false', () => {
    expect(resolveRequesterIp(makeReq(undefined, { 'x-forwarded-for': '1.2.3.4' }))).toBeUndefined();
  });
});

describe('resolveRequesterIp — trustProxy true', () => {
  beforeEach(() => {
    trustProxyRef.value = true;
  });

  //? CORE-O3: XFF resolution now counts from the RIGHT (trusted-proxy hop), not
  //? the leftmost client-controlled hop. With trustedProxyHopCount=1 (default)
  //? the resolved IP is hops[length-1] — the immediate upstream proxy entry.
  it('prefers the rightmost X-Forwarded-For hop (trusted-proxy semantics, CORE-O3)', () => {
    const ip = resolveRequesterIp(makeReq('10.0.0.1', { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }));
    expect(ip).toBe('10.0.0.1');
  });

  it('falls back to X-Real-IP when no X-Forwarded-For', () => {
    const ip = resolveRequesterIp(makeReq('10.0.0.1', { 'x-real-ip': '198.51.100.9' }));
    expect(ip).toBe('198.51.100.9');
  });

  it('resolves via the forwarded header even when the raw socket address is absent', () => {
    const ip = resolveRequesterIp(makeReq(undefined, { 'x-forwarded-for': '203.0.113.7' }));
    expect(ip).toBe('203.0.113.7');
  });

  it('falls back to the raw socket address when no forwarded headers are present', () => {
    expect(resolveRequesterIp(makeReq('10.0.0.1'))).toBe('10.0.0.1');
  });
});
