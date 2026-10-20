import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, describe, expect, it, vi } from 'vitest';

//? A freshly injected route or page file must pass the lint a new project is
//? created with. The templates no longer reach the file with a blanket
//? `eslint-disable`, so every rule of the scaffold's ESLint config applies.
//? The project lives under the repo's ignored `node_modules/.cache`, so its
//? config resolves the same plugins as a scaffolded project.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const scaffold = path.resolve(here, '../../create-luckystack-app/template');
const cacheDir = path.join(repoRoot, 'node_modules', '.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const ROOT = fs.mkdtempSync(path.join(cacheDir, 'ls-template-lint-'));
const SRC = path.join(ROOT, 'src');

vi.mock('@luckystack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luckystack/core')>();
  return { ...actual, ROOT_DIR: ROOT, getSrcDir: () => SRC };
});

const { injectTemplate } = await import('./templateInjector');
const { resetTemplateRegistryForTests } = await import('./templateRegistry');

vi.spyOn(console, 'log').mockImplementation(() => undefined);

afterAll(() => {
  resetTemplateRegistryForTests();
  fs.rmSync(ROOT, { recursive: true, force: true });
});

const write = (relative: string, content: string): string => {
  const file = path.join(ROOT, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};

//? Stand-ins for what the type generator and the scaffold provide.
const writeProject = (): void => {
  for (const name of ['eslint.config.js', 'eslint.official.config.js', 'eslint.luckystack.config.js', 'tsconfig.json', 'tsconfig.server.json']) {
    fs.copyFileSync(path.join(scaffold, name), path.join(ROOT, name));
  }
  write('config.ts', [
    `export type { AuthProps } from '@luckystack/core';`,
    'export interface SessionLayout { id: string; admin: boolean }',
    '',
  ].join('\n'));
  write('src/_sockets/apiTypes.generated.ts', [
    'export interface Functions { session: { getSession: (token: string) => Promise<{ location?: { pathName?: string } } | null> } }',
    'export type MaybePromise<T> = T | Promise<T>;',
    'export type StreamPayload = Record<string, unknown>;',
    'export type ApiStreamEmitter = (payload?: StreamPayload) => void | Promise<void>;',
    'export type SyncServerStreamEmitter = (payload?: StreamPayload) => void | Promise<void>;',
    'export type SyncClientStreamEmitter = (payload?: StreamPayload) => void | Promise<void>;',
    'export type SyncBroadcastStreamEmitter = (payload?: StreamPayload) => void;',
    'export type SyncStreamToEmitter = (tokens: string | string[], payload?: StreamPayload) => void;',
    `export type ApiResponse = { status: 'success'; httpStatus?: number; [key: string]: unknown } | { status: 'error'; httpStatus?: number; errorCode: string };`,
    `export type SyncServerResponse = { status: 'success'; [key: string]: unknown } | { status: 'error'; errorCode: string };`,
    `export type SyncClientResponse = { status: 'success'; [key: string]: unknown } | { status: 'error'; errorCode: string };`,
    'export type SyncClientInput<P extends string, N extends string> = { page: P; name: N };',
    'export type SyncServerOutput<P extends string, N extends string> = { page: P; name: N };',
    '',
  ].join('\n'));
};

//? One file per template kind, under `src/<area>/`.
const injectEveryKind = async (area: string): Promise<string[]> => {
  write(`src/${area}/_sync/update_server_v1.ts`, '');
  const files = [
    `src/${area}/_api/getOrder_v1.ts`,
    `src/${area}/_sync/update_server_v1.ts`,
    `src/${area}/_sync/update_client_v1.ts`,
    `src/${area}/_sync/notify_client_v1.ts`,
    `src/${area}/admin/page.tsx`,
    `src/${area}/about/page.tsx`,
  ].map((relative) => write(relative, ''));
  for (const file of files) expect(await injectTemplate(file)).toBe(true);
  return files;
};

describe('injected templates lint clean', () => {
  it('with the scaffold ESLint config, for the bundled templates and the scaffold copies', async () => {
    writeProject();
    const consumerTemplates = path.join(ROOT, '.luckystack', 'templates');
    const scaffoldTemplates = path.join(scaffold, '_dot_luckystack', 'templates');
    const bundled = await injectEveryKind('bundled');

    fs.mkdirSync(consumerTemplates, { recursive: true });
    for (const name of fs.readdirSync(scaffoldTemplates).filter((entry) => entry.includes('.template.'))) {
      fs.copyFileSync(path.join(scaffoldTemplates, name), path.join(consumerTemplates, name));
    }
    const scaffolded = await injectEveryKind('scaffolded');

    const files = [...bundled, ...scaffolded];
    const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: path.join(ROOT, 'eslint.config.js') });
    const results = await eslint.lintFiles(files);
    const problems = results.flatMap((result) =>
      result.messages.map((message) => `${path.relative(ROOT, result.filePath)}:${String(message.line)} ${message.ruleId ?? 'parse'}: ${message.message}`));

    expect(results).toHaveLength(files.length);
    expect(problems).toEqual([]);
  }, 120_000);
});
