import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getInputTypeDetailsFromFile, getOutputTypeDetailsFromFile } from './extractors';
import { getServerProgram } from './tsProgram';

//? DEPTH + BREADTH coverage for the wire projection, beyond the single 2-level
//? cycle in `wireProjection.test.ts`. The route returns a 3-level MikroORM graph
//? (Company -> Department -> Employee), each level a cycle, with a Date at every
//? level, a nullable self-relation, a scalar array, and relation collections.
//?
//? Why this matters: an expander that walks the deeper live-entity cycles can
//? re-introduce the `__@`-marker leak or the `EntityProperty` walk that DEVKIT-1
//? was about. Nested OBJECT projection is pinned separately by
//? wireProjectionOrmMatrix.test.ts using `EntityDTO<Loaded<...>>`; a live entity
//? serializes its relation collections as primary keys. Measured ground truth (real
//? MikroORM 6.6.14 EntityManager, `JSON.stringify` on the live graph):
//?
//?   {"departments":["d1"],"name":"Acme","createdAt":"2026-...Z","tags":["a","b"],"id":"c1"}
//?
//? i.e. relations serialize to primary keys and every `createdAt` is an ISO
//? string. The generated OUTPUT type must be consistent with that payload.

const FIXTURES = path.join(import.meta.dirname, '__fixtures__');
const DEEP_ROUTE = path.join(FIXTURES, 'mikroDeepRoute_v1.ts');
const EXTRACTION_TIMEOUT_MS = 120_000;

beforeAll(() => {
  //? Warm the memoized program (see wireProjection.test.ts for why).
  getServerProgram();
}, 180_000);

describe('wire projection — deep 3-level ORM graph', () => {
  it('projects each Date that survives the live entity\'s primary-key relation serialization', () => {
    const output = getOutputTypeDetailsFromFile(DEEP_ROUTE);
    expect(output.text).toContain('createdAt: string');
    //? NO Date may survive. Nested DTO Date fields are tested by the ORM matrix;
    //? this live entity sends relation primary keys rather than nested objects.
    expect(
      output.text,
      'a Date survived somewhere in the graph — a deeper level was not projected',
    ).not.toMatch(/createdAt:\s*Date\b/);
  }, EXTRACTION_TIMEOUT_MS);

  it('never emits a bare Date field anywhere in the output', () => {
    const output = getOutputTypeDetailsFromFile(DEEP_ROUTE);
    //? Broader than createdAt: no property of type Date may appear. `: Date` with
    //? a word boundary avoids matching `Date` inside a longer identifier.
    expect(output.text, 'a Date leaked into a client-facing type').not.toMatch(/:\s*Date\b/);
  }, EXTRACTION_TIMEOUT_MS);

  it('completes extraction without leaking an internal __@ marker', () => {
    //? DEVKIT-1's original symptom. The escaped internal name (`__@name@id`) is
    //? only printable by the structural path the expander skips; if it appears,
    //? the cycle guard or a symbol-less type slipped through.
    const output = getOutputTypeDetailsFromFile(DEEP_ROUTE);
    expect(output.text).not.toContain('__@');
  }, EXTRACTION_TIMEOUT_MS);

  it('does not drag MikroORM internals (EntityProperty / EntityMetadata) into the type', () => {
    //? The whole point of the projection: it never walks into an ORM internal,
    //? because those do not survive JSON.stringify. Their presence would mean the
    //? expander reached the entity's real machinery instead of its wire shape.
    const output = getOutputTypeDetailsFromFile(DEEP_ROUTE);
    expect(output.text).not.toContain('EntityProperty');
    expect(output.text).not.toContain('EntityMetadata');
    expect(output.text).not.toContain('EntityManager');
  }, EXTRACTION_TIMEOUT_MS);

  it('stays bounded — a 3-level cyclic graph must not explode the output', () => {
    //? DEVKIT-1's real-consumer shape hit 50,623 chars before the projection.
    //? A projection that accidentally walked the relations would balloon again.
    //? Generous ceiling: this is a regression tripwire, not a tight budget.
    const output = getOutputTypeDetailsFromFile(DEEP_ROUTE);
    expect(
      output.text.length,
      `output ballooned to ${String(output.text.length)} chars — the projection walked into the graph`,
    ).toBeLessThan(2000);
  }, EXTRACTION_TIMEOUT_MS);

  it('leaves the INPUT type unprojected (the load-bearing boundary)', () => {
    //? Same invariant as the shallow test: inputs feed the fail-closed prod
    //? validator and must keep their declared types.
    const input = getInputTypeDetailsFromFile(DEEP_ROUTE);
    expect(input.text).not.toContain('createdAt: string');
    expect(input.text).toContain('companyId');
  }, EXTRACTION_TIMEOUT_MS);
});
