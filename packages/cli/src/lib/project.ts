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
  scripts?: Record<string, string>;
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

//? Normalize a caught `unknown` throw into a real Error. `catch` gives `unknown`;
//? casting with `as Error` is forbidden (strict-typing policy) — callers must use
//? this helper instead of `error as Error` so a thrown string or number never
//? produces `err.error.message = undefined`.
export const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

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

//? Best-effort read+parse of a package.json. Returns null on a missing/unreadable
//? file OR invalid JSON (mid-edit, BOM-corrupted, …) so callers on the hot path
//? can degrade gracefully instead of crashing with a raw SyntaxError stack.
const readPackageJson = (pkgPath: string): PackageJson | null => {
  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    return parsed as PackageJson;
  } catch {
    return null;
  }
};

//? A LuckyStack project is identified by a package.json that depends on at least
//? one `@luckystack/*` package AND a top-level `config.ts`. We walk up from the
//? CWD so the CLI works when invoked from a subdirectory.
export const findProjectRoot = (startDir: string): ConsumerProject | null => {
  let dir = path.resolve(startDir);
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath) && fs.existsSync(path.join(dir, 'config.ts'))) {
      //? Guard the parse: a malformed / mid-edit `package.json` (here or in an
      //? ancestor) must NOT throw a raw SyntaxError on the hot path of every
      //? command — treat an unparseable file as "not a project" and keep walking,
      //? mirroring the best-effort parsing in the env-key reader.
      const pkg = readPackageJson(pkgPath);
      if (pkg) {
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        //? A consumer project depends on at least one `@luckystack/*` package; the
        //? framework monorepo itself doesn't, but has `packages/core`. Accept both
        //? so the scan commands work in either (the `add` commands target consumers).
        const hasLuckyStack =
          Object.keys(deps).some((name) => name.startsWith('@luckystack/')) ||
          fs.existsSync(path.join(dir, 'packages', 'core', 'package.json'));
        if (hasLuckyStack) return { root: dir, pkg, pkgPath };
      }
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
    //? Reuse an existing @luckystack dep's range so the new package version
    //? matches the rest — but ONLY a plain semver/dist-tag range. A protocol
    //? spec (`file:`/`link:`/`git`/`http`/`workspace:`/`portal:`) points at a
    //? SPECIFIC package's location, so reusing it for a DIFFERENT package mis-
    //? points the install (e.g. `@luckystack/login: file:…/luckystack-api.tgz`,
    //? which npm then can't resolve as login). Skip those and fall back to the
    //? CLI's own version range, which install overrides / the registry resolve.
    if (
      name.startsWith('@luckystack/')
      && typeof range === 'string'
      && range.length > 0
      && !/^(file:|link:|git\+|git:|https?:|workspace:|portal:)/.test(range)
    ) {
      return range;
    }
  }
  return `^${cliVersion}`;
};

//? Detect the indentation used in a JSON file: look for the first property line
//? (leading whitespace before `"`), return its whitespace prefix. Falls back to
//? 2-space when the file is one-line or has no detectable indent, so the output
//? is always valid JSON and matches the common convention. Exported so callers
//? (e.g. addAiDocs patching .mcp.json) can preserve a file's original indentation.
export const detectJsonIndent = (raw: string): number | string => {
  for (const line of raw.replaceAll('\r\n', '\n').split('\n').slice(1)) {
    const match = /^(\s+)"/.exec(line);
    if (match) return match[1] ?? 2;
  }
  return 2;
};

//? Add a dependency to package.json if absent. Returns true when it was added,
//? false when it was already present (idempotent).
//? DD-CLI-D1: an empty `name` is a caller bug — guard it so an accidental ''
//? key never silently writes to dependencies['']. DD-CLI-D2: preserve the file's
//? original indentation instead of always emitting 2-space.
export const addDependency = (project: ConsumerProject, name: string, range: string): boolean => {
  if (!name) throw new Error('addDependency: name must be a non-empty string');
  project.pkg.dependencies ??= {};
  if (project.pkg.dependencies[name]) return false;
  project.pkg.dependencies[name] = range;
  //? Keep dependencies sorted so diffs stay stable.
  project.pkg.dependencies = Object.fromEntries(
    Object.entries(project.pkg.dependencies).toSorted(([a], [b]) => a.localeCompare(b)),
  );
  const raw = fs.readFileSync(project.pkgPath, 'utf8');
  const indent = detectJsonIndent(raw);
  fs.writeFileSync(project.pkgPath, `${JSON.stringify(project.pkg, null, indent)}\n`);
  return true;
};

