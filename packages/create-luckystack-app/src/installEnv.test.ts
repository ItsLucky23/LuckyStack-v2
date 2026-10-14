import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
//? Cross-package import, TEST-ONLY — the same precedent as index.test.ts: the
//? scaffolder stays zero-dep, so the CLI keeps its own copy and this pins both.
import { installEnv as cliInstallEnv } from '../../cli/src/lib/project';
import { installEnv } from './index';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('installEnv', () => {
  const env = {
    PATH: '/usr/bin',
    npm_config_allow_scripts: 'esbuild',
    NPM_CONFIG_ALLOW_SCRIPTS: 'esbuild',
    'npm_config_allow-scripts': 'esbuild',
    npm_config_registry: 'http://127.0.0.1:4873',
  };

  it('drops only the allow-scripts variable, in every spelling npm reads', () => {
    expect(installEnv(env)).toEqual({ PATH: '/usr/bin', npm_config_registry: 'http://127.0.0.1:4873' });
  });

  it('is identical in the CLI', () => {
    expect(cliInstallEnv(env)).toEqual(installEnv(env));
  });

  it('lets a real npm install run that npm rejects with the inherited variable', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-install-env-'));
    dirs.push(project);
    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"probe","version":"0.0.0","private":true}\n');
    const npmInstall = (childEnv: NodeJS.ProcessEnv) =>
      spawnSync('npm', ['install', '--offline', '--no-audit', '--no-fund'], { cwd: project, encoding: 'utf8', env: childEnv });

    const inherited = npmInstall({ ...process.env, npm_config_allow_scripts: 'esbuild' });
    //? Only npm versions with the allow-scripts policy (11.19+) reject it; on
    //? older npm there is nothing to prove.
    if (!`${inherited.stdout}${inherited.stderr}`.includes('EALLOWSCRIPTS')) return;
    expect(inherited.status).not.toBe(0);
    expect(npmInstall(installEnv({ ...process.env, npm_config_allow_scripts: 'esbuild' })).status).toBe(0);
  });
});
