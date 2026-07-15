import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

//? DEVKIT-1, blast radius. `tsProgram.test.ts` proves `expandTypeDetailed`
//? THROWS on a decorator-based MikroORM entity. This file answers the question a
//? consumer actually cares about: what does the generator DO about it?
//?
//? Answer: `extractors.ts` wraps every extraction in try/catch, so the throw is
//? swallowed into a `console.error` and the route's payload type silently
//? degrades to the `{ status: string }` DEFAULT — the entire `result` shape is
//? lost. These tests lock in that CURRENT behaviour.

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
  it('the crash is swallowed: the payload type degrades to the `{ status: string }` DEFAULT', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = getOutputTypeDetailsFromFile(ROUTE);

    //? THE CONSUMER-VISIBLE BUG. The route really returns
    //? `{ status: 'success'; result: { owner: FixtureOwner } }`, but every trace
    //? of `result` is gone. `apiRequest(...)` on the client gets no payload type.
    expect(result.text).toBe('{ status: string }');
    expect(result.unresolvedSymbols).toEqual([]);

    //? It is not silent — but a console.error is the ONLY signal, and generation
    //? still "succeeds" and writes the degraded type to disk.
    expect(errorSpy).toHaveBeenCalledOnce();
    const [message, error] = errorSpy.mock.calls[0]!;
    expect(String(message)).toContain('Error extracting output type from');
    expect((error as Error).message).toContain("Cannot read properties of undefined (reading 'name')");
  }, EXTRACTION_TIMEOUT_MS);

  it('the DEFAULT is indistinguishable from a route that legitimately returns { status: string }', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    //? Why the above matters: the degraded output is a VALID-looking type. There
    //? is no marker in the emitted artifact saying "this one crashed", so
    //? `apiTypeDiagnostics.generated.json` (DD-DEVKIT-D3) does not flag it
    //? either — it only tracks getSourceFile misses and zod-any fallbacks.
    expect(getOutputTypeDetailsFromFile(ROUTE).text).toBe('{ status: string }');
  }, EXTRACTION_TIMEOUT_MS);

  it('the INPUT type is unaffected — only the entity-carrying output breaks', () => {
    //? Scopes the bug: the crash needs a MikroORM entity in the type graph. The
    //? `data` input is plain, so it still inlines correctly.
    expect(getInputTypeDetailsFromFile(ROUTE).text).toBe('{\n  ownerId: string\n}');
  }, EXTRACTION_TIMEOUT_MS);
});
