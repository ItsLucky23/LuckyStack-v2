import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

//? DEVKIT-1, blast radius. `tsProgram.test.ts` proves `expandTypeDetailed` no
//? longer THROWS on a decorator-based MikroORM entity. This file answers the
//? question a consumer actually cares about: what does the generator DO about
//? it?
//?
//? BEFORE the fix: `extractors.ts` wraps every extraction in try/catch, so the
//? throw was swallowed into a `console.error` and the route's payload type
//? silently degraded to the `{ status: string }` DEFAULT — the entire `result`
//? shape lost. AFTER: the real shape is extracted. These tests pin that, plus
//? the diagnostics seam that makes any FUTURE swallowed throw visible.

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const ROUTE = path.join(FIXTURE_DIR, 'mikroRoute_v1.ts');

//? Point the extractors at the fixture program instead of the repo's server
//? program. Built lazily INSIDE the factory: vi.mock is hoisted above the module
//? body, so anything it closes over from module scope would be in the TDZ.
//? `expandTypeDetailed` and the rest stay REAL — only the program source is
//? swapped, so this exercises the true extraction path.
vi.mock('./tsProgram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tsProgram')>();
  const ts = await import('typescript');
  const nodePath = await import('node:path');
  const dir = nodePath.default.join(
    nodePath.default.dirname(fileURLToPath(import.meta.url)),
    '__fixtures__',
  );

  let program: import('typescript').Program | undefined;
  return {
    ...actual,
    getServerProgram: () => {
      if (!program) {
        const cfgPath = nodePath.default.join(dir, 'tsconfig.json');
        const { config } = ts.readConfigFile(cfgPath, ts.sys.readFile.bind(ts.sys));
        const { options, fileNames } = ts.parseJsonConfigFileContent(config, ts.sys, dir);
        program = ts.createProgram(fileNames, options);
      }
      return program;
    },
  };
});

const { getInputTypeDetailsFromFile, getOutputTypeDetailsFromFile } = await import('./extractors');
const { getServerProgram } = await import('./tsProgram');
const { getExtractionFailures, clearExtractionFailures, recordExtractionOutcome, findExtractionFailure } = await import('./extractionDiagnostics');

//? Warm the (memoized) fixture program here rather than letting whichever test
//? runs first pay for it — under full-suite CPU contention that build exceeds
//? vitest's 5s default timeout and makes this file flaky by run order.
beforeAll(() => {
  getServerProgram();
}, 180_000);

const EXTRACTION_TIMEOUT_MS = 120_000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractors — a route returning a MikroORM entity', () => {
  //? THE REGRESSION NET for DEVKIT-1 / T11. This is the consumer-visible bug:
  //? the route really returns `{ status: 'success'; result: { owner: ... } }`,
  //? and before the fix every trace of `result` was gone — `apiRequest(...)` on
  //? the client got no payload type at all.
  it('extracts the REAL payload shape instead of degrading to `{ status: string }`', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = getOutputTypeDetailsFromFile(ROUTE);

    expect(result.text).not.toBe('{ status: string }');
    expect(result.text).toContain("status: 'success'");
    expect(result.text).toContain('result:');
    //? The entity's own fields survive the round-trip.
    expect(result.text).toContain('id: string');
    //? `string`, not `Date` — this is an OUTPUT, and outputs are projected to the
    //? shape the client actually receives. The entity holds a Date; JSON.stringify
    //? calls its toJSON() and the client gets an ISO string. This assertion used
    //? to pin `Date` deliberately, as the marker for exactly this fix.
    expect(result.text).toContain('createdAt: string');
    //? The tuple that used to crash the expander.
    expect(result.text).toContain('[string, string]');
    //? Symbol-keyed MikroORM markers must never reach the emitted text.
    expect(result.text).not.toContain('__@');

    //? No swallowed crash any more — nothing is logged.
    expect(errorSpy).not.toHaveBeenCalled();
  }, EXTRACTION_TIMEOUT_MS);

  it('records NO extraction failure for the route', () => {
    clearExtractionFailures();
    getOutputTypeDetailsFromFile(ROUTE);
    expect(getExtractionFailures()).toEqual([]);
  }, EXTRACTION_TIMEOUT_MS);

  it('the INPUT type is unaffected — it always inlined correctly', () => {
    //? Scopes the bug: the crash needed a MikroORM entity in the type graph. The
    //? `data` input is plain, so it was never affected either way.
    expect(getInputTypeDetailsFromFile(ROUTE).text).toBe('{\n  ownerId: string\n}');
  }, EXTRACTION_TIMEOUT_MS);

  //? THE COST OF FIXING THE CRASH, pinned so it cannot regress silently.
  //? Reaching the real shape means the traversal now walks deep into MikroORM's
  //? own types, and the cycle guard renders those as bare NAMES
  //? (`EntityProperty`, `EntityMetadata`, ...). They are declared inside
  //? node_modules, so `collectTypeSymbolFallback` returns them with NO
  //? importPath — and `typeMapGenerator.ts` turns exactly that into a hard
  //? `Aborting generation because unresolved type symbols were found`.
  //?
  //? So for a route that leaks an ORM entity, the fix converts a SILENT
  //? degradation into a LOUD generation abort. That is the correct posture per
  //? DD-DEVKIT-D1 (never silent), and the real remedy is not to return an entity
  //? from a route — but it IS a behaviour change worth knowing about.
  it('surfaces node_modules-declared symbols with no importPath (which aborts generation)', () => {
    const result = getOutputTypeDetailsFromFile(ROUTE);
    const names = result.unresolvedSymbols.map((s) => s.name);

    expect(names).toContain('EntityProperty');
    //? No importPath => typeMapGenerator.ts adds it to `unresolvedTypeAliases`
    //? and throws.
    const entityProperty = result.unresolvedSymbols.find((s) => s.name === 'EntityProperty');
    expect(entityProperty?.importPath).toBeUndefined();
  }, EXTRACTION_TIMEOUT_MS);
});

