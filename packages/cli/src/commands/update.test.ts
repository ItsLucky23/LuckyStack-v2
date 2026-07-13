import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  choicesToFlags,
  hashFileContent,
  isSafeSurfacePath,
  isUpdatablePath,
  planUpdate,
  readScaffoldManifest,
  runUpdate,
  MANIFEST_RELATIVE_PATH,
  type ScaffoldManifest,
} from './update';
import type { ConsumerProject } from '../lib/project';

let consumerDir: string;
let freshDir: string;

beforeEach(() => {
  consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-upd-consumer-'));
  freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-upd-fresh-'));
});
afterEach(() => {
  fs.rmSync(consumerDir, { recursive: true, force: true });
  fs.rmSync(freshDir, { recursive: true, force: true });
});

const write = (root: string, relative: string, content: string): void => {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};

const sha = (content: string): string => hashFileContent(Buffer.from(content), true);

const manifestFor = (
  root: string,
  files: Record<string, string>,
  overrides: Partial<ScaffoldManifest> = {},
): ScaffoldManifest => {
  const manifest: ScaffoldManifest = {
    schemaVersion: 1,
    luckystackVersion: '0.4.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    projectName: 'app',
    choices: { dbProvider: 'mongodb' },
    files: Object.entries(files)
      .map(([p, content]) => ({ path: p, sha256: sha(content) }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    ...overrides,
  };
  write(root, MANIFEST_RELATIVE_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};

const project = (): ConsumerProject => ({
  root: consumerDir,
  pkg: {},
  pkgPath: path.join(consumerDir, 'package.json'),
});

describe('isSafeSurfacePath', () => {
  it('accepts the framework-owned bucket and rejects user code', () => {
    expect(isSafeSurfacePath('CLAUDE.md')).toBe(true);
    expect(isSafeSurfacePath('docs/luckystack/ARCHITECTURE_API.md')).toBe(true);
    expect(isSafeSurfacePath('skills/custom/foo.md')).toBe(true);
    expect(isSafeSurfacePath('.claude/commands/save.md')).toBe(true);
    expect(isSafeSurfacePath('scripts/generateTypeMaps.ts')).toBe(true);
    expect(isSafeSurfacePath('.luckystack/templates/page.tsx')).toBe(true);

    expect(isSafeSurfacePath('src/login/page.tsx')).toBe(false);
    expect(isSafeSurfacePath('functions/db.ts')).toBe(false);
    expect(isSafeSurfacePath('config.ts')).toBe(false);
    expect(isSafeSurfacePath('prisma/schema.prisma')).toBe(false);
    expect(isSafeSurfacePath('docs/PRODUCT.md')).toBe(false);
    expect(isSafeSurfacePath('.env.local')).toBe(false);
  });
});

describe('isUpdatablePath (ADR 0025 --app scope)', () => {
  it('framework scope = bucket B only (never src/ or config)', () => {
    expect(isUpdatablePath('CLAUDE.md', 'framework')).toBe(true);
    expect(isUpdatablePath('scripts/generateTypeMaps.ts', 'framework')).toBe(true);
    expect(isUpdatablePath('src/_components/LoginForm.tsx', 'framework')).toBe(false);
    expect(isUpdatablePath('config.ts', 'framework')).toBe(false);
  });

  it('app scope ALSO updates framework-authored app files', () => {
    expect(isUpdatablePath('src/_components/LoginForm.tsx', 'app')).toBe(true);
    expect(isUpdatablePath('src/settings/_components/TwoFactorSection.tsx', 'app')).toBe(true);
    expect(isUpdatablePath('functions/session.ts', 'app')).toBe(true);
    expect(isUpdatablePath('config.ts', 'app')).toBe(true);
    expect(isUpdatablePath('tsconfig.server.json', 'app')).toBe(true);
    expect(isUpdatablePath('CLAUDE.md', 'app')).toBe(true); //? bucket B still included
  });

  it('app scope STILL never touches schema / deps / secrets / manifest', () => {
    expect(isUpdatablePath('prisma/schema.prisma', 'app')).toBe(false);
    expect(isUpdatablePath('package.json', 'app')).toBe(false);
    expect(isUpdatablePath('package-lock.json', 'app')).toBe(false);
    expect(isUpdatablePath('.env', 'app')).toBe(false);
    expect(isUpdatablePath('.env.local', 'app')).toBe(false);
    expect(isUpdatablePath('.luckystack/scaffold.json', 'app')).toBe(false);
  });
});

describe('choicesToFlags', () => {
  it('maps recorded choices onto scaffolder flags', () => {
    expect(
      choicesToFlags({
        orm: 'prisma',
        dbProvider: 'postgresql',
        authMode: 'credentials+oauth',
        oauthProviders: ['google', 'github'],
        emailProvider: 'resend',
        monitoringProvider: 'sentry',
        presence: true,
        errorTracking: true,
        docsUi: false,
        secretManager: false,
        router: true,
        aiInstructions: true,
        aiBrowserTooling: 'agent-browser',
      }),
    ).toEqual([
      '--orm=prisma',
      '--db=postgresql',
      '--auth=credentials+oauth',
      '--oauth=google,github',
      '--email=resend',
      '--monitoring=sentry',
      '--presence',
      '--error-tracking',
      '--router',
      '--ai-browser=agent-browser',
    ]);
  });

  it('is tolerant of missing/unknown keys and maps aiInstructions=false', () => {
    expect(choicesToFlags({ aiInstructions: false, mysteryFutureChoice: 'x' })).toEqual([
      '--no-ai-docs',
    ]);
  });
});

describe('planUpdate', () => {
  it('classifies add / unchanged / overwrite (pristine) / sidecar (modified)', () => {
    //? Consumer state: one pristine file, one user-modified file, one missing.
    write(consumerDir, 'CLAUDE.md', 'old claude\n');
    write(consumerDir, 'docs/luckystack/GUIDE.md', 'USER EDITED\n');
    const consumerManifest = manifestFor(consumerDir, {
      'CLAUDE.md': 'old claude\n',
      'docs/luckystack/GUIDE.md': 'old guide\n',
    });

    //? Fresh render: CLAUDE.md changed upstream, GUIDE.md changed upstream,
    //? one brand-new file, one file identical to the consumer's copy.
    write(freshDir, 'CLAUDE.md', 'new claude\n');
    write(freshDir, 'docs/luckystack/GUIDE.md', 'new guide\n');
    write(freshDir, 'skills/custom/new-skill.md', 'skill\n');
    write(consumerDir, '.claude/commands/save.md', 'same\n');
    write(freshDir, '.claude/commands/save.md', 'same\n');
    //? Out-of-surface fresh file must be ignored entirely.
    write(freshDir, 'src/page.tsx', 'export {}\n');
    const freshManifest = manifestFor(freshDir, {
      'CLAUDE.md': 'new claude\n',
      'docs/luckystack/GUIDE.md': 'new guide\n',
      'skills/custom/new-skill.md': 'skill\n',
      '.claude/commands/save.md': 'same\n',
      'src/page.tsx': 'export {}\n',
    }, { luckystackVersion: '0.5.0' });

    const plan = planUpdate(consumerDir, consumerManifest, freshManifest);
    const byPath = Object.fromEntries(plan.entries.map((e) => [e.path, e.action]));
    expect(byPath).toEqual({
      'CLAUDE.md': 'overwrite',
      'docs/luckystack/GUIDE.md': 'sidecar',
      'skills/custom/new-skill.md': 'add',
      '.claude/commands/save.md': 'unchanged',
    });
  });

  it('without a manifest, differing files are sidecar-only (never overwrite)', () => {
    write(consumerDir, 'CLAUDE.md', 'old claude\n');
    write(freshDir, 'CLAUDE.md', 'new claude\n');
    const freshManifest = manifestFor(freshDir, { 'CLAUDE.md': 'new claude\n' });

    const plan = planUpdate(consumerDir, null, freshManifest);
    expect(plan.manifestPresent).toBe(false);
    expect(plan.entries).toEqual([
      { path: 'CLAUDE.md', action: 'sidecar', freshSha256: sha('new claude\n') },
    ]);
  });

  it('treats CRLF-only differences as unchanged (git autocrlf survival)', () => {
    write(consumerDir, 'CLAUDE.md', 'line one\r\nline two\r\n');
    write(freshDir, 'CLAUDE.md', 'line one\nline two\n');
    const consumerManifest = manifestFor(consumerDir, { 'CLAUDE.md': 'line one\nline two\n' });
    const freshManifest = manifestFor(freshDir, { 'CLAUDE.md': 'line one\nline two\n' });

    const plan = planUpdate(consumerDir, consumerManifest, freshManifest);
    expect(plan.entries[0]?.action).toBe('unchanged');
  });
});

describe('applyUpdate + runUpdate (injected fresh render)', () => {
  it('overwrites pristine, sidecars modified, adds new, refreshes the manifest, writes a report', () => {
    write(consumerDir, 'CLAUDE.md', 'old claude\n');
    write(consumerDir, 'docs/luckystack/GUIDE.md', 'USER EDITED\n');
    manifestFor(consumerDir, {
      'CLAUDE.md': 'old claude\n',
      'docs/luckystack/GUIDE.md': 'old guide\n',
    });

    write(freshDir, 'CLAUDE.md', 'new claude\n');
    write(freshDir, 'docs/luckystack/GUIDE.md', 'new guide\n');
    write(freshDir, 'skills/custom/new-skill.md', 'skill\n');
    manifestFor(freshDir, {
      'CLAUDE.md': 'new claude\n',
      'docs/luckystack/GUIDE.md': 'new guide\n',
      'skills/custom/new-skill.md': 'skill\n',
    }, { luckystackVersion: '0.5.0' });

    const result = runUpdate(project(), {
      cliVersion: '0.5.0',
      renderFreshScaffold: () => ({ projectDir: freshDir, cleanup: () => undefined }),
    });
    expect(result.ok).toBe(true);

    //? Pristine file replaced; modified file untouched but has a .new twin.
    expect(fs.readFileSync(path.join(consumerDir, 'CLAUDE.md'), 'utf8')).toBe('new claude\n');
    expect(fs.readFileSync(path.join(consumerDir, 'docs/luckystack/GUIDE.md'), 'utf8')).toBe('USER EDITED\n');
    expect(fs.readFileSync(path.join(consumerDir, 'docs/luckystack/GUIDE.md.new'), 'utf8')).toBe('new guide\n');
    expect(fs.readFileSync(path.join(consumerDir, 'skills/custom/new-skill.md'), 'utf8')).toBe('skill\n');

    //? Manifest refreshed: written files get the new hash, sidecarred keeps old baseline.
    const updated = readScaffoldManifest(consumerDir);
    expect(updated?.luckystackVersion).toBe('0.5.0');
    expect(updated?.updatedAt).toBeDefined();
    const hashes = Object.fromEntries((updated?.files ?? []).map((f) => [f.path, f.sha256]));
    expect(hashes['CLAUDE.md']).toBe(sha('new claude\n'));
    expect(hashes['skills/custom/new-skill.md']).toBe(sha('skill\n'));
    expect(hashes['docs/luckystack/GUIDE.md']).toBe(sha('old guide\n'));

    //? Report written under dump/ and mentions the sidecar.
    const dumpDir = path.join(consumerDir, 'dump');
    const reports = fs.readdirSync(dumpDir).filter((f) => f.startsWith('UPDATE_'));
    expect(reports).toHaveLength(1);
    const report = fs.readFileSync(path.join(dumpDir, String(reports[0])), 'utf8');
    expect(report).toContain('docs/luckystack/GUIDE.md');
    expect(report).toContain('AI merge instruction');
  });

  it('stamp-less mode: nothing overwritten, no manifest fabricated', () => {
    write(consumerDir, 'CLAUDE.md', 'old claude\n');
    write(freshDir, 'CLAUDE.md', 'new claude\n');
    manifestFor(freshDir, { 'CLAUDE.md': 'new claude\n' });

    const result = runUpdate(project(), {
      cliVersion: '0.5.0',
      renderFreshScaffold: () => ({ projectDir: freshDir, cleanup: () => undefined }),
    });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(consumerDir, 'CLAUDE.md'), 'utf8')).toBe('old claude\n');
    expect(fs.existsSync(path.join(consumerDir, 'CLAUDE.md.new'))).toBe(true);
    expect(fs.existsSync(path.join(consumerDir, MANIFEST_RELATIVE_PATH))).toBe(false);
  });

  it('fails cleanly when the fresh render cannot be produced', () => {
    manifestFor(consumerDir, {});
    const result = runUpdate(project(), {
      cliVersion: '0.5.0',
      renderFreshScaffold: () => null,
    });
    expect(result.ok).toBe(false);
  });

  //? ADR 0025: the --app scenario that motivated the feature — a feature
  //? release ships a NEW framework src/ file + CHANGES an existing one, while
  //? the developer has edited some framework files and has their own app code.
  it('--app scope: delivers new framework src/ files, sidecars edited ones, never touches user code / schema', () => {
    //? Consumer: edited LoginForm (framework file), pristine page.tsx (framework
    //? file), their OWN component, an edited prisma schema.
    write(consumerDir, 'src/_components/LoginForm.tsx', 'USER-EDITED FORM\n');
    write(consumerDir, 'src/login/page.tsx', 'old page\n');
    write(consumerDir, 'src/_components/MyOwnThing.tsx', 'my code\n');
    write(consumerDir, 'prisma/schema.prisma', 'model User { many fields }\n');
    manifestFor(consumerDir, {
      'src/_components/LoginForm.tsx': 'old form\n',
      'src/login/page.tsx': 'old page\n',
      'prisma/schema.prisma': 'model User { }\n',
    });

    //? Fresh render (new version): LoginForm changed, page.tsx changed, a
    //? brand-new TwoFactorSection, and a changed schema.
    write(freshDir, 'src/_components/LoginForm.tsx', 'new form with 2fa\n');
    write(freshDir, 'src/login/page.tsx', 'new page\n');
    write(freshDir, 'src/settings/_components/TwoFactorSection.tsx', 'new 2fa section\n');
    write(freshDir, 'prisma/schema.prisma', 'model User { + twoFactor fields }\n');
    manifestFor(freshDir, {
      'src/_components/LoginForm.tsx': 'new form with 2fa\n',
      'src/login/page.tsx': 'new page\n',
      'src/settings/_components/TwoFactorSection.tsx': 'new 2fa section\n',
      'prisma/schema.prisma': 'model User { + twoFactor fields }\n',
    }, { luckystackVersion: '0.6.0' });

    const result = runUpdate(project(), {
      cliVersion: '0.6.0',
      scope: 'app',
      renderFreshScaffold: () => ({ projectDir: freshDir, cleanup: () => undefined }),
    });
    expect(result.ok).toBe(true);

    //? New framework file delivered.
    expect(fs.readFileSync(path.join(consumerDir, 'src/settings/_components/TwoFactorSection.tsx'), 'utf8')).toBe('new 2fa section\n');
    //? Edited framework file: NOT overwritten, gets a `.new` sidecar.
    expect(fs.readFileSync(path.join(consumerDir, 'src/_components/LoginForm.tsx'), 'utf8')).toBe('USER-EDITED FORM\n');
    expect(fs.readFileSync(path.join(consumerDir, 'src/_components/LoginForm.tsx.new'), 'utf8')).toBe('new form with 2fa\n');
    //? Pristine framework file: refreshed to the new version.
    expect(fs.readFileSync(path.join(consumerDir, 'src/login/page.tsx'), 'utf8')).toBe('new page\n');
    //? The developer's OWN file (never in the fresh render) is untouched, no sidecar.
    expect(fs.readFileSync(path.join(consumerDir, 'src/_components/MyOwnThing.tsx'), 'utf8')).toBe('my code\n');
    expect(fs.existsSync(path.join(consumerDir, 'src/_components/MyOwnThing.tsx.new'))).toBe(false);
    //? Deny-listed schema: NEVER touched, even in app scope (no overwrite, no `.new`).
    expect(fs.readFileSync(path.join(consumerDir, 'prisma/schema.prisma'), 'utf8')).toBe('model User { many fields }\n');
    expect(fs.existsSync(path.join(consumerDir, 'prisma/schema.prisma.new'))).toBe(false);

    //? Report lists the new file + the merge sidecar.
    const dumpDir = path.join(consumerDir, 'dump');
    const report = fs.readFileSync(path.join(dumpDir, String(fs.readdirSync(dumpDir).find((f) => f.startsWith('UPDATE_')))), 'utf8');
    expect(report).toContain('New framework files delivered');
    expect(report).toContain('src/settings/_components/TwoFactorSection.tsx');
    expect(report).toContain('src/_components/LoginForm.tsx');
    expect(report).toContain('AI merge instruction');
  });

  it('framework scope leaves src/ untouched even when the render changed it', () => {
    write(consumerDir, 'src/login/page.tsx', 'old page\n');
    manifestFor(consumerDir, { 'src/login/page.tsx': 'old page\n' });
    write(freshDir, 'src/login/page.tsx', 'new page\n');
    manifestFor(freshDir, { 'src/login/page.tsx': 'new page\n' }, { luckystackVersion: '0.6.0' });

    const result = runUpdate(project(), {
      cliVersion: '0.6.0',
      //? default scope = framework
      renderFreshScaffold: () => ({ projectDir: freshDir, cleanup: () => undefined }),
    });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(consumerDir, 'src/login/page.tsx'), 'utf8')).toBe('old page\n');
    expect(fs.existsSync(path.join(consumerDir, 'src/login/page.tsx.new'))).toBe(false);
  });
});
