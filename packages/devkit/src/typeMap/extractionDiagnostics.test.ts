import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { getSrcDir } from '@luckystack/core';
import { buildTypeMapArtifacts, ApiTypeEntry, SyncTypeEntry } from './emitterArtifacts';
import { clearExtractionFailures, recordExtractionOutcome } from './extractionDiagnostics';

//? DD-DEVKIT-D3, end-to-end. `apiTypeDiagnostics.generated.json` is what CI
//? gates on (it can fail the build on a non-zero `fallbackCount`), so this
//? drives the REAL emitter — `buildTypeMapArtifacts` — and asserts on the
//? diagnostics it actually produces, rather than on `collectFallbacks` (which is
//? module-private) in isolation.
//?
//? The route key the emitter builds is `<pagePath>/<name>@<version>`, derived
//? from the entry's map keys; the diagnostics registry derives the SAME key from
//? the recorded file path via routeMeta. These tests pin that the two agree —
//? if they ever drift, a real crashed route would be reported as a plain
//? `default-fallback` again and the whole seam would be silently inert.

//? Must be under the configured srcDir or routeMeta cannot derive a route.
const ROUTE_FILE = path.join(getSrcDir(), 'demo', '_api', 'thing_v1.ts');
const SYNC_FILE = path.join(getSrcDir(), 'demo', '_sync', 'tick_server_v1.ts');

const apiEntry = (overrides: Partial<ApiTypeEntry> = {}): ApiTypeEntry => ({
  input: '{\n  a: string\n}',
  output: '{\n  status: \'success\'\n}',
  stream: 'never',
  method: 'POST',
  rateLimit: false,
  auth: undefined,
  version: 'v1',
  ...overrides,
});

const syncEntry = (overrides: Partial<SyncTypeEntry> = {}): SyncTypeEntry => ({
  clientInput: '{\n  a: string\n}',
  serverOutput: '{\n  status: \'success\'\n}',
  clientOutput: '{\n  status: \'success\'\n}',
  serverStream: 'never',
  clientStream: 'never',
  version: 'v1',
  ...overrides,
});

const build = ({
  apis,
  syncs,
}: {
  apis?: Map<string, Map<string, ApiTypeEntry>>;
  syncs?: Map<string, Map<string, SyncTypeEntry>>;
} = {}) =>
  buildTypeMapArtifacts({
    typesByPage: apis ?? new Map(),
    syncTypesByPage: syncs ?? new Map(),
    namedImports: new Map(),
    defaultImports: new Map(),
    functionsInterface: '',
  });

beforeEach(() => {
  clearExtractionFailures();
});

