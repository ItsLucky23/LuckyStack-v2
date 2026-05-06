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
}

const DEFAULT_RULES: RoutingRules = {
  apiMarker: '_api',
  syncMarker: '_sync',
  apiVersionRegex: /_v(\d+)$/,
  syncServerVersionRegex: /_server_v(\d+)$/,
  syncClientVersionRegex: /_client_v(\d+)$/,
  syncVersionRegex: /_(server|client)_v(\d+)$/,
  ignore: () => false,
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