describe('extraction diagnostics — the seam that makes a swallowed throw visible', () => {
  //? DD-DEVKIT-D3: the CI gate can fail on a non-zero `fallbackCount`, so a
  //? whole-shape loss must never be invisible to it. Before this seam existed, a
  //? crashed extraction and a route that genuinely declares no shape both
  //? emitted `reason: 'default-fallback'` — indistinguishable.
  it('records a failure on throw and clears it on success', () => {
    clearExtractionFailures();

    recordExtractionOutcome({
      filePath: '/x/src/demo/_api/thing_v1.ts',
      kind: 'api',
      field: 'output',
      error: new Error('boom'),
    });
    expect(getExtractionFailures()).toHaveLength(1);
    expect(getExtractionFailures()[0]!.message).toBe('boom');

    //? A later successful re-extraction of the same file+field must retract the
    //? verdict — otherwise a stale "failed" entry would outlive the problem.
    recordExtractionOutcome({
      filePath: '/x/src/demo/_api/thing_v1.ts',
      kind: 'api',
      field: 'output',
      error: null,
    });
    expect(getExtractionFailures()).toEqual([]);
  });

  //? The clear happens on ENTRY, not on the success path, because an extractor
  //? has several EARLY bail-outs (no source file / no `ApiParams` / no `data`)
  //? that never reach the success path. If the clear lived there, a file that
  //? once threw and then started bailing out early would keep reporting
  //? `extraction-error` forever.
  it('a re-extraction that bails out EARLY still retracts a previous failure', () => {
    clearExtractionFailures();
    //? `MISSING` has no ApiParams interface to find, so the extractor returns
    //? its DEFAULT via an early return rather than via the success path.
    const MISSING = path.join(FIXTURE_DIR, 'mikroEntities.ts');

    recordExtractionOutcome({ filePath: MISSING, kind: 'api', field: 'input', error: new Error('stale') });
    expect(getExtractionFailures()).toHaveLength(1);

    expect(getInputTypeDetailsFromFile(MISSING).text).toBe('{ }');
    expect(getExtractionFailures(), 'the stale failure must be gone').toEqual([]);
  }, EXTRACTION_TIMEOUT_MS);

  it('does not match a route whose file path is underivable', () => {
    clearExtractionFailures();
    //? The fixture lives outside srcDir, so `extractPagePath` throws; the lookup
    //? must swallow that and simply not match rather than break generation.
    recordExtractionOutcome({ filePath: ROUTE, kind: 'api', field: 'output', error: new Error('boom') });
    expect(findExtractionFailure('anything/at@v1', 'api', 'output')).toBeUndefined();
    clearExtractionFailures();
  });

  it('a non-Error throw is still recorded', () => {
    clearExtractionFailures();
    recordExtractionOutcome({ filePath: '/x/src/a/_api/b_v1.ts', kind: 'api', field: 'input', error: 'plain string' });
    expect(getExtractionFailures()[0]!.message).toBe('plain string');
    clearExtractionFailures();
  });

  //? This runs inside a catch handler, so recording must never itself throw —
  //? including for values `JSON.stringify` chokes on (circular / BigInt) or
  //? silently returns `undefined` for.
  it('records hostile thrown values without throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const cases: { label: string; error: unknown }[] = [
      { label: 'circular', error: circular },
      { label: 'bigint', error: 10n },
      { label: 'undefined', error: undefined },
      { label: 'object', error: { code: 42 } },
    ];

    for (const { label, error } of cases) {
      clearExtractionFailures();
      expect(
        () => { recordExtractionOutcome({ filePath: '/x/src/a/_api/b_v1.ts', kind: 'api', field: 'input', error }); },
        label,
      ).not.toThrow();
      const recorded = getExtractionFailures();
      //? `undefined` is indistinguishable from the success sentinel by design —
      //? `error: null` is what CLEARS a failure, and `undefined` is not null, so
      //? it must still record.
      expect(recorded, label).toHaveLength(1);
      expect(typeof recorded[0]!.message, label).toBe('string');
      expect(recorded[0]!.message.length, label).toBeGreaterThan(0);
    }
    clearExtractionFailures();
  });
});
