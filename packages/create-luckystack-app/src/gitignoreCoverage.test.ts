//? Finding 010: the env templates and DOCKER.md call `.env.docker` gitignored,
//? but the scaffold's .gitignore did not list it — remote database/Redis
//? passwords were one `git add .` away from the repository. SQLite data files
//? (user rows, password hashes) were not ignored either. Checked with real git,
//? so the patterns are judged exactly as a consumer's repository judges them.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEMPLATE = path.resolve(import.meta.dirname, '..', 'template');
let repo = '';

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-gitignore-'));
  const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  fs.copyFileSync(path.join(TEMPLATE, '_dot_gitignore'), path.join(repo, '.gitignore'));
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const isIgnored = (file: string): boolean =>
  spawnSync('git', ['check-ignore', '-q', '--no-index', file], { cwd: repo }).status === 0;

//? Every file a template or shipped doc describes as gitignored/ignored.
const filesCalledIgnored = (): string[] => {
  const sources = fs.readdirSync(TEMPLATE)
    .filter((name) => name.startsWith('_dot_env'))
    .map((name) => fs.readFileSync(path.join(TEMPLATE, name), 'utf8'));
  sources.push(fs.readFileSync(path.join(TEMPLATE, 'docs', 'DOCKER.md'), 'utf8'));
  const names = new Set<string>();
  for (const text of sources) {
    for (const match of text.matchAll(/`?(\.env[\w.]*)`? \(gitignored\)/g)) names.add(match[1] ?? '');
    for (const match of text.matchAll(/ignored `(\.env[\w.]*)`/g)) names.add(match[1] ?? '');
  }
  names.delete('');
  return [...names];
};

describe('scaffold .gitignore', () => {
  it('ignores every env file the templates and docs call gitignored', () => {
    const files = filesCalledIgnored();
    expect(files).toEqual(expect.arrayContaining(['.env.docker', '.env.local']));
    for (const file of files) expect(isIgnored(file), file).toBe(true);
  });

  it.each(['.env.docker', '.env.production.local', 'dev.db', 'prisma/dev.db', 'dev.db-journal', 'dev.db-wal'])(
    'ignores %s',
    (file) => { expect(isIgnored(file)).toBe(true); },
  );

  it('keeps the committed, non-secret env files tracked', () => {
    for (const file of ['.env', '.env_template', '.env.local_template', '.env.docker_template']) {
      expect(isIgnored(file), file).toBe(false);
    }
  });
});
