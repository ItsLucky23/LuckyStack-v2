//? Single source of truth for WHICH function modules exist and WHAT key path
//? each one occupies under the injected `functions` parameter.
//?
//? Three layers used to answer that question independently, and they disagreed:
//?   - the dev loader (`loader.ts#scanFunctionsFolder`) walked every configured
//?     `serverFunctionDirs` root and nested by directory;
//?   - the type-map generator (`typeMap/functionsMeta.ts`) did the same;
//?   - the PRODUCTION map generator (`scripts/generateServerRequests.ts`) walked
//?     two hardcoded directories and keyed purely on `path.basename()`.
//?
//? The result was a dev/prod divergence that no build step could catch: types
//? and dev runtime promised `functions.sleep` / `functions.rbac.engine`, while
//? the deployed bundle had neither (`shared/` was never scanned, and nested
//? folders collapsed onto their bare filename). It only ever surfaced as a
//? production `TypeError`. See ADR 0046 + `docs/lessons/`.
//?
//? This module owns discovery + key derivation once; the generators render it.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, getServerFunctionDirs, isTestFile, isTestDirectory } from '@luckystack/core';
import { getRoutingRules } from './routingRules';

export interface FunctionModule {
  /**
   * Key path under the injected `functions` object. `shared/rbac/engine.ts`
   * with root `shared` yields `['rbac', 'engine']`, reachable as
   * `functions.rbac.engine`.
   */
  keyPath: string[];
  /** Workspace-relative, forward-slash path to the source file (with `.ts`). */
  sourcePath: string;
  /** Workspace-relative, forward-slash root directory that claimed this key path. */
  rootPath: string;
}

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

const toWorkspaceRelative = (absolutePath: string): string =>
  normalizePath(path.relative(ROOT_DIR, absolutePath));

/** Dotted rendering of a key path, e.g. `rbac.engine`. */
export const formatFunctionKeyPath = (keyPath: string[]): string => keyPath.join('.');

/**
 * Last segment of a key path — the module's file name, which is also the alias
 * a default-only export is published under (`functions.sleep.sleep`).
 *
 * Discovery never produces an empty key path; the guard exists so the callers
 * get a real string instead of threading `string | undefined` through every
 * emitter.
 */
export const functionModuleFileName = (keyPath: string[]): string => {
  const fileName = keyPath.at(-1);
  if (fileName === undefined) {
    throw new Error('[function-injection] Internal error: encountered an empty function key path.');
  }
  return fileName;
};

//? Same wording as `typeMap/functionsMeta.ts#formatConflict` so a consumer sees
//? one consistent diagnostic whichever generator trips first.
export const formatFunctionKeyConflict = (
  keyPath: string[],
  firstSourcePath: string,
  secondSourcePath: string,
): string =>
  `[function-injection] Conflict at \`functions.${formatFunctionKeyPath(keyPath)}\`: `
  + `defined in both \`${firstSourcePath}\` and \`${secondSourcePath}\`. `
  + 'Delete one — `shared/` is the canonical location for framework re-exports.';

//? A key cannot be a module AND a namespace: `functions/rbac.ts` claims
//? `functions.rbac` as a module while `shared/rbac/engine.ts` needs it to be an
//? object holding `engine`. Whichever the generator emitted last used to win
//? silently, so one of the two modules simply vanished from the registry.
export const formatFunctionNamespaceConflict = (
  moduleKeyPath: string[],
  moduleSourcePath: string,
  nestedKeyPath: string[],
  nestedSourcePath: string,
): string =>
  `[function-injection] Conflict at \`functions.${formatFunctionKeyPath(moduleKeyPath)}\`: `
  + `\`${moduleSourcePath}\` defines it as a module, but \`${nestedSourcePath}\` nests `
  + `\`functions.${formatFunctionKeyPath(nestedKeyPath)}\` underneath it. `
  + 'Rename one — a key cannot be both a module and a namespace.';

