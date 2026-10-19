//? `--router` used to write `"router": "luckystack-router"`. The router CLI exits
//? 2 without --deploy/--services, and the two topology files are TypeScript, so
//? plain node cannot load them: `npm run router` never worked outside Docker.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { ROUTER_SCRIPT, wireRouter } from './index';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const TEMPLATE = path.resolve(import.meta.dirname, '..', 'template');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const flagValue = (script: string, flag: string): string => {
  const parts = script.split(' ');
  const value = parts[parts.indexOf(flag) + 1];
  if (!value || !parts.includes(flag)) throw new Error(`${flag} missing from: ${script}`);
  return value;
};

describe('npm run router (--router scaffold)', () => {
  it('writes the router script into package.json', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-router-script-'));
    created.push(target);
    fs.cpSync(TEMPLATE, target, { recursive: true });
    wireRouter(target, '0.0.0');
    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.router).toBe(ROUTER_SCRIPT);
  });

  it('passes the two flags the router CLI requires, pointing at files the template ships', () => {
    const routerCli = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'router', 'src', 'cli.ts'), 'utf8');
    expect(routerCli).toContain('--deploy and --services are required');
    for (const flag of ['--deploy', '--services']) {
      expect(fs.existsSync(path.join(TEMPLATE, flagValue(ROUTER_SCRIPT, flag)))).toBe(true);
    }
  });

  it("runs the router package's own bin through tsx", () => {
    const routerPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', 'router', 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
    };
    expect(ROUTER_SCRIPT.startsWith('tsx --tsconfig tsconfig.server.json ')).toBe(true);
    expect(ROUTER_SCRIPT).toContain(`node_modules/@luckystack/router/${routerPkg.bin['luckystack-router'] ?? ''}`);
  });

  it('can load both TypeScript topology files with the loader the script uses', () => {
    //? The router CLI imports each file by URL; do the same here, without
    //? starting the router itself.
    const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-router-probe-'));
    created.push(probeDir);
    const probe = path.join(probeDir, 'probe.mjs');
    fs.writeFileSync(probe, [
      "import { pathToFileURL } from 'node:url';",
      "import path from 'node:path';",
      'for (const file of process.argv.slice(2)) await import(pathToFileURL(path.resolve(file)).href);',
      "process.stdout.write('loaded');",
    ].join('\n'));
    const result = spawnSync(
      TSX,
      ['--tsconfig', 'tsconfig.server.json', probe, flagValue(ROUTER_SCRIPT, '--deploy'), flagValue(ROUTER_SCRIPT, '--services')],
      { cwd: TEMPLATE, encoding: 'utf8', timeout: 60_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('loaded');
  }, 60_000);
});
