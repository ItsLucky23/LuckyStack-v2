import type { z } from 'zod';

//? Walk a Zod schema and produce a minimal valid value. Used by the
//? contract/fuzz runners so "valid input" tests don't require hand-written
//? fixtures per endpoint. Handles the shapes the generator emits
//? (primitives, literals, unions, optionals, objects, records, arrays).
//?
//? Not a property-based generator — returns the SAME deterministic value
//? every call. For randomized fuzz, swap to `fast-check` in a later session.

//? zod 4 renamed the internal def accessor from `._def` to `.def`; recurse
//? through whichever a child node exposes so the walker handles both versions.
const innerDef = (node: { _def?: unknown; def?: unknown } | undefined): unknown =>
  node ? (node.def ?? node._def) : undefined;

const sampleForDef = (def: unknown): unknown => {
  //? Zod stores its runtime shape on `_def.type` (v3) or `_def.typeName`.
  //? Access is untyped because `def` can be any of dozens of internal shapes.
  const d = def as {
    typeName?: string;
    type?: string;
    innerType?: { _def?: unknown; def?: unknown };
    values?: unknown[] | Record<string, unknown>;
    entries?: Record<string, unknown>;
    value?: unknown;
    options?: { _def?: unknown; def?: unknown }[];
    shape?: (() => Record<string, { _def?: unknown; def?: unknown }>) | Record<string, { _def?: unknown; def?: unknown }>;
    valueType?: { _def: unknown };
    element?: { _def: unknown };
    items?: { _def?: unknown; def?: unknown }[];
    schema?: { _def?: unknown; def?: unknown };
    in?: { _def?: unknown; def?: unknown };
  };

  const name = d.typeName ?? d.type;

  switch (name) {
    case 'ZodString':
    case 'string': {
      return 'test';
    }
    case 'ZodNumber':
    case 'number': {
      return 0;
    }
    case 'ZodBoolean':
    case 'boolean': {
      return false;
    }
    case 'ZodNull':
    case 'null': {
      return null;
    }
    case 'ZodUndefined':
    case 'undefined': {
      return undefined;
    }
    case 'ZodAny':
    case 'any':
    case 'ZodUnknown':
    case 'unknown': {
      return null;
    }
    case 'ZodLiteral':
    case 'literal': {
      //? zod 3 stores the literal on `_def.value`; zod 4 stores `_def.values` (array).
      return d.value ?? (Array.isArray(d.values) ? d.values[0] : undefined);
    }
    case 'ZodOptional':
    case 'optional':
    case 'ZodNullable':
    case 'nullable': {
      //? Omitting optional fields is the most conservative valid input.
      return undefined;
    }
    case 'ZodEnum':
    case 'enum':
    case 'ZodNativeEnum':
    case 'nativeEnum': {
      //? Return the first declared value so an enum-typed required field gets a
      //? VALID member rather than `null` (which the route's own Zod rejects,
      //? silently turning the contract probe into a validation-error test).
      //? zod 3 stores members on `_def.values` (array); zod 4 on `_def.entries`
      //? (object) or `_def.values` (Set/array).
      if (Array.isArray(d.values)) return d.values[0];
      const entries = d.entries ?? (d.values && !Array.isArray(d.values) ? d.values : undefined);
      if (entries) {
        const first = Object.values(entries)[0];
        if (first !== undefined) return first;
      }
      return undefined;
    }
    case 'ZodDefault':
    case 'default':
    case 'ZodCatch':
    case 'catch': {
      //? Unwrap to the inner schema's sample (the field is still required at the
      //? type level; the default only applies when omitted).
      return sampleForDef(innerDef(d.innerType));
    }
    case 'ZodEffects':
    case 'effects':
    case 'ZodPipeline':
    case 'pipe':
    case 'ZodBranded':
    case 'branded':
    case 'ZodReadonly':
    case 'readonly': {
      //? `.refine`/`.transform`/`.pipe`/`.brand`/`.readonly` wrap an inner
      //? schema — recurse into it. A `.refine` may still reject the sample, but
      //? recursing yields a structurally-valid base far more often than `null`.
      return sampleForDef(innerDef(d.schema ?? d.in ?? d.innerType));
    }
    case 'ZodTuple':
    case 'tuple': {
      const items = d.items ?? [];
      return items.map(item => sampleForDef(innerDef(item)));
    }
    case 'ZodUnion':
    case 'union':
    case 'ZodDiscriminatedUnion':
    case 'discriminatedUnion': {
      return d.options && d.options.length > 0 && d.options[0] ? sampleForDef(innerDef(d.options[0])) : undefined;
    }
    case 'ZodArray':
    case 'array': {
      return [];
    }
    case 'ZodObject':
    case 'object': {
      const out: Record<string, unknown> = {};
      //? zod 3 exposes `_def.shape` as a function; zod 4 as a plain object.
      const shape = typeof d.shape === 'function' ? d.shape() : (d.shape ?? {});
      for (const [key, valueSchema] of Object.entries(shape)) {
        const sample = sampleForDef(innerDef(valueSchema));
        if (sample !== undefined) out[key] = sample;
      }
      return out;
    }
    case 'ZodRecord':
    case 'record': {
      return {};
    }
    case 'ZodDate':
    case 'date': {
      return new Date().toISOString();
    }
    default: {
      //? Unknown node: OMIT (undefined) rather than emit `null`. A `null` for a
      //? required field of an unhandled type makes the route's own Zod reject
      //? the body, silently turning the "happy path" contract probe into a
      //? validation-error test. Omitting lets the object walker drop the key so
      //? the probe only fails if the field was genuinely required (a real,
      //? visible signal) instead of always.
      return undefined;
    }
  }
};

export const sampleSchemaInput = (schema: z.ZodType): unknown => {
  //? zod 4 renamed the public def accessor from `._def` to `.def`; fall back to
  //? `._def` (zod 3) so the top-level entry handles both, matching the
  //? recursive `innerDef` helper.
  const node = schema as { def?: unknown; _def?: unknown };
  return sampleForDef(node.def ?? node._def);
};
