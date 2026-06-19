//? Value-SAFE env-file editing for the reconfigure flow (ADR 0014). The CLI may
//? read `.env.local` for key NAMES only (Rule 16 / ADR 0014 D1) and, when ADDING a
//? provider, APPEND an empty placeholder block so the developer has slots to fill.
//? It NEVER reads, rewrites, or deletes a line that could hold a secret VALUE:
//?   - add  : append a sentinel-delimited block ONLY when none of the provider's
//?            keys are already declared (idempotent) — existing lines untouched.
//?   - remove: drop ONLY a sentinel block the CLI itself wrote (empty placeholders);
//?            a hand-filled block (no sentinel, or values present) is left in place
//?            and the user is told which keys to clear. We never destroy a secret.
//? `EXTERNAL_ORIGINS` lives in `.env` (non-secret) and is comma-managed directly.

import fs from 'node:fs';
import path from 'node:path';

const open = (id: string): string => `# >>> luckystack:${id} >>>`;
const close = (id: string): string => `# <<< luckystack:${id} <<<`;

//? True when the project declares a sentinel block for `id` (i.e. the CLI added
//? this provider's placeholders before).
export const hasSentinelBlock = (text: string, id: string): boolean => text.includes(open(id));

//? Append a sentinel-delimited block. Caller guarantees absence (upsert checks).
//? Normalizes CRLF→LF first: `writeText` re-applies CRLF on write-back, so a mixed
//? \r\n + \n string would otherwise become \r\r\n.
export const appendSentinelBlock = (text: string, id: string, lines: readonly string[]): string => {
  const normalized = text.replaceAll('\r\n', '\n');
  const block = [open(id), ...lines, close(id)].join('\n');
  const base = normalized.length === 0 || normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  const sep = base.length === 0 ? '' : '\n';
  return `${base}${sep}${block}\n`;
};

//? The UNCOMMENTED keys inside a sentinel block that the developer FILLED with a
//? real value. Used to refuse deleting a block that would destroy live credentials
//? — value presence is detected, the value itself is never read out or returned.
//? `shippedDefaults` (key → the non-empty default the CLI itself wrote, e.g.
//? `EMAIL_FROM=noreply@example.com`) lets us EXCLUDE an untouched shipped default
//? from the "filled" set: a value equal to its shipped default is inert, not a
//? developer secret, so a placeholder-only block can still be auto-removed. A key
//? absent from the map (empty default) counts any non-empty value as filled.
export const filledKeysInBlock = (
  text: string,
  id: string,
  shippedDefaults?: ReadonlyMap<string, string>,
): string[] => {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const start = lines.indexOf(open(id));
  if (start === -1) return [];
  const end = lines.indexOf(close(id), start);
  //? Open sentinel but no close (truncated/malformed): we can't safely scan the
  //? block, so treat it as "has content" → the caller keeps it rather than risk
  //? deleting secrets in an unbounded region.
  if (end === -1) return ['<unclosed block>'];
  const filled: string[] = [];
  for (let i = start + 1; i < end; i += 1) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(lines[i] ?? '');
    if (!match) continue;
    const key = match[1] ?? '';
    const value = (match[2] ?? '').trim();
    //? Non-empty AND not the untouched shipped default → a real developer value.
    if (value.length > 0 && value !== shippedDefaults?.get(key)) filled.push(key);
  }
  return filled;
};

//? Remove a sentinel-delimited block (and a single trailing blank line if left).
//? Returns the text unchanged when the block is absent.
export const removeSentinelBlock = (text: string, id: string): string => {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const start = lines.indexOf(open(id));
  if (start === -1) return text;
  const end = lines.indexOf(close(id), start);
  if (end === -1) return text;
  //? Drop the block; also swallow one immediately-preceding blank line so repeated
  //? add/remove cycles don't accumulate blank lines.
  let from = start;
  if (from > 0 && lines[from - 1] === '') from -= 1;
  lines.splice(from, end - from + 1);
  return lines.join('\n');
};

//? Locate the EXTERNAL_ORIGINS assignment by LINE INDEX (not substring) + parse its
//? comma-separated value. Index-based so an edit never touches a comment or other
//? line that merely contains the same text as a substring. Returns null when absent.
const findOriginsLine = (lines: readonly string[]): { idx: number; origins: string[] } | null => {
  const idx = lines.findIndex((line) => /^\s*EXTERNAL_ORIGINS\s*=/.test(line));
  if (idx === -1) return null;
  const value = /^\s*EXTERNAL_ORIGINS\s*=(.*)$/.exec(lines[idx] ?? '')?.[1] ?? '';
  const origins = value.split(',').map((o) => o.trim()).filter((o) => o.length > 0);
  return { idx, origins };
};

