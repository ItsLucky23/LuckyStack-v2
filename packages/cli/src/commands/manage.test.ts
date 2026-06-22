//? Tests for the manage/list/remove surface. The raw TTY checkbox loop is NOT
//? tested (hard + low value); instead the diff is a pure function and the
//? add/remove handlers run against a temp project dir on disk.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeManagePlan } from './manage';
import { removeFeature } from './remove';
import { installedRegistryIds, listFeatures } from './list';
import { findRegistryEntry, REGISTRY } from '../registry';
import { findProjectRoot, type ConsumerProject } from '../lib/project';

//? Spin up a throwaway LuckyStack-shaped project (package.json + config.ts) under
//? the OS temp dir, optionally with extra files. Returns the resolved
//? ConsumerProject (via findProjectRoot, exactly as the CLI locates it).
const tempProject = (
  deps: Record<string, string>,
  files: Record<string, string> = {},
): { project: ConsumerProject; root: string } => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'luckystack-cli-'));
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'tmp', version: '0.0.0', dependencies: deps }, null, 2)}\n`,
  );
  writeFileSync(path.join(root, 'config.ts'), 'export default {};\n');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const project = findProjectRoot(root);
  if (!project) throw new Error('temp project not detected');
  return { project, root };
};

const createdRoots: string[] = [];
const make = (deps: Record<string, string>, files?: Record<string, string>): { project: ConsumerProject; root: string } => {
  const result = tempProject(deps, files);
  createdRoots.push(result.root);
  return result;
};

afterEach(() => {
  for (const root of createdRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const readDeps = (root: string): Record<string, string> => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
  return pkg.dependencies ?? {};
};

//? Resolve a registry entry or fail the test loudly — avoids non-null assertions
//? in the cases below while keeping the entry strongly typed.
const entryOf = (id: string): import('../registry').RegistryEntry => {
  const entry = findRegistryEntry(id);
  if (!entry) throw new Error(`registry entry "${id}" missing`);
  return entry;
};

describe('registry parity', () => {
  it('every registry id is unique and maps to @luckystack/<id>', () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of REGISTRY) expect(entry.pkg).toBe(`@luckystack/${entry.id}`);
  });

  it('login is the only guarded entry', () => {
    const guarded = REGISTRY.filter((e) => e.removable === 'guarded').map((e) => e.id);
    expect(guarded).toEqual(['login']);
  });
});

describe('computeManagePlan (pure diff)', () => {
  it('adds newly-checked, removes unchecked-but-installed, leaves unchanged alone', () => {
    const plan = computeManagePlan(['presence', 'email'], ['email', 'docs-ui']);
    expect(plan.add).toEqual(['docs-ui']);
    expect(plan.remove).toEqual(['presence']);
  });

  it('is a no-op when selection equals installed', () => {
    const plan = computeManagePlan(['email', 'sync'], ['sync', 'email']);
    expect(plan).toEqual({ add: [], remove: [] });
  });

  it('ignores ids not in the registry on both sides', () => {
    const plan = computeManagePlan(['bogus-installed'], ['bogus-selected']);
    expect(plan).toEqual({ add: [], remove: [] });
  });

  it('output preserves REGISTRY order', () => {
    const allIds = REGISTRY.map((e) => e.id);
    const plan = computeManagePlan([], allIds);
    expect(plan.add).toEqual(allIds);
  });
});

describe('installedRegistryIds', () => {
  it('detects installed registry packages from package.json deps', () => {
    const { project } = make({ '@luckystack/email': '^0.2.0', '@luckystack/core': '^0.2.0' });
    expect(installedRegistryIds(project)).toEqual(['email']);
  });
});

describe('listFeatures output', () => {
  it('marks installed vs available and surfaces core/other packages', () => {
    const { project } = make({ '@luckystack/presence': '^0.2.1', '@luckystack/core': '^0.2.1' });
    const log = vi.spyOn(console, 'log').mockImplementation(vi.fn());
    listFeatures(project);
    const out = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toMatch(/presence\s+installed \(\^0\.2\.1\)/);
    expect(out).toMatch(/email\s+available/);
    expect(out).toContain('@luckystack/core (^0.2.1)');
  });
});

describe('removeFeature — backend', () => {
  it('drops the dependency line', () => {
    const { project, root } = make({ '@luckystack/email': '^0.2.0', '@luckystack/core': '^0.2.0' });
    vi.spyOn(console, 'log').mockImplementation(vi.fn());
    const result = removeFeature(project, entryOf('email'));
    expect(result.ok).toBe(true);
    const deps = readDeps(root);
    expect(deps['@luckystack/email']).toBeUndefined();
    expect(deps['@luckystack/core']).toBe('^0.2.0');
  });
});

describe('removeFeature — login (guarded)', () => {
  it('drops the dep but KEEPS the copied auth files', () => {
    const { project, root } = make(
      { '@luckystack/login': '^0.2.0' },
      {
        'src/login/page.tsx': '// user-edited login page\n',
        'src/_components/LoginForm.tsx': '// user-edited form\n',
      },
    );
    vi.spyOn(console, 'log').mockImplementation(vi.fn());
    const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const result = removeFeature(project, entryOf('login'));
    expect(result.ok).toBe(true);
    expect(readDeps(root)['@luckystack/login']).toBeUndefined();
    //? Files KEPT.
    expect(existsSync(path.join(root, 'src/login/page.tsx'))).toBe(true);
    expect(existsSync(path.join(root, 'src/_components/LoginForm.tsx'))).toBe(true);
    //? Warning lists the kept paths.
    const warned = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('src/login');
    expect(warned).toContain('src/_components/LoginForm.tsx');
  });
});

//? The FULL (presence-wired) main.tsx + TemplateProvider.tsx the add path
//? produces — removal must reverse exactly these tokens.
const FULL_MAIN =
  "import { createBrowserRouter, RouterProvider, useParams, useSearchParams } from 'react-router-dom';\n" +
  "import type { PageMiddleware } from '@luckystack/core/client';\n" +
  "import { LocationProvider } from '@luckystack/presence/client';\n" +
  '\n' +
  'const router = createBrowserRouter([\n' +
  '  {\n' +
  '    element: <LocationProvider />,\n' +
  '  },\n' +
  ']);\n';

const FULL_TEMPLATE =
  "import { SocketStatusIndicator } from '@luckystack/presence/client';\n" +
  "import { useTheme, useSession, useTranslator } from '@luckystack/core/client';\n" +
  "import type { SessionLayout } from 'config';\n" +
  "import { useSocketStatus } from 'src/_providers/socketStatusProvider';\n" +
  '\n' +
  'const Provider = ({ children }: { children: SessionLayout }) => {\n' +
  '  const { setTheme } = useTheme();\n' +
  '  const { socketStatus } = useSocketStatus();\n' +
  '  const translate = useTranslator();\n' +
  '  return (\n' +
  '    <div>\n' +
  '      <SocketStatusIndicator\n' +
  '        status={socketStatus.self.status}\n' +
  '        reconnectAttempt={socketStatus.self.reconnectAttempt}\n' +
  "        label={translate({ key: 'template.socketStatus' })}\n" +
  '      />\n' +
  '      <TemplateComponent>{children}</TemplateComponent>\n' +
  '    </div>\n' +
  '  );\n' +
  '};\n';

describe('removeFeature — presence (reverses JSX)', () => {
  it('drops the dep and reverts the client mounts', () => {
    const { project, root } = make(
      { '@luckystack/presence': '^0.2.0' },
      {
        'src/main.tsx': FULL_MAIN,
        'src/_components/templates/TemplateProvider.tsx': FULL_TEMPLATE,
      },
    );
    vi.spyOn(console, 'log').mockImplementation(vi.fn());
    const result = removeFeature(project, entryOf('presence'));
    expect(result.ok).toBe(true);

    expect(readDeps(root)['@luckystack/presence']).toBeUndefined();
    const main = readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
    expect(main).not.toContain('@luckystack/presence/client');
    expect(main).toContain('element: <Outlet />,');
    expect(main).toContain('useSearchParams, Outlet }');

    const tpl = readFileSync(path.join(root, 'src/_components/templates/TemplateProvider.tsx'), 'utf8');
    expect(tpl).not.toContain('SocketStatusIndicator');
    expect(tpl).not.toContain('useTranslator');
    expect(tpl).not.toContain('useSocketStatus');
    expect(tpl).toContain("import { useTheme, useSession } from '@luckystack/core/client';");
  });

  it('fails loud when a presence token is missing (hand-edited file)', () => {
    const { project } = make(
      { '@luckystack/presence': '^0.2.0' },
      {
        //? main still references presence (so the revert is attempted) but the
        //? router token was hand-changed → editFile must throw, surfaced as a Result.
        'src/main.tsx': "import { LocationProvider } from '@luckystack/presence/client';\n// hand-edited, no router token\n",
        'src/_components/templates/TemplateProvider.tsx': FULL_TEMPLATE,
      },
    );
    vi.spyOn(console, 'log').mockImplementation(vi.fn());
    const result = removeFeature(project, entryOf('presence'));
    expect(result.ok).toBe(false);
  });
});
