//? Pure page-route validator. Lives in @luckystack/core (no Node deps) so
//? both the client-side router (`src/main.tsx`'s `getRoutes()`) AND the
//? devkit-side scaffold CLI / hot-reload validator can consume it through
//? the same single source of truth.
//?
//? Implements the invisible-parent folder convention: a folder starting
//? with `privateFolderPrefix` is stripped from the URL but its CHILDREN
//? remain routeable. A `page.tsx` placed directly inside such a folder
//? (no non-private sibling segment) is invalid because it has no URL.
//?
//? Reserved framework folders (`_api`, `_sync`, `_components`, …) NEVER
//? host a page, even nested — placing `page.tsx` anywhere under one of
//? them is a hard error.

export interface PageRouteRules {
  /**
   * Single-character prefix that marks a folder as **invisible-parent** for
   * page routing. Default: `'_'`.
   */
  privateFolderPrefix: string;
  /**
   * Folder names that are reserved for framework-internal use and may NEVER
   * host a `page.tsx`, nested or otherwise. Scaffold + page-discovery emit
   * a hard error when a page is placed inside one.
   */
  scaffoldIgnoredFolders: readonly string[];
}

export const DEFAULT_PAGE_ROUTE_RULES: PageRouteRules = {
  privateFolderPrefix: '_',
  scaffoldIgnoredFolders: [
    '_api',
    '_sync',
    '_function',
    '_functions',
    '_component',
    '_components',
    '_provider',
    '_providers',
    '_locale',
    '_locales',
    '_socket',
    '_sockets',
    '_shared',
    '_server',
  ],
};

export interface PagePathValidationResult {
  /** `true` when the page file produces a routeable URL. */
  valid: boolean;
  /** Computed URL when `valid`. Always begins with `/`. `/` for root page. */
  route?: string;
  /** Human-readable explanation when `!valid`. */
  reason?: string;
}

/**
 * Validate a `page.tsx` file path relative to `src/`. Accepts both
 * forward and back slashes, with or without a leading `./` or `/`.
 * The filename **must** be `page.tsx` (or `page.jsx`); other filenames
 * return `valid: false`.
 *
 * Examples (defaults):
 *   admin/page.tsx              -> { valid: true, route: '/admin' }
 *   _housing/renting/page.tsx   -> { valid: true, route: '/renting' }
 *   _housing/page.tsx           -> { valid: false, reason: 'no URL segment left after stripping underscore folders' }
 *   _api/something/page.tsx     -> { valid: false, reason: 'page.tsx cannot live inside reserved folder _api' }
 *   page.tsx                    -> { valid: true, route: '/' }
 *   some/route.tsx              -> { valid: false, reason: 'not a page file (expected page.tsx)' }
 */
export const validatePagePath = (
  srcRelativePath: string,
  rules: PageRouteRules = DEFAULT_PAGE_ROUTE_RULES,
): PagePathValidationResult => {
  const normalized = srcRelativePath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const segments = normalized.split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return { valid: false, reason: 'empty path' };
  }

  const filename = segments.at(-1);
  if (filename !== 'page.tsx' && filename !== 'page.jsx') {
    return { valid: false, reason: 'not a page file (expected page.tsx)' };
  }

  const folderSegments = segments.slice(0, -1);
  const prefix = rules.privateFolderPrefix;
  const reserved = rules.scaffoldIgnoredFolders;

  for (const reservedName of reserved) {
    if (folderSegments.includes(reservedName)) {
      return { valid: false, reason: `page.tsx cannot live inside reserved folder ${reservedName}` };
    }
  }

  const visibleSegments = folderSegments.filter((segment) => !segment.startsWith(prefix));

  if (folderSegments.length > 0 && visibleSegments.length === 0) {
    return { valid: false, reason: 'no URL segment left after stripping underscore folders' };
  }

  const route = visibleSegments.length === 0 ? '/' : `/${visibleSegments.join('/')}`;
  return { valid: true, route };
};
