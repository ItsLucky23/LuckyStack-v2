//? Finding 096: the scaffolded GitHub CI always used setup-node's npm cache and
//? `npm install`, whatever --pm was chosen. setup-node fails the step when it
//? finds no npm lockfile, and a bun project only has bun.lock — so every run of
//? a `--pm=bun` project failed at 'Setup Node'. The matrix also tested Node 20
//? while engines require >=22.13. The GitLab file had the same npm-only shape.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUN_VERSION_FLOOR, buildCiTemplateVars, replacePlaceholders } from './index';

const TEMPLATE = path.resolve(import.meta.dirname, '..', 'template');
const render = (rel: string, packageManager: 'npm' | 'bun'): string =>
  replacePlaceholders(fs.readFileSync(path.join(TEMPLATE, rel), 'utf8'), buildCiTemplateVars(packageManager));

const GITHUB = '.github/workflows/ci.yml';
const GITLAB = '.gitlab-ci.yml';

describe('scaffolded CI per package manager', () => {
  it.each(['npm', 'bun'] as const)('%s: leaves no CI placeholder unrendered', (packageManager) => {
    for (const file of [GITHUB, GITLAB]) {
      expect(render(file, packageManager)).not.toMatch(/{{CI_\w+}}/);
    }
  });

  it('tests only Node versions the engines field allows', () => {
    const engines = (JSON.parse(fs.readFileSync(path.join(TEMPLATE, 'package.json'), 'utf8')) as { engines: { node: string } }).engines.node;
    const floorMajor = Number(/>=(\d+)/.exec(engines)?.[1]);
    const matrix = /node-version: \[([^\]]+)\]/.exec(render(GITHUB, 'npm'))?.[1] ?? '';
    const majors = [...matrix.matchAll(/'(\d+)'/g)].map((m) => Number(m[1]));
    expect(majors.length).toBeGreaterThan(0);
    for (const major of majors) expect(major).toBeGreaterThanOrEqual(floorMajor);
  });

  it('npm: keeps the npm cache and npm install', () => {
    const github = render(GITHUB, 'npm');
    expect(github).toContain("          node-version: ${{ matrix.node-version }}\n          cache: 'npm'\n");
    expect(github).toContain('run: npm install');
    expect(github).not.toContain('setup-bun');
    expect(render(GITLAB, 'npm')).toContain('- package-lock.json');
  });

  it('bun: sets up bun and installs with it, without the npm lockfile cache', () => {
    const github = render(GITHUB, 'bun');
    expect(github).not.toContain("cache: 'npm'");
    expect(github).toContain('uses: oven-sh/setup-bun@v2');
    expect(github).toContain(`bun-version: '${BUN_VERSION_FLOOR}'`);
    expect(github).toContain('run: bun install');
    const gitlab = render(GITLAB, 'bun');
    expect(gitlab).not.toContain('package-lock.json');
    expect(gitlab).toContain('- bun.lock');
    expect(gitlab).not.toMatch(/^\s+- npm install$/m);
    expect(gitlab).toContain(`- npm install -g bun@${BUN_VERSION_FLOOR} && bun install`);
  });

  it('bun: the Setup Bun step is a sibling step, not part of the Setup Node inputs', () => {
    const github = render(GITHUB, 'bun');
    expect(github).toContain([
      '          node-version: ${{ matrix.node-version }}',
      '',
      '      - name: Setup Bun',
      '        uses: oven-sh/setup-bun@v2',
    ].join('\n'));
  });
});
