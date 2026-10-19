//? `luckystack check-i18n` — two scans over the project:
//?   C. Unused translations — keys in locale JSON not referenced in code.
//?   D. Missing translations — keys used in code but absent from one or more locales.
//? Dynamic keys (`notify.error({ key: errorCode })`) are handled by ALSO harvesting
//? every literal `errorCode: '...'` repo-wide as a "used" key (server error codes
//? are hardcoded, so this covers the dynamic path), plus the keys the installed
//? @luckystack/* packages emit (harvestFrameworkKeys). Truly-unresolvable dynamic
//? call sites are listed separately for manual review.
//? Output: dump/UNUSED_I18N_<hash>.log + dump/MISSING_I18N_<hash>.log.

import fs from 'node:fs';
import path from 'node:path';
import { buildScanReports, collectSourceFiles, groupLocations, matchAll, walkDir } from '../lib/scan';
import type { SourceFile } from '../lib/scan';
import type { ConsumerProject } from '../lib/project';

//? Translation keys are dotted (`common.connectionError`, `sync.invalidName`).
//? Restricting the "used" set to dotted strings filters out unrelated `key:`
//? object props (e.g. `{ key: 'name' }` in a non-i18n context).
//? Allow `_` and `-` in every segment (first included) so keys like
//? `my-feature.some_key` are not incorrectly rejected as non-translation keys.
const isTranslationKey = (value: string): boolean => /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/.test(value);

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

//? Static-literal translation keys referenced in code, with where each was seen.
//? Harvests literal `key: '...'` (notify/translate/upsert call sites) PLUS every
//? literal `errorCode: '...'` (server error codes are hardcoded — this covers the
//? dynamic `notify.error({ key: errorCode })` path), filtered to dotted keys via
//? `isTranslationKey`. Returns the per-key location map (drives the MISSING report)
//? plus the bare key set (drives the UNUSED report). Pure over `files`.
export interface UsedKeys {
  /** `dotted key -> ["rel:line", ...]` for every literal hit. */
  locations: Map<string, string[]>;
  /** The set of dotted keys (== `locations` keys). */
  keys: Set<string>;
}

export const harvestUsedKeys = (files: SourceFile[]): UsedKeys => {
  const keyHits = matchAll(files, /\bkey:\s*['"]([^'"]+)['"]/);
  const errorCodeHits = matchAll(files, /\berrorCode:\s*['"]([^'"]+)['"]/);
  const locations = groupLocations([...keyHits, ...errorCodeHits].filter((h) => isTranslationKey(h.value)));
  return { locations, keys: new Set(locations.keys()) };
};

//? Translation keys the INSTALLED framework emits at runtime (`errorCode:
//? 'api.invalidName'`, `message: 'sync.disabled'`, `fallbackErrorCode: …`) and
//? the client translates from the consumer's own locales. Since the package
//? split they live in node_modules, which the source scan skips, so without
//? this every framework code read as "unused" and the report told the LLM to
//? delete it. Harvests every dotted string literal in @luckystack/*/dist rather
//? than a fixed set of property names: built code reaches keys via ternaries
//? and constants too, and a false "used" only keeps a key — the safe direction.
const FRAMEWORK_CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const DOTTED_LITERAL = /['"`]([A-Za-z][\w-]*(?:\.[\w-]+)+)['"`]/g;

export const harvestFrameworkKeys = (root: string): Set<string> => {
  const keys = new Set<string>();
  const scope = path.join(root, 'node_modules', '@luckystack');
  if (!fs.existsSync(scope)) return keys;
  for (const name of fs.readdirSync(scope)) {
    //? existsSync follows symlinks (workspace installs link the packages).
    const dist = path.join(scope, name, 'dist');
    if (!fs.existsSync(dist)) continue;
    walkDir(dist, new Set(['node_modules']), (abs) => {
      if (!FRAMEWORK_CODE_EXTENSIONS.has(path.extname(abs))) return;
      for (const match of fs.readFileSync(abs, 'utf8').matchAll(DOTTED_LITERAL)) {
        const candidate = match[1];
        if (candidate !== undefined && isTranslationKey(candidate)) keys.add(candidate);
      }
    });
  }
  return keys;
};

//? Exclude literals + TS type annotations (`key: string` in a function param /
//? interface is not a translation call) so the manual-review note stays signal.
const NON_KEY_VALUES = new Set(['true', 'false', 'null', 'undefined', 'string', 'number', 'boolean', 'unknown', 'any', 'void', 'object', 'never']);

//? Dynamic call sites we can't statically resolve: `key:` followed by an
//? identifier (not a quoted literal). These are listed for manual review — a key
//? might be live via one of them. TS type annotations are filtered out. Pure.
export const collectDynamicSites = (files: SourceFile[]): { value: string; file: string; line: number }[] => {
  const dynamicHits = matchAll(files, /\bkey:\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*[,})]/);
  return dynamicHits.filter((h) => !NON_KEY_VALUES.has(h.value));
};

