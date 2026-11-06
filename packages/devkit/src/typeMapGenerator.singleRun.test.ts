import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

//? Regression: on a clean checkout `apiTypes.generated.ts` does not exist yet,
//? but route handlers import `Functions` / `ApiResponse` from it. Extracting
//? routes before that file exists resolves those types to `any`, so one run of
//? the generator used to leave every dependent route output as `any` and only
//? a second run produced the real types. One run must now be complete: the
//? second run may change nothing except the diagnostics timestamp.
let workspace = '';
vi.mock('@luckystack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luckystack/core')>();
  return {
    ...actual,
    get ROOT_DIR() { return workspace; },
    getSrcDir: () => path.join(workspace, 'src'),
    getSharedDir: () => path.join(workspace, 'shared'),
    getServerFunctionDirs: () => [path.join(workspace, 'functions')],
    getGeneratedSocketTypesPath: () => path.join(workspace, 'src/_sockets/apiTypes.generated.ts'),
    getGeneratedApiSchemasPath: () => path.join(workspace, 'src/_sockets/apiInputSchemas.generated.ts'),
    getGeneratedApiDocsPath: () => path.join(workspace, 'src/docs/apiDocs.generated.json'),
  };
});

//? Every bootstrap write drops the cached Program, so the count of
//? invalidations per run shows how many Programs that run built.
const invalidations = vi.hoisted(() => ({ count: 0 }));
vi.mock('./typeMap/tsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./typeMap/tsApi')>();
  return {
    ...actual,
    invalidateProgramCache: () => {
      invalidations.count++;
      actual.invalidateProgramCache();
    },
  };
});

import { format } from 'prettier';
import { generateTypeMapFile } from './typeMapGenerator';

const runGeneration = (): number => {
  invalidations.count = 0;
  generateTypeMapFile({ quiet: true });
  return invalidations.count;
};

const FIXTURE: Record<string, string> = {
  'package.json': '{ "name": "typemap-single-run-fixture", "private": true, "type": "module" }\n',
  'tsconfig.server.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ES2022',
      moduleResolution: 'bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      lib: ['ES2023'],
    },
    include: ['functions/**/*', 'src/**/_api/**/*', 'src/**/_sync/**/*'],
  }, null, 2),
  'functions/greeting.ts': [
    'export interface Greeting { message: string; length: number }',
    'export const build = (name: string): Greeting => ({ message: `hi ${name}`, length: name.length });',
    '',
  ].join('\n'),
  //? Output depends on an injected `functions.*` return type.
  'src/_api/greet_v1.ts': [
    "import { Functions } from '../_sockets/apiTypes.generated';",
    '',
    'export interface ApiParams {',
    '  data: { name: string };',
    '  user: null;',
    '  functions: Functions;',
    '}',
    '',
    'export const main = ({ data, functions }: ApiParams) => {',
    '  const greeting = functions.greeting.build(data.name);',
    "  return { status: 'success' as const, greeting };",
    '};',
    '',
  ].join('\n'),
  //? Output depends on the generated `ApiResponse` envelope.
  'src/_api/count_v1.ts': [
    "import { ApiResponse } from '../_sockets/apiTypes.generated';",
    '',
    'export interface ApiParams {',
    '  data: Record<string, never>;',
    '  user: null;',
    '}',
    '',
    'export const main = () => {',
    "  const inner: ApiResponse<{ total: number }> = { status: 'success', total: 3 };",
    "  return { status: 'success' as const, inner };",
    '};',
    '',
  ].join('\n'),
};

const TYPES = 'src/_sockets/apiTypes.generated.ts';
const DIAGNOSTICS = 'src/docs/apiTypeDiagnostics.generated.json';
const ARTIFACTS = [TYPES, 'src/_sockets/apiInputSchemas.generated.ts', 'src/docs/apiDocs.generated.json', DIAGNOSTICS] as const;
type Artifact = typeof ARTIFACTS[number];

const readArtifact = (file: Artifact): string => fs.readFileSync(path.join(workspace, file), 'utf8');
const readArtifacts = (): Record<Artifact, string> => ({
  [TYPES]: readArtifact(TYPES),
  [ARTIFACTS[1]]: readArtifact(ARTIFACTS[1]),
  [ARTIFACTS[2]]: readArtifact(ARTIFACTS[2]),
  [DIAGNOSTICS]: readArtifact(DIAGNOSTICS),
});

const withoutTimestamp = (diagnostics: string): unknown => {
  const { generatedAt: _generatedAt, ...rest } = JSON.parse(diagnostics) as { generatedAt: string };
  return rest;
};

beforeAll(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-typemap-')));
  for (const [file, content] of Object.entries(FIXTURE)) {
    fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
    fs.writeFileSync(path.join(workspace, file), content);
  }
  fs.mkdirSync(path.join(workspace, 'src/_sockets'), { recursive: true });
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('generateTypeMapFile on a clean checkout', () => {
  it('is complete after one run: a second run changes nothing but generatedAt', () => {
    expect(fs.existsSync(path.join(workspace, TYPES))).toBe(false);

    expect(runGeneration(), 'Program builds on a clean checkout').toBe(2);
    const first = readArtifacts();

    expect(runGeneration(), 'Program builds once the file is current').toBe(1);
    const second = readArtifacts();

    for (const file of ARTIFACTS.filter((name) => name !== DIAGNOSTICS)) {
      expect(second[file], file).toBe(first[file]);
    }
    expect(withoutTimestamp(second[DIAGNOSTICS])).toEqual(withoutTimestamp(first[DIAGNOSTICS]));

    //? Guard against a run that is stable only because both runs degraded.
    expect(first[TYPES]).toMatch(/greeting: \{\s*message: string;\s*length: number;?\s*\}/);
    expect(first[TYPES]).toMatch(/total: number/);
  }, 180_000);

  it('does no bootstrap in the steady state, also when the file was reformatted', async () => {
    //? The scaffolded generateTypeMaps script runs prettier over the file after
    //? each run, so the fixed-part check must not depend on formatting.
    const formatted = await format(readArtifact(TYPES), { parser: 'typescript' });
    expect(formatted).not.toBe(readArtifact(TYPES));
    fs.writeFileSync(path.join(workspace, TYPES), formatted);

    expect(runGeneration(), 'Program builds in a steady-state run').toBe(1);
  }, 180_000);

  it('bootstraps again when the Functions interface changed', () => {
    fs.writeFileSync(path.join(workspace, 'functions/greeting.ts'), [
      'export interface Greeting { message: string; length: number; loud: boolean }',
      'export const build = (name: string): Greeting => ({ message: `hi ${name}`, length: name.length, loud: false });',
      '',
    ].join('\n'));

    expect(runGeneration(), 'Program builds after a Functions change').toBe(2);
    expect(readArtifact(TYPES)).toMatch(/greeting: \{\s*message: string;\s*length: number;\s*loud: boolean;?\s*\}/);
  }, 180_000);
});
