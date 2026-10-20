import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildUpgradePlan, runUpgrade } from './upgrade';
import type { ConsumerProject } from '../lib/project';

const INSTALLED = [
  { name: '@luckystack/core', version: '0.4.0', changelog: 'node_modules/@luckystack/core/CHANGELOG.md' },
  { name: '@luckystack/cli', version: '0.4.0', changelog: 'node_modules/@luckystack/cli/CHANGELOG.md' },
];

describe('buildUpgradePlan', () => {
  it('reports the installed core version + target, and lists CHANGELOGs core-first', () => {
    const plan = buildUpgradePlan(INSTALLED, '2026-07-14', true, '0.6.6');
    expect(plan).toContain('Installed version:** 0.4.0');
    expect(plan).toContain('Target version:** 0.6.6');
    expect(plan).toContain('node_modules/@luckystack/core/CHANGELOG.md');
    expect(plan.indexOf('@luckystack/core (installed')).toBeLessThan(plan.indexOf('@luckystack/cli (installed'));
  });

  it('flags a missing manifest as sidecar-only and no target as "latest"', () => {
    const plan = buildUpgradePlan(INSTALLED, '2026-07-14', false, null);
    expect(plan).toContain('SIDECAR-ONLY');
    expect(plan).toContain('npm view @luckystack/core version');
  });

  it('reaches the consumer steps that only create-luckystack-app published, through the CLI changelog', () => {
    //? The plan only lists changelogs under node_modules/@luckystack, and a
    //? project never installs create-luckystack-app. The CLI must ship its
    //? changelog, and that changelog must carry the 0.12 / 0.12.1 steps.
    const cliDir = path.resolve(import.meta.dirname, '../..');
    const pkg = JSON.parse(fs.readFileSync(path.join(cliDir, 'package.json'), 'utf8')) as { files: string[] };
    expect(pkg.files).toContain('CHANGELOG.md');
    const changelog = fs.readFileSync(path.join(cliDir, 'CHANGELOG.md'), 'utf8');
    const start = changelog.indexOf('### Upgrading a project scaffolded before 0.12');
    expect(start).toBeGreaterThan(-1);
    const section = changelog.slice(start, changelog.indexOf('\n## [', start));
    for (const step of ['eslint-plugin-jsx-a11y-x', 'eslint-plugin-eslint-comments', 'luckystack/no-untranslated-jsx-text', 'trustedDependencies']) {
      expect(section).toContain(step);
    }
  });

  const cliDir = path.resolve(import.meta.dirname, '../..');
  const scaffoldChangelog = path.resolve(cliDir, '../create-luckystack-app/CHANGELOG.md');
  //? Numbered step `step` under `heading` inside the `version` section, so a newer
  //? release's upgrade list never shadows the one being checked.
  const firstStep = (file: string, version: string, heading: string, step = 1): string => {
    const changelog = fs.readFileSync(file, 'utf8');
    const versionStart = changelog.indexOf(version);
    expect(versionStart).toBeGreaterThan(-1);
    const start = changelog.indexOf(heading, versionStart);
    expect(start).toBeGreaterThan(-1);
    return changelog.slice(start).split('\n').find((line) => line.startsWith(`${String(step)}. `)) ?? '';
  };

  it('carries the 0.15 router step, binding new services in deploy.config.ts, in both changelogs', () => {
    //? Declaring `settings` / `reset-password` in services.config.ts is not enough:
    //? without a deploy.config.ts binding the router answers serviceNotAssigned.
    const cliStep = firstStep(path.join(cliDir, 'CHANGELOG.md'), '## [0.15.0]', '### Upgrading a project scaffolded before 0.15');
    const scaffoldStep = firstStep(scaffoldChangelog, '## [0.15.0]', '### Upgrading an existing project');
    expect(cliStep).toContain('deploy.config.ts');
    expect(cliStep).toContain('serviceNotAssigned');
    expect(cliStep).toBe(scaffoldStep);
  });

  it('carries the 0.16 provider-id schema step in both changelogs', () => {
    const cliStep = firstStep(path.join(cliDir, 'CHANGELOG.md'), '## [0.16.0]', '### Upgrading a project scaffolded before 0.16');
    const scaffoldStep = firstStep(scaffoldChangelog, '## [0.16.0]', '### Upgrading an existing project');
    expect(cliStep).toContain('@@index([provider, providerAccountId])');
    expect(cliStep).toContain('npx luckystack add login');
    expect(cliStep).toBe(scaffoldStep);
  });

  it('carries the 0.16 adapter step, persisting the id from create and update, in both changelogs', () => {
    //? Login binds an existing account with `update(id, { providerAccountId })`.
    const cliStep = firstStep(path.join(cliDir, 'CHANGELOG.md'), '## [0.16.0]', '### Upgrading a project scaffolded before 0.16', 2);
    const scaffoldStep = firstStep(scaffoldChangelog, '## [0.16.0]', '### Upgrading an existing project', 2);
    expect(cliStep).toContain('`create` and `update`');
    expect(cliStep).toBe(scaffoldStep);
  });

  it('handles zero installed packages gracefully', () => {
    const plan = buildUpgradePlan([], '2026-07-14', false, null);
    expect(plan).toContain('unknown');
    expect(plan).toContain('no CHANGELOGs found');
  });
});

describe('runUpgrade', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-upgrade-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const project = (): ConsumerProject => ({ root, pkg: {}, pkgPath: path.join(root, 'package.json') });

  it('writes dump/UPGRADE_PLAN.md with the installed version read from node_modules', () => {
    const coreDir = path.join(root, 'node_modules', '@luckystack', 'core');
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(path.join(coreDir, 'package.json'), JSON.stringify({ version: '0.5.0' }));
    fs.writeFileSync(path.join(coreDir, 'CHANGELOG.md'), '# changelog');

    runUpgrade(project(), '0.6.6', new Date('2026-07-14T00:00:00Z'));

    const plan = fs.readFileSync(path.join(root, 'dump', 'UPGRADE_PLAN.md'), 'utf8');
    expect(plan).toContain('Installed version:** 0.5.0');
    expect(plan).toContain('Target version:** 0.6.6');
    expect(plan).toContain('node_modules/@luckystack/core/CHANGELOG.md');
  });
});
