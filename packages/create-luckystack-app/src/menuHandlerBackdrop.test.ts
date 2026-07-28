import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const ROOT_MENU_HANDLER = path.join(ROOT, 'src/_components/MenuHandler.tsx');
const TEMPLATE_MENU_HANDLER = path.join(ROOT, 'packages/create-luckystack-app/template/src/_components/MenuHandler.tsx');

const read = (file: string): string => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');

const implementations = [
  ['root dogfood app', ROOT_MENU_HANDLER],
  ['fresh scaffold', TEMPLATE_MENU_HANDLER],
] as const;

describe.each(implementations)('%s menu backdrop', (_name, file) => {
  const source = read(file);

  it('only closes through the dedicated backdrop button', () => {
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain('onClick={closeAll}');
    expect(source).not.toContain('backdropPressedRef');
    expect(source).not.toContain('onMouseDown=');
    expect(source).not.toContain('onMouseUp=');
  });
});

describe('menu backdrop source parity', () => {
  it('keeps the root and fresh-scaffold implementations byte-identical', () => {
    expect(read(ROOT_MENU_HANDLER)).toBe(read(TEMPLATE_MENU_HANDLER));
  });
});
