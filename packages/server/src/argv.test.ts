import { describe, it, expect } from 'vitest';

import { parseServerArgv } from './argv';

//? `parseServerArgv` is the pure half of the argv module — no env writeback,
//? no idempotency latch, no `process.argv` read. `applyServerArgv` and the
//? `getParsed*` accessors are intentionally NOT covered here: they share
//? module-level mutable state (`hasRun` latch + `process.env.SERVER_PORT`
//? writeback) that only behaves correctly on first call per process, which
//? makes deterministic per-test assertions impossible without resetting
//? module state the module deliberately does not expose.

describe('parseServerArgv', () => {
  describe('bundles parsing', () => {
    it('returns an empty bundle list when no positional args are given', () => {
      expect(parseServerArgv([])).toEqual({ bundles: [], port: null });
    });

    it('treats an empty-string first arg as no bundles', () => {
      expect(parseServerArgv([''])).toEqual({ bundles: [], port: null });
    });

    it('parses a single bundle', () => {
      expect(parseServerArgv(['billing'])).toEqual({ bundles: ['billing'], port: null });
    });

    it('splits a comma-separated bundle list', () => {
      expect(parseServerArgv(['billing,vehicles'])).toEqual({
        bundles: ['billing', 'vehicles'],
        port: null,
      });
    });

    it('trims surrounding whitespace from each bundle', () => {
      expect(parseServerArgv([' billing , vehicles '])).toEqual({
        bundles: ['billing', 'vehicles'],
        port: null,
      });
    });

    it('drops empty segments produced by stray commas', () => {
      expect(parseServerArgv(['billing,,vehicles,'])).toEqual({
        bundles: ['billing', 'vehicles'],
        port: null,
      });
    });

    it('deduplicates repeated bundle names while preserving first-seen order', () => {
      expect(parseServerArgv(['billing,vehicles,billing'])).toEqual({
        bundles: ['billing', 'vehicles'],
        port: null,
      });
    });
  });

  describe('port parsing', () => {
    it('parses a numeric port into a number', () => {
      const result = parseServerArgv(['billing', '4001']);
      expect(result.port).toBe(4001);
      expect(result.bundles).toEqual(['billing']);
    });

    it('leaves port null when the second arg is omitted', () => {
      expect(parseServerArgv(['billing']).port).toBeNull();
    });

    it('parses a port even when the bundle arg is an empty string', () => {
      expect(parseServerArgv(['', '8080'])).toEqual({ bundles: [], port: 8080 });
    });

    it('throws when the port arg is non-numeric', () => {
      expect(() => parseServerArgv(['billing', 'notaport'])).toThrow(
        /port argument must be numeric/,
      );
    });

    it('throws when the port arg mixes digits and letters', () => {
      expect(() => parseServerArgv(['billing', '40a1'])).toThrow(
        /port argument must be numeric/,
      );
    });

    it('treats an explicit empty-string port arg as non-numeric', () => {
      //? `''` is `!== undefined`, so it reaches the PORT_PATTERN guard and
      //? fails the `^\d+$` test rather than being skipped.
      expect(() => parseServerArgv(['billing', ''])).toThrow(
        /port argument must be numeric/,
      );
    });
  });

  describe('arity validation', () => {
    it('throws when more than two positional args are supplied', () => {
      expect(() => parseServerArgv(['billing', '4001', 'extra'])).toThrow(
        /unexpected positional argument/,
      );
    });

    it('includes the offending extra args in the error message', () => {
      expect(() => parseServerArgv(['billing', '4001', 'extra', 'more'])).toThrow(
        /extra more/,
      );
    });

    it('validates arity before port format', () => {
      //? Three args short-circuit on the length guard, so a bad port in
      //? slot 1 never reaches the PORT_PATTERN check.
      expect(() => parseServerArgv(['billing', 'notaport', 'extra'])).toThrow(
        /unexpected positional argument/,
      );
    });
  });
});
