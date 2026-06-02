import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { sampleSchemaInput } from './schemaSampleInput';

//? `sampleSchemaInput` walks a Zod schema's `_def` and returns a minimal,
//? deterministic value the contract/fuzz layers can post as "valid input".
//? Tests build real Zod schemas (the same surface the generator emits) and
//? assert both the produced sample AND that the sample actually parses.
//? Using `z.parse` as the oracle means each assertion is meaningful: the
//? walker's output must satisfy the very schema it was derived from.

describe('sampleSchemaInput', () => {
  describe('primitives', () => {
    it('returns "test" for a string schema', () => {
      const sample = sampleSchemaInput(z.string());
      expect(sample).toBe('test');
      expect(() => z.string().parse(sample)).not.toThrow();
    });

    it('returns 0 for a number schema', () => {
      const sample = sampleSchemaInput(z.number());
      expect(sample).toBe(0);
      expect(z.number().parse(sample)).toBe(0);
    });

    it('returns false for a boolean schema', () => {
      const sample = sampleSchemaInput(z.boolean());
      expect(sample).toBe(false);
      expect(z.boolean().parse(sample)).toBe(false);
    });

    it('returns null for a null schema', () => {
      expect(sampleSchemaInput(z.null())).toBeNull();
    });

    it('returns undefined for an undefined schema', () => {
      expect(sampleSchemaInput(z.undefined())).toBeUndefined();
    });

    it('returns null for any / unknown schemas', () => {
      expect(sampleSchemaInput(z.any())).toBeNull();
      expect(sampleSchemaInput(z.unknown())).toBeNull();
    });
  });

  describe('literals and unions', () => {
    it('returns the literal value for a literal schema', () => {
      const sample = sampleSchemaInput(z.literal('PENDING'));
      expect(sample).toBe('PENDING');
      expect(z.literal('PENDING').parse(sample)).toBe('PENDING');
    });

    it('returns a numeric literal value verbatim', () => {
      expect(sampleSchemaInput(z.literal(42))).toBe(42);
    });

    it('samples the first option of a union', () => {
      const schema = z.union([z.string(), z.number()]);
      const sample = sampleSchemaInput(schema);
      expect(sample).toBe('test');
      expect(() => schema.parse(sample)).not.toThrow();
    });

    it('samples the first option even when later options are objects', () => {
      const schema = z.union([z.literal('a'), z.object({ x: z.number() })]);
      expect(sampleSchemaInput(schema)).toBe('a');
    });
  });

  describe('optionals and nullables', () => {
    it('returns undefined for an optional schema', () => {
      expect(sampleSchemaInput(z.string().optional())).toBeUndefined();
    });

    it('returns undefined for a nullable schema', () => {
      expect(sampleSchemaInput(z.string().nullable())).toBeUndefined();
    });
  });

  describe('arrays and records', () => {
    it('returns an empty array for an array schema', () => {
      const sample = sampleSchemaInput(z.array(z.string()));
      expect(sample).toEqual([]);
      expect(() => z.array(z.string()).parse(sample)).not.toThrow();
    });

    it('returns an empty object for a record schema', () => {
      const schema = z.record(z.string(), z.number());
      const sample = sampleSchemaInput(schema);
      expect(sample).toEqual({});
      expect(() => schema.parse(sample)).not.toThrow();
    });
  });

  describe('dates', () => {
    it('returns an ISO date string for a date schema', () => {
      const sample = sampleSchemaInput(z.date());
      expect(typeof sample).toBe('string');
      expect(Number.isNaN(Date.parse(sample as string))).toBe(false);
    });
  });

  describe('objects', () => {
    it('returns {} for an empty object schema', () => {
      expect(sampleSchemaInput(z.object({}))).toEqual({});
    });

    it('fills required fields with their sampled values', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
        active: z.boolean(),
      });
      const sample = sampleSchemaInput(schema);
      expect(sample).toEqual({ name: 'test', age: 0, active: false });
      expect(() => schema.parse(sample)).not.toThrow();
    });

    it('omits optional fields rather than emitting undefined keys', () => {
      const schema = z.object({
        required: z.string(),
        maybe: z.string().optional(),
      });
      const sample = sampleSchemaInput(schema) as Record<string, unknown>;
      expect(sample).toEqual({ required: 'test' });
      expect(Object.prototype.hasOwnProperty.call(sample, 'maybe')).toBe(false);
      expect(() => schema.parse(sample)).not.toThrow();
    });

    it('recurses into nested objects', () => {
      const schema = z.object({
        outer: z.object({ inner: z.string() }),
        count: z.number(),
      });
      const sample = sampleSchemaInput(schema);
      expect(sample).toEqual({ outer: { inner: 'test' }, count: 0 });
      expect(() => schema.parse(sample)).not.toThrow();
    });

    it('produces a parseable sample for an object containing an array of literals', () => {
      const schema = z.object({
        ids: z.array(z.number()),
        kind: z.literal('vehicle'),
      });
      const sample = sampleSchemaInput(schema);
      expect(sample).toEqual({ ids: [], kind: 'vehicle' });
      expect(() => schema.parse(sample)).not.toThrow();
    });
  });

  describe('determinism', () => {
    it('returns an equal value on repeated calls for the same schema', () => {
      const schema = z.object({ name: z.string(), tags: z.array(z.string()) });
      expect(sampleSchemaInput(schema)).toEqual(sampleSchemaInput(schema));
    });
  });

  describe('fallback', () => {
    it('returns null for an unrecognised schema kind', () => {
      //? `z.bigint()` is not in the handled switch; the walker hits the
      //? `default` arm and returns null rather than throwing.
      expect(sampleSchemaInput(z.bigint())).toBeNull();
    });
  });
});
