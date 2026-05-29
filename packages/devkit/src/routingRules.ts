//? Routing rule registry. Lets consumers customize the file-based routing
//? conventions that devkit uses to discover APIs, sync events, and ignored
//? folders.
//?
//? Defaults preserve the framework's original `_api`/`_sync` markers and the
//? `_v{N}.ts` / `_server_v{N}.ts` / `_client_v{N}.ts` filename suffixes. The
//? `ignore` predicate is called for each candidate path during discovery; a
//? consumer can return `true` to skip e.g. `__tests__` folders, vendor
//? directories, or any other custom rule.

export interface RoutingRules {
  /** Folder name that marks an API directory. Default: `_api`. */
  apiMarker: string;
  /** Folder name that marks a sync directory. Default: `_sync`. */
  syncMarker: string;
  /** Suffix matcher for API files: must end with `_v<number>.ts`. */
  apiVersionRegex: RegExp;
  /** Suffix matcher for sync server files: must end with `_server_v<number>.ts`. */
  syncServerVersionRegex: RegExp;
  /** Suffix matcher for sync client files: must end with `_client_v<number>.ts`. */
  syncClientVersionRegex: RegExp;
  /** Combined sync regex (server or client). */
  syncVersionRegex: RegExp;
  /**
   * Predicate called for each candidate file/folder during discovery.
   * Return `true` to skip. Path is provided as a forward-slash relative
   * string from the workspace root (e.g. `src/dashboard/__tests__/foo_v1.ts`).
   */
  ignore: (relativePath: string) => boolean;
  /**
   * Single-character prefix that marks a folder as **invisible-parent** for
   * page routing: `src/_housing/renting/page.tsx` resolves to `/renting`
   * (the `_housing` segment is stripped from the URL). A `page.tsx` placed
   * directly inside an `_<name>` folder is invalid (no URL segment left).
   *
   * Default: `'_'`. Override only if you need a different prefix scheme.
   */
  privateFolderPrefix: string;
  /**
   * Folder names that are reserved for framework-internal use and may NEVER
   * host a `page.tsx`. Scaffold + page-discovery emit a hard error when a
   * page is placed inside one. Extend (do not replace) the defaults if you
   * add your own internal folder convention.
   *
   * Defaults: `_api`, `_sync`, `_function(s)`, `_component(s)`, `_provider(s)`,
   * `_locale(s)`, `_socket(s)`, `_shared`, `_server`. The semantic markers
   * (`_api`, `_sync`) are also reserved by the API/sync routers.
   */
  scaffoldIgnoredFolders: string[];
  /**
   * Optional predicate. Return `true` for a given absolute file path to
   * disable template injection entirely for that file. Useful when a
   * consumer wants to opt some part of the tree out of the scaffold
   * (e.g. `/src/migrations/**` lives by hand). The argument is the
   * absolute path the chokidar watcher provides; the predicate is
   * called BEFORE the `isInApiFolder` / `isPageFile` checks fire.
   */
  disableTemplateInjection?: (filePath: string) => boolean;
}

const DEFAULT_RULES: RoutingRules = {
  apiMarker: '_api',
  syncMarker: '_sync',
  apiVersionRegex: /_v(\d+)$/,
  syncServerVersionRegex: /_server_v(\d+)$/,
  syncClientVersionRegex: /_client_v(\d+)$/,
  syncVersionRegex: /_(server|client)_v(\d+)$/,
  ignore: () => false,
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

let activeRules: RoutingRules = DEFAULT_RULES;

export const registerRoutingRules = (overrides: Partial<RoutingRules>): RoutingRules => {
  activeRules = { ...DEFAULT_RULES, ...overrides };
  return activeRules;
};

export const getRoutingRules = (): RoutingRules => activeRules;

//? Convenience helpers built on top of the active rules — used by
//? loader/hotReload/discovery so call sites don't have to compose the
//? marker name into a path-segment check themselves.
export const apiMarkerSegment = (): string => `/${getRoutingRules().apiMarker}/`;
export const syncMarkerSegment = (): string => `/${getRoutingRules().syncMarker}/`;

export const isApiFileName = (fileName: string): boolean => {
  if (!fileName.endsWith('.ts')) return false;
  const stem = fileName.slice(0, -3);
  return getRoutingRules().apiVersionRegex.test(stem);
};

export const isSyncServerFileName = (fileName: string): boolean => {
  if (!fileName.endsWith('.ts')) return false;
  const stem = fileName.slice(0, -3);
  return getRoutingRules().syncServerVersionRegex.test(stem);
};

export const isSyncClientFileName = (fileName: string): boolean => {
  if (!fileName.endsWith('.ts')) return false;
  const stem = fileName.slice(0, -3);
  return getRoutingRules().syncClientVersionRegex.test(stem);
};

export const isSyncFileName = (fileName: string): boolean => {
  if (!fileName.endsWith('.ts')) return false;
  const stem = fileName.slice(0, -3);
  return getRoutingRules().syncVersionRegex.test(stem);
};

//? Per-route business-logic test files (`<name>_v<N>.tests.ts` and
//? `<name>_server_v<N>.tests.ts`) live INSIDE `_api/` and `_sync/` folders
//? alongside the route they cover. Loaders, validators, and template
//? injectors must skip them — they are picked up separately by
//? `@luckystack/test-runner`.
export const isRouteTestFile = (fileNameOrPath: string): boolean => {
  return fileNameOrPath.endsWith('.tests.ts');
};

//? Re-export the core page-route validator + bind it to the active
//? `RoutingRules` (so a consumer that calls `registerRoutingRules({
//? scaffoldIgnoredFolders: [...] })` to add a custom private folder
//? sees the override applied here too). The pure helper lives in
//? `@luckystack/core/pageRouteValidation.ts` so the client-side router
//? in `src/main.tsx` can import it without dragging devkit into the
//? Vite bundle.
import { validatePagePath as corePagePath, type PagePathValidationResult as CoreResult, type PageRouteRules } from '@luckystack/core';

export type PagePathValidationResult = CoreResult;

export const validatePagePath = (srcRelativePath: string): PagePathValidationResult => {
  const rules = getRoutingRules();
  const pageRules: PageRouteRules = {
    privateFolderPrefix: rules.privateFolderPrefix,
    scaffoldIgnoredFolders: rules.scaffoldIgnoredFolders,
  };
  return corePagePath(srcRelativePath, pageRules);
};
