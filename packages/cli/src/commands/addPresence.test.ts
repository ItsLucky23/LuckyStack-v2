//? Finding 019: add/remove presence edit two consumer files. A token miss in the
//? second (TemplateProvider.tsx is often customized) must leave the first one
//? untouched too, and the "already wired" check must look at both files.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsumerProject } from '../lib/project';
import { findRegistryEntry } from '../registry';
import { addPresence } from './addPresence';
import { removeFeature } from './remove';

const MAIN_PRUNED = [
  "import { createBrowserRouter, RouterProvider, useParams, useSearchParams, Outlet } from 'react-router-dom';",
  "import type { PageMiddleware } from '@luckystack/core/client';",
  'const routes = [{ element: <Outlet />, children: [] }];',
  '',
].join('\n');

const TEMPLATE_PROVIDER_PRUNED = [
  "import { useTheme, useSession } from '@luckystack/core/client';",
  "import type { SessionLayout } from 'config';",
  'export const TemplateProvider = ({ children }) => {',
  '  const { setTheme } = useTheme();',
  '  return (',
  '    <>',
  '      <TemplateComponent>{children}</TemplateComponent>',
  '    </>',
  '  );',
  '};',
  '',
].join('\n');

let root: string;
const mainPath = (): string => path.join(root, 'src', 'main.tsx');
const templateProviderPath = (): string => path.join(root, 'src', '_components', 'templates', 'TemplateProvider.tsx');
const options = { install: false, cliVersion: '0.14.0' };

const project = (): ConsumerProject => {
  const pkgPath = path.join(root, 'package.json');
  return { root, pkgPath, pkg: JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as ConsumerProject['pkg'] };
};
const dependencies = (): Record<string, string> =>
  (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }).dependencies ?? {};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-presence-'));
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'app', dependencies: { '@luckystack/core': '^0.14.0' } }, null, 2)}\n`);
  fs.mkdirSync(path.dirname(templateProviderPath()), { recursive: true });
  fs.writeFileSync(mainPath(), MAIN_PRUNED);
  fs.writeFileSync(templateProviderPath(), TEMPLATE_PROVIDER_PRUNED);
  vi.spyOn(console, 'log').mockImplementation(() => { /* quiet */ });
  vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('add presence is all-or-nothing across main.tsx and TemplateProvider.tsx', () => {
  it('leaves main.tsx and package.json untouched when TemplateProvider drifted, and a re-run fails again', () => {
    const customized = TEMPLATE_PROVIDER_PRUNED.replace('useTheme, useSession }', 'useTheme, useSession, useLocation }');
    fs.writeFileSync(templateProviderPath(), customized);

    expect(addPresence(project(), options).ok).toBe(false);
    expect(fs.readFileSync(mainPath(), 'utf8')).toBe(MAIN_PRUNED);
    expect(dependencies()['@luckystack/presence']).toBeUndefined();

    //? The old main.tsx-only check reported success here with the UI half-wired.
    expect(addPresence(project(), options).ok).toBe(false);
  });

  it('completes a project an older CLI left half-wired (main.tsx done, TemplateProvider not)', () => {
    expect(addPresence(project(), options).ok).toBe(true);
    const wiredMain = fs.readFileSync(mainPath(), 'utf8');
    fs.writeFileSync(templateProviderPath(), TEMPLATE_PROVIDER_PRUNED);

    expect(addPresence(project(), options).ok).toBe(true);
    expect(fs.readFileSync(mainPath(), 'utf8')).toBe(wiredMain);
    expect(fs.readFileSync(templateProviderPath(), 'utf8')).toContain('<SocketStatusIndicator');
  });
});

describe('remove presence is all-or-nothing across main.tsx and TemplateProvider.tsx', () => {
  const presence = findRegistryEntry('presence');

  it('changes nothing when TemplateProvider drifted, as its error message says', () => {
    expect(addPresence(project(), options).ok).toBe(true);
    const wiredMain = fs.readFileSync(mainPath(), 'utf8');
    fs.writeFileSync(
      templateProviderPath(),
      fs.readFileSync(templateProviderPath(), 'utf8').replace('  const translate = useTranslator();\n', '  const t = useTranslator();\n'),
    );
    if (!presence) throw new Error('presence registry entry missing');

    const result = removeFeature(project(), presence);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Nothing was changed');
    expect(fs.readFileSync(mainPath(), 'utf8')).toBe(wiredMain);
    expect(dependencies()['@luckystack/presence']).toBeDefined();
  });

  it('keeps the dependency-drop gated on TemplateProvider too, not only main.tsx', () => {
    expect(addPresence(project(), options).ok).toBe(true);
    fs.writeFileSync(mainPath(), MAIN_PRUNED);
    if (!presence) throw new Error('presence registry entry missing');

    expect(removeFeature(project(), presence).ok).toBe(true);
    expect(fs.readFileSync(templateProviderPath(), 'utf8')).not.toContain('@luckystack/presence');
    expect(dependencies()['@luckystack/presence']).toBeUndefined();
  });
});
