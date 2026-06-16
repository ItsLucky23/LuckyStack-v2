import { describe, it, expect, vi } from 'vitest';

vi.mock('./loggerRegistry', () => ({
  getLogger: () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import { resolveClientIp, UNKNOWN_CLIENT_IP } from './resolveClientIp';

describe('resolveClientIp', () => {
  it('returns the raw peer address verbatim when trustProxy is off', () => {
    const resolved = resolveClientIp({
      rawAddress: '203.0.113.5',
      headers: { 'x-forwarded-for': '1.2.3.4' },
      trustProxy: false,
    });
    expect(resolved).toBe('203.0.113.5');
  });

  it('ignores XFF / X-Real-IP entirely when trustProxy is off (no spoofing)', () => {
    const resolved = resolveClientIp({
      rawAddress: '203.0.113.5',
      headers: { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '7.7.7.7' },
      trustProxy: false,
    });
    expect(resolved).toBe('203.0.113.5');
  });

  it('prefers the leftmost XFF hop when trustProxy is on', () => {
    const resolved = resolveClientIp({
      rawAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' },
      trustProxy: true,
    });
    expect(resolved).toBe('198.51.100.2');
  });

  it('handles a repeated XFF header (array form)', () => {
    const resolved = resolveClientIp({
      rawAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': ['198.51.100.9', '10.0.0.1'] },
      trustProxy: true,
    });
    expect(resolved).toBe('198.51.100.9');
  });

  it('falls back to X-Real-IP when XFF is absent (trustProxy on)', () => {
    const resolved = resolveClientIp({
      rawAddress: '10.0.0.1',
      headers: { 'x-real-ip': '198.51.100.3' },
      trustProxy: true,
    });
    expect(resolved).toBe('198.51.100.3');
  });

  it('strips the IPv4-mapped IPv6 prefix and lowercases IPv6', () => {
    expect(resolveClientIp({ rawAddress: '::ffff:1.2.3.4', headers: {}, trustProxy: false })).toBe('1.2.3.4');
    expect(resolveClientIp({ rawAddress: '2001:DB8::1', headers: {}, trustProxy: false })).toBe('2001:db8::1');
    expect(resolveClientIp({ rawAddress: 'fe80::1%eth0', headers: {}, trustProxy: false })).toBe('fe80::1');
  });

  it('returns the unknown sentinel when no address can be resolved', () => {
    expect(resolveClientIp({ rawAddress: null, headers: {}, trustProxy: false })).toBe(UNKNOWN_CLIENT_IP);
    expect(resolveClientIp({ rawAddress: undefined, headers: {}, trustProxy: true })).toBe(UNKNOWN_CLIENT_IP);
  });
});
