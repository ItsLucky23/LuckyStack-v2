import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'node:http';

import {
  BASE_HOP_BY_HOP_HEADERS,
  HTTP_HOP_BY_HOP_HEADERS,
  WS_HOP_BY_HOP_HEADERS,
  stripHopByHopHeaders,
  extractConnectionTokens,
  stripForwardedHeaders,
  isOriginFormTarget,
  isHostPinned,
  normalizeForwardedProto,
  createTrustedProxyMatcher,
  resolveForwardedProto,
  buildForwardedFor,
} from './proxyUtils';
import { URL } from 'node:url';

//? Proxy-parity: the HTTP and WS proxies share the same `proxyUtils` helpers.
//? These tests pin the invariants BOTH proxies rely on so divergence between
//? the two transport implementations is detected at the unit level before it
//? reaches an integration test.

const fakeHeaders = (headers: Record<string, string | string[]>): IncomingMessage['headers'] =>
  headers as IncomingMessage['headers'];

// ---------------------------------------------------------------------------
// isOriginFormTarget — shared by both proxies for SSRF prevention
// ---------------------------------------------------------------------------
describe('isOriginFormTarget (shared by HTTP + WS proxy)', () => {
  it('accepts a bare slash', () => {
    expect(isOriginFormTarget('/')).toBe(true);
  });

  it('accepts a normal origin-form path', () => {
    expect(isOriginFormTarget('/api/vehicles/getAll')).toBe(true);
  });

  it('rejects an absolute-form target (SSRF)', () => {
    expect(isOriginFormTarget('http://attacker.example:9999/path')).toBe(false);
  });

  it('rejects a protocol-relative target (// host)', () => {
    expect(isOriginFormTarget('//attacker.example/path')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isOriginFormTarget('')).toBe(false);
  });

  it('rejects a path that does not start with /', () => {
    expect(isOriginFormTarget('relative/path')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractConnectionTokens — dynamic hop-by-hop stripping (ROUTER-O18)
// ---------------------------------------------------------------------------
describe('extractConnectionTokens', () => {
  it('returns an empty set when Connection header is absent', () => {
    expect(extractConnectionTokens(fakeHeaders({}))).toEqual(new Set());
  });

  it('returns the lowercased token from a single-value Connection header', () => {
    const result = extractConnectionTokens(fakeHeaders({ connection: 'close' }));
    expect(result).toEqual(new Set(['close']));
  });

  it('parses multiple comma-separated tokens', () => {
    const result = extractConnectionTokens(
      fakeHeaders({ connection: 'Keep-Alive, X-My-Token' }),
    );
    expect(result).toEqual(new Set(['keep-alive', 'x-my-token']));
  });

  it('handles an array Connection header value', () => {
    const result = extractConnectionTokens(
      fakeHeaders({ connection: ['Upgrade', 'x-bearer-nonce'] }),
    );
    //? Both tokens must be caught regardless of multi-value shape.
    expect(result.has('upgrade')).toBe(true);
    expect(result.has('x-bearer-nonce')).toBe(true);
  });

  it('ignores empty tokens from trailing commas', () => {
    const result = extractConnectionTokens(fakeHeaders({ connection: 'close,' }));
    expect(result).toEqual(new Set(['close']));
  });
});

// ---------------------------------------------------------------------------
// stripHopByHopHeaders — parity: both proxies strip the same headers
// ---------------------------------------------------------------------------
describe('stripHopByHopHeaders (parity: HTTP and WS proxies must agree)', () => {
  it('strips all BASE_HOP_BY_HOP_HEADERS keys', () => {
    const headers = fakeHeaders({
      connection: 'close',
      'keep-alive': 'timeout=5',
      'proxy-authenticate': 'Basic realm="proxy"',
      'proxy-authorization': 'Basic dXNlcjpwYXNz',
      te: 'trailers',
      trailer: 'Expires',
      'transfer-encoding': 'chunked',
      'x-custom': 'preserved',
    });
    const result = stripHopByHopHeaders(headers, BASE_HOP_BY_HOP_HEADERS);
    //? None of the base hop-by-hop headers survive.
    for (const key of BASE_HOP_BY_HOP_HEADERS) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result['x-custom']).toBe('preserved');
  });

  it('HTTP set also strips upgrade', () => {
    const headers = fakeHeaders({ upgrade: 'websocket', 'x-app': 'ok' });
    const result = stripHopByHopHeaders(headers, HTTP_HOP_BY_HOP_HEADERS);
    expect(result).not.toHaveProperty('upgrade');
    expect(result['x-app']).toBe('ok');
  });

  it('WS set keeps upgrade for the handshake', () => {
    const headers = fakeHeaders({ upgrade: 'websocket', 'x-app': 'ok' });
    const result = stripHopByHopHeaders(headers, WS_HOP_BY_HOP_HEADERS);
    //? WS hop-by-hop set omits 'upgrade' so the handshake header passes through.
    expect(result['upgrade']).toBe('websocket');
  });

  it('strips a dynamic Connection-token (ROUTER-O18 parity)', () => {
    //? A client injects `x-bearer-nonce` as a Connection token. Both proxies
    //? must strip it so it never reaches the upstream.
    const headers = fakeHeaders({
      connection: 'x-bearer-nonce',
      'x-bearer-nonce': 'secret-value',
      'x-safe': 'preserved',
    });
    const result = stripHopByHopHeaders(headers, BASE_HOP_BY_HOP_HEADERS);
    expect(result).not.toHaveProperty('x-bearer-nonce');
    expect(result['x-safe']).toBe('preserved');
  });
});

// ---------------------------------------------------------------------------
// stripForwardedHeaders — shared security gate for XFF / proto spoofing
// ---------------------------------------------------------------------------
describe('stripForwardedHeaders (shared by HTTP + WS proxy)', () => {
  it('strips x-forwarded-for', () => {
    const result = stripForwardedHeaders({ 'x-forwarded-for': '1.2.3.4', 'x-other': 'ok' });
    expect(result).not.toHaveProperty('x-forwarded-for');
    expect(result['x-other']).toBe('ok');
  });

  it('strips x-forwarded-proto', () => {
    const result = stripForwardedHeaders({ 'x-forwarded-proto': 'https', accept: 'text/html' });
    expect(result).not.toHaveProperty('x-forwarded-proto');
    expect(result['accept']).toBe('text/html');
  });

  it('strips x-luckystack-* internal markers', () => {
    const result = stripForwardedHeaders({
      'x-luckystack-resolved-env': 'staging',
      'x-luckystack-via-fallback': '1',
      'x-safe': 'ok',
    });
    expect(result).not.toHaveProperty('x-luckystack-resolved-env');
    expect(result).not.toHaveProperty('x-luckystack-via-fallback');
    expect(result['x-safe']).toBe('ok');
  });

  it('strips x-real-ip', () => {
    const result = stripForwardedHeaders({ 'x-real-ip': '10.0.0.1', 'content-type': 'application/json' });
    expect(result).not.toHaveProperty('x-real-ip');
  });

  it('strips forwarded (RFC 7239)', () => {
    const result = stripForwardedHeaders({ forwarded: 'for=1.2.3.4', host: 'example.com' });
    expect(result).not.toHaveProperty('forwarded');
    expect(result['host']).toBe('example.com');
  });
});

// ---------------------------------------------------------------------------
// isHostPinned — shared SSRF guard used by both proxies
// ---------------------------------------------------------------------------
describe('isHostPinned (shared SSRF guard)', () => {
  it('returns true when protocol + host match exactly', () => {
    expect(isHostPinned(new URL('http://127.0.0.1:4001/api/foo'), 'http://127.0.0.1:4001')).toBe(true);
  });

  it('returns false when the host diverges', () => {
    expect(isHostPinned(new URL('http://attacker.example/api/foo'), 'http://127.0.0.1:4001')).toBe(false);
  });

  it('returns false when the protocol diverges', () => {
    expect(isHostPinned(new URL('https://127.0.0.1:4001/api/foo'), 'http://127.0.0.1:4001')).toBe(false);
  });

  it('returns false on an unparseable backend target', () => {
    expect(isHostPinned(new URL('http://127.0.0.1:4001/path'), 'not a url')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeForwardedProto — parity: same scheme normalization on both paths
// ---------------------------------------------------------------------------
describe('normalizeForwardedProto (shared by HTTP + WS proxy)', () => {
  it('passes https through', () => {
    expect(normalizeForwardedProto('https')).toBe('https');
  });

  it('passes http through', () => {
    expect(normalizeForwardedProto('http')).toBe('http');
  });

  it('collapses an attacker-supplied scheme to http', () => {
    expect(normalizeForwardedProto('ftp')).toBe('http');
  });

  it('handles undefined as http', () => {
    expect(normalizeForwardedProto(undefined)).toBe('http');
  });

  it('takes the first value from an array', () => {
    expect(normalizeForwardedProto(['https', 'http'])).toBe('https');
  });
});

describe('trusted x-forwarded-proto boundary', () => {
  it('ignores a direct client claiming https when no proxy is trusted', () => {
    expect(resolveForwardedProto('https', '203.0.113.42')).toBe('http');
  });

  it('honors https only when the immediate peer matches an explicit CIDR', () => {
    const trusted = createTrustedProxyMatcher(['10.20.0.0/16', '2001:db8::/32']);
    expect(resolveForwardedProto('https', '10.20.4.8', trusted)).toBe('https');
    expect(resolveForwardedProto('https', '10.21.4.8', trusted)).toBe('http');
    expect(resolveForwardedProto('https', '2001:db8::42', trusted)).toBe('https');
  });

  it('normalizes IPv4-mapped IPv6 peer addresses before matching', () => {
    const trusted = createTrustedProxyMatcher(['127.0.0.1/32']);
    expect(resolveForwardedProto('https', '::ffff:127.0.0.1', trusted)).toBe('https');
  });

  it('fails router boot configuration on malformed CIDRs', () => {
    expect(() => createTrustedProxyMatcher(['10.0.0.0/99'])).toThrow('invalid trusted proxy');
    expect(() => createTrustedProxyMatcher(['not-an-ip'])).toThrow('invalid trusted proxy');
  });
});

// ---------------------------------------------------------------------------
// buildForwardedFor — parity: consistent XFF value
// ---------------------------------------------------------------------------
describe('buildForwardedFor (shared by HTTP + WS proxy)', () => {
  it('returns the remote address when available', () => {
    expect(buildForwardedFor('203.0.113.42')).toBe('203.0.113.42');
  });

  it('returns an empty string when the address is undefined', () => {
    expect(buildForwardedFor(undefined)).toBe('');
  });
});
