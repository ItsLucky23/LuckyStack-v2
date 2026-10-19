//? Owner decision for sweep finding 100: a flag the user passed explicitly is
//? never dropped silently. When it contradicts another flag, a default or a
//? wizard answer, the scaffolder exits 2 before writing anything. Values left to
//? their default keep the quiet normalisation.
//?
//? Finding 051 sits in the same resolution step: a monitoring backend without
//? @luckystack/error-tracking installed an SDK nothing ever fed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CHOICES,
  findFlagConflicts,
  flagOnlyDependencies,
  normalizeChoices,
  parseArgs,
} from './index';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const ENTRY = path.join(import.meta.dirname, 'index.ts');

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const resolvedFrom = (overrides: Partial<typeof DEFAULT_CHOICES>) => ({ ...DEFAULT_CHOICES, ...overrides });

describe('findFlagConflicts', () => {
  it('rejects --oauth when auth resolves to anything but credentials+oauth', () => {
    const args = parseArgs(['app', '--no-prompt', '--oauth=google,github']);
    const conflicts = findFlagConflicts(args, resolvedFrom({ authMode: 'none' }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('--oauth=google,github needs --auth=credentials+oauth');
  });

  it('rejects --oauth next to an explicit --auth=credentials before any prompt', () => {
    const args = parseArgs(['app', '--auth=credentials', '--oauth=google']);
    expect(findFlagConflicts(args, flagOnlyDependencies(args))).toHaveLength(1);
  });

  it('rejects --ai-browser=all next to --no-ai-docs', () => {
    const args = parseArgs(['app', '--no-ai-docs', '--ai-browser=all']);
    expect(findFlagConflicts(args, flagOnlyDependencies(args))[0]).toContain('--ai-browser=all needs the AI dev instructions');
  });

  it('accepts --ai-browser=none next to --no-ai-docs (what `luckystack update` replays)', () => {
    const args = parseArgs(['app', '--no-ai-docs', '--ai-browser=none']);
    expect(findFlagConflicts(args, flagOnlyDependencies(args))).toEqual([]);
  });

  it('rejects --auth next to --orm=none, also on the interactive path', () => {
    const args = parseArgs(['app', '--orm=none', '--auth=credentials']);
    expect(args.prompt).toBe(true);
    expect(findFlagConflicts(args, flagOnlyDependencies(args))[0]).toContain("--auth=credentials needs a data layer");
  });

  it('reports nothing for compatible flags or for flags that were not passed', () => {
    const compatible = parseArgs(['app', '--auth=credentials+oauth', '--oauth=google', '--ai-browser=all']);
    expect(findFlagConflicts(compatible, resolvedFrom({ authMode: 'credentials+oauth', oauthProviders: ['google'] }))).toEqual([]);
    const bare = parseArgs(['app', '--no-ai-docs']);
    expect(findFlagConflicts(bare, resolvedFrom({ aiInstructions: false, aiBrowserTooling: 'none' }))).toEqual([]);
    const emptyOauth = parseArgs(['app', '--oauth=']);
    expect(findFlagConflicts(emptyOauth, resolvedFrom({}))).toEqual([]);
  });

  it('only reports a dependency that is already known', () => {
    const args = parseArgs(['app', '--oauth=google']);
    expect(findFlagConflicts(args, flagOnlyDependencies(args))).toEqual([]);
  });
});

describe('monitoring backend implies error-tracking (051)', () => {
  it('turns error-tracking on when a backend is picked without it', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    for (const monitoringProvider of ['sentry', 'datadog', 'posthog'] as const) {
      expect(normalizeChoices(resolvedFrom({ monitoringProvider, errorTracking: false })).errorTracking).toBe(true);
    }
  });

  it('leaves error-tracking as chosen when no backend is picked', () => {
    expect(normalizeChoices(resolvedFrom({ monitoringProvider: 'none', errorTracking: false })).errorTracking).toBe(false);
    expect(normalizeChoices(resolvedFrom({ monitoringProvider: 'none', errorTracking: true })).errorTracking).toBe(true);
  });
});

describe('create-luckystack-app flag handling (end to end)', () => {
  const run = (flags: string[]) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-flag-conflicts-'));
    created.push(cwd);
    const result = spawnSync(TSX, [ENTRY, 'flag-app', '--no-install', '--no-ai-docs', ...flags], {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
    });
    return { result, appDir: path.join(cwd, 'flag-app') };
  };

  it('exits 2 without writing anything for --oauth while auth stays at its default', () => {
    const { result, appDir } = run(['--no-prompt', '--oauth=google,github']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--oauth=google,github needs --auth=credentials+oauth');
    expect(fs.existsSync(appDir)).toBe(false);
  }, 120_000);

  it('records error-tracking for --monitoring=sentry and ships its shim', () => {
    const { result, appDir } = run(['--no-prompt', '--monitoring=sentry']);
    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(appDir, '.luckystack', 'scaffold.json'), 'utf8')) as {
      choices: { errorTracking: boolean; monitoringProvider: string };
    };
    expect(manifest.choices).toMatchObject({ errorTracking: true, monitoringProvider: 'sentry' });
    const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies).toHaveProperty('@luckystack/error-tracking');
    expect(pkg.dependencies).toHaveProperty('@sentry/node');
    expect(fs.existsSync(path.join(appDir, 'functions', 'sentry.ts'))).toBe(true);
  }, 120_000);
});
