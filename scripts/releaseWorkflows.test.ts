import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

//? Regression tests for the GitHub release workflows (sweep 065, 113, 115).
//? The workflows have no runner locally, so these read the YAML as text: the
//? tag check's Node script is extracted and executed against fixture packages,
//? and the step order / conditions that make up the gates are asserted.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const publishYml = readFileSync(path.join(repoRoot, '.github', 'workflows', 'publish.yml'), 'utf8');
const ciYml = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

const stepIndex = (yml: string, name: string): number => yml.indexOf(`- name: ${name}`);

//? The heredoc body of the tag step, de-indented to plain JavaScript.
const extractTagCheckScript = (): string => {
  const step = publishYml.slice(stepIndex(publishYml, 'Tag must equal the lockstep package version'));
  const body = /<<'NODE'\n([\s\S]*?)\n\s*NODE\n/.exec(step)?.[1];
  if (!body) throw new Error('tag check heredoc not found in publish.yml');
  const indent = /^ */.exec(body)?.[0].length ?? 0;
  return body.split('\n').map((line) => line.slice(indent)).join('\n');
};

const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const runTagCheck = (tag: string, versions: Record<string, string>): { status: number | null; output: string } => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ls-tag-check-'));
  fixtures.push(dir);
  for (const [name, version] of Object.entries(versions)) {
    mkdirSync(path.join(dir, 'packages', name), { recursive: true });
    writeFileSync(path.join(dir, 'packages', name, 'package.json'), JSON.stringify({ name: `@luckystack/${name}`, version }));
  }
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', extractTagCheckScript()], {
    cwd: dir,
    env: { ...process.env, RELEASE_TAG: tag },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

describe('publish.yml — tag must equal the lockstep version (sweep 065)', () => {
  it('passes when every package is on the tag version', () => {
    expect(runTagCheck('v0.15.0', { core: '0.15.0', router: '0.15.0' }).status).toBe(0);
  });

  it('fails a tag on a commit whose version bump was forgotten', () => {
    const result = runTagCheck('v0.15.0', { core: '0.14.0', router: '0.14.0' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('does not match the package version 0.14.0');
  });

  it('fails when the packages are not on one version', () => {
    const result = runTagCheck('v0.15.0', { core: '0.15.0', router: '0.14.0' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('not on one lockstep version');
  });

  it('runs on every tag ref, before dependencies are installed', () => {
    const step = publishYml.slice(stepIndex(publishYml, 'Tag must equal the lockstep package version'));
    expect(step).toMatch(/^.*\n\s+if: \$\{\{ startsWith\(github\.ref, 'refs\/tags\/'\) \}\}/);
    expect(stepIndex(publishYml, 'Tag must equal the lockstep package version')).toBeLessThan(stepIndex(publishYml, 'Install dependencies'));
  });

  it('refuses a real manual publish from a ref that is not a version tag', () => {
    const step = publishYml.slice(stepIndex(publishYml, 'Real publish requires a version tag'));
    expect(step).toContain("if: ${{ github.event_name == 'workflow_dispatch' && !inputs.dry_run && !startsWith(github.ref, 'refs/tags/v') }}");
    expect(step).toMatch(/exit 1/);
  });
});

describe('publish.yml — a green ci run gates the real publish (sweep 113)', () => {
  const gate = 'Require a green `ci` run for this commit';

  it('checks the ci workflow for the exact commit before installing or publishing', () => {
    expect(stepIndex(publishYml, gate)).toBeGreaterThan(-1);
    expect(stepIndex(publishYml, gate)).toBeLessThan(stepIndex(publishYml, 'Install dependencies'));
    expect(stepIndex(publishYml, gate)).toBeLessThan(stepIndex(publishYml, 'Publish (real, with provenance)'));
    const step = publishYml.slice(stepIndex(publishYml, gate), stepIndex(publishYml, 'Ensure provenance-capable npm'));
    expect(step).toContain('actions/workflows/ci.yml/runs?head_sha=${GITHUB_SHA}');
    expect(step).toContain('.conclusion == "success"');
  });

  it('applies to every run that can publish for real (only a dry run skips it)', () => {
    const step = publishYml.slice(stepIndex(publishYml, gate));
    expect(step).toMatch(/^.*\n\s+if: \$\{\{ !\(github\.event_name == 'workflow_dispatch' && inputs\.dry_run\) \}\}/);
  });

  it('has permission to read workflow runs', () => {
    expect(publishYml).toMatch(/permissions:[\s\S]*?\n\s+actions: read/);
  });

  //? Review 1 finding 8: one transient `gh api` error ended the step (the shell
  //? exits on the first failing command), and a run that a later push cancelled
  //? was reported without saying so.
  const gateStep = (): string => publishYml.slice(stepIndex(publishYml, gate), stepIndex(publishYml, 'Ensure provenance-capable npm'));

  it('retries a failed gh api call instead of ending the step', () => {
    expect(gateStep()).toMatch(/if runs=\$\(gh api /);
    expect(gateStep()).toContain('retrying');
  });

  it('names a cancelled run and how to recover', () => {
    expect(gateStep()).toContain('was cancelled or failed');
    expect(gateStep()).toContain('Re-run ci for this commit');
  });

  const jq = spawnSync('jq', ['--version']).status === 0;
  const runVerdict = (runs: { status: string; conclusion: string | null }[]): string => {
    const program = /verdict='([^']+)'/.exec(gateStep())?.[1];
    if (!program) throw new Error('verdict program not found in publish.yml');
    const result = spawnSync('jq', ['-r', program], { input: JSON.stringify(runs), encoding: 'utf8' });
    return result.stdout.trim();
  };

  it.skipIf(!jq).each([
    ['success', [{ status: 'completed', conclusion: 'failure' }, { status: 'completed', conclusion: 'success' }]],
    ['failed', [{ status: 'completed', conclusion: 'failure' }]],
    ['failed', [{ status: 'completed', conclusion: 'cancelled' }]],
    ['none', []],
    ['pending', [{ status: 'in_progress', conclusion: null }, { status: 'completed', conclusion: 'cancelled' }]],
  ] as const)('decides %s for %j', (expected, runs) => {
    expect(runVerdict([...runs])).toBe(expected);
  });
});

describe('workflow npm scripts exist (sweep 115)', () => {
  //? ci.yml ran `npm run test:e2e`, which the root package.json never defined;
  //? `continue-on-error` hid the failure.
  const scripts = Object.keys((JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts);

  it.each([['ci.yml', ciYml], ['publish.yml', publishYml]])('%s only runs scripts defined in package.json', (_name, yml) => {
    const used = [...yml.matchAll(/npm run ([\w:.-]+)/g)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((script) => script !== undefined && !scripts.includes(script))).toEqual([]);
  });
});
