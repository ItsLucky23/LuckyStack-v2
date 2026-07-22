import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const ROOT_INTERNALS = path.join(ROOT, 'src/_components/dropdownInternals.tsx');
const TEMPLATE_COMPONENTS = path.join(ROOT, 'packages/create-luckystack-app/template/src/_components/dropdown');
const TEMPLATE_INTERNALS = path.join(TEMPLATE_COMPONENTS, 'dropdownInternals.tsx');

const read = (file: string): string => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');

const extractDropdownHook = (source: string): string => {
  const start = source.indexOf('export function useDropdownMenu');
  const end = source.indexOf('interface DropdownMenuShellProps');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const implementations = [
  ['root dogfood app', ROOT_INTERNALS],
  ['fresh scaffold', TEMPLATE_INTERNALS],
] as const;

describe.each(implementations)('%s dropdown positioning', (_name, file) => {
  const source = read(file);
  const hook = extractDropdownHook(source);

  it('seeds the portal width from the live trigger before mounting it', () => {
    const openStart = hook.indexOf('const openDropdown');
    const openEnd = hook.indexOf('const closeDropdown');
    const openDropdown = hook.slice(openStart, openEnd);

    expect(openDropdown.indexOf('triggerRef.current?.getBoundingClientRect()')).toBeGreaterThanOrEqual(0);
    expect(openDropdown.indexOf('setMenuPosition({ top: rect.bottom + TRIGGER_GAP')).toBeGreaterThanOrEqual(0);
    expect(openDropdown.indexOf('setMenuPosition({ top: rect.bottom + TRIGGER_GAP'))
      .toBeLessThan(openDropdown.indexOf('setIsMenuMounted(true)'));
  });

  it('remeasures after rendered-size, viewport, scroll, and anchor-position changes', () => {
    expect(hook).toContain('new ResizeObserver(requestPositionUpdate)');
    expect(hook).toContain('[triggerRef.current, menuRef.current, listRef.current]');
    expect(hook).toContain('window.addEventListener("scroll", requestPositionUpdate, true)');
    expect(hook).toContain('visualViewport?.addEventListener("resize", requestPositionUpdate)');
    expect(hook).toContain('anchorTrackingFrame = requestAnimationFrame(trackAnchor)');
  });
});

describe('dropdown positioning source parity', () => {
  it('keeps the shared root and scaffold hooks byte-identical', () => {
    expect(extractDropdownHook(read(ROOT_INTERNALS))).toBe(extractDropdownHook(read(TEMPLATE_INTERNALS)));
  });

  it.each(['Dropdown.tsx', 'MultiSelectDropdown.tsx'])('%s uses the repaired shared hook', (file) => {
    const source = read(path.join(TEMPLATE_COMPONENTS, file));
    expect(source).toContain('useDropdownMenu,');
    expect(source).toContain('const controller = useDropdownMenu({ showSearch });');
  });
});
