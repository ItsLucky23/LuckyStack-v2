//? Page templates in a scaffolded app.
//?   050 — `npm run scaffold:page admin/users` wrote `template = 'dashboard'`, a
//?         name the scaffold's Template union does not have: React then threw
//?         'Element type is invalid' on that route. Typecheck cannot see it
//?         (pages load through import.meta.glob).
//?   052 — only the 'home' template mounted <Middleware>, so the 'plain' pages
//?         `/` and `/dashboard` never ran their `export const middleware`: `/`
//?         rendered blank and `/dashboard` was open to logged-out visitors.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TEMPLATE = path.resolve(import.meta.dirname, '..', 'template');
const read = (rel: string): string => fs.readFileSync(path.join(TEMPLATE, rel), 'utf8');

const PROVIDER = 'src/_components/templates/TemplateProvider.tsx';

const templateUnion = (): string[] => {
  const match = /export type Template = ([^;]+);/.exec(read(PROVIDER));
  if (!match?.[1]) throw new Error('Template union not found');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
};

//? Every `export const template = '…'` a page source or page generator emits.
const emittedTemplateNames = (source: string): string[] =>
  [...source.matchAll(/export const template = '([^']+)'/g)].map((m) => m[1] ?? '');

describe('page template names (050)', () => {
  it('scaffold:page only emits names from the Template union', () => {
    const names = emittedTemplateNames(read('scripts/scaffoldPage.mjs'));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(templateUnion()).toContain(name);
  });

  it('the dev template injector templates only emit names from the Template union', () => {
    const dir = path.join(TEMPLATE, '_dot_luckystack', 'templates');
    const pageTemplates = fs.readdirSync(dir).filter((file) => file.startsWith('page_'));
    expect(pageTemplates.length).toBeGreaterThan(0);
    for (const file of pageTemplates) {
      for (const name of emittedTemplateNames(fs.readFileSync(path.join(dir, file), 'utf8'))) {
        expect(templateUnion()).toContain(name);
      }
    }
  });
});

describe('every page template mounts <Middleware> (052)', () => {
  it('maps each Template name to a component file that wraps its children in <Middleware>', () => {
    const provider = read(PROVIDER);
    for (const name of templateUnion()) {
      const component = new RegExp(String.raw`\b${name}: (\w+),`).exec(provider)?.[1];
      expect(component, `no component registered for '${name}'`).toBeDefined();
      const importPath = new RegExp(String.raw`import ${component ?? ''} from '\./(\w+)';`).exec(provider)?.[1];
      expect(importPath, `${component ?? ''} is not imported from its own file`).toBeDefined();
      const source = read(`src/_components/templates/${importPath ?? ''}.tsx`);
      expect(source).toMatch(/<Middleware>\s*{children}\s*<\/Middleware>/);
    }
  });
});