//? Add `origin` to EXTERNAL_ORIGINS (creating the line if absent), de-duplicated.
export const addOrigin = (text: string, origin: string): string => {
  //? Normalize first (writeText re-applies CRLF) — the create-line branch must NOT
  //? splice a bare \n onto a still-CRLF string or writeText produces \r\r\n.
  const normalized = text.replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  const found = findOriginsLine(lines);
  if (!found) {
    const base = normalized.length === 0 || normalized.endsWith('\n') ? normalized : `${normalized}\n`;
    return `${base}EXTERNAL_ORIGINS=${origin}\n`;
  }
  if (found.origins.includes(origin)) return text;
  lines[found.idx] = `EXTERNAL_ORIGINS=${[...found.origins, origin].join(',')}`;
  return lines.join('\n');
};

//? Remove `origin` from EXTERNAL_ORIGINS. No-op when the key/origin is absent. When
//? the last origin is removed the whole line is dropped (avoid a malformed empty
//? `EXTERNAL_ORIGINS=`, which the origin gate would read as an empty allow-list).
export const removeOrigin = (text: string, origin: string): string => {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const found = findOriginsLine(lines);
  if (!found?.origins.includes(origin)) return text;
  const next = found.origins.filter((o) => o !== origin);
  if (next.length === 0) lines.splice(found.idx, 1);
  else lines[found.idx] = `EXTERNAL_ORIGINS=${next.join(',')}`;
  return lines.join('\n');
};

//? --- file wrappers (preserve CRLF; create .env.local on first append) ---

const readText = (file: string): string => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

const writeText = (file: string, original: string, next: string): void => {
  const wasCrlf = original.includes('\r\n');
  fs.writeFileSync(file, wasCrlf ? next.replaceAll('\n', '\r\n') : next);
};

//? Append a provider placeholder block to `.env.local` IFF no sentinel for it
//? exists AND none of its primary keys are already declared (value-safe + idempotent).
//? Returns 'added' | 'skipped' (already configured/present). Never edits existing lines.
export const upsertEnvBlock = (
  root: string,
  id: string,
  lines: readonly string[],
  alreadyDeclaredKeys: ReadonlySet<string>,
  declaredByThisBlock: readonly string[],
): 'added' | 'skipped' => {
  const file = path.join(root, '.env.local');
  const original = readText(file);
  if (hasSentinelBlock(original, id)) return 'skipped';
  if (declaredByThisBlock.some((key) => alreadyDeclaredKeys.has(key))) return 'skipped';
  writeText(file, original, appendSentinelBlock(original, id, lines));
  return 'added';
};

//? Remove a CLI-written sentinel block from `.env.local`. Returns 'removed' when a
//? sentinel block existed, else 'kept' (no sentinel → possibly hand-filled; we never
//? delete it). The caller informs the user which keys to clear in the 'kept' case.
export const dropEnvBlock = (
  root: string,
  id: string,
  shippedDefaults?: ReadonlyMap<string, string>,
): 'removed' | 'kept' => {
  const file = path.join(root, '.env.local');
  const original = readText(file);
  if (!hasSentinelBlock(original, id)) return 'kept';
  //? Value-safety (ADR 0014 D1): if the developer typed real values into the
  //? CLI-written placeholders, KEEP the block and tell them which keys to clear —
  //? a `manage` removal must never silently destroy a live secret. An untouched
  //? shipped default (passed in `shippedDefaults`) is NOT a secret, so a block that
  //? holds only placeholders + shipped defaults is removed cleanly.
  const filled = filledKeysInBlock(original, id, shippedDefaults);
  if (filled.length > 0) {
    console.warn(`⚠ kept the .env.local block for "${id}" — it has filled value(s); clear these by hand: ${filled.join(', ')}`);
    return 'kept';
  }
  writeText(file, original, removeSentinelBlock(original, id));
  return 'removed';
};

//? Add/remove an OAuth provider origin in `.env` (non-secret). Best-effort: a
//? missing `.env` is created on add, left alone on remove.
export const updateExternalOrigin = (root: string, origin: string, action: 'add' | 'remove'): void => {
  const file = path.join(root, '.env');
  const original = readText(file);
  if (action === 'remove' && original.length === 0) return;
  const next = action === 'add' ? addOrigin(original, origin) : removeOrigin(original, origin);
  if (next !== original) writeText(file, original, next);
};
