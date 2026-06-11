//? `luckystack check-i18n` — two scans over the project:
//?   C. Unused translations — keys in locale JSON not referenced in code.
//?   D. Missing translations — keys used in code but absent from one or more locales.
//? Dynamic keys (`notify.error({ key: errorCode })`) are handled by ALSO harvesting
//? every literal `errorCode: '...'` repo-wide as a "used" key (server error codes
//? are hardcoded, so this covers the dynamic path). Truly-unresolvable dynamic
//? call sites are listed separately for manual review.
//? Output: dump/UNUSED_I18N_<hash>.log + dump/MISSING_I18N_<hash>.log.

import fs from 'node:fs';
import path from 'node:path';
import { buildScanReports, collectSourceFiles, groupLocations, matchAll, walkDir } from '../lib/scan';
import type { ConsumerProject } from '../lib/project';

//? Translation keys are dotted (`common.connectionError`, `sync.invalidName`).
//? Restricting the "used" set to dotted strings filters out unrelated `key:`
//? object props (e.g. `{ key: 'name' }` in a non-i18n context).
const isTranslationKey = (value: string): boolean => /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)+$/.test(value);

//? Recursively flatten a nested locale object to dotted leaf keys.
const flattenKeys = (obj: unknown, prefix: string, out: Set<string>): void => {
  if (obj === null || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const dotted = prefix.length > 0 ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      flattenKeys(value, dotted, out);
    } else {
      out.add(dotted);
    }
  }
};

const LOCALE_IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', '.cache', 'dump', '.smoke-test', 'build', 'coverage']);

//? Find every `*.json` under a `_locales/` directory in the scanned tree.
//? (collectSourceFiles only returns code files, so walk for locale JSON here.)
const findLocaleFiles = (root: string): string[] => {
  const out: string[] = [];
  walkDir(root, LOCALE_IGNORED_DIRS, (abs, name) => {
    if (name.endsWith('.json') && path.basename(path.dirname(abs)) === '_locales') {
      out.push(abs);
    }
  });
  return out.toSorted();
};

export const checkI18n = (project: ConsumerProject): void => {
  const files = collectSourceFiles(project.root);

  //? Used keys: literal `key: '...'` (notify/translate/upsert) + every literal
  //? `errorCode: '...'` (the dynamic-key source). Filtered to dotted keys.
  const keyHits = matchAll(files, /\bkey:\s*['"]([^'"]+)['"]/);
  const errorCodeHits = matchAll(files, /\berrorCode:\s*['"]([^'"]+)['"]/);
  const usedLocations = groupLocations([...keyHits, ...errorCodeHits].filter((h) => isTranslationKey(h.value)));
  const usedKeys = new Set(usedLocations.keys());

  //? Dynamic call sites we can't resolve: `key:` followed by an identifier.
  const dynamicHits = matchAll(files, /\bkey:\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*[,})]/);
  //? Exclude literals + TS type annotations (`key: string` in a function param /
  //? interface is not a translation call) so the manual-review note stays signal.
  const NON_KEY_VALUES = new Set(['true', 'false', 'null', 'undefined', 'string', 'number', 'boolean', 'unknown', 'any', 'void', 'object', 'never']);
  const dynamicSites = dynamicHits.filter((h) => !NON_KEY_VALUES.has(h.value));

  //? Locale files → dotted key sets per file.
  const localePaths = findLocaleFiles(project.root);
  const localeKeys = new Map<string, Set<string>>(); // rel -> keys
  for (const abs of localePaths) {
    const rel = path.relative(project.root, abs).split(path.sep).join('/');
    const keys = new Set<string>();
    try {
      flattenKeys(JSON.parse(fs.readFileSync(abs, 'utf8')), '', keys);
    } catch {
      console.warn(`  ⚠ could not parse locale file ${rel} — skipped.`);
      continue;
    }
    localeKeys.set(rel, keys);
  }
  const localeRels = [...localeKeys.keys()];

  // ---- Command C: unused translations (per locale file) ----
  const dynamicNote = dynamicSites.length > 0
    ? `# NOTE: ${String(dynamicSites.length)} dynamic key call-site(s) (key: <variable>) could not be\n` +
      `# statically resolved — a key listed below MAY still be used via one of them:\n` +
      dynamicSites.map((h) => `#   ${h.file}:${String(h.line)} (key: ${h.value})`).join('\n') + '\n'
    : '';
  const unused = buildScanReports({
    root: project.root,
    kind: 'UNUSED_I18N',
    items: [...localeKeys],
    renderSection: ([rel, keys]) => {
      const unusedKeys = [...keys].filter((k) => !usedKeys.has(k)).toSorted();
      if (unusedKeys.length === 0) return null;
      return {
        section: `## file: ${rel}\n${unusedKeys.map((k) => `- ${k}`).join('\n')}`,
        count: unusedKeys.length,
      };
    },
    header: (count) =>
      `# UNUSED TRANSLATIONS — ${String(count)} found across ${String(localeRels.length)} locale file(s)\n` +
      `# Present in a locale JSON but referenced nowhere in code.\n` +
      `# Used-key set = literal { key: '...' } + errorCode: '...' (dotted) repo-wide.\n` +
      dynamicNote +
      `# Feed this to an LLM: delete each truly-unused key from the locale file(s).\n\n`,
    emptyText: '(no unused translations)\n',
  });

  // ---- Command D: missing translations (per language) ----
  const missing = buildScanReports({
    root: project.root,
    kind: 'MISSING_I18N',
    items: [...usedLocations.entries()].toSorted(([a], [b]) => a.localeCompare(b)),
    renderSection: ([key, locations]) => {
      const missingFrom = localeRels.filter((rel) => !localeKeys.get(rel)?.has(key));
      if (missingFrom.length === 0) return null;
      const presentIn = localeRels.filter((rel) => localeKeys.get(rel)?.has(key));
      return {
        section:
          `## KEY: ${key}\n` +
          `- used in: ${locations.slice(0, 8).join(', ')}${locations.length > 8 ? ` (+${String(locations.length - 8)} more)` : ''}\n` +
          `- missing from: ${missingFrom.join(', ')}\n` +
          `- present in: ${presentIn.join(', ') || '(none)'}`,
        count: 1,
      };
    },
    header: (count) =>
      `# MISSING TRANSLATIONS — ${String(count)} key(s) absent from ≥1 locale file\n` +
      `# Used in code (or as a server errorCode) but missing from one or more locales.\n` +
      `# Locale files: ${localeRels.join(', ') || '(none found)'}\n` +
      `# Feed this to an LLM: add each missing key (with a translation) to the listed\n` +
      `# locale file(s), matching the wording/placeholders of the 'present in' files.\n\n`,
    emptyText: '(no missing translations)\n',
  });

  console.log(`\n✓ i18n scan complete (${String(files.length)} source files, ${String(localeRels.length)} locale file(s), ${String(usedKeys.size)} keys used).`);
  console.log(`  Unused translations:  ${String(unused.count)} → Look in ${unused.path} and resolve all unused keys.`);
  console.log(`  Missing translations: ${String(missing.count)} → Look in ${missing.path} and resolve all missing keys.`);
  if (dynamicSites.length > 0) {
    console.log(`  (${String(dynamicSites.length)} dynamic key call-site(s) noted in the unused log for manual review.)`);
  }
};
