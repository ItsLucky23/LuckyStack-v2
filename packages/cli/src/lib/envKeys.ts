//? Reads which env KEY NAMES are declared in a project's env files — NEVER their
//? values (CLAUDE.md Rule 16 + ADR 0014 D1: `.env.local` may be inspected for key
//? PRESENCE only). Used to detect which OAuth / email / monitoring providers a
//? project has configured, since that intent lives in env, not in package.json.
//?
//? Precedence mirrors the framework's own env loading: `.env.local` first, then
//? `.env`. For a boolean "is this key declared?" the union is what matters, so we
//? collect the uncommented assignment keys from both files into one set.

import fs from 'node:fs';
import path from 'node:path';

//? Files scanned, in precedence order. `.env.local` (developer secrets) is read
//? for KEY NAMES ONLY — the value (right of `=`) is never parsed or returned.
const ENV_FILES = ['.env.local', '.env'] as const;

//? Match an UNCOMMENTED assignment line and capture only the key name. A leading
//? `#` (enable-later block) means the key is NOT declared, so those are skipped —
//? a commented `# DEV_GOOGLE_CLIENT_ID=` does not count as "google configured".
//? `export FOO=` is tolerated. We never look past the `=`.
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

//? Parse a single env file's text into the set of declared key names. Pure +
//? value-blind: only the substring left of the first `=` is ever read.
export const parseDeclaredKeys = (text: string): Set<string> => {
  const keys = new Set<string>();
  for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
    const match = ASSIGNMENT.exec(line);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
};

//? The union of declared key names across `.env.local` then `.env` under `root`.
//? Missing/unreadable files are skipped silently (a project may have neither yet).
export const readDeclaredEnvKeys = (root: string): Set<string> => {
  const keys = new Set<string>();
  for (const file of ENV_FILES) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const key of parseDeclaredKeys(text)) keys.add(key);
  }
  return keys;
};

//? True when ANY of `candidateKeys` is declared in the project's env files. Used
//? to map a provider (with its id/host key candidates) to "configured or not".
export const anyKeyDeclared = (declared: ReadonlySet<string>, candidateKeys: readonly string[]): boolean =>
  candidateKeys.some((key) => declared.has(key));
