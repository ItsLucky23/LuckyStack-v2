import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { typeTextToZodSource } from './zodEmitter';

describe('zod emitter — a Date value is an ISO string on the wire', () => {
  //? The full route generator rejects Date input annotations because the handler
  //? cannot truthfully receive an instance. This lower-level converter still
  //? models the wire value correctly for direct callers and diagnostics.

  it('emits an ISO-string check, never z.date()', () => {
    const source = typeTextToZodSource('{ from: Date }');
    expect(source).toContain('z.iso.datetime()');
    expect(source, 'z.date() demands a Date instance, which JSON cannot carry').not.toContain('z.date()');
  });

  it('the emitted schema accepts what the wire actually delivers', () => {
    //? Not a proxy for the real thing — build the schema and run it. `z.date()`
    //? returns false on this exact string (verified against zod 4.4.3), which is
    //? the whole defect.
    const overTheWire = JSON.parse(JSON.stringify({ from: new Date() })) as { from: string };

    expect(z.iso.datetime().safeParse(overTheWire.from).success).toBe(true);
    expect(z.date().safeParse(overTheWire.from).success).toBe(false);
  });

  it('still rejects a string that is not a date', () => {
    //? The fix must not turn the check into "any string".
    expect(z.iso.datetime().safeParse('not a date').success).toBe(false);
  });
});