const walkFunctionRoot = (
  dir: string,
  rootDir: string,
  basePath: string[],
  collected: FunctionModule[],
): void => {
  //? Sorted so the emitted map is byte-stable across machines and filesystems —
  //? the generated file is committed in some projects and diffed in review.
  const entries = fs.readdirSync(dir).toSorted();

  for (const entry of entries) {
    // Never crawl an installed package tree that happens to sit under a
    // function root (mirrors `loader.ts#collectTsFiles`).
    if (entry === 'node_modules') continue;

    const fullPath = path.join(dir, entry);
    if (getRoutingRules().ignore(toWorkspaceRelative(fullPath))) continue;

    if (fs.statSync(fullPath).isDirectory()) {
      //? `__tests__` / `__mocks__` hold no injectable modules.
      if (isTestDirectory(entry)) continue;
      walkFunctionRoot(fullPath, rootDir, [...basePath, entry], collected);
      continue;
    }

    if (!entry.endsWith('.ts')) continue;
    //? A test file beside a function module would be injected as a sibling key
    //? (`functions/db.tests.ts` -> `functions['db.tests']`), imported at boot by
    //? the dev loader AND baked into the production runtime map. Route
    //? discovery gets this for free — `_v<N>.ts` never matches `_v1.tests.ts` —
    //? but a function root has no such natural filter.
    if (isTestFile(entry)) continue;

    collected.push({
      keyPath: [...basePath, entry.slice(0, -'.ts'.length)],
      sourcePath: toWorkspaceRelative(fullPath),
      rootPath: toWorkspaceRelative(rootDir),
    });
  }
};

//? A nested module whose ancestor is itself a module is dropped: emitting both
//? would silently overwrite one of them (whichever the serializer wrote last),
//? which is precisely the class of bug this module exists to prevent.
const resolveNamespaceConflicts = (
  modules: FunctionModule[],
  reportConflict: (message: string) => void,
): FunctionModule[] => {
  const byDottedKey = new Map<string, FunctionModule>();
  for (const module of modules) {
    byDottedKey.set(formatFunctionKeyPath(module.keyPath), module);
  }

  return modules.filter((module) => {
    // Every strict ancestor of this key path must NOT also be a module.
    for (let depth = 1; depth < module.keyPath.length; depth++) {
      const ancestor = byDottedKey.get(formatFunctionKeyPath(module.keyPath.slice(0, depth)));
      if (!ancestor) continue;

      reportConflict(formatFunctionNamespaceConflict(
        ancestor.keyPath,
        ancestor.sourcePath,
        module.keyPath,
        module.sourcePath,
      ));
      return false;
    }
    return true;
  });
};

export interface CollectFunctionModulesOptions {
  /**
   * Override the configured roots (absolute paths). Tests pass this;
   * production callers omit it and get `getServerFunctionDirs()`.
   */
  roots?: string[];
  /**
   * When provided, a collision REPORTS through this callback and the offending
   * module is skipped instead of throwing. The dev loader passes it so a
   * duplicate does not hard-crash a running dev server; the build-time
   * generators omit it so the same duplicate fails the build loudly.
   */
  onConflict?: (message: string) => void;
}

/**
 * Discover every server function module across the configured
 * `paths.serverFunctionDirs` roots (default `['functions', 'shared']`), in
 * config order, and derive its `functions.*` key path from its location
 * relative to the root that owns it.
 *
 * Throws on a cross-root key collision or a module/namespace collision (unless
 * `onConflict` is supplied), so a broken registry fails the BUILD instead of
 * producing a map that is silently missing entries at runtime.
 */
export const collectFunctionModules = (
  options: CollectFunctionModulesOptions = {},
): FunctionModule[] => {
  const { roots, onConflict } = options;
  const functionRoots = roots ?? getServerFunctionDirs();
  const claimedByDottedKey = new Map<string, FunctionModule>();

  const reportConflict = (message: string): void => {
    if (!onConflict) throw new Error(message);
    onConflict(message);
  };

  for (const root of functionRoots) {
    if (!fs.existsSync(root)) continue;

    const fromThisRoot: FunctionModule[] = [];
    walkFunctionRoot(root, root, [], fromThisRoot);

    for (const module of fromThisRoot) {
      const dottedKey = formatFunctionKeyPath(module.keyPath);
      const claimed = claimedByDottedKey.get(dottedKey);
      if (claimed) {
        //? First claim wins, matching the historic dev-loader behaviour.
        reportConflict(formatFunctionKeyConflict(
          module.keyPath,
          claimed.sourcePath,
          module.sourcePath,
        ));
        continue;
      }
      claimedByDottedKey.set(dottedKey, module);
    }
  }

  const modules = [...claimedByDottedKey.values()]
    .toSorted((left, right) => formatFunctionKeyPath(left.keyPath).localeCompare(formatFunctionKeyPath(right.keyPath)));

  return resolveNamespaceConflicts(modules, reportConflict);
};

