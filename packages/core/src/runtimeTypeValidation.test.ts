import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { validateInputByType } from './runtimeTypeValidation';
import { registerProjectConfig } from './projectConfig';

const originalNodeEnv = process.env.NODE_ENV;

describe('validateInputByType — production enforce wiring (CORE-01)', () => {
  beforeEach(() => {
    registerProjectConfig({});
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    registerProjectConfig({});
  });

  it("validates the resolved type text in production by default ('enforce')", async () => {
    const ok = await validateInputByType({
      typeText: '{ name: string; count: number }',
      value: { name: 'a', count: 1 },
      rootKey: 'data',
    });
    expect(ok.status).toBe('success');

    const bad = await validateInputByType({
      typeText: '{ name: string; count: number }',
      value: { name: 'a', count: 'not-a-number' },
      rootKey: 'data',
    });
    expect(bad.status).toBe('error');
  });

  it("becomes a no-op in production when validation.runtimeMode is 'off'", async () => {
    registerProjectConfig({ validation: { runtimeMode: 'off' } });
    const result = await validateInputByType({
      typeText: '{ name: string }',
      value: { name: 123 },
      rootKey: 'data',
    });
    expect(result.status).toBe('success');
  });

  it('still short-circuits empty / any type text to success', async () => {
    const empty = await validateInputByType({ typeText: '', value: 1, rootKey: 'data' });
    const anyType = await validateInputByType({ typeText: 'any', value: 1, rootKey: 'data' });
    expect(empty.status).toBe('success');
    expect(anyType.status).toBe('success');
  });
});

describe('validateInputByType — fail-closed hardening', () => {
  beforeEach(() => {
    registerProjectConfig({});
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    registerProjectConfig({});
  });

  it('FAILS CLOSED on an unrecognized/unvalidatable terminal type', async () => {
    //? A function type the recognizers can't structurally validate must NOT
    //? silently pass any value (the former fail-open).
    const result = await validateInputByType({
      typeText: '() => void',
      value: { anything: true },
      rootKey: 'data',
    });
    expect(result.status).toBe('error');
  });

  it('validates Record<K, V> values (no longer accepts any object)', async () => {
    const ok = await validateInputByType({
      typeText: 'Record<string, number>',
      value: { a: 1, b: 2 },
      rootKey: 'data',
    });
    expect(ok.status).toBe('success');

    const bad = await validateInputByType({
      typeText: 'Record<string, number>',
      value: { a: '<script>' },
      rootKey: 'data',
    });
    expect(bad.status).toBe('error');
  });

  it('rejects prototype-pollution keys in a Record', async () => {
    const result = await validateInputByType({
      typeText: 'Record<string, string>',
      value: JSON.parse('{"__proto__": {"polluted": "yes"}}') as unknown,
      rootKey: 'data',
    });
    expect(result.status).toBe('error');
  });

  it('rejects prototype-pollution keys admitted by an index signature', async () => {
    const result = await validateInputByType({
      typeText: '{ [key: string]: string }',
      value: JSON.parse('{"__proto__": "x"}') as unknown,
      rootKey: 'data',
    });
    expect(result.status).toBe('error');
  });

  it('returns a clean error (never throws / blows the stack) on deeply-nested input', async () => {
    let nested: unknown = 0;
    for (let i = 0; i < 5000; i += 1) nested = [nested];
    const result = await validateInputByType({
      typeText: 'number[][]',
      value: nested,
      rootKey: 'data',
    });
    //? The validator must settle with a validation error, not propagate a
    //? throw or overflow the stack (the recursion-depth guard backstops a
    //? pathological generated type; a fixed shallow type fails fast).
    expect(result.status).toBe('error');
  });
});
