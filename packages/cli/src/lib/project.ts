//? Shared helpers for the `luckystack` CLI: locating the consumer project,
//? reading/patching its package.json, CRLF-safe file edits, idempotent asset
//? copies, and running npm. All paths are resolved against the consumer's CWD.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface ConsumerProject {
  /** Absolute project root (where package.json + config.ts live). */
  root: string;
  /** Parsed package.json. */
  pkg: PackageJson;
  /** package.json absolute path. */
  pkgPath: string;
}

export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

//? Tuple-style result used by the `add` command handlers so a missing edit token
//? surfaces as a returned error the CLI entry can report + exit on, rather than an
//? unhandled throw that crashes the process with a raw stack trace.
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

//? `value` is optional so void handlers can return `ok()` (no `ok(undefined)` —
//? which the `no-useless-undefined` lint rule rejects). Defaults `T` to `void`.
export const ok = <T = void>(value?: T): Result<T, never> => ({ ok: true, value: value as T });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

//? Shared "not a LuckyStack project" message — kept as one const so the scan and
//? add paths can't drift.
export const PROJECT_NOT_FOUND =
  'Not a LuckyStack project (no package.json with an @luckystack/* dependency + config.ts found).';

//? Read + assert the `version` field of a package.json shape. Used for the CLI's
//? own version (so an empty/malformed package.json fails loudly, not silently as
//? `undefined`).
export const parsePackageVersion = (raw: unknown): string => {
  if (raw === null || typeof raw !== 'object' || !('version' in raw)) {
    throw new Error('package.json is missing a "version" field.');
  }
  const version: unknown = raw.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('package.json "version" is not a non-empty string.');
  }
  return version;
};

//? A LuckyStack project is identified by a package.json that depends on at least
//? one `@luckystack/*` package AND a top-level `config.ts`. We walk up from the
//? CWD so the CLI works when invoked from a subdirectory.
export const findProjectRoot = (startDir: string): ConsumerProject | null => {
  let dir = path.resolve(startDir);
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath) && fs.existsSync(path.join(dir, 'config.ts'))) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as PackageJson;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      //? A consumer project depends on at least one `@luckystack/*` package; the
      //? framework monorepo itself doesn't, but has `packages/core`. Accept both
      //? so the scan commands work in either (the `add` commands target consumers).
      const hasLuckyStack =
        Object.keys(deps).some((name) => name.startsWith('@luckystack/')) ||
        fs.existsSync(path.join(dir, 'packages', 'core', 'package.json'));
      if (hasLuckyStack) return { root: dir, pkg, pkgPath };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

//? Locate the consumer project or report the canonical PROJECT_NOT_FOUND message
//? and return null. `extraHint` appends a second line (the `add` paths add a
//? "run inside your project directory" reminder the scan paths don't). Callers
//? `process.exit(1)` on null — kept in the entry so the lib stays exit-free where
//? practical, but the message + lookup live here so they can't drift.
export const validateProject = (startDir: string, extraHint?: string): ConsumerProject | null => {
  const project = findProjectRoot(startDir);
  if (!project) {
    console.error(PROJECT_NOT_FOUND);
    if (extraHint) console.error(extraHint);
    return null;
  }
  return project;
};

//? Reuse the version range the project already pins its other `@luckystack/*`
//? deps to, so an added package stays in lockstep. Falls back to the CLI's own
//? major (`^<cliVersion>`) when no @luckystack dep exists yet.
export const resolveLuckyStackRange = (pkg: PackageJson, cliVersion: string): string => {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [name, range] of Object.entries(deps)) {
    if (name.startsWith('@luckystack/') && typeof range === 'string' && range.length > 0) {
      return range;
    }
  }
  return `^${cliVersion}`;
};

//? Add a dependency to package.json if absent. Returns true when it was added,
//? false when it was already present (idempotent).
export const addDependency = (project: ConsumerProject, name: string, range: string): boolean => {
  project.pkg.dependencies ??= {};
  if (project.pkg.dependencies[name]) return false;
  project.pkg.dependencies[name] = range;
  //? Keep dependencies sorted so diffs stay stable.
  project.pkg.dependencies = Object.fromEntries(
    Object.entries(project.pkg.dependencies).toSorted(([a], [b]) => a.localeCompare(b)),
  );
  fs.writeFileSync(project.pkgPath, `${JSON.stringify(project.pkg, null, 2)}\n`);
  return true;
};

export interface FileEdit {
  find: string;
  replace: string;
}

//? Apply ordered string edits to a project file. CRLF is normalized to LF before
//? matching (mirrors create-luckystack-app's editScaffoldFile) so `\n`-bearing
//? tokens match regardless of checkout line endings. Throws when a token is
//? absent so a drifted file surfaces loudly instead of silently half-applying.
export const editFile = (filePath: string, edits: readonly FileEdit[]): void => {
  const original = fs.readFileSync(filePath, 'utf8');
  //? Match against an LF-normalized copy so `\n`-bearing tokens hit regardless of
  //? the checkout's line endings, then restore CRLF on write-back if the file was
  //? CRLF — otherwise a Windows consumer (core.autocrlf) gets a whole-file LF diff.
  const wasCrlf = original.includes('\r\n');
  let content = original.replaceAll('\r\n', '\n');
  //? Apply every edit to an in-memory copy first; the file on disk is written
  //? exactly once, after all edits succeed. If any token is missing we throw
  //? before that single write, so a drifted template can never leave the file
  //? half-edited. Edits are intentionally sequential — an earlier edit may
  //? introduce the anchor a later edit matches against (see addPresence).
  for (const { find, replace } of edits) {
    if (!content.includes(find)) {
      throw new Error(`edit failed — token not found in ${filePath}:\n${find}`);
    }
    content = content.replaceAll(find, replace);
  }
  if (wasCrlf) content = content.replaceAll('\n', '\r\n');
  fs.writeFileSync(filePath, content);
};

//? Recursively copy `srcDir` into `destDir`, skipping any file that already
//? exists (idempotent — the consumer owns + may have edited copied files, so we
//? never clobber). Returns the list of relative paths actually written.
export const copyDirIfAbsent = (srcDir: string, destDir: string): string[] => {
  const written: string[] = [];
  const walk = (src: string, dest: string): void => {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        walk(srcPath, destPath);
      } else if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
        written.push(destPath);
      }
    }
  };
  walk(srcDir, destDir);
  return written;
};

//? Resolve a path inside this package's shipped `assets/` folder. `dist/index.js`
//? sits one level under the package root, so `assets/` is `../assets`.
export const assetPath = (...segments: string[]): string => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', 'assets', ...segments);
};

export const runNpmInstall = (root: string): boolean => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status === 0;
};
