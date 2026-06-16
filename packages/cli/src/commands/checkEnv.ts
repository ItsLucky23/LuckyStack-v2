//? `luckystack check-env` — two scans over the project:
//?   A. Unused keys  — defined in a loaded .env file but referenced nowhere in code.
//?   B. Missing defs — referenced in code but defined in no loaded .env file.
//? Results are written to dump/UNUSED_ENV_<hash>.log + dump/MISSING_ENV_<hash>.log,
//? structured so an LLM can resolve them directly.

import fs from 'node:fs';
import path from 'node:path';
import { buildScanReports, collectSourceFiles, groupLocations, matchAll } from '../lib/scan';
import type { ConsumerProject } from '../lib/project';

//? Keys consumed by the framework itself (read inside node_modules/@luckystack/*
//? or by external tools like Prisma/Vite), so a consumer scan must NOT flag them
//? as "unused" just because the consumer's own src never reads them. Edit/extend
//? per project as needed.
//? DEV NOTE: there is no automated parity test between this set and the actual
//? `process.env` reads inside @luckystack/* packages. When adding or removing a
//? framework env var, update this set manually. A future improvement would be a
//? CI step that greps the published packages for `process.env.<KEY>` references
//? and diffs them against this list.
const FRAMEWORK_ENV_KEYS = new Set([
  'NODE_ENV', 'SECURE', 'PROJECT_NAME', 'SERVER_IP', 'SERVER_PORT',
  'REDIS_HOST', 'REDIS_USER', 'REDIS_PASSWORD', 'REDIS_PORT',
  'EXTERNAL_ORIGINS', 'DNS', 'LUCKYSTACK_ENV', 'LUCKYSTACK_ENV_FILES',
  'LUCKYSTACK_PRESET', 'ROUTER_PORT', 'LUCKYSTACK_SECRET_MANAGER_URL',
  'DATABASE_URL',
  'EMAIL_FROM', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS',
  'SENTRY_DSN', 'SENTRY_ENABLED', 'POSTHOG_KEY', 'POSTHOG_HOST', 'BCRYPT_ROUNDS',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET',
  'FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET',
  'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID',
]);
//? Prefixes whose keys are read outside the server's `process.env` (Vite injects
//? VITE_*; TEST_* are consumed by the test-runner scripts).
const IGNORED_PREFIXES = ['VITE_', 'TEST_'];

const isIgnored = (key: string): boolean =>
  FRAMEWORK_ENV_KEYS.has(key) || IGNORED_PREFIXES.some((p) => key.startsWith(p));

//? Strip the dev-only `DEV_` prefix so `DEV_GOOGLE_CLIENT_ID` (env file) and
//? `env('GOOGLE_CLIENT_ID')` / `process.env.GOOGLE_CLIENT_ID` (code) match — the
//? framework reads `DEV_<KEY>` in dev and the unprefixed `<KEY>` in prod.
const baseKey = (key: string): string => key.replace(/^DEV_/, '');

