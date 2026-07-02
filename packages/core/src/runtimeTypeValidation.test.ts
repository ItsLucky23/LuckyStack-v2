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

  it('accepts a shallow value against an object type whose properties contain nested unions (union-depth regression)', async () => {
    //? Regression: an object type text that CONTAINS `|` INSIDE its properties but
    //? has NO top-level union must not enter the union branch and recurse on the
    //? IDENTICAL string, inflating `depth` on every pass until MAX_VALIDATION_DEPTH
    //? false-positives with a bogus "input nesting exceeds the maximum depth" on a
    //? perfectly shallow value. Before the fix, ANY route whose input type carried
    //? a union (e.g. a `theme: 'dark' | 'light'` field) always failed validation —
    //? and with `validation.runtimeMode: 'enforce'` the default, in production too.
    const typeText =
      "{ name?: undefined | string; theme?: undefined | 'dark' | 'light'; language?: undefined | 'nl' | 'en' | 'de' | 'fr'; avatar?: undefined | string }";

    const shallow = await validateInputByType({ typeText, value: { name: 'New Name' }, rootKey: 'data' });
    expect(shallow.status).toBe('success');

    //? The nested union is still ENFORCED: a valid member passes, an invalid one fails.
    const validMember = await validateInputByType({ typeText, value: { theme: 'dark' }, rootKey: 'data' });
    expect(validMember.status).toBe('success');
    const invalidMember = await validateInputByType({ typeText, value: { theme: 'purple' }, rootKey: 'data' });
    expect(invalidMember.status).toBe('error');
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
