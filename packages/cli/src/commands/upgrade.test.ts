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