//? Read a single non-secret config key's VALUE from the project's `.env` (only the
//? `LUCKYSTACK_ENV_FILES` override, which lives in `.env`, never `.env.local`).
//? Unlike parseEnvKeys (names only, by design — .env.local holds secrets) this
//? must see one value to mirror the server's env-file selection. Best-effort:
//? missing/unreadable file → null.
const readEnvOverrideFromProject = (root: string): string | null => {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(root, '.env'), 'utf8');
  } catch {
    return null;
  }
  for (const line of raw.replaceAll('\r\n', '\n').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const match = /^(?:export\s+)?LUCKYSTACK_ENV_FILES\s*=\s*(.*)$/.exec(trimmed);
    if (match) {
      //? Strip surrounding quotes a consumer may have wrapped the value in.
      return (match[1] ?? '').trim().replaceAll(/^['"]|['"]$/g, '');
    }
  }
  return null;
};

//? Mirror @luckystack/core `getEnvFiles()`: `LUCKYSTACK_ENV_FILES` (comma list)
//? overrides the `['.env', '.env.local']` default. The CLI never loads dotenv, so
//? read the override from BOTH the CLI process env AND the project's `.env`
//? (process env wins) — otherwise a project that only sets the override in its
//? `.env` would be scanned against the wrong files, producing false unused/missing
//? findings an LLM might "fix" by deleting live keys.
const resolveEnvFiles = (root: string): string[] => {
  const override = process.env.LUCKYSTACK_ENV_FILES ?? readEnvOverrideFromProject(root);
  if (override && override.trim().length > 0) {
    return override.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return ['.env', '.env.local'];
};

//? Parse KEY names only (never values — `.env.local` holds secrets) from `KEY=…`
//? lines, skipping comments + blanks. NOTE (CLAUDE.md Rule 16): reading `.env.local`
//? at all is deliberate and within the letter of the rule — only the LEFT-hand KEY
//? names are kept; every value is discarded here, so no secret is ever surfaced.
//? Don't "fix" this by skipping `.env.local` — the scan needs its key names to
//? avoid false "missing definition" findings.
const parseEnvKeys = (absPath: string): string[] => {
  let raw: string;
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  const keys: string[] = [];
  //? Track an open multi-line quoted value (`KEY="line1\nline2"`): while inside one,
  //? a continuation line that happens to look like `WORD=` is part of the VALUE, not
  //? a new key — counting it would produce a false "missing definition" finding.
  let openQuote: '"' | "'" | null = null;
  for (const line of raw.replaceAll('\r\n', '\n').split('\n')) {
    if (openQuote) {
      //? Still inside a quoted value — a line whose TRIMMED form ends with the
      //? matching quote is treated as the close. Using endsWith avoids closing
      //? prematurely on a continuation line that merely contains the quote char
      //? embedded in the value (e.g. `has a "word" in it`).
      if (line.trimEnd().endsWith(openQuote)) openQuote = null;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(trimmed);
    if (match?.[1]) {
      keys.push(match[1]);
      //? Detect a value that OPENS a quote without closing it on the same line.
      const value = match[2] ?? '';
      const quote = value.startsWith('"') ? '"' : (value.startsWith("'") ? "'" : null);
      if (quote && !value.slice(1).includes(quote)) openQuote = quote;
    }
  }
  return keys;
};

export const checkEnv = (project: ConsumerProject): void => {
  const files = collectSourceFiles(project.root);

  //? Code references: process.env.X / process.env['X'] / env('X') helper calls.
  const refHits = [
    ...matchAll(files, /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/),
    ...matchAll(files, /process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/),
    ...matchAll(files, /\benv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/),
  ];
  const usedLocations = groupLocations(refHits);
  const usedBases = new Set([...usedLocations.keys()].map((key) => baseKey(key)));

  //? Defined keys, per env file.
  const envFiles = resolveEnvFiles(project.root);
  const definedByFile = new Map<string, string[]>();
  const definedBases = new Set<string>();
  const presentEnvFiles: string[] = [];
  for (const rel of envFiles) {
    const abs = path.join(project.root, rel);
    if (!fs.existsSync(abs)) continue;
    presentEnvFiles.push(rel);
    const keys = parseEnvKeys(abs);
    definedByFile.set(rel, keys);
    for (const key of keys) definedBases.add(baseKey(key));
  }

  // ---- Command A: unused keys ----
  const unused = buildScanReports({
    root: project.root,
    kind: 'UNUSED_ENV',
    items: [...definedByFile],
    renderSection: ([rel, keys]) => {
      const unusedKeys = keys.filter((key) => !usedBases.has(baseKey(key)) && !isIgnored(key));
      if (unusedKeys.length === 0) return null;
      return {
        section: `## file: ${rel}\n${unusedKeys.map((k) => `- ${k}`).join('\n')}`,
        count: unusedKeys.length,
      };
    },
    header: (count) =>
      `# UNUSED ENV KEYS — ${String(count)} found\n` +
      `# Defined in a loaded .env file but referenced nowhere in code.\n` +
      `# Loaded env files: ${presentEnvFiles.join(', ') || '(none found)'}\n` +
      `# Framework-consumed keys (Redis/Prisma/OAuth/Vite/Test…) are excluded.\n` +
      `# Feed this to an LLM: for each key, decide whether to delete it from the\n` +
      `# .env file or wire it into the code that should consume it.\n\n`,
    emptyText: '(no unused keys)\n',
  });

  // ---- Command B: missing definitions ----
  const missing = buildScanReports({
    root: project.root,
    kind: 'MISSING_ENV',
    items: [...usedLocations.entries()].toSorted(([a], [b]) => a.localeCompare(b)),
    renderSection: ([key, locations]) => {
      const base = baseKey(key);
      if (definedBases.has(base) || isIgnored(key) || isIgnored(base)) return null;
      return {
        section:
          `## KEY: ${key}\n` +
          `- used in: ${locations.join(', ')}\n` +
          `- not defined in: ${presentEnvFiles.join(', ') || '(no env files found)'}\n` +
          `- suggested: add \`${base}=\` to .env (or .env.local if it's a secret)`,
        count: 1,
      };
    },
    header: (count) =>
      `# MISSING ENV DEFINITIONS — ${String(count)} found\n` +
      `# Referenced in code but defined in no loaded .env file (DEV_ prefix aware).\n` +
      `# Loaded env files: ${presentEnvFiles.join(', ') || '(none found)'}\n` +
      `# Framework/ambient keys (NODE_ENV, Redis, OAuth, VITE_/TEST_…) are excluded.\n` +
      `# Feed this to an LLM: add each missing key to the right .env file.\n\n`,
    emptyText: '(no missing definitions)\n',
  });

  console.log(`\n✓ env scan complete (${String(files.length)} source files, ${String(presentEnvFiles.length)} env file(s)).`);
  console.log(`  Unused keys:        ${String(unused.count)} → Look in ${unused.path} and resolve all unused keys.`);
  console.log(`  Missing definitions: ${String(missing.count)} → Look in ${missing.path} and resolve all missing keys.`);
};
