import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

//? Injected route files must not inherit the template's blanket
//? `eslint-disable` header: it silences all lint in the user's file, and once
//? the file is clean ESLint fails on it as an unused directive.

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-template-header-'));
const SRC = path.join(ROOT, 'src');

vi.mock('@luckystack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luckystack/core')>();
  return { ...actual, ROOT_DIR: ROOT, getSrcDir: () => SRC };
});

const { injectTemplate, injectServerTemplateWithClientInput } = await import('./templateInjector');

const here = path.dirname(fileURLToPath(import.meta.url));
const scaffoldTemplates = path.resolve(here, '../../create-luckystack-app/template/_dot_luckystack/templates');

vi.spyOn(console, 'log').mockImplementation(() => undefined);

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

const emptyFile = (...segments: string[]): string => {
  const file = path.join(SRC, ...segments);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  return file;
};

const expectNoLintHeader = (file: string): void => {
  const content = fs.readFileSync(file, 'utf8');
  expect(content.length).toBeGreaterThan(0);
  expect(content).not.toContain('eslint-disable');
  expect(content.startsWith('\n')).toBe(false);
};

describe('template injection drops the template lint header', () => {
  it('for the bundled api, page and sync templates', async () => {
    const files = [
      emptyFile('orders', '_api', 'getOrder_v1.ts'),
      emptyFile('orders', 'page.tsx'),
      emptyFile('orders', '_sync', 'update_client_v1.ts'),
    ];
    for (const file of files) {
      expect(await injectTemplate(file)).toBe(true);
      expectNoLintHeader(file);
    }
  });

  it('for the server template filled with client input types', async () => {
    const file = emptyFile('orders', '_sync', 'update_server_v1.ts');
    expect(await injectServerTemplateWithClientInput(file, '{ id: string }')).toBe(true);
    expectNoLintHeader(file);
    expect(fs.readFileSync(file, 'utf8')).toContain('clientInput: { id: string }');
  });

  it('for the scaffold’s consumer-editable copies in .luckystack/templates', async () => {
    const consumerDir = path.join(ROOT, '.luckystack', 'templates');
    fs.mkdirSync(consumerDir, { recursive: true });
    for (const name of fs.readdirSync(scaffoldTemplates).filter((entry) => entry.includes('.template.'))) {
      fs.copyFileSync(path.join(scaffoldTemplates, name), path.join(consumerDir, name));
    }

    const files = [emptyFile('billing', '_api', 'getInvoice_v1.ts'), emptyFile('billing', 'page.tsx')];
    for (const file of files) {
      expect(await injectTemplate(file)).toBe(true);
      expectNoLintHeader(file);
    }
    //? The template files themselves keep the header, so they stay lint-clean.
    expect(fs.readFileSync(path.join(consumerDir, 'api.template.ts'), 'utf8')).toMatch(/^\/\* eslint-disable/);
  });

  it('for a consumer template saved with a byte-order mark', async () => {
    const consumerFile = path.join(ROOT, '.luckystack', 'templates', 'api.template.ts');
    fs.mkdirSync(path.dirname(consumerFile), { recursive: true });
    const byteOrderMark = String.fromCodePoint(0xFE_FF);
    fs.writeFileSync(consumerFile, `${byteOrderMark}/* eslint-disable */\r\n\r\nexport const main = () => ({ status: 'success' });\r\n`);

    const file = emptyFile('bom', '_api', 'getThing_v1.ts');
    expect(await injectTemplate(file)).toBe(true);
    expectNoLintHeader(file);
    expect(fs.readFileSync(file, 'utf8')).toBe('export const main = () => ({ status: \'success\' });\r\n');
  });
});
