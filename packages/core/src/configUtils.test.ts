import { describe, it, expect } from 'vitest';

import { deepMerge, isPlainObject } from './configUtils';

describe('deepMerge', () => {
  it('merges nested plain objects key-by-key', () => {
    const base = { a: 1, nested: { x: 1, y: 2 } };
    const merged = deepMerge(base, { nested: { y: 9 } });
    expect(merged).toEqual({ a: 1, nested: { x: 1, y: 9 } });
  });

  it('skips undefined override values (base wins)', () => {
    const merged = deepMerge({ a: 1, b: 2 }, { b: undefined });
    expect(merged).toEqual({ a: 1, b: 2 });
  });

  it('replaces arrays wholesale, never merges them', () => {
    const merged = deepMerge({ list: [1, 2, 3] }, { list: [9] });
    expect(merged).toEqual({ list: [9] });
  });

  //? Regression (CORE-09): a `__proto__` key in the override must NOT reassign
  //? the prototype of the result or pollute Object.prototype.
  it('does not pollute the prototype via a __proto__ key', () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}}') as object as Record<string, unknown>;
    const merged: Record<string, unknown> = deepMerge({ a: 1 }, malicious);
    expect(merged.a).toBe(1);
    const probe: Record<string, unknown> = {};
    expect(probe.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });

  //? CORE-N5: only `__proto__` is blocked (it can silently mutate the prototype
  //? chain via spread/assign). `constructor` and `prototype` are valid config key
  //? names and must be copied through; blocking them silently dropped legitimate
  //? consumer config (CORE-N5 fix).
  it('copies constructor/prototype keys (only __proto__ is blocked — CORE-N5)', () => {
    const override: Record<string, unknown> = { constructor: 'legit', prototype: 'legit' };
    const merged: Record<string, unknown> = deepMerge<Record<string, unknown>>({ safe: true }, override);
    expect(merged.safe).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(merged, 'constructor')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(merged, 'prototype')).toBe(true);
    expect(merged.constructor).toBe('legit');
    expect(merged.prototype).toBe('legit');
  });
});

describe('isPlainObject', () => {
  it('accepts object literals and null-prototype objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it('rejects arrays, null, and class instances', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
  });
});