//? Add a DEV dependency (idempotent). Used for dev-only tooling like @luckystack/mcp.
export const addDevDependency = (project: ConsumerProject, name: string, range: string): boolean => {
  if (!name) throw new Error('addDevDependency: name must be a non-empty string');
  project.pkg.devDependencies ??= {};
  if (project.pkg.devDependencies[name]) return false;
  project.pkg.devDependencies[name] = range;
  project.pkg.devDependencies = Object.fromEntries(
    Object.entries(project.pkg.devDependencies).toSorted(([a], [b]) => a.localeCompare(b)),
  );
  const raw = fs.readFileSync(project.pkgPath, 'utf8');
  fs.writeFileSync(project.pkgPath, `${JSON.stringify(project.pkg, null, detectJsonIndent(raw))}\n`);
  return true;
};

//? Drop a dependency from package.json if present. Returns true when it was
//? removed, false when it was already absent (idempotent — the inverse of
//? addDependency). Preserves the file's original indentation, same as the add
//? path. Only touches `dependencies` (the add path only ever writes there).
export const dropDependency = (project: ConsumerProject, name: string): boolean => {
  if (!name) throw new Error('dropDependency: name must be a non-empty string');
  //? Remove from BOTH dependencies and devDependencies — `hasDependency` checks
  //? both, so leaving a dep in devDependencies would make state detection report
  //? the feature as still installed after a removal (an infinite "remove" loop).
  let removed = false;
  if (project.pkg.dependencies && name in project.pkg.dependencies) {
    const { [name]: _removed, ...rest } = project.pkg.dependencies;
    project.pkg.dependencies = rest;
    removed = true;
  }
  if (project.pkg.devDependencies && name in project.pkg.devDependencies) {
    const { [name]: _removedDev, ...rest } = project.pkg.devDependencies;
    project.pkg.devDependencies = rest;
    removed = true;
  }
  if (!removed) return false;
  const raw = fs.readFileSync(project.pkgPath, 'utf8');
  const indent = detectJsonIndent(raw);
  fs.writeFileSync(project.pkgPath, `${JSON.stringify(project.pkg, null, indent)}\n`);
  return true;
};

//? True when the consumer's package.json lists `name` in dependencies OR
//? devDependencies. Used by `list` / `manage` to detect the installed set from
//? the manifest (the package.json is the consumer's declared intent — cheaper +
//? mutation-aligned than resolving node_modules, which `add`/`remove` edit here).
export const hasDependency = (pkg: PackageJson, name: string): boolean =>
  Boolean(pkg.dependencies?.[name]) || Boolean(pkg.devDependencies?.[name]);

//? The version range a dependency is pinned to (dependencies first, then
//? devDependencies), or null when absent. Drives the `installed (vRANGE)` column.
export const dependencyRange = (pkg: PackageJson, name: string): string | null => {
  const range = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  return typeof range === 'string' && range.length > 0 ? range : null;
};

//? Add/overwrite a `scripts.<name>` entry in package.json (idempotent: returns
//? false when already set to the same command). Preserves indentation.
export const setScript = (project: ConsumerProject, name: string, command: string): boolean => {
  if (!name) throw new Error('setScript: name must be a non-empty string');
  project.pkg.scripts ??= {};
  if (project.pkg.scripts[name] === command) return false;
  project.pkg.scripts[name] = command;
  const raw = fs.readFileSync(project.pkgPath, 'utf8');
  fs.writeFileSync(project.pkgPath, `${JSON.stringify(project.pkg, null, detectJsonIndent(raw))}\n`);
  return true;
};

