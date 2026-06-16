import { describe, it, expect, afterEach } from 'vitest';

import {
  sanitizeForLog,
  registerRedactedLogKeys,
  resetRedactedLogKeysForTests,
  REDACTED_PLACEHOLDER,
  DEFAULT_REDACTED_LOG_KEYS,
  isRedactedLogKey,
} from './redactedLogKeys';

afterEach(() => {
  resetRedactedLogKeysForTests();
});

describe('sanitizeForLog (SYNC-17 defense-in-depth)', () => {
  it('redacts default sensitive keys at the top level', () => {
    const out = sanitizeForLog({ token: 'secret', name: 'ok' }) as Record<string, unknown>;
    expect(out.token).toBe(REDACTED_PLACEHOLDER);
    expect(out.name).toBe('ok');
  });

  it('redacts matching keys case-insensitively and nested', () => {
    const out = sanitizeForLog({
      level1: { Authorization: 'Bearer x', payload: { Password: 'p', keep: 1 } },
    }) as { level1: { Authorization: unknown; payload: { Password: unknown; keep: unknown } } };
    expect(out.level1.Authorization).toBe(REDACTED_PLACEHOLDER);
    expect(out.level1.payload.Password).toBe(REDACTED_PLACEHOLDER);
    expect(out.level1.payload.keep).toBe(1);
  });

  it('walks arrays, redacting sensitive keys inside elements', () => {
    const out = sanitizeForLog([{ token: 'a' }, { keep: 'b' }]) as { token?: unknown; keep?: unknown }[];
    expect(out).toHaveLength(2);
    expect(out[0]?.token).toBe(REDACTED_PLACEHOLDER);
    expect(out[1]?.keep).toBe('b');
  });

  it('does not mutate the input object', () => {
    const input = { token: 'secret' };
    sanitizeForLog(input);
    expect(input.token).toBe('secret');
  });

  it('honours keys registered at boot via registerRedactedLogKeys', () => {
    registerRedactedLogKeys(['apiKey']);
    const out = sanitizeForLog({ apiKey: 'k', other: 1 }) as Record<string, unknown>;
    expect(out.apiKey).toBe(REDACTED_PLACEHOLDER);
  });

  it('caps recursion depth without throwing on a cyclic graph', () => {
    const cyclic: Record<string, unknown> = { keep: 1 };
    cyclic.self = cyclic;
    expect(() => sanitizeForLog(cyclic)).not.toThrow();
  });

  it('passes primitives through unchanged', () => {
    expect(sanitizeForLog('plain')).toBe('plain');
    expect(sanitizeForLog(42)).toBe(42);
    expect(sanitizeForLog(null)).toBeNull();
  });

  it('exports the default redacted key set and matches via isRedactedLogKey', () => {
    expect(DEFAULT_REDACTED_LOG_KEYS).toContain('token');
    expect(isRedactedLogKey('TOKEN')).toBe(true);
  });

  it('seeds the 0.2.0 widened keys (csrfToken / apiKey / secret) as exact defaults', () => {
    expect(DEFAULT_REDACTED_LOG_KEYS).toEqual(
      expect.arrayContaining(['csrftoken', 'apikey', 'secret']),
    );
    expect(isRedactedLogKey('csrfToken')).toBe(true);
    expect(isRedactedLogKey('apiKey')).toBe(true);
    expect(isRedactedLogKey('Secret')).toBe(true);
  });

  it('redacts compound keys by sensitive suffix (targetToken / sessionToken / clientSecret)', () => {
    expect(isRedactedLogKey('targetToken')).toBe(true);
    expect(isRedactedLogKey('sessionToken')).toBe(true);
    expect(isRedactedLogKey('clientSecret')).toBe(true);
    expect(isRedactedLogKey('stripeApiKey')).toBe(true);
    expect(isRedactedLogKey('oldPassword')).toBe(true);
  });

  it('leaves non-sensitive keys untouched (no over-redaction)', () => {
    expect(isRedactedLogKey('name')).toBe(false);
    expect(isRedactedLogKey('email')).toBe(false);
    expect(isRedactedLogKey('userId')).toBe(false);
    expect(isRedactedLogKey('tokenCount')).toBe(false);
    expect(isRedactedLogKey('secretSanta')).toBe(false);
  });

  it('sanitizeForLog masks suffix-matched compound keys nested in a payload', () => {
    const out = sanitizeForLog({
      targetToken: 'abc',
      clientSecret: 'xyz',
      tokenCount: 7,
      user: { sessionToken: 'def', name: 'ok' },
    }) as Record<string, unknown> & { user: Record<string, unknown> };
    expect(out.targetToken).toBe(REDACTED_PLACEHOLDER);
    expect(out.clientSecret).toBe(REDACTED_PLACEHOLDER);
    expect(out.tokenCount).toBe(7);
    expect(out.user.sessionToken).toBe(REDACTED_PLACEHOLDER);
    expect(out.user.name).toBe('ok');
  });
});
