import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

//? The checker memo (checkerMemo.ts) is a pure speed-up: generation output must
//? be byte-identical with and without it, and it must never answer for a
//? Program built after the sources changed.
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

//? Switches the memo off for the reference run; `wrapped` proves the memo was
//? really in use for the other run.
const memo = vi.hoisted(() => ({ enabled: true, wrapped: 0 }));
vi.mock('./checkerMemo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./checkerMemo')>();
  return {
    memoizeChecker: (checker: Parameters<typeof actual.memoizeChecker>[0]) => {
      if (!memo.enabled) return checker;
      memo.wrapped++;
      return actual.memoizeChecker(checker);
    },
  };
});

import { generateTypeMapFile } from '../typeMapGenerator';
import { getOutputTypeDetailsFromFile } from './extractors';
import { disposeTsApi, getServerProgram, invalidateProgramCache } from './tsApi';

const PROFILE_SOURCE = [
  'export interface Address { street: string; city: string }',
  'export interface Profile { name: string; address: Address; tags: string[] }',
  "export type Role = 'admin' | 'member';",
  '',
].join('\n');

//? Shared types reused across API and sync routes, so the memoized queries
//? hit repeatedly, plus a `functions.*` dependency through the generated file.
const FIXTURE: Record<string, string> = {
  'package.json': '{ "name": "typemap-checker-memo-fixture", "private": true, "type": "module" }\n',
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
    include: ['functions/**/*', 'shared/**/*', 'src/**/_api/**/*', 'src/**/_sync/**/*'],
  }, null, 2),
  'functions/greeting.ts': [
    'export interface Greeting { message: string; length: number }',
    'export const build = (name: string): Greeting => ({ message: `hi ${name}`, length: name.length });',
    '',
  ].join('\n'),
  'shared/profile.ts': PROFILE_SOURCE,
  //? A custom `toJSON` decides the wire type through the property lookup.
  'shared/money.ts': [
    'export class Money {',
    '  constructor(private readonly cents: number) {}',
    '  toJSON(): string { return (this.cents / 100).toFixed(2); }',
    '}',
    '',
  ].join('\n'),
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
  'src/_api/profile_v1.ts': [
    "import type { Profile, Role } from '../../shared/profile';",
    '',
    'export interface ApiParams {',
    '  data: { id: string; role?: Role };',
    '  user: null;',
    '}',
    '',
    'declare const load: (id: string) => Profile;',
    '',
    'export const main = ({ data }: ApiParams) => {',
    "  return { status: 'success' as const, profile: load(data.id), role: data.role ?? ('member' as Role), loadedAt: new Date() };",
    '};',
    '',
  ].join('\n'),
  'src/_api/profiles_v1.ts': [
    "import type { Address, Profile } from '../../shared/profile';",
    "import { Money } from '../../shared/money';",
    '',
    'export interface ApiParams {',
    '  data: { city: string };',
    '  user: null;',
    '}',
    '',
    'declare const all: () => Profile[];',
    '',
    'export const main = ({ data }: ApiParams) => {',
    '  const profiles = all().filter((profile) => profile.address.city === data.city);',
    "  const addresses: Address[] = profiles.map((profile) => profile.address);",
    "  const names: Pick<Profile, 'name'>[] = profiles.map(({ name }) => ({ name }));",
    "  return { status: 'success' as const, profiles, addresses, names, loadedAt: new Date(), total: new Money(500) };",
    '};',
    '',
  ].join('\n'),
  'src/users/_sync/rename_server_v1.ts': [
    "import { Functions, SyncServerResponse, MaybePromise } from '../../_sockets/apiTypes.generated';",
    "import type { Profile } from '../../../shared/profile';",
    '',
    'export interface SyncParams {',
    '  clientInput: { profile: Profile; name: string };',
    '  user: null;',
    '  functions: Functions;',
    '  roomCode: string;',
    '}',
    '',
    'export const main = ({ clientInput }: SyncParams): MaybePromise<SyncServerResponse> => {',
    "  return { status: 'success', profile: { ...clientInput.profile, name: clientInput.name } };",
    '};',
    '',
  ].join('\n'),
};

const ARTIFACTS = [
  'src/_sockets/apiTypes.generated.ts',
  'src/_sockets/apiInputSchemas.generated.ts',
  'src/docs/apiDocs.generated.json',
  'src/docs/apiTypeDiagnostics.generated.json',
] as const;

const readArtifacts = (): Record<string, string> => Object.fromEntries(ARTIFACTS.map((file) => {
  const content = fs.readFileSync(path.join(workspace, file), 'utf8');
  if (!file.endsWith('apiTypeDiagnostics.generated.json')) return [file, content];
  //? The only field that differs between two runs by design.
  const { generatedAt: _generatedAt, ...rest } = JSON.parse(content) as { generatedAt: string };
  return [file, JSON.stringify(rest)];
}));

const generate = (memoEnabled: boolean): Record<string, string> => {
  memo.enabled = memoEnabled;
  memo.wrapped = 0;
  generateTypeMapFile({ quiet: true });
  return readArtifacts();
};

beforeAll(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-checker-memo-')));
  for (const [file, content] of Object.entries(FIXTURE)) {
    fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
    fs.writeFileSync(path.join(workspace, file), content);
  }
  fs.mkdirSync(path.join(workspace, 'src/_sockets'), { recursive: true });
});

afterAll(() => {
  disposeTsApi();
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('checker memo', () => {
  it('generates byte-identical artifacts with and without the memo', () => {
    //? Reach the steady state first, so both compared runs start from the same files.
    generate(true);

    const withMemo = generate(true);
    expect(memo.wrapped, 'the memoized run used the memo').toBeGreaterThan(0);
    const withoutMemo = generate(false);
    expect(memo.wrapped, 'the reference run bypassed the memo').toBe(0);

    for (const file of ARTIFACTS) {
      expect(withMemo[file], file).toBe(withoutMemo[file]);
    }
    //? Guard against outputs that agree only because both degraded to `any`.
    const types = withMemo['src/_sockets/apiTypes.generated.ts'];
    expect(types).toMatch(/greeting: \{\s*message: string;\s*length: number;?\s*\}/);
    expect(types).toMatch(/street: string;\s*city: string/);
    expect(types).toMatch(/loadedAt: string/);
    //? `Money.toJSON` returns a string, so its wire type is `string`.
    expect(types).toMatch(/total: string/);
    expect(types).toMatch(/role: "admin" \| "member"|role: 'admin' \| 'member'/);
  }, 180_000);

  it('answers from the edited sources after the Program cache is invalidated', () => {
    memo.enabled = true;
    const route = path.join(workspace, 'src/_api/profile_v1.ts');
    invalidateProgramCache();

    const firstChecker = getServerProgram().checker;
    const before = getOutputTypeDetailsFromFile(route).text;
    expect(before).toMatch(/city: string/);
    expect(before).not.toMatch(/zip/);

    fs.writeFileSync(
      path.join(workspace, 'shared/profile.ts'),
      PROFILE_SOURCE.replace('city: string }', 'city: string; zip: number }'),
    );
    invalidateProgramCache();

    expect(getServerProgram().checker, 'a new Program gets a new memoized checker').not.toBe(firstChecker);
    expect(getOutputTypeDetailsFromFile(route).text).toMatch(/city: string;?\s*zip: number/);
  }, 180_000);
});
