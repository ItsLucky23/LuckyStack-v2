import type { z } from 'zod';

//? Walk a Zod schema and produce a minimal valid value. Used by the
//? contract/fuzz runners so "valid input" tests don't require hand-written
//? fixtures per endpoint. Handles the shapes the generator emits
//? (primitives, literals, unions, optionals, objects, records, arrays).
//?
//? Not a property-based generator — returns the SAME deterministic value
//? every call. For randomized fuzz, swap to `fast-check` in a later session.

const sampleForDef = (def: unknown): unknown => {
  //? Zod stores its runtime shape on `_def.type` (v3) or `_def.typeName`.
  //? Access is untyped because `def` can be any of dozens of internal shapes.
  const d = def as { typeName?: string; type?: string; innerType?: { _def: unknown }; values?: unknown[]; value?: unknown; options?: { _def: unknown }[]; shape?: () => Record<string, { _def: unknown }>; valueType?: { _def: unknown }; element?: { _def: unknown } };

  const name = d.typeName ?? d.type;

  switch (name) {
    case 'ZodString':
    case 'string':
      return 'test';
    case 'ZodNumber':
    case 'number':
      return 0;
    case 'ZodBoolean':
    case 'boolean':
      return false;
    case 'ZodNull':
    case 'null':
      return null;
    case 'ZodUndefined':
    case 'undefined':
      return undefined;
    case 'ZodAny':
    case 'any':
    case 'ZodUnknown':
    case 'unknown':
      return null;
    case 'ZodLiteral':
    case 'literal':
      return d.value;
    case 'ZodOptional':
    case 'optional':
    case 'ZodNullable':
    case 'nullable':
      //? Omitting optional fields is the most conservative valid input.
      return undefined;
    case 'ZodUnion':
    case 'union':
      return d.options && d.options.length > 0 ? sampleForDef(d.options[0]._def) : null;
    case 'ZodArray':
    case 'array':
      return [];
    case 'ZodObject':
    case 'object': {
      const out: Record<string, unknown> = {};
      const shape = d.shape?.() ?? {};
      for (const [key, valueSchema] of Object.entries(shape)) {
        const sample = sampleForDef(valueSchema._def);
        if (sample !== undefined) out[key] = sample;
      }
      return out;
    }
    case 'ZodRecord':
    case 'record':
      return {};
    case 'ZodDate':
    case 'date':
      return new Date().toISOString();
    default:
      return null;
  }
};

export const sampleSchemaInput = (schema: z.ZodTypeAny): unknown => {
  return sampleForDef(schema._def);
};