//? Every `_locales/*.json` under `root` → dotted-key set, keyed by its posix
//? rel-path. A file that fails to parse is warned about and skipped (so one bad
//? locale never crashes the scan), matching the original inline behavior.
export const loadLocaleKeys = (root: string): Map<string, Set<string>> => {
  const localeKeys = new Map<string, Set<string>>(); // rel -> keys
  for (const abs of findLocaleFiles(root)) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const keys = new Set<string>();
    try {
      flattenKeys(JSON.parse(fs.readFileSync(abs, 'utf8')), '', keys);
    } catch {
      console.warn(`  ⚠ could not parse locale file ${rel} — skipped.`);
      continue;
    }
    localeKeys.set(rel, keys);
  }
  return localeKeys;
};

export const checkI18n = (project: ConsumerProject): void => {
  const files = collectSourceFiles(project.root);

  //? Used keys (literal `key:`/`errorCode:`) + unresolved dynamic `key:<var>` sites.
  const { locations: usedLocations, keys: usedKeys } = harvestUsedKeys(files);
  const frameworkKeys = harvestFrameworkKeys(project.root);
  const dynamicSites = collectDynamicSites(files);

  //? Locale files → dotted key sets per file.
  const localeKeys = loadLocaleKeys(project.root);
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
      const unusedKeys = [...keys].filter((k) => !usedKeys.has(k) && !frameworkKeys.has(k)).toSorted();
      if (unusedKeys.length === 0) return null;
      return {
        section: `## file: ${rel}\n${unusedKeys.map((k) => `- ${k}`).join('\n')}`,
        count: unusedKeys.length,
      };
    },
    header: (count) =>
      `# UNUSED TRANSLATIONS — ${String(count)} found across ${String(localeRels.length)} locale file(s)\n` +
      `# Present in a locale JSON but referenced nowhere in code.\n` +
      `# Used-key set = literal { key: '...' } + errorCode: '...' (dotted) repo-wide,\n` +
      `# plus ${String(frameworkKeys.size)} dotted literal(s) emitted by the installed @luckystack/* packages\n` +
      `# (node_modules/@luckystack/*/dist).\n` +
      `# Heuristic limit: keys reached via a variable/helper (e.g. t('foo.bar'),\n` +
      `# positional keys) are NOT recognized and may be listed here in error.\n` +
      `# WARNING: framework error codes (api.*, auth.*, sync.*, routing.*, …) never\n` +
      `# appear in your own source — a zero-match repo search does NOT prove them\n` +
      `# unused. Keys of a feature you have not added yet (e.g. docs.* before\n` +
      `# \`npx luckystack add docs-ui\`) are needed once you add it.\n` +
      dynamicNote +
      `# Feed this to an LLM: before deleting each key, full-text-search the repo\n` +
      `# AND node_modules/@luckystack for its dotted name; delete only keys with\n` +
      `# zero matches in both, and keep any key under a framework prefix unless\n` +
      `# the developer confirms it.\n\n`,
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
