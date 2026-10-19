//? Integration tests for the imperative Change.apply() closures (the parts the
//? pure planChanges tests don't exercise): env-block writes, the login-UI delete,
//? and dep add/drop. Each runs against a throwaway temp project. We isolate a
//? single change by its summary so heavy asset-copying changes (addLogin) aren't
//? pulled in here — those reuse handlers covered elsewhere.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planChanges, configFromState, type DesiredConfig, type ApplyContext } from './transitions';
import type { ProjectState } from './lib/state';
import { assetPath, type ConsumerProject } from './lib/project';

const cfg = (over: Partial<DesiredConfig> = {}): DesiredConfig => ({
  authMode: 'none',
  oauthProviders: [],
  email: 'none',
  monitoring: 'none',
  toggles: { presence: false, sync: false, cron: false, 'docs-ui': false, 'secret-manager': false, router: false, mcp: false },
  orm: 'prisma',
  dbProvider: 'postgresql',
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
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

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
  //? Place a file with the exact content the framework ships for that path.
  const placeShipped = (rel: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(assetPath('login', rel), path.join(dir, rel));
  };
  const place = (rel: string, content: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };

  it('removes the shipped login files (incl. logout_v1, which needs the session shim) and @luckystack/login', () => {
    placeShipped('src/login/page.tsx');
    placeShipped('src/_components/LoginForm.tsx');
    placeShipped('src/_api/logout_v1.ts');
    placeShipped('functions/session.ts');

    applyOne(planChanges(cfg({ authMode: 'credentials' }), cfg()), 'Auth: → none');
    expect(fs.existsSync(path.join(dir, 'src', 'login'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'src', '_components', 'LoginForm.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'src', '_api', 'logout_v1.ts'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'functions', 'session.ts'))).toBe(false);
    expect(readPkg().dependencies?.['@luckystack/login']).toBeUndefined();
  });

  it('keeps files the user added or edited in the auth folders, and lists them in the preview and the result', () => {
    placeShipped('src/settings/page.tsx');
    place('src/settings/billing/page.tsx', 'export default function Billing() { return null; }\n');
    place('functions/session.ts', "export * from '@luckystack/login'; // my tweak\n");
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* captured */ });
    vi.spyOn(console, 'log').mockImplementation(() => { /* quiet */ });

    const changes = planChanges(cfg({ authMode: 'credentials' }), cfg(), dir);
    const preview = changes.find((c) => c.summary.includes('Auth: → none'))?.effects.join('\n') ?? '';
    expect(preview).toContain('src/settings/billing/page.tsx');
    expect(preview).toContain('functions/session.ts  ⚠ uses @luckystack/login');
    expect(preview).not.toContain('    src/settings/page.tsx');

    applyOne(changes, 'Auth: → none');
    expect(fs.existsSync(path.join(dir, 'src', 'settings', 'page.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'src', 'settings', 'billing', 'page.tsx'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'functions', 'session.ts'), 'utf8')).toContain('my tweak');
    const warned = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(warned).toContain('src/settings/billing/page.tsx');
    expect(warned).toContain('functions/session.ts');
  });

  it('treats a file matching the scaffold manifest hash as shipped even when the cli asset moved on', () => {
    const olderRender = '// login page as an older scaffold rendered it\n';
    place('src/login/page.tsx', olderRender);
    place('.luckystack/scaffold.json', `${JSON.stringify({
      schemaVersion: 1,
      luckystackVersion: '0.1.0',
      createdAt: '2026-01-01T00:00:00.000Z',
      projectName: 't',
      choices: {},
      files: [{ path: 'src/login/page.tsx', sha256: crypto.createHash('sha256').update(olderRender).digest('hex') }],
    })}\n`);

    applyOne(planChanges(cfg({ authMode: 'credentials' }), cfg()), 'Auth: → none');
    expect(fs.existsSync(path.join(dir, 'src', 'login'))).toBe(false);
  });

  it('drops the /login guard from the new-page generators and names an edited one instead', () => {
    //? Review 1 finding 7: same generators as the --auth=none scaffold (098).
    const template = path.resolve(import.meta.dirname, '..', '..', 'create-luckystack-app', 'template');
    place('scripts/scaffoldPage.mjs', fs.readFileSync(path.join(template, 'scripts', 'scaffoldPage.mjs'), 'utf8'));
    const editedTemplate = fs
      .readFileSync(path.join(template, '_dot_luckystack', 'templates', 'page_dashboard.template.tsx'), 'utf8')
      .replace('//? Default: require login.', '//? Team default: require login.');
    place('.luckystack/templates/page_dashboard.template.tsx', editedTemplate);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* captured */ });
    vi.spyOn(console, 'log').mockImplementation(() => { /* quiet */ });

    const changes = planChanges(cfg({ authMode: 'credentials' }), cfg(), dir);
    const preview = changes.find((c) => c.summary.includes('Auth: → none'))?.effects.join('\n') ?? '';
    expect(preview).toContain('⚠ .luckystack/templates/page_dashboard.template.tsx was edited');
    expect(preview).not.toContain('⚠ scripts/scaffoldPage.mjs');

    applyOne(changes, 'Auth: → none');
    expect(fs.readFileSync(path.join(dir, 'scripts', 'scaffoldPage.mjs'), 'utf8'))
      .not.toMatch(/^\s*if \(!session\) return \{ success: false, redirect: '\/login' \};/m);
    expect(fs.readFileSync(path.join(dir, '.luckystack', 'templates', 'page_dashboard.template.tsx'), 'utf8')).toBe(editedTemplate);
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain('page_dashboard.template.tsx was edited');
  });
});

describe('Change.apply — email & monitoring deps + env', () => {
  it('email none → resend adds the package + placeholder keys', () => {
    applyOne(planChanges(cfg(), cfg({ email: 'resend' })), 'Email: none → resend');
    expect(readPkg().dependencies?.['@luckystack/email']).toBeDefined();
    expect(readLocal()).toContain('RESEND_API_KEY=');
  });

  it('email transport switches add and drop the transport package the adapter loads', () => {
    applyOne(planChanges(cfg(), cfg({ email: 'smtp' })), 'Email: none → smtp');
    expect(readPkg().dependencies).toMatchObject({ nodemailer: '^10.0.0' });

    applyOne(planChanges(cfg({ email: 'smtp' }), cfg({ email: 'resend' })), 'Email: smtp → resend');
    expect(readPkg().dependencies).toMatchObject({ resend: '^6.0.0' });
    expect(readPkg().dependencies?.nodemailer).toBeUndefined();

    applyOne(planChanges(cfg({ email: 'resend' }), cfg({ email: 'none' })), 'Email: resend → none');
    expect(readPkg().dependencies?.resend).toBeUndefined();
    expect(readPkg().dependencies?.['@luckystack/email']).toBeUndefined();
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
      orm: 'prisma',
      dbProvider: 'mongodb',
      packages: { presence: true, sync: false, 'docs-ui': true, login: true, email: true, 'error-tracking': true },
    };
    expect(configFromState(state)).toEqual({
      authMode: 'credentials+oauth',
      oauthProviders: ['google'],
      email: 'resend',
      monitoring: 'sentry',
      orm: 'prisma',
      dbProvider: 'mongodb',
      //? toggles cover every TOGGLE_ID; ids absent from packages default to false.
      toggles: { presence: true, sync: false, cron: false, 'docs-ui': true, 'secret-manager': false, router: false, mcp: false },
    });
  });
});
