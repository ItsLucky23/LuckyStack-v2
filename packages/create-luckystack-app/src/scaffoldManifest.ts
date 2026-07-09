//? Scaffold manifest — the missing "what did the scaffold write, with which
//? choices, at which version?" record (decision: ADR 0021, scaffold-manifest +
//? luckystack update). Written ONCE at scaffold time to
//? `.luckystack/scaffold.json` (committed — it must survive clones):
//?
//? - `choices` + `projectName` + `luckystackVersion` let a future
//?   `luckystack update` RE-RENDER the exact same template (files are
//?   `{{VAR}}`-substituted, so a raw-template diff is meaningless without
//?   them) and let the manage CLI reconfigure migration-bearing axes.
//? - `files[].sha256` is the pristine-vs-modified detector: hash matches the
//?   manifest -> the consumer never touched it -> safe to overwrite with a
//?   newer render; hash differs -> NEVER overwrite (diff/sidecar/AI-merge).
//?
//? Hashes are computed over the RENDERED bytes with CRLF normalized to LF for
//? text files (same convention as the repo's assetParity check) so a git
//? autocrlf checkout doesn't read as "user modified every file".

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SCAFFOLD_MANIFEST_DIR = '.luckystack';
export const SCAFFOLD_MANIFEST_FILE = 'scaffold.json';

//? Never manifest-tracked: installs/VCS state, the manifest itself, and env
//? files (they hold (future) secrets and must never be update-managed — an
//? update command has no business near them, and hashing low-entropy secrets
//? would make the committed manifest an offline-guessing oracle).
const EXCLUDED_DIRS = new Set(['node_modules', '.git']);
const EXCLUDED_FILES = new Set(['.env', '.env.local', '.secret-manager-token']);

export interface ScaffoldManifestFileEntry {
  /** Project-relative path with forward slashes (stable across OSes). */
  path: string;
  /** sha256 hex of the rendered content (text: CRLF→LF normalized). */
  sha256: string;
}

export interface ScaffoldManifest {
  schemaVersion: 1;
  /** create-luckystack-app version that produced this project. */
  luckystackVersion: string;
  createdAt: string;
  /** The slugified project name — a template-vars input, needed to re-render. */
  projectName: string;
  /** The resolved wizard/flag choices — the other template-vars input. */
  choices: Record<string, unknown>;
  files: ScaffoldManifestFileEntry[];
}

export const hashFileContent = (buffer: Buffer, isText: boolean): string => {
  const bytes = isText
    ? Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
    : buffer;
  return crypto.createHash('sha256').update(bytes).digest('hex');
};

/**
 * Walk `rootDir` and hash every scaffold-written file (excluding installs,
 * VCS state, env files, and the manifest itself). `isTextFile` is injected by
 * the caller (the scaffolder's own heuristic) so text files get CRLF-stable
 * hashes. Result is sorted by path for deterministic output.
 */
export const collectFileHashes = (
  rootDir: string,
  isTextFile: (filePath: string) => boolean,
): ScaffoldManifestFileEntry[] => {
  const entries: ScaffoldManifestFileEntry[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(rootDir, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (EXCLUDED_FILES.has(entry.name)) continue;
      if (relative === `${SCAFFOLD_MANIFEST_DIR}/${SCAFFOLD_MANIFEST_FILE}`) continue;
      entries.push({
        path: relative,
        sha256: hashFileContent(fs.readFileSync(absolute), isTextFile(absolute)),
      });
    }
  };
  walk(rootDir);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
};

export interface WriteScaffoldManifestInput {
  luckystackVersion: string;
  projectName: string;
  choices: Record<string, unknown>;
  isTextFile: (filePath: string) => boolean;
}

/**
 * Write `.luckystack/scaffold.json` for a freshly scaffolded project. Call
 * AFTER every file write/prune/wire step and BEFORE `npm install`, so the
 * hashes describe exactly what the scaffold produced.
 */
export const writeScaffoldManifest = (
  targetDir: string,
  input: WriteScaffoldManifestInput,
): ScaffoldManifest => {
  const manifest: ScaffoldManifest = {
    schemaVersion: 1,
    luckystackVersion: input.luckystackVersion,
    createdAt: new Date().toISOString(),
    projectName: input.projectName,
    choices: input.choices,
    files: collectFileHashes(targetDir, input.isTextFile),
  };
  const manifestDir = path.join(targetDir, SCAFFOLD_MANIFEST_DIR);
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(
    path.join(manifestDir, SCAFFOLD_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
};