//? Drop a `scripts.<name>` entry if present (inverse of setScript).
export const dropScript = (project: ConsumerProject, name: string): boolean => {
  if (!name || !project.pkg.scripts || !(name in project.pkg.scripts)) return false;
  const { [name]: _removed, ...rest } = project.pkg.scripts;
  project.pkg.scripts = rest;
  const raw = fs.readFileSync(project.pkgPath, 'utf8');
  fs.writeFileSync(project.pkgPath, `${JSON.stringify(project.pkg, null, detectJsonIndent(raw))}\n`);
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
    //? Replace only the FIRST occurrence so a token that appears more than once
    //? in a drifted file does not cause a double-edit (would corrupt the output).
    //? String.prototype.replace with a string needle replaces the first match only.
    content = content.replace(find, replace);
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

//? Resolve a bare command name (`npm`) to an ABSOLUTE path by scanning `PATH`
//? only — the current directory is intentionally NOT searched, so an `npm.cmd` /
//? `npm.exe` dropped in the project root can never be picked up. On Windows we try
//? each `PATHEXT` extension (`.cmd`, `.exe`, …); elsewhere the bare name. Returns
//? null if not found (caller reports a clean failure).
const resolveCommandPath = (command: string): string | null => {
  const rawPath = process.env.PATH ?? process.env.Path ?? '';
  const dirs = rawPath.split(path.delimiter).filter((d) => d.length > 0);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => e.length > 0)
      : [''];
  for (const dir of dirs) {
    //? A relative PATH entry could still resolve against cwd — skip those.
    if (!path.isAbsolute(dir)) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext.toLowerCase());
      const candidateUpper = path.join(dir, command + ext);
      if (fs.existsSync(candidate)) return candidate;
      if (candidateUpper !== candidate && fs.existsSync(candidateUpper)) return candidateUpper;
    }
  }
  return null;
};

//? Detect the package manager in use by checking for lockfiles and the
//? `packageManager` field in package.json. Checked in priority order so a
//? project that committed multiple lockfiles still picks the right one.
//? Exported for the cross-package parity test that pins this detector against
//? the `packageManager` field create-luckystack-app's `--pm=bun` actually
//? writes — the scaffolder can't import it (zero-dep, no cli dependency), so
//? the seam between "what the scaffold records" and "what every later
//? `luckystack` install spawns" is guarded by a test instead of a shared import.
//? pnpm/yarn stay recognised here (a consumer may switch by hand) even though
//? the scaffold wizard only offers npm + bun.
export const detectPackageManager = (root: string, pkg: PackageJson): string => {
  const pm = typeof pkg.packageManager === 'string' ? pkg.packageManager : '';
  if (pm.startsWith('pnpm')) return 'pnpm';
  if (pm.startsWith('yarn')) return 'yarn';
  if (pm.startsWith('bun')) return 'bun';
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
};

export const runNpmInstall = (root: string, pkg: PackageJson = {}): boolean => {
  //? Security (Windows): `spawnSync('npm.cmd', …, { shell: true, cwd: root })` lets
  //? cmd.exe resolve `npm.cmd` against the CWD BEFORE PATH — a malicious `npm.cmd`
  //? dropped at the project root would run with the user's privileges. Resolve the
  //? detected package manager to an ABSOLUTE path via PATH (PATHEXT-aware, cwd
  //? excluded) and spawn THAT, so the command is never resolved relative to `root`.
  const manager = detectPackageManager(root, pkg);
  const resolved = resolveCommandPath(manager);
  if (!resolved) return false;
  //? A `.cmd`/`.bat` shim still needs cmd.exe to interpret it, but we now hand the
  //? shell an ABSOLUTE path, so it is never resolved relative to `cwd`.
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
  if (needsShell) {
    //? `shell: true` would hand cmd.exe a single joined command string and cmd
    //? re-splits it on spaces — so the standard Windows layout
    //? `C:\Program Files\nodejs\npm.cmd` breaks ("'C:\Program' is not recognized")
    //? and the install SILENTLY no-ops (callers only warn). Invoke the comspec
    //? explicitly with the path QUOTED + `windowsVerbatimArguments` so cmd does not
    //? re-parse/auto-quote it. (`/d` skips AutoRun, `/c` runs then exits.)
    //? CRITICAL: with `/s`, cmd strips the FIRST and LAST quote of the whole
    //? string after `/c` and runs the rest verbatim. A single quote-pair
    //? (`"<path>" install`) is therefore WRONG — cmd strips those two quotes,
    //? leaving `C:\Program Files\...\npm.cmd install` which splits on the space
    //? ("'C:\Program' is not recognized"). The path must be wrapped in an OUTER
    //? quote pair too: `""<path>" install"` — `/s` strips the outer pair, the
    //? inner pair keeps the spaced path intact.
    const comspec = process.env.ComSpec ?? 'cmd.exe';
    const shellResult = spawnSync(comspec, ['/d', '/s', '/c', `""${resolved}" install"`], {
      cwd: root,
      stdio: 'inherit',
      windowsVerbatimArguments: true,
    });
    return shellResult.status === 0;
  }
  const result = spawnSync(resolved, ['install'], { cwd: root, stdio: 'inherit' });
  return result.status === 0;
};