describe('apiTypeDiagnostics — a THROWN extraction is a first-class reason', () => {
  it('reports `extraction-error` (not `default-fallback`) when the extraction threw', () => {
    recordExtractionOutcome({
      filePath: ROUTE_FILE,
      kind: 'api',
      field: 'output',
      error: new TypeError("Cannot read properties of undefined (reading 'name')"),
    });

    const apis = new Map([['demo', new Map([['thing@v1', apiEntry({ output: '{ status: string }' })]])]]);
    const { diagnosticsData } = build({ apis });

    const entry = diagnosticsData.fallbacks.find((f) => f.field === 'output');
    expect(entry).toBeDefined();
    expect(entry!.reason).toBe('extraction-error');
    expect(entry!.route).toBe('demo/thing@v1');
    //? The thrown message is PERSISTED — previously it existed only as a
    //? console.error that vanished with the terminal scrollback.
    expect(entry!.detail).toContain("Cannot read properties of undefined (reading 'name')");
    //? DD-DEVKIT-D3: the CI gate sees it.
    expect(diagnosticsData.fallbackCount).toBeGreaterThan(0);
  });

  //? PROVES THE FIX FAILS WITHOUT ITSELF. Identical emitter input, identical
  //? degraded text — the ONLY difference is whether a throw was recorded. Without
  //? the seam both cases produce `default-fallback`, which is exactly the blind
  //? spot DEVKIT-1 hid in.
  it('the SAME degraded text without a recorded throw stays `default-fallback`', () => {
    const apis = new Map([['demo', new Map([['thing@v1', apiEntry({ output: '{ status: string }' })]])]]);
    const { diagnosticsData } = build({ apis });

    const entry = diagnosticsData.fallbacks.find((f) => f.field === 'output');
    expect(entry).toBeDefined();
    expect(entry!.reason).toBe('default-fallback');
    expect(entry!.detail).toBeUndefined();
  });

  it('flags a thrown sync extraction against the right route + field', () => {
    recordExtractionOutcome({
      filePath: SYNC_FILE,
      kind: 'sync',
      field: 'serverOutput',
      error: new Error('kaboom'),
    });

    const syncs = new Map([['demo', new Map([['tick@v1', syncEntry({ serverOutput: '{ status: string }' })]])]]);
    const { diagnosticsData } = build({ syncs });

    const entry = diagnosticsData.fallbacks.find((f) => f.field === 'serverOutput');
    expect(entry?.reason).toBe('extraction-error');
    expect(entry?.kind).toBe('sync');
    expect(entry?.route).toBe('demo/tick@v1');
    expect(entry?.detail).toBe('kaboom');
  });

  it('reports an API stream extraction throw even though `never` is normally legitimate', () => {
    recordExtractionOutcome({ filePath: ROUTE_FILE, kind: 'api', field: 'stream', error: new Error('stream exploded') });
    const apis = new Map([['demo', new Map([['thing@v1', apiEntry()]])]]);
    const { diagnosticsData } = build({ apis });

    expect(diagnosticsData.fallbacks).toContainEqual(expect.objectContaining({
      route: 'demo/thing@v1',
      field: 'stream',
      fallback: 'never',
      reason: 'extraction-error',
      detail: 'stream exploded',
    }));
  });

  it.each(['serverStream', 'clientStream'])('reports a sync %s extraction throw', (field) => {
    recordExtractionOutcome({ filePath: SYNC_FILE, kind: 'sync', field, error: new Error(`${field} exploded`) });
    const syncs = new Map([['demo', new Map([['tick@v1', syncEntry()]])]]);
    const { diagnosticsData } = build({ syncs });

    expect(diagnosticsData.fallbacks).toContainEqual(expect.objectContaining({
      route: 'demo/tick@v1',
      field,
      fallback: 'never',
      reason: 'extraction-error',
      detail: `${field} exploded`,
    }));
  });

  //? A throw is reported even when the resulting text does NOT look like a
  //? default — the failure is the signal, not the shape of what it fell back to.
  it('reports a throw whose fallback text is not one of the known defaults', () => {
    recordExtractionOutcome({ filePath: ROUTE_FILE, kind: 'api', field: 'input', error: new Error('odd') });

    const apis = new Map([['demo', new Map([['thing@v1', apiEntry()]])]]);
    const { diagnosticsData } = build({ apis });

    const entry = diagnosticsData.fallbacks.find((f) => f.field === 'input');
    expect(entry?.reason).toBe('extraction-error');
  });

  it('a failure recorded for a DIFFERENT route does not contaminate this one', () => {
    recordExtractionOutcome({
      filePath: path.join(getSrcDir(), 'other', '_api', 'thing_v1.ts'),
      kind: 'api',
      field: 'output',
      error: new Error('elsewhere'),
    });

    const apis = new Map([['demo', new Map([['thing@v1', apiEntry({ output: '{ status: string }' })]])]]);
    const { diagnosticsData } = build({ apis });

    const entry = diagnosticsData.fallbacks.find((f) => f.field === 'output');
    expect(entry!.reason).toBe('default-fallback');
  });

  it('checks Zod degradation only for API input — the only generated schema field', () => {
    const unsupportedByZod = '{ left: string } & { right: string }';
    const apis = new Map([['demo', new Map([['thing@v1', apiEntry({
      input: unsupportedByZod,
      output: unsupportedByZod,
      stream: unsupportedByZod,
    })]])]]);
    const { diagnosticsData } = build({ apis });

    expect(diagnosticsData.fallbacks.filter((entry) => entry.reason === 'zod-any-fallback')).toEqual([
      expect.objectContaining({ field: 'input' }),
    ]);
  });

  it('a clean route produces no diagnostics at all', () => {
    const apis = new Map([['demo', new Map([['thing@v1', apiEntry()]])]]);
    const { diagnosticsData } = build({ apis });
    expect(diagnosticsData.fallbacks.filter((f) => f.field === 'output')).toEqual([]);
  });
});
