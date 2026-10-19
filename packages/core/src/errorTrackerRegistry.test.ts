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
});
