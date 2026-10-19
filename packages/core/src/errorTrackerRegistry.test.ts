import { describe, expect, it } from 'vitest';

import { sanitizeErrorString } from './errorTrackerRegistry';

//? The free-text scrub is the only value-level redaction the tracker adapters
//? apply to error messages, stacks and captureMessage text. Each row is a shape
//? an upstream HTTP-client error can echo; the secret must not survive.
describe('sanitizeErrorString', () => {
  const cases: { name: string; input: string; secret: string }[] = [
    { name: 'URL parameter', input: 'GET /reset?token=abc123 failed', secret: 'abc123' },
    { name: 'log label', input: 'login failed password: hunter2', secret: 'hunter2' },
    { name: 'Bearer header', input: 'authorization: Bearer abc123SECRET', secret: 'abc123SECRET' },
    { name: 'Basic header', input: 'Authorization=Basic dXNlcjpwYXNz', secret: 'dXNlcjpwYXNz' },
    { name: 'JSON body', input: 'Request failed: {"password":"hunter2","token":"tok_live_9"}', secret: 'hunter2' },
    { name: 'second JSON key', input: 'Request failed: {"password":"hunter2","token":"tok_live_9"}', secret: 'tok_live_9' },
    { name: 'JSON with spaces', input: '{ "secret" : "s3cr3t value" }', secret: 's3cr3t' },
    { name: 'single-quoted value', input: "token: 'abc'", secret: 'abc' },
    { name: 'spaced assignment', input: 'password = hunter2', secret: 'hunter2' },
    { name: 'escaped quote inside JSON value', input: '{"password":"a\\"b-tail"}', secret: 'b-tail' },
    { name: 'snake-case URL parameter', input: 'GET /x?api_key=abc123', secret: 'abc123' },
    { name: 'header-case log label', input: 'x-api-key: abc123', secret: 'abc123' },
    { name: 'private key', input: 'private_key=abc', secret: 'abc' },
    { name: 'prefixed secret key', input: 'stripe_secret_key=sk_live_1', secret: 'sk_live_1' },
    { name: 'camel-case secret key', input: 'stripeSecretKey: sk_live_2', secret: 'sk_live_2' },
    { name: 'separated registered key', input: 'set_cookie: sid=abc', secret: 'abc' },
  ];

  for (const { name, input, secret } of cases) {
    it(`removes the secret from a ${name}`, () => {
      const result = sanitizeErrorString(input);
      expect(result).not.toContain(secret);
      expect(result).toContain('[redacted]');
    });
  }

  it('keeps text that carries no secret value', () => {
    expect(sanitizeErrorString('password=&next=1')).toBe('password=&next=1');
    expect(sanitizeErrorString('{"password":""}')).toBe('{"password":""}');
    expect(sanitizeErrorString('nothing sensitive here')).toBe('nothing sensitive here');
  });

  it('keeps ordinary words and non-secret keys', () => {
    const text = 'cache_key=abc idempotency-key: 42 tokenCount: 5 secretary=bob api: up key=1 private=no';
    expect(sanitizeErrorString(text)).toBe(text);
  });

  it.each([
    'api_'.repeat(20_000),
    'a-p-i-k-e-'.repeat(10_000),
    `token${' '.repeat(100_000)}`,
    'token="a'.repeat(20_000),
    "secret_key='".repeat(20_000),
    'stripe_secret_'.repeat(10_000),
  ])('scrubs a long adversarial input in linear time (%#)', (input) => {
    const start = performance.now();
    sanitizeErrorString(input);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
