//? "Is this project file still exactly what the framework shipped?" — the guard
//? that lets a removal delete the framework's own copies while keeping anything
//? the user added or edited. ADR 0014's preview rule: a change lists exactly
//? what it adds/removes, so a removal may not silently take user work with it.
//?
//? A file counts as shipped when its hash equals EITHER the CLI's asset copy
//? (what `luckystack add` writes) OR the hash the scaffold manifest recorded for
//? that path (what create-luckystack-app wrote, possibly at an older version).
//? Every other file is the user's — an edit, or a file they added themselves.
//? A file copied by an OLDER cli without a manifest entry therefore reads as
//? the user's: keeping a framework file is recoverable, deleting work is not.

import fs from 'node:fs';
import path from 'node:path';
import { hashFileContent, isTextFile, readScaffoldManifest } from '../commands/update';

export interface ShippedSplit {
  /** Unedited framework copies (posix, project-relative) — safe to delete. */
  shipped: string[];
  /** Files the user added or edited (posix, project-relative) — keep + list. */
  kept: string[];
}

const hashAt = (absolute: string): string =>
  hashFileContent(fs.readFileSync(absolute), isTextFile(absolute));

//? Expand project-relative entries (files or directories) to the files that
//? exist under them, as posix paths. Missing entries contribute nothing.
export const expandToFiles = (root: string, entries: readonly string[]): string[] => {
  const out: string[] = [];
  const walk = (relative: string): void => {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    if (fs.statSync(absolute).isDirectory()) {
      for (const name of fs.readdirSync(absolute).toSorted()) walk(`${relative}/${name}`);
      return;
    }
    out.push(relative);
  };
  for (const entry of entries) walk(entry.replaceAll('\\', '/'));
  return out;
};

const readRecordedHashes = (root: string): Map<string, string> => {
  try {
    const manifest = readScaffoldManifest(root);
    return new Map((manifest?.files ?? []).map((entry) => [entry.path, entry.sha256]));
  } catch {
    //? A hand-broken manifest only loses the second source; the asset
    //? comparison still runs, and anything unproven is kept.
    return new Map();
  }
};

//? `assetRoot` mirrors the project layout (assets/<bundle>/<project path>).
export const splitShippedFiles = (
  root: string,
  relativePaths: readonly string[],
  assetRoot: string,
): ShippedSplit => {
  const recorded = readRecordedHashes(root);
  const split: ShippedSplit = { shipped: [], kept: [] };
  for (const relative of relativePaths) {
    const localHash = hashAt(path.join(root, relative));
    const assetAbsolute = path.join(assetRoot, relative);
    const matchesAsset = fs.existsSync(assetAbsolute) && hashAt(assetAbsolute) === localHash;
    const matchesManifest = recorded.get(relative) === localHash;
    (matchesAsset || matchesManifest ? split.shipped : split.kept).push(relative);
  }
  return split;
};

//? Remove a directory tree that holds no files anymore. Kept user files keep
//? their folders alive — only truly empty directories go.
export const removeDirIfEmptyDeep = (dir: string): void => {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeDirIfEmptyDeep(path.join(dir, entry.name));
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
};
