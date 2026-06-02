import { describe, it, expect } from 'vitest';

import {
  validatePagePath,
  DEFAULT_PAGE_ROUTE_RULES,
} from './pageRouteValidation';

describe('validatePagePath', () => {
  it('maps a top-level page folder to its route', () => {
    const result = validatePagePath('admin/page.tsx');
    expect(result).toEqual({ valid: true, route: '/admin' });
  });

  it('maps a nested page folder to a nested route', () => {
    const result = validatePagePath('admin/users/page.tsx');
    expect(result).toEqual({ valid: true, route: '/admin/users' });
  });

  it('treats a bare page.tsx as the root route', () => {
    expect(validatePagePath('page.tsx')).toEqual({ valid: true, route: '/' });
  });

  it('strips invisible-parent (underscore) folders from the URL but keeps children routeable', () => {
    expect(validatePagePath('_housing/renting/page.tsx')).toEqual({
      valid: true,
      route: '/renting',
    });
  });

  it('rejects a page that has no URL segment after stripping underscore folders', () => {
    const result = validatePagePath('_housing/page.tsx');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no URL segment left after stripping underscore folders');
  });

  it('rejects a page inside a reserved framework folder (even nested)', () => {
    const result = validatePagePath('_api/something/page.tsx');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('page.tsx cannot live inside reserved folder _api');
  });

  it('rejects a page nested deep under a reserved folder', () => {
    const result = validatePagePath('dashboard/_components/widget/page.tsx');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('page.tsx cannot live inside reserved folder _components');
  });

  it('rejects a non-page filename', () => {
    const result = validatePagePath('some/route.tsx');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('not a page file (expected page.tsx)');
  });

  it('accepts page.jsx as a valid page file', () => {
    expect(validatePagePath('legacy/page.jsx')).toEqual({ valid: true, route: '/legacy' });
  });

  it('rejects an empty path', () => {
    const result = validatePagePath('');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('empty path');
  });

  it('normalizes backslashes and leading ./ or / prefixes', () => {
    expect(validatePagePath(String.raw`.\admin\page.tsx`)).toEqual({ valid: true, route: '/admin' });
    expect(validatePagePath('/admin/page.tsx')).toEqual({ valid: true, route: '/admin' });
    expect(validatePagePath('//admin//page.tsx')).toEqual({ valid: true, route: '/admin' });
  });

  it('respects a custom privateFolderPrefix', () => {
    const result = validatePagePath('(group)/dashboard/page.tsx', {
      privateFolderPrefix: '(',
      scaffoldIgnoredFolders: [],
    });
    expect(result).toEqual({ valid: true, route: '/dashboard' });
  });

  it('respects custom reserved folders', () => {
    const result = validatePagePath('internal/page.tsx', {
      privateFolderPrefix: '_',
      scaffoldIgnoredFolders: ['internal'],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('page.tsx cannot live inside reserved folder internal');
  });

  it('exposes the underscore prefix and reserved folders in DEFAULT_PAGE_ROUTE_RULES', () => {
    expect(DEFAULT_PAGE_ROUTE_RULES.privateFolderPrefix).toBe('_');
    expect(DEFAULT_PAGE_ROUTE_RULES.scaffoldIgnoredFolders).toContain('_api');
    expect(DEFAULT_PAGE_ROUTE_RULES.scaffoldIgnoredFolders).toContain('_sync');
  });
});
