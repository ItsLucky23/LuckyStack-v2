import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneAuthNone } from './index';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('authMode none template prune', () => {
  it('applies every exact-token edit to the current template', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-auth-none-prune-'));
    created.push(target);
    fs.cpSync(path.resolve(import.meta.dirname, '../template'), target, { recursive: true });

    const readme = fs.readFileSync(path.join(target, 'README.md'), 'utf8');
    expect(() => pruneAuthNone(target)).not.toThrow();
    expect(fs.readFileSync(path.join(target, 'README.md'), 'utf8')).toBe(readme);

    const config = fs.readFileSync(path.join(target, 'config.ts'), 'utf8');
    expect(config).toContain("forgotPassword: 'disabled' as const");
    expect(config).toContain('credentials: false');
    expect(config).not.toContain("forgotPassword: 'framework' as const");
    expect(fs.existsSync(path.join(target, 'src/login'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'functions/session.ts'))).toBe(false);
  });

  //? Finding 098: the prune removed the /login guard from dashboard/page.tsx but
  //? kept it in the generators for NEW pages, so a fresh admin page always
  //? redirected to the missing /login route and could never be opened.
  it('removes the /login guard from the generators for new pages', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-auth-none-prune-'));
    created.push(target);
    fs.cpSync(path.resolve(import.meta.dirname, '../template'), target, { recursive: true });
    //? The scaffolder renames `_dot_luckystack` to `.luckystack` while copying.
    fs.renameSync(path.join(target, '_dot_luckystack'), path.join(target, '.luckystack'));

    pruneAuthNone(target);

    const pageTemplate = fs.readFileSync(path.join(target, '.luckystack/templates/page_dashboard.template.tsx'), 'utf8');
    const scaffoldPage = fs.readFileSync(path.join(target, 'scripts/scaffoldPage.mjs'), 'utf8');
    for (const generated of [pageTemplate, scaffoldPage]) {
      //? Live (uncommented) guard lines only — the plain variant keeps a
      //? commented-out example.
      expect(generated).not.toMatch(/^\s*if \(!session\) return \{ success: false, redirect: '\/login' \};/m);
      expect(generated).not.toMatch(/^export const middleware/m);
      expect(generated).not.toMatch(/^import type \{ (PageMiddleware|SessionLayout) \}/m);
    }
    //? The plain variant's commented-out example guard is left alone.
    expect(scaffoldPage).toContain('// export const middleware: PageMiddleware<SessionLayout>');
  });
});
