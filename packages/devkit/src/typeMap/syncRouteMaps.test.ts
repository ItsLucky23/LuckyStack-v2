import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTypeMapArtifacts, ApiTypeEntry, SyncTypeEntry } from './emitterArtifacts';
import { clearExtractionFailures } from './extractionDiagnostics';
import { disposeTsApi, transpileSourceText } from './tsApi';

//? `syncMetaMap` + `syncInputSchemas` are what the test-runner sweeps walk to
//? reach sync routes, the way `apiMetaMap` + `apiInputSchemas` let them reach
//? API routes. These pin the emitted shape against the real emitter.

const syncEntry = (overrides: Partial<SyncTypeEntry> = {}): SyncTypeEntry => ({
  clientInput: '{\n  message: string\n}',
  serverOutput: '{\n  status: \'success\'\n}',
  clientOutput: '{\n  status: \'success\'\n}',
  serverStream: 'never',
  clientStream: 'never',
  version: 'v1',
  hasServer: true,
  hasClient: false,
  serverMeta: { auth: { login: true, hasAdditional: false }, rateLimit: 30 },
  ...overrides,
});

const apiEntry = (overrides: Partial<ApiTypeEntry> = {}): ApiTypeEntry => ({
  input: '{\n  a: string\n}',
  output: '{\n  status: \'success\'\n}',
  stream: 'never',
  method: 'POST',
  rateLimit: undefined,
  auth: { login: false, hasAdditional: false },
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

const sliceExport = (content: string, name: string): string => {
  const start = content.indexOf(`export const ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  return content.slice(start, content.indexOf('\n};', start) + 3);
};

const syntaxErrors = (content: string): string[] => {
  const result = transpileSourceText('generated.ts', content);
  return (result.diagnostics ?? []).map((d) => d.text);
};

beforeEach(() => {
  clearExtractionFailures();
});
afterAll(() => {
  disposeTsApi();
});

describe('syncMetaMap', () => {
  it('emits one entry per server sync route with the API meta rendering rules', () => {
    const syncs = new Map([
      ['chat', new Map([
        ['send@v2', syncEntry({ version: 'v2', serverMeta: { auth: { login: false, hasAdditional: false }, rateLimit: false } })],
        ['send@v1', syncEntry()],
        ['admin@v1', syncEntry({ serverMeta: { auth: { login: true, additional: [{ key: 'admin', value: true }], hasAdditional: true }, rateLimit: undefined } })],
      ])],
      ['system', new Map([['ping@v1', syncEntry({ serverMeta: { auth: undefined, rateLimit: undefined } })]])],
    ]);
    const { content } = build({ syncs });

    expect(sliceExport(content, 'syncMetaMap')).toBe(`export const syncMetaMap: Record<string, Record<string, Record<string, SyncMetaEntry>>> = {
  'chat': {
    'admin': {
      'v1': { auth: { login: true, additional: [{"key":"admin","value":true}], hasAdditional: true } },
    },
    'send': {
      'v1': { auth: { login: true }, rateLimit: 30 },
      'v2': { auth: { login: false }, rateLimit: false },
    },
  },
  'system': {
    'ping': {
      'v1': { auth: { login: false } },
    },
  },
};`);
    expect(content).toContain('export interface SyncMetaEntry {');
    expect(content).toContain('export const getSyncMeta = (pagePath: string, syncName: string, version: string): SyncMetaEntry | undefined => {');
  });

  it('is emitted right after getApiMeta', () => {
    const { content } = build();
    expect(content.indexOf('export const getApiMeta')).toBeLessThan(content.indexOf('export interface SyncMetaEntry'));
    expect(content.indexOf('export interface SyncMetaEntry')).toBeLessThan(content.indexOf('// Sync Type Definitions'));
  });

  it('skips client-only syncs — they are not callable routes', () => {
    const syncs = new Map([
      ['chat', new Map([['typing@v1', syncEntry({ serverMeta: undefined, hasServer: false, hasClient: true })]])],
    ]);
    const { content, schemasContent } = build({ syncs });

    expect(sliceExport(content, 'syncMetaMap')).toBe('export const syncMetaMap: Record<string, Record<string, Record<string, SyncMetaEntry>>> = {\n};');
    expect(sliceExport(schemasContent, 'syncInputSchemas')).toBe('export const syncInputSchemas: Record<string, Record<string, Record<string, z.ZodTypeAny>>> = {\n};');
  });

  it('leaves the apiMetaMap rendering unchanged', () => {
    const apis = new Map([['demo', new Map([
      ['thing@v1', apiEntry({ rateLimit: 60, auth: { login: true, additional: [{ key: 'admin' }], hasAdditional: true } })],
      ['other@v1', apiEntry({ method: 'GET', auth: undefined })],
    ])]]);
    const { content } = build({ apis });

    expect(sliceExport(content, 'apiMetaMap')).toContain(`      'v1': { method: 'POST', auth: { login: true, additional: [{"key":"admin"}], hasAdditional: true }, rateLimit: 60 },`);
    expect(sliceExport(content, 'apiMetaMap')).toContain(`      'v1': { method: 'GET', auth: { login: false } },`);
  });
});

describe('syncInputSchemas', () => {
  it('emits a Zod schema per server sync route from its clientInput', () => {
    const syncs = new Map([['chat', new Map([['send@v1', syncEntry()]])]]);
    const { schemasContent } = build({ syncs });

    const block = sliceExport(schemasContent, 'syncInputSchemas');
    expect(block).toContain(`  'chat': {\n    'send': {\n      'v1': z.object(`);
    expect(block).toMatch(/"message": z\.string\(\)/);
    expect(schemasContent).toContain('export const getSyncInputSchema = (');
    expect(schemasContent.indexOf('export const apiInputSchemas')).toBeLessThan(schemasContent.indexOf('export const syncInputSchemas'));
  });

  it('empty project emits both maps as `{}` and stays syntactically valid', () => {
    const { content, schemasContent } = build();
    expect(content).toContain('export const syncMetaMap: Record<string, Record<string, Record<string, SyncMetaEntry>>> = {\n};');
    expect(schemasContent).toContain('export const syncInputSchemas: Record<string, Record<string, Record<string, z.ZodTypeAny>>> = {\n};');
    expect(syntaxErrors(content)).toEqual([]);
    expect(syntaxErrors(schemasContent)).toEqual([]);
  });

  it('records a Zod fallback on a server sync clientInput in the diagnostics', () => {
    const unsupportedByZod = '{ left: string } & { right: string }';
    const syncs = new Map([['chat', new Map([
      ['send@v1', syncEntry({ clientInput: unsupportedByZod })],
      ['typing@v1', syncEntry({ clientInput: unsupportedByZod, serverMeta: undefined, hasServer: false, hasClient: true })],
    ])]]);
    const { diagnosticsData } = build({ syncs });

    expect(diagnosticsData.fallbacks.filter((entry) => entry.reason === 'zod-any-fallback')).toEqual([
      expect.objectContaining({ route: 'chat/send@v1', kind: 'sync', field: 'clientInput' }),
    ]);
  });
});
