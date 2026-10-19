import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addRouter, removeRouter, ROUTER_SCRIPT, setInvocationTransport } from './addRouter';
import { assetPath, type ConsumerProject } from '../lib/project';
import { ROUTER_SCRIPT as SCAFFOLDER_ROUTER_SCRIPT } from '../../../create-luckystack-app/src/index';

let root: string;
let project: ConsumerProject;
const socketLine = "invocation: 'socket' as 'socket' | 'routed-http',";
const routedLine = "invocation: 'routed-http' as 'socket' | 'routed-http',";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-add-router-'));
  const pkgPath = path.join(root, 'package.json');
  fs.writeFileSync(pkgPath, '{"name":"fixture"}\n');
  fs.writeFileSync(path.join(root, 'config.ts'), `${socketLine}\n`);
  project = { root, pkgPath, pkg: { name: 'fixture' } };
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('router invocation transport wiring', () => {
  it('switches routed invocation on add and restores socket invocation on remove', () => {
    setInvocationTransport(project, socketLine, routedLine);
    expect(fs.readFileSync(path.join(root, 'config.ts'), 'utf8')).toContain(routedLine);

    setInvocationTransport(project, routedLine, socketLine);
    expect(fs.readFileSync(path.join(root, 'config.ts'), 'utf8')).toContain(socketLine);
  });
});

describe('router npm script (finding 049)', () => {
  it('matches the scaffolder so `add router` and `--router` start the same command', () => {
    expect(ROUTER_SCRIPT).toBe(SCAFFOLDER_ROUTER_SCRIPT);
  });

  it('writes that script, replacing the bare luckystack-router one', () => {
    project.pkg.scripts = { router: 'luckystack-router' };
    vi.spyOn(console, 'log').mockImplementation(() => { /* quiet */ });

    expect(addRouter(project, { install: false, cliVersion: '0.15.0' }).ok).toBe(true);

    const written = JSON.parse(fs.readFileSync(project.pkgPath, 'utf8')) as { scripts: Record<string, string> };
    expect(written.scripts.router).toBe(ROUTER_SCRIPT);
  });
});

describe('remove router keeps edited topology files (finding 068)', () => {
  const placeShipped = (rel: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(assetPath('router', rel), path.join(root, rel));
  };

  it('deletes unedited topology files but keeps and lists an edited deploy.config.ts', () => {
    placeShipped('services.config.ts');
    placeShipped('server/config/presetLoader.ts');
    placeShipped('deploy.config.ts');
    fs.appendFileSync(path.join(root, 'deploy.config.ts'), '// my multi-instance presets\n');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* captured */ });
    vi.spyOn(console, 'log').mockImplementation(() => { /* quiet */ });

    expect(removeRouter(project).ok).toBe(true);

    expect(fs.existsSync(path.join(root, 'services.config.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'server', 'config', 'presetLoader.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'deploy.config.ts'), 'utf8')).toContain('my multi-instance presets');
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain('deploy.config.ts');
  });

  it('keeps the files an edited preset loader imports', () => {
    placeShipped('services.config.ts');
    placeShipped('deploy.config.ts');
    placeShipped('server/config/presetLoader.ts');
    fs.appendFileSync(path.join(root, 'server', 'config', 'presetLoader.ts'), '// tweak\n');
    vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ });
    vi.spyOn(console, 'log').mockImplementation(() => { /* quiet */ });

    expect(removeRouter(project).ok).toBe(true);

    expect(fs.existsSync(path.join(root, 'services.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'deploy.config.ts'))).toBe(true);
  });
});