interface RenderNode {
  children: Map<string, RenderNode>;
  module: { varName: string; fileName: string } | null;
}

const createRenderNode = (): RenderNode => ({ children: new Map(), module: null });

//? Mirrors `loader.ts#resolveFunctionModule` exactly: named exports win, a
//? lone default export is aliased to the file name so handlers call
//? `functions.sleep.sleep(ms)` rather than `functions.sleep.default(ms)`.
const renderModuleEntry = (varName: string, fileName: string, indent: string): string =>
  `(() => {\n`
  + `${indent}  const { default: _default, ...named } = ${varName} as Record<string, unknown>;\n`
  + `${indent}  const cleaned = Object.fromEntries(Object.entries(named).filter(([key]) => key !== '__esModule'));\n`
  + `${indent}  if (Object.keys(cleaned).length > 0) return cleaned;\n`
  + `${indent}  return _default !== undefined ? { ${JSON.stringify(fileName)}: _default } : {};\n`
  + `${indent}})()`;

const renderNode = (node: RenderNode, indent: string): string => {
  let output = '';
  for (const [name, child] of node.children) {
    if (child.module) {
      output += `${indent}${JSON.stringify(name)}: ${renderModuleEntry(child.module.varName, child.module.fileName, indent)},\n`;
      continue;
    }
    output += `${indent}${JSON.stringify(name)}: {\n${renderNode(child, `${indent}  `)}${indent}},\n`;
  }
  return output;
};

export interface RenderedFunctionsMap {
  /** `import * as fn0 from '...'` lines, in emission order. */
  imports: string[];
  /** The full `export const functions = { ... };` declaration. */
  source: string;
}

/**
 * Render discovered modules into the `functions` export of a generated
 * production runtime-map file. The emitted object is NESTED, matching what the
 * dev loader builds and what `apiTypes.generated.ts` declares.
 *
 * @param modules      Output of {@link collectFunctionModules}.
 * @param importPrefix Prefix that turns a workspace-relative source path into a
 *                     specifier relative to the generated file (`'../../'` for
 *                     the standard `server/prod/` output location).
 * @param varPrefix    Import alias prefix; aliases are `<varPrefix><n>`.
 */
export const renderFunctionsMap = ({
  modules,
  importPrefix,
  varPrefix = 'fn',
}: {
  modules: FunctionModule[];
  importPrefix: string;
  varPrefix?: string;
}): RenderedFunctionsMap => {
  const imports: string[] = [];
  const root = createRenderNode();

  for (const [index, module] of modules.entries()) {
    const varName = `${varPrefix}${index}`;
    imports.push(`import * as ${varName} from '${importPrefix}${module.sourcePath.replace(/\.ts$/, '')}';`);

    let target = root;
    for (const segment of module.keyPath.slice(0, -1)) {
      let child = target.children.get(segment);
      if (!child) {
        child = createRenderNode();
        target.children.set(segment, child);
      }
      target = child;
    }

    const fileName = functionModuleFileName(module.keyPath);
    const leaf = createRenderNode();
    leaf.module = { varName, fileName };
    target.children.set(fileName, leaf);
  }

  //? The declared value type stays `Record<string, Record<string, unknown>>`:
  //? a namespace node is a `Record<string, unknown>` at every depth, so the
  //? annotation holds for arbitrarily deep nesting.
  const source =
    'export const functions: Record<string, Record<string, unknown>> = {\n'
    + renderNode(root, '  ')
    + '};';

  return { imports, source };
};
