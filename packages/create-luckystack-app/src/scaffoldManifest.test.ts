import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectFileHashes,
  hashFileContent,
  writeScaffoldManifest,
  SCAFFOLD_MANIFEST_DIR,
  SCAFFOLD_MANIFEST_FILE,
  type ScaffoldManifest,
} from './scaffoldManifest';

const isTextByExt = (filePath: string): boolean =>
  ['.ts', '.json', '.md'].includes(path.extname(filePath));

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-manifest-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (relative: string, content: string | Buffer): void => {
  const absolute = path.join(dir, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};

describe('hashFileContent', () => {
  it('is CRLF-stable for text files', () => {
    const lf = hashFileContent(Buffer.from('a\nb\n'), true);
    const crlf = hashFileContent(Buffer.from('a\r\nb\r\n'), true);
    expect(crlf).toBe(lf);
  });

  it('hashes binary content byte-exact (no normalization)', () => {
    const lf = hashFileContent(Buffer.from('a\nb\n'), false);
    const crlf = hashFileContent(Buffer.from('a\r\nb\r\n'), false);
    expect(crlf).not.toBe(lf);
  });
});

describe('collectFileHashes', () => {
  it('walks recursively, excludes installs/VCS/env/manifest, sorts, uses forward slashes', () => {
    write('package.json', '{}');
    write('src/page.tsx', 'export {}');
    write('src/_components/Form.tsx', 'export {}');
    write('.env', 'SECRET=1');
    write('.env.local', 'SECRET=2');
    write('.secret-manager-token', 'token');
    write('node_modules/dep/index.js', 'x');
    write('.git/HEAD', 'ref');
    write(`${SCAFFOLD_MANIFEST_DIR}/${SCAFFOLD_MANIFEST_FILE}`, '{}');
    write(`${SCAFFOLD_MANIFEST_DIR}/templates/page.tsx`, 'template');

    const entries = collectFileHashes(dir, isTextByExt);
    const paths = entries.map((entry) => entry.path);
    expect(paths).toEqual([
      '.luckystack/templates/page.tsx',
      'package.json',
      'src/_components/Form.tsx',
      'src/page.tsx',
    ]);
    for (const entry of entries) expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces identical hashes for identical content (pristine detection)', () => {
    write('a.ts', 'export const x = 1;\n');
    const first = collectFileHashes(dir, isTextByExt);
    const second = collectFileHashes(dir, isTextByExt);
    expect(second).toEqual(first);

    write('a.ts', 'export const x = 2;\n');
    const modified = collectFileHashes(dir, isTextByExt);
    expect(modified[0]?.sha256).not.toBe(first[0]?.sha256);
  });
});

describe('writeScaffoldManifest', () => {
  it('writes a committed-shape manifest with version, choices, and file hashes', () => {
    write('package.json', '{"name":"t"}');
    write('config.ts', 'export const a = 1;');

    const returned = writeScaffoldManifest(dir, {
      luckystackVersion: '0.4.1',
      projectName: 'my-app',
      choices: { dbProvider: 'mongodb', authMode: 'none', presence: false },
      isTextFile: isTextByExt,
    });

    const manifestPath = path.join(dir, SCAFFOLD_MANIFEST_DIR, SCAFFOLD_MANIFEST_FILE);
    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ScaffoldManifest;
    expect(onDisk).toEqual(returned);
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.luckystackVersion).toBe('0.4.1');
    expect(onDisk.projectName).toBe('my-app');
    expect(onDisk.choices).toEqual({ dbProvider: 'mongodb', authMode: 'none', presence: false });
    expect(onDisk.files.map((f) => f.path)).toEqual(['config.ts', 'package.json']);
    expect(Date.parse(onDisk.createdAt)).not.toBeNaN();
    //? The manifest must not list itself.
    expect(onDisk.files.some((f) => f.path.endsWith(SCAFFOLD_MANIFEST_FILE))).toBe(false);
  });
});
