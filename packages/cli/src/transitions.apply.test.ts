//? Integration tests for the imperative Change.apply() closures (the parts the
//? pure planChanges tests don't exercise): env-block writes, the login-UI delete,
//? and dep add/drop. Each runs against a throwaway temp project. We isolate a
//? single change by its summary so heavy asset-copying changes (addLogin) aren't
//? pulled in here — those reuse handlers covered elsewhere.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planChanges, configFromState, type DesiredConfig, type ApplyContext } from './transitions';
import type { ProjectState } from './lib/state';
import type { ConsumerProject } from './lib/project';

const cfg = (over: Partial<DesiredConfig> = {}): DesiredConfig => ({
  authMode: 'none',
  oauthProviders: [],
  email: 'none',
  monitoring: 'none',
  toggles: { presence: false, sync: false, 'docs-ui': false, 'secret-manager': false, router: false, mcp: false },
  ...over,
});

let dir: string;
let project: ConsumerProject;
const localPath = (): string => path.join(dir, '.env.local');
const readLocal = (): string => fs.readFileSync(localPath(), 'utf8');
const readPkg = (): ConsumerProject['pkg'] => JSON.parse(fs.readFileSync(project.pkgPath, 'utf8'));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-tx-'));
  const pkgPath = path.join(dir, 'package.json');
  const pkg = { name: 't', dependencies: { '@luckystack/core': '^0.2.5', '@luckystack/login': '^0.2.5' } };
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  project = { root: dir, pkgPath, pkg: JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as ConsumerProject['pkg'] };
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const ctx = (): ApplyContext => ({ project, cliVersion: '0.2.5', declaredKeys: new Set<string>() });

//? Apply only the change whose summary matches `needle`.
const applyOne = (changes: ReturnType<typeof planChanges>, needle: string): void => {
  const change = changes.find((c) => c.summary.includes(needle));
  expect(change, `no change matching "${needle}"`).toBeDefined();
  const result = change?.apply(ctx());
  expect(result?.ok).toBe(true);
};

describe('Change.apply — OAuth provider', () => {
  it('add writes the placeholder block + origin', () => {
    const changes = planChanges(cfg({ authMode: 'credentials' }), cfg({ authMode: 'credentials+oauth', oauthProviders: ['google'] }));
    applyOne(changes, 'OAuth provider google: add');
    expect(readLocal()).toContain('# >>> luckystack:oauth:google >>>');
    expect(readLocal()).toContain('DEV_GOOGLE_CLIENT_ID=');
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf8')).toContain('EXTERNAL_ORIGINS=https://accounts.google.com');
  });

  it('remove drops the CLI block + origin', () => {
    //? Seed an added block first.
    applyOne(planChanges(cfg({ authMode: 'credentials' }), cfg({ authMode: 'credentials+oauth', oauthProviders: ['google'] })), 'google: add');
    applyOne(planChanges(cfg({ authMode: 'credentials+oauth', oauthProviders: ['google'] }), cfg({ authMode: 'credentials' })), 'google: remove');
    expect(readLocal()).not.toContain('DEV_GOOGLE_CLIENT_ID=');
  });
});

describe('Change.apply — auth → none deletes the UI + drops the dep', () => {
  it('removes the login dirs and @luckystack/login', () => {
    fs.mkdirSync(path.join(dir, 'src', 'login'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'login', 'page.tsx'), '// login');
    fs.mkdirSync(path.join(dir, 'src', '_components'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', '_components', 'LoginForm.tsx'), '// form');

    applyOne(planChanges(cfg({ authMode: 'credentials' }), cfg()), 'Auth: → none');
    expect(fs.existsSync(path.join(dir, 'src', 'login'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'src', '_components', 'LoginForm.tsx'))).toBe(false);
    expect(readPkg().dependencies?.['@luckystack/login']).toBeUndefined();
  });
});

describe('Change.apply — email & monitoring deps + env', () => {
  it('email none → resend adds the package + placeholder keys', () => {
    applyOne(planChanges(cfg(), cfg({ email: 'resend' })), 'Email: none → resend');
    expect(readPkg().dependencies?.['@luckystack/email']).toBeDefined();
    expect(readLocal()).toContain('RESEND_API_KEY=');
  });

  it('monitoring none → sentry adds error-tracking + @sentry/node + DSN placeholder', () => {
    applyOne(planChanges(cfg(), cfg({ monitoring: 'sentry' })), 'Monitoring: none → sentry');
    const deps = readPkg().dependencies ?? {};
    expect(deps['@luckystack/error-tracking']).toBeDefined();
    expect(deps['@sentry/node']).toBeDefined();
    expect(readLocal()).toContain('SENTRY_DSN=');
  });
});

describe('Change.apply — upsertEnvBlock skips when key already declared (stale-set idempotency)', () => {
  it('does not add a placeholder block when the id key is already in declaredKeys', () => {
    //? Simulate a user who previously hand-filled DEV_GOOGLE_CLIENT_ID in .env.local
    //? (no sentinel) — the apply must skip re-adding the placeholder and succeed.
    const handFilledKey = 'DEV_GOOGLE_CLIENT_ID';
    const handFilledCtx = (): ApplyContext => ({ project, cliVersion: '0.2.5', declaredKeys: new Set([handFilledKey]) });
    const changes = planChanges(cfg({ authMode: 'credentials' }), cfg({ authMode: 'credentials+oauth', oauthProviders: ['google'] }));
    const change = changes.find((c) => c.summary.includes('OAuth provider google: add'));
    expect(change, 'no google:add change').toBeDefined();
    const result = change?.apply(handFilledCtx());
    expect(result?.ok).toBe(true);
    //? .env.local must NOT have been created (the block was skipped).
    expect(fs.existsSync(path.join(dir, '.env.local'))).toBe(false);
  });
});

//? Guard configFromState round-trips a detected state into a DesiredConfig.
describe('configFromState', () => {
  it('maps a ProjectState into the editable config shape', () => {
    const state: ProjectState = {
      authMode: 'credentials+oauth',
      oauthProviders: ['google'],
      email: 'resend',
      monitoring: 'sentry',
      packages: { presence: true, sync: false, 'docs-ui': true, login: true, email: true, 'error-tracking': true },
    };
    expect(configFromState(state)).toEqual({
      authMode: 'credentials+oauth',
      oauthProviders: ['google'],
      email: 'resend',
      monitoring: 'sentry',
      //? toggles cover every TOGGLE_ID; ids absent from packages default to false.
      toggles: { presence: true, sync: false, 'docs-ui': true, 'secret-manager': false, router: false, mcp: false },
    });
  });
});
