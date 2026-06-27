import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ts from 'typescript';
import { ROOT_DIR, getGeneratedSocketTypesPath, getSrcDir } from '@luckystack/core';
import {
  ROUTE_NAMING_EXAMPLES,
  ROUTE_NAMING_RULES,
  isVersionedApiFileName,
  isVersionedSyncClientFileName,
  isVersionedSyncFileName,
  isVersionedSyncServerFileName,
} from './routeConventions';
import { apiMarkerSegment, getRoutingRules, isRouteTestFile, syncMarkerSegment, validatePagePath } from './routingRules';
import {
  BUILT_IN_TEMPLATE_FILENAMES,
  getRegisteredTemplate,
  resolveTemplateKind,
  type BuiltInTemplateKind,
  type TemplateKind,
  type TemplateMatchContext,
} from './templateRegistry';

/**
 * Template Injector
 *
 * Injects default templates into new empty files in _api and _sync folders.
 * Handles sync file pairing with context-aware template selection.
 */


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templatesDir = path.join(__dirname, 'templates');

//? Consumer-side template overrides + selection rules live here (created by the
//? scaffold). Resolved relative to the project root so it is stable regardless
//? of the srcDir layout.
const getConsumerTemplatesDir = (): string => path.join(ROOT_DIR, '.luckystack', 'templates');

//? Candidate content filenames for a kind: built-ins have a fixed name; custom
//? kinds resolve to `<kind>.template.tsx` then `<kind>.template.ts`.
const templateContentFilenames = (kind: TemplateKind): string[] => {
  const builtIn = BUILT_IN_TEMPLATE_FILENAMES[kind as BuiltInTemplateKind];
  if (builtIn) return [builtIn];
  return [`${kind}.template.tsx`, `${kind}.template.ts`];
};

//? Resolve raw template content for a kind. Order: consumer file (editable,
//? shipped to `.luckystack/templates/`) -> registered string override ->
//? bundled dist template (built-in kinds only). Returns null when nothing
//? resolves (e.g. a custom kind with no content provided).
const resolveTemplateContent = (kind: TemplateKind): string | null => {
  const consumerDir = getConsumerTemplatesDir();
  for (const fileName of templateContentFilenames(kind)) {
    const consumerFile = path.join(consumerDir, fileName);
    if (fs.existsSync(consumerFile)) {
      try {
        return fs.readFileSync(consumerFile, 'utf8');
      } catch (error) {
        console.error(`[TemplateInjector] Could not read consumer template: ${consumerFile}`, error);
      }
    }
  }

  const override = getRegisteredTemplate(kind);
  if (override !== null) return override;

  const builtInName = BUILT_IN_TEMPLATE_FILENAMES[kind as BuiltInTemplateKind];
  if (builtInName) {
    const bundled = path.join(templatesDir, builtInName);
    try {
      return fs.readFileSync(bundled, 'utf8');
    } catch (error) {
      console.error(`[TemplateInjector] Could not read bundled template: ${bundled}`, error);
      return null;
    }
  }

  console.warn(`[TemplateInjector] No content for custom template kind "${kind}" — add .luckystack/templates/${kind}.template.tsx or call registerTemplate('${kind}', ...).`);
  return null;
};

//? Dev-only: load the consumer's `.luckystack/templates/templateRules.ts` once,
//? so their register* calls configure the injector before the first injection.
//? Absent file => built-in defaults apply. Never imported in prod (devkit is a
//? devDependency, and this only runs from the dev watcher path).
let consumerTemplateConfig: Promise<void> | null = null;
const ensureConsumerTemplateConfigLoaded = (): Promise<void> => {
  consumerTemplateConfig ??= (async () => {
    const dir = getConsumerTemplatesDir();
    for (const fileName of ['templateRules.ts', 'templateRules.mjs', 'templateRules.js']) {
      const rulesFile = path.join(dir, fileName);
      if (!fs.existsSync(rulesFile)) continue;

      //? Safety net: verify the resolved path stays within ROOT_DIR before
      //? dynamic-importing it. In practice `dir` is always
      //? `path.join(ROOT_DIR, '.luckystack', 'templates')` (see
      //? `getConsumerTemplatesDir`), so this check can only fail if ROOT_DIR
      //? itself is misconfigured or a symlink escapes the tree.
      const resolvedRulesFile = path.resolve(rulesFile);
      const resolvedRoot = path.resolve(ROOT_DIR);
      if (
        !resolvedRulesFile.startsWith(resolvedRoot + path.sep)
        && resolvedRulesFile !== resolvedRoot
      ) {
        console.warn(
          `[TemplateInjector] Template rules file resolves outside project root — skipping: ${rulesFile}`,
        );
        continue;
      }

      try {
        await import(pathToFileURL(rulesFile).href);
      } catch (error) {
        console.error(`[TemplateInjector] Failed to load consumer template rules: ${rulesFile}`, error);
      }
      return;
    }
  })();
  return consumerTemplateConfig;
};

export const isEmptyFile = (filePath: string): boolean => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.trim().length === 0;
  } catch {
    return false;
  }
};

const isCommentOnlyFile = (filePath: string): boolean => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const withoutBlockComments = content.replaceAll(/\/\*[\s\S]*?\*\//g, '');
    const withoutLineComments = withoutBlockComments.replaceAll(/(^|\s)\/\/.*$/gm, '$1');
    return withoutLineComments.trim().length === 0;
  } catch {
    return false;
  }
};

export const isInApiFolder = (filePath: string): boolean => {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.includes(apiMarkerSegment()) && filePath.endsWith('.ts') && !isRouteTestFile(filePath);
};

export const isInSyncFolder = (filePath: string): boolean => {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.includes(syncMarkerSegment()) && filePath.endsWith('.ts') && !isRouteTestFile(filePath);
};

export const isPageFile = (filePath: string): boolean => {
  const normalized = filePath.replaceAll('\\', '/');
  const filename = normalized.split('/').pop() ?? '';
  return filename === 'page.tsx' || filename === 'page.jsx';
};

export const isSyncServerFile = (filePath: string): boolean => {
  return isVersionedSyncServerFileName(filePath);
};

export const isSyncClientFile = (filePath: string): boolean => {
  return isVersionedSyncClientFileName(filePath);
};

const isVersionedApiFile = (filePath: string): boolean => {
  return isVersionedApiFileName(filePath);
};

const isVersionedSyncFile = (filePath: string): boolean => {
  return isVersionedSyncFileName(filePath);
};

const getFileName = (filePath: string): string => {
  return path.basename(filePath.replaceAll('\\', '/'));
};

const stripTsExtension = (fileName: string): string => {
  return fileName.replace(/\.ts$/, '');
};

const toApiBaseName = (fileName: string): string => {
  const withoutExtension = stripTsExtension(fileName);
  const withoutVersion = withoutExtension.replace(/_v\d+$/, '');
  return withoutVersion || 'myApi';
};

const toSyncBaseName = (fileName: string): string => {
  const withoutExtension = stripTsExtension(fileName);
  const withoutVersionedKind = withoutExtension.replace(/_(?:server|client)_v\d+$/, '');
  const withoutKindOnly = withoutVersionedKind.replace(/_(?:server|client)$/, '');
  const withoutVersionOnly = withoutKindOnly.replace(/_v\d+$/, '');
  return withoutVersionOnly || 'mySync';
};

const getApiFilenameReason = (fileName: string): string => {
  const withoutExtension = stripTsExtension(fileName);

  if (/_v\d+$/.test(withoutExtension)) {
    return 'The filename already looks versioned.';
  }

  if (/_v\d+/.test(withoutExtension)) {
    return 'The version token must be at the end of the filename.';
  }

  if (/_server|_client/.test(withoutExtension)) {
    return 'API files do not use _server/_client suffixes.';
  }

  return 'Missing required version suffix.';
};

const getSyncFilenameReason = (fileName: string): string => {
  const withoutExtension = stripTsExtension(fileName);

  if (/_(?:server|client)_v\d+$/.test(withoutExtension)) {
    return 'The filename already looks versioned.';
  }

  if (/_(?:server|client)$/.test(withoutExtension)) {
    return 'Sync files with _server/_client must include a version suffix like _v1.';
  }

  if (/_v\d+$/.test(withoutExtension)) {
    return 'Sync files with versions must also include _server or _client.';
  }

  return 'Missing required sync kind and version suffix.';
};

export const getRouteFilenameValidationMessage = (filePath: string): string | null => {
  const normalized = filePath.replaceAll('\\', '/');
  const fileName = getFileName(normalized);

  if (isInApiFolder(normalized) && !isVersionedApiFile(normalized)) {
    const base = toApiBaseName(fileName);
    return [
      `Invalid API filename: ${fileName}`,
      `Reason: ${getApiFilenameReason(fileName)}`,
      `Expected: ${ROUTE_NAMING_RULES.api}`,
      `Example: ${base}_v1.ts (for example ${ROUTE_NAMING_EXAMPLES.api})`,
      'This file is ignored by route loading and type generation until it is renamed.'
    ].join(' ');
  }

  if (isInSyncFolder(normalized) && !isVersionedSyncFile(normalized)) {
    const base = toSyncBaseName(fileName);
    return [
      `Invalid sync filename: ${fileName}`,
      `Reason: ${getSyncFilenameReason(fileName)}`,
      `Expected: ${ROUTE_NAMING_RULES.syncServer} or ${ROUTE_NAMING_RULES.syncClient}`,
      `Examples: ${base}_server_v1.ts, ${base}_client_v1.ts (for example ${ROUTE_NAMING_EXAMPLES.syncServer})`,
      'This file is ignored by route loading and type generation until it is renamed.'
    ].join(' ');
  }

  return null;
};

const getInvalidVersionMessage = (filePath: string): string => {
  const validationMessage = getRouteFilenameValidationMessage(filePath) ?? 'Invalid route filename.';
  return `// ${validationMessage}\n`;
};

//? Compute the validator-friendly path (relative to `src/`, forward slashes)
//? for a page file. Returns `null` if the file is outside `getSrcDir()`.
const computeSrcRelativePath = (filePath: string): string | null => {
  try {
    const srcDir = getSrcDir();
    const absolute = path.resolve(filePath);
    const normalizedSrc = srcDir.replaceAll('\\', '/');
    const normalizedAbs = absolute.replaceAll('\\', '/');
    if (!normalizedAbs.startsWith(`${normalizedSrc}/`)) return null;
    return normalizedAbs.slice(normalizedSrc.length + 1);
  } catch {
    return null;
  }
};

//? Mirror of `getInvalidVersionMessage` for page.tsx files placed in
//? locations the framework router will silently skip. Instead of writing
//? the plain/dashboard template (which would render fine but never get
//? routed), we write a commented diagnostic block so the developer
//? immediately sees WHY their page isn't appearing.
const getInvalidPagePlacementMessage = (_filePath: string, reason: string, srcRelative: string): string => {
  const lines = [
    '//? --- LUCKYSTACK PLACEMENT WARNING ---',
    '//? This page.tsx is in a location the file-based router will not route.',
    `//? Reason: ${reason}`,
    `//? Path:   ${srcRelative}`,
    '//?',
    '//? Common fixes:',
    "//?   - Move the file up so a visible (non-underscore) folder segment remains:",
    "//?     e.g. src/_marketing/page.tsx  ->  src/_marketing/landing/page.tsx",
    "//?         (the new file routes at /landing — `_marketing` stays invisible).",
    "//?   - Or move the file OUT of a reserved framework folder (_api, _sync,",
    "//?     _components, _functions, _shared, _providers, _locales, _sockets, _server).",
    '//?',
    '//? Delete the file or move it to fix; the dev server will re-inject a',
    '//? real page template once the placement is valid.',
    '',
    //? Named export instead of `export {};` so the file satisfies
    //? `unicorn/require-module-specifiers` (and stays a valid ES module
    //? without dragging in side-effect-only semantics). Reads back as a
    //? cheap runtime tag for tooling that wants to detect the warning.
    "export const __luckystackPlacementWarning = true;",
    '',
  ];
  return lines.join('\n');
};

/**
 * Get the paired sync file path (server -> client or client -> server)
 */
export const getPairedSyncFile = (filePath: string): string | null => {
  const normalized = filePath.replaceAll('\\', '/');
  if (isSyncServerFile(normalized)) {
    return normalized.replace(/_server_v(\d+)\.ts$/, '_client_v$1.ts');
  }
  if (isSyncClientFile(normalized)) {
    return normalized.replace(/_client_v(\d+)\.ts$/, '_server_v$1.ts');
  }
  return null;
};

/**
 * Check if a paired sync file exists
 */
export const hasPairedFile = (filePath: string): boolean => {
  const pairedPath = getPairedSyncFile(filePath);
  if (!pairedPath) return false;
  return fs.existsSync(pairedPath);
};

/**
 * Extract page path from a sync file path (e.g., "examples" from "src/examples/_sync/test_server_v1.ts")
 */
export const extractSyncPagePath = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const match = /src\/(.+?)\/_sync\//.exec(normalized);
  if (match?.[1]) return match[1];
  //? A sync directly under `src/_sync/` resolves to the `'system'` sentinel —
  //? the SAME page key the type-map generator (`routeMeta.extractSyncPagePath`)
  //? and the dev loader use for root syncs. Returning `''` here injected
  //? `type PagePath = '';` into the paired client/server template, which then
  //? failed to index `SyncTypeMap['system']` — a broken generated reference.
  if (/(?:^|\/)src\/_sync\//.test(normalized)) return 'system';
  return '';
};

/**
 * Extract sync name from a sync file path (e.g., "test" from "src/examples/_sync/test_server_v1.ts")
 */
export const extractSyncName = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const match = /_sync\/(.+)\.ts$/.exec(normalized);
  if (!match) {
    const basename = path.basename(filePath, '.ts');
    return basename.replace(/_server_v\d+$/, '').replace(/_client_v\d+$/, '');
  }

  return (match[1] ?? '').replace(/_server_v\d+$/, '').replace(/_client_v\d+$/, '');
};

/**
 * Extract clientInput type body from a sync file's SyncParams interface
 * Returns the content between the braces of clientInput: { ... }
 */
export const extractClientInputFromFile = (filePath: string): string | null => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');

    // Find interface SyncParams
    const syncParamsMatch = /interface\s+SyncParams\s*\{/.exec(content);
    if (!syncParamsMatch) return null;

    //? Scope the `clientInput` search to the region AFTER the `SyncParams`
    //? declaration. An unscoped global search could match a `clientInput:` in
    //? an earlier comment, a different interface, or a destructure above the
    //? `SyncParams` body and extract the wrong block.
    const searchRegion = content.slice(syncParamsMatch.index + syncParamsMatch[0].length);
    const clientInputMatch = /clientInput\s*:\s*\{/.exec(searchRegion);
    if (!clientInputMatch) return null;

    // Extract balanced braces
    const startIndex = content.indexOf(
      '{',
      syncParamsMatch.index + syncParamsMatch[0].length + clientInputMatch.index,
    );
    if (startIndex === -1) return null;
    let depth = 0;
    let endIndex = -1;

    for (let i = startIndex; i < content.length; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;

      if (depth === 0) {
        endIndex = i;
        break;
      }
    }

    //? Braces never balanced (truncated / malformed file) — return null rather
    //? than a single `{` of garbage that a truthiness-checking caller would
    //? splice into user source.
    if (endIndex === -1) return null;

    return content.slice(startIndex, endIndex + 1);
  } catch (error) {
    console.error(`[TemplateInjector] Error extracting clientInput from ${filePath}:`, error);
    return null;
  }
};

/**
 * Extract clientInput type from the generated apiTypes.generated.ts file
 * Used when the server file is already deleted but we need to migrate types to client
 */
export const extractClientInputFromGeneratedTypes = (pagePath: string, syncName: string): string | null => {
  try {
    const generatedTypesPath = getGeneratedSocketTypesPath();
    const content = fs.readFileSync(generatedTypesPath, 'utf8');

    const escapeRegex = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const escapedPagePath = escapeRegex(pagePath);
    const escapedSyncName = escapeRegex(syncName);

    const pageBlockRegex = new RegExp(String.raw`'${escapedPagePath}'\s*:\s*\{([\s\S]*?)\n\s{2}\};`, 'm');
    const pageBlockMatch = content.match(pageBlockRegex);
    if (!pageBlockMatch?.[1]) {
      console.log(`[TemplateInjector] Could not find page block for ${pagePath}`);
      return null;
    }

    const pageBlock = pageBlockMatch[1];

    const syncEntryPattern = new RegExp(String.raw`'${escapedSyncName}':\s*\{\s*clientInput:\s*`);
    const match = pageBlock.match(syncEntryPattern);

    if (!match || typeof match.index !== 'number') {
      console.log(`[TemplateInjector] Could not find sync entry for ${pagePath}/${syncName}`);
      return null;
    }

    const pageStart = content.indexOf(pageBlock);
    const globalMatchIndex = pageStart + match.index;

    // Find the start of clientInput value (the opening brace)
    const searchStart = globalMatchIndex + match[0].length;
    const braceStart = content.indexOf('{', searchStart - 1);

    if (braceStart === -1) return null;

    // Extract balanced braces
    let depth = 0;
    let endIndex = -1;

    for (let i = braceStart; i < content.length; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;

      if (depth === 0) {
        endIndex = i;
        break;
      }
    }

    //? Braces never balanced — return null instead of a lone `{` of garbage.
    if (endIndex === -1) return null;

    const extracted = content.slice(braceStart, endIndex + 1);
    console.log(`[TemplateInjector] Extracted clientInput types: ${extracted}`);
    return extracted;
  } catch (error) {
    console.error(`[TemplateInjector] Error extracting clientInput from generated types:`, error);
    return null;
  }
};

/**
 * Calculate the relative path prefix (e.g., '../../../') to reach project root from a file
 * @param filePath - Absolute or relative path to the file
 * @returns The relative path prefix to reach project root
 */
export const calculateRelativePath = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');

  //? Anchor on the CONFIGURED srcDir, not the literal substring `src/`. A
  //? non-`src` layout (`srcDir: 'app'`) or a root path that itself contains
  //? `src/` (`C:/work/srcrepo/...`) computed the wrong depth with the old
  //? `indexOf('src/')`, breaking the injected `{{REL_PATH}}` import. Reuse the
  //? same srcDir-driven anchoring the rest of the package uses (mirrors
  //? `computeSrcRelativePath`). For the standard `src` layout this is
  //? byte-identical to the old heuristic.
  const srcRelative = computeSrcRelativePath(filePath);
  if (srcRelative !== null) {
    try {
      const srcDepthFromRoot = path
        .relative(ROOT_DIR, getSrcDir())
        .replaceAll('\\', '/')
        .split('/')
        .filter((segment) => segment.length > 0).length;
      //? `srcRelative` is `<dirs.../file.ts>` relative to srcDir. The number of
      //? `../` to climb from the FILE's directory up to srcDir is the count of
      //? its DIRECTORY segments (drop the trailing filename). Adding srcDir's
      //? own depth below the project root gives the climb to root — the template
      //? then re-descends via the literal `src/` it appends after `{{REL_PATH}}`.
      const dirSegmentsAfterSrc = Math.max(
        0,
        srcRelative.split('/').filter((segment) => segment.length > 0).length - 1,
      );
      return '../'.repeat(srcDepthFromRoot + dirSegmentsAfterSrc);
    } catch {
      //? Fall through to the literal-`src/` heuristic below.
    }
  }

  // Fallback (relative path the watcher handed us, or srcDir unresolvable):
  // Find the 'src/' part of the path
  const srcIndex = normalized.indexOf('src/');
  if (srcIndex === -1) {
    // Fallback: count from beginning if src not found
    console.warn(`[TemplateInjector] Could not find /src/ in path: ${filePath}`);
    return '../../../'; // default fallback
  }

  // Get path after 'src/' (e.g., 'examples/examples2/_api/file.ts')
  const relativePath = normalized.slice(Math.max(0, srcIndex + 4)); // +4 to skip 'src/'

  // Count segments (directories + filename)
  const segments = relativePath.split('/').filter(s => s.length > 0).length;

  // We need to go up `segments` levels to reach project root
  // e.g., 'examples/_api/file.ts' = 3 segments -> '../../../'
  return '../'.repeat(segments);
};

// ---------------------------------------------------------------------------
// File classification helpers
// ---------------------------------------------------------------------------

type FileClassification =
  | { fileKind: 'api'; hasPairedServer: false; srcRelativePath: null }
  | { fileKind: 'sync_server'; hasPairedServer: false; srcRelativePath: null }
  | { fileKind: 'sync_client'; hasPairedServer: boolean; srcRelativePath: null }
  | { fileKind: 'page'; hasPairedServer: false; srcRelativePath: string | null }
  | null;

/**
 * Determines the structural file kind and paired-server presence for template selection.
 * Returns null for files that should not receive a template.
 */
const classifyFile = (filePath: string): FileClassification => {
  if (isInApiFolder(filePath)) {
    return { fileKind: 'api', hasPairedServer: false, srcRelativePath: null };
  }

  if (isInSyncFolder(filePath)) {
    if (isSyncServerFile(filePath)) {
      return { fileKind: 'sync_server', hasPairedServer: false, srcRelativePath: null };
    }
    if (isSyncClientFile(filePath)) {
      return { fileKind: 'sync_client', hasPairedServer: hasPairedFile(filePath), srcRelativePath: null };
    }
    console.log(`[TemplateInjector] Unknown sync file type: ${filePath}`);
    return null;
  }

  if (isPageFile(filePath)) {
    return { fileKind: 'page', hasPairedServer: false, srcRelativePath: computeSrcRelativePath(filePath) };
  }

  return null;
};

/**
 * Validates page placement for a classified page file.
 * Returns the placement-warning content when the page is un-routable, null when valid.
 */
const checkPagePlacement = (filePath: string, srcRelativePath: string | null): string | null => {
  if (srcRelativePath === null) return null;
  const placement = validatePagePath(srcRelativePath);
  if (!placement.valid) {
    return getInvalidPagePlacementMessage(filePath, placement.reason ?? 'invalid placement', srcRelativePath);
  }
  return null;
};

/**
 * Substitutes `{{REL_PATH}}`, `{{PAGE_PATH}}`, and `{{SYNC_NAME}}` placeholders
 * in a raw template string. Also strips `@ts-ignore`/`@ts-expect-error` pragma
 * lines that guard `{{REL_PATH}}` imports in built-in templates.
 */
const applyTemplatePlaceholders = (
  content: string,
  filePath: string,
  fileKind: TemplateMatchContext['fileKind'],
): string => {
  const relPath = calculateRelativePath(filePath);
  const pragmaPattern = /\/\/\s*@ts-(?:ignore|expect-error).*\r?\n(.*)\{\{REL_PATH\}\}/g;
  let result = content.replaceAll(pragmaPattern, (_, prefix) => `${prefix}${relPath}`);
  result = result.replaceAll('{{REL_PATH}}', relPath);

  //? Sync templates may carry PAGE_PATH / SYNC_NAME placeholders (paired client
  //? + server). Substitute for any sync file — a no-op when the placeholders
  //? are absent (e.g. standalone client).
  if (fileKind === 'sync_client' || fileKind === 'sync_server') {
    const pagePath = extractSyncPagePath(filePath);
    const syncName = extractSyncName(filePath);
    result = result.replaceAll('{{PAGE_PATH}}', pagePath);
    result = result.replaceAll('{{SYNC_NAME}}', syncName);
  }

  return result;
};

const getTemplate = (filePath: string): string | null => {
  //? Classify the file structurally; the registered selection RULES then decide
  //? the kind (consumer-editable via `.luckystack/templates/templateRules.ts`).
  const classification = classifyFile(filePath);
  if (!classification) return null;

  const { fileKind, hasPairedServer, srcRelativePath } = classification;

  //? Validate page placement BEFORE rule selection. A page inside a reserved
  //? framework folder (`_api`, `_sync`, ...) or with no URL segment left
  //? after stripping invisible-parent folders is silently un-routed — so we
  //? emit a commented diagnostic instead of a dead plain/dashboard skeleton.
  if (fileKind === 'page') {
    const placementWarning = checkPagePlacement(filePath, srcRelativePath);
    if (placementWarning !== null) return placementWarning;
  }

  const ctx: TemplateMatchContext = { filePath, fileKind, hasPairedServer, srcRelativePath };
  const templateKind = resolveTemplateKind(ctx);
  if (!templateKind) {
    console.log(`[TemplateInjector] No template rule matched for ${filePath} (fileKind=${fileKind})`);
    return null;
  }

  const rawContent = resolveTemplateContent(templateKind);
  if (rawContent === null) return null;

  return applyTemplatePlaceholders(rawContent, filePath, fileKind);
};

export const injectTemplate = async (filePath: string): Promise<boolean> => {
  await ensureConsumerTemplateConfigLoaded();

  if (getRouteFilenameValidationMessage(filePath)) {
    fs.writeFileSync(filePath, getInvalidVersionMessage(filePath), 'utf8');
    console.log(`[TemplateInjector] Invalid route filename, injected guidance: ${filePath}`);
    return true;
  }

  const template = getTemplate(filePath);

  if (!template) {
    return false;
  }

  try {
    fs.writeFileSync(filePath, template, 'utf8');
    console.log(`[TemplateInjector] Injected template into: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`[TemplateInjector] Failed to inject template: ${filePath}`, error);
    return false;
  }
};

export const shouldInjectTemplate = (
  filePath: string,
  options: { isNewFile?: boolean } = {},
): boolean => {
  //? Consumer disable hook — if `registerRoutingRules({ disableTemplateInjection })`
  //? was called with a predicate that returns true for this path, skip the
  //? injection entirely. Useful for files the consumer manages by hand
  //? (e.g. a generated migrations tree).
  const { disableTemplateInjection } = getRoutingRules();
  if (disableTemplateInjection?.(filePath)) {
    return false;
  }

  if (!(isInApiFolder(filePath) || isInSyncFolder(filePath) || isPageFile(filePath))) {
    return false;
  }

  //? An EMPTY file is always safe to template (there is nothing to lose).
  if (isEmptyFile(filePath)) return true;

  //? A COMMENT-ONLY file is only templated when it is genuinely NEW (the `add`
  //? event). Commenting out an entire EXISTING `_api`/`_sync`/`page` file and
  //? saving it (a common debugging move) fires a `change` event with
  //? comment-only content — injecting the starter template there silently
  //? OVERWRITES the user's commented-out code with no undo (data loss). On
  //? `add` there is no prior route entry to clobber, so it stays safe.
  if (options.isNewFile) return isCommentOnlyFile(filePath);

  return false;
};

// ---------------------------------------------------------------------------
// Paired-client rewrite helpers
// ---------------------------------------------------------------------------

/**
 * Ensures `SyncClientInput` and `SyncServerOutput` are imported from the
 * generated types file. Prepends a new import line when the single-line
 * regex misses multi-line or namespace variants.
 */
const ensureImportedTypes = (content: string, clientFilePath: string): string => {
  if (content.includes('SyncClientInput')) return content;

  let result = content.replace(
    /import \{([^}]+)\} from ['"]([^'"]*apiTypes\.generated)['"]/,
    (_match, imports: string, importPath: string) => {
      return `import {${imports}, SyncClientInput, SyncServerOutput } from '${importPath}'`;
    }
  );

  //? Safety net: the single-line regex above misses multi-line, `type`-only,
  //? or namespace imports. When it misses, prepend a fresh import so the
  //? rewritten `clientInput`/`serverOutput` references always resolve.
  if (!result.includes('SyncClientInput')) {
    const relPath = calculateRelativePath(clientFilePath);
    result = `import { SyncClientInput, SyncServerOutput } from '${relPath}src/_sockets/apiTypes.generated';\n` + result;
  }

  return result;
};

/**
 * Inserts `PagePath` and `SyncName` type aliases after the last import
 * statement, when they are not already present.
 */
const insertTypeAliases = (content: string, pagePath: string, syncName: string): string => {
  if (content.includes('type PagePath')) return content;

  const importEndMatch = content.match(/import .+?;[\r\n]+/g);
  if (!importEndMatch) return content;

  const lastImport = importEndMatch.at(-1);
  if (!lastImport) return content;

  const lastImportEnd = content.lastIndexOf(lastImport) + lastImport.length;
  const typeAliases = `\n// Types are imported from the generated file based on the _server.ts definition\ntype PagePath = '${pagePath}';\ntype SyncName = '${syncName}';\n`;
  return content.slice(0, lastImportEnd) + typeAliases + content.slice(lastImportEnd);
};

/**
 * Regex fallback: replaces the inline `clientInput: { ... }` type block with
 * the generated type reference `SyncClientInput<PagePath, SyncName>`.
 * Only handles single-line object types; multi-line types require the AST path.
 */
const rewriteClientInputType = (content: string): string => {
  return content.replace(
    /^(\s*)clientInput:\s*\{[^}]*\}/m,
    '$1clientInput: SyncClientInput<PagePath, SyncName>'
  );
};

/**
 * Replaces the `clientInput` property type in the `SyncParams` interface using
 * the TypeScript AST. Locates the `clientInput` `PropertySignature` inside
 * `SyncParams` via the parser, extracts its type node's source span, and
 * performs a targeted character-position replacement — preserving the rest of
 * the source text verbatim (whitespace, comments, etc.).
 *
 * Returns the rewritten source on success, or `null` when:
 * - the file cannot be parsed
 * - `SyncParams` or `clientInput` is not found
 * - the existing type is not a `TypeLiteralNode` (already migrated → skip)
 * - the re-parsed result still contains a type literal (rewrite did not take)
 *
 * Callers must leave the file untouched and log the failure when `null` is
 * returned.
 */
const rewriteClientInputTypeAst = (content: string, sourceFileName: string): string | null => {
  // Parse to an AST (syntactic only — no type-checker needed).
  const parseSource = (src: string) =>
    ts.createSourceFile(
      sourceFileName,
      src,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );

  const sourceFile = parseSource(content);

  // Locate `SyncParams` interface.
  let syncParamsInterface: ts.InterfaceDeclaration | undefined;
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === 'SyncParams') {
      syncParamsInterface = stmt;
      break;
    }
  }

  if (!syncParamsInterface) return null;

  // Locate `clientInput` property signature.
  let clientInputMember: ts.PropertySignature | undefined;
  for (const member of syncParamsInterface.members) {
    if (
      ts.isPropertySignature(member)
      && ts.isIdentifier(member.name)
      && member.name.text === 'clientInput'
    ) {
      clientInputMember = member;
      break;
    }
  }

  if (!clientInputMember?.type) return null;

  //? Only replace object-literal type nodes ( `{ ... }` ) — already-migrated
  //? files that carry `SyncClientInput<PagePath, SyncName>` are left untouched.
  if (!ts.isTypeLiteralNode(clientInputMember.type)) return null;

  // Use the type node's AST span for a targeted position replacement so the
  // rest of the file's whitespace and comments are preserved verbatim.
  const typeNode = clientInputMember.type;
  const start = typeNode.getStart(sourceFile);
  const end = typeNode.getEnd();

  const rewritten = `${content.slice(0, start)}SyncClientInput<PagePath, SyncName>${content.slice(end)}`;

  // Re-parse the rewritten source to verify it is syntactically valid before
  // handing it back to the caller (who will write it to disk).
  // Use a throw-away single-file program so we can call the public
  // `getSyntacticDiagnostics` API (instead of the private `parseDiagnostics`).
  const reparsedFile = parseSource(rewritten);
  const verifyProgram = ts.createProgram({
    rootNames: [sourceFileName],
    options: { noResolve: true, skipLibCheck: true },
    // Supply the in-memory source so `ts.createProgram` never touches the disk.
    host: {
      ...ts.createCompilerHost({}),
      getSourceFile: (name) => (name === sourceFileName ? reparsedFile : undefined),
      fileExists: (name) => name === sourceFileName,
      readFile: (name) => (name === sourceFileName ? rewritten : undefined),
    },
  });
  const syntaxErrors = verifyProgram.getSyntacticDiagnostics(reparsedFile);
  if (syntaxErrors.length > 0) {
    console.log(
      `[TemplateInjector] AST rewrite produced invalid TypeScript for ${sourceFileName} — leaving untouched`,
      'yellow',
    );
    return null;
  }

  return rewritten;
};

/**
 * Adds `serverOutput: SyncServerOutput<PagePath, SyncName>` to the SyncParams
 * interface when not already present.
 */
const addServerOutputToParams = (content: string): string => {
  if (content.includes('serverOutput:')) return content;
  return content.replace(
    /^(\s*)(clientInput:\s*SyncClientInput<PagePath, SyncName>);?\s*$/m,
    '$1$2;\n$1serverOutput: SyncServerOutput<PagePath, SyncName>;'
  );
};

/**
 * Adds `serverOutput` to the main function destructuring when not already present.
 */
const addServerOutputToDestructuring = (content: string): string => {
  if (!content.includes('main') || /\{\s*[^}]*serverOutput[^}]*\}\s*:\s*SyncParams/.test(content)) {
    return content;
  }
  return content.replace(
    /\{\s*([^}]*?clientInput)([^}]*)\}\s*:\s*SyncParams/,
    '{ $1, serverOutput$2 }: SyncParams'
  );
};

/**
 * Update a client file to use the paired template (imports types from generated file)
 * Called when a _server.ts is created and _client.ts already exists
 * PRESERVES user's main function code!
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async signature keeps the public interface awaitable for future I/O expansion
export const updateClientFileForPairedServer = async (clientFilePath: string): Promise<boolean> => {
  try {
    const pagePath = extractSyncPagePath(clientFilePath);
    const syncName = extractSyncName(clientFilePath);

    let content = fs.readFileSync(clientFilePath, 'utf8');

    content = ensureImportedTypes(content, clientFilePath);
    content = insertTypeAliases(content, pagePath, syncName);

    // Prefer AST-based rewrite (type-aware, handles multi-line object types).
    // Fall back to the regex path only when the AST cannot locate the node
    // (e.g. non-standard structure) so the most common cases always benefit
    // from the precise position replacement.
    const astResult = rewriteClientInputTypeAst(content, path.basename(clientFilePath));
    if (astResult === null) {
      console.log(
        `[TemplateInjector] AST clientInput rewrite unavailable for ${clientFilePath} — using regex fallback`,
        'yellow',
      );
      content = rewriteClientInputType(content);
    } else {
      content = astResult;
    }

    content = addServerOutputToParams(content);
    content = addServerOutputToDestructuring(content);

    fs.writeFileSync(clientFilePath, content, 'utf8');
    console.log(`[TemplateInjector] Updated client file to use paired types (preserved code): ${clientFilePath}`);
    return true;
  } catch (error) {
    console.error(`[TemplateInjector] Failed to update client file: ${clientFilePath}`, error);
    return false;
  }
};

// ---------------------------------------------------------------------------
// Deleted-server cleanup helpers
// ---------------------------------------------------------------------------

/**
 * Replaces the `clientInput` type (either a generated reference or an inline block)
 * with the supplied inline type block.
 */
const inlineClientInputType = (content: string, clientInputTypes: string): string => {
  // Use replacer functions so `$`-sequences in `clientInputTypes` (Prisma `$Enums.Role`,
  // template-literal `${...}` types) are spliced verbatim, not re-interpreted as backrefs.
  return content
    .replace(
      /^(\s*)clientInput:\s*SyncClientInput<[^>]+>/m,
      (_match, indent: string) => `${indent}clientInput: ${clientInputTypes}`
    )
    .replace(
      /^(\s*)clientInput:\s*\{[^}]*\}/m,
      (_match, indent: string) => `${indent}clientInput: ${clientInputTypes}`
    );
};

/**
 * Removes `serverOutput` lines from the SyncParams interface body.
 */
const removeServerOutputFromParams = (content: string): string => {
  return content
    .replace(/^[ \t]*serverOutput:\s*SyncServerOutput<[^>]+>;?\s*\r?\n?/m, '')
    .replace(/^[ \t]*serverOutput:\s*\{[^}]*\};?\s*\r?\n?/m, '');
};

/**
 * Removes `serverOutput` from the main function destructuring.
 */
const removeServerOutputFromDestructuring = (content: string): string => {
  return content
    .replaceAll(/,\s*serverOutput(?=\s*[,}])/g, '')
    .replaceAll(/serverOutput\s*,\s*/g, '');
};

/**
 * Strips `SyncClientInput` and `SyncServerOutput` from import statements.
 */
const removeGeneratedTypeImports = (content: string): string => {
  return content
    .replaceAll(/,\s*SyncClientInput(?=\s*[,}])/g, '')
    .replaceAll(/,\s*SyncServerOutput(?=\s*[,}])/g, '');
};

/**
 * Removes the injected `PagePath` / `SyncName` type alias comment and declarations.
 */
const removeTypeAliases = (content: string): string => {
  let result = content.replaceAll(/\/\/\s*Types are imported.*\n?/g, '');
  result = result.replaceAll(/type PagePath = '[^']*';\s*\n?/g, '');
  return result.replaceAll(/type SyncName = '[^']*';\s*\n?/g, '');
};

/**
 * Splits a sync-client file into `[header, body]` at the start of `main`'s
 * function body (the `=> {` opener). `serverOutput` only legitimately appears
 * in the `SyncParams` interface and in `main`'s parameter destructuring — both
 * of which live in the header. Scoping the serverOutput-stripping regexes to
 * the header keeps user body code that coincidentally contains `serverOutput`
 * (e.g. `{ x: serverOutput, y }`) untouched. If the `: SyncParams` annotation
 * or the body opener can't be found, falls back to treating the whole file as
 * header (the previous whole-file behavior).
 */
const splitAtMainBody = (content: string): [header: string, body: string] => {
  const paramsAnchor = content.indexOf(': SyncParams');
  if (paramsAnchor === -1) return [content, ''];
  const bodyOpener = content.indexOf('=> {', paramsAnchor);
  if (bodyOpener === -1) return [content, ''];
  const splitIndex = bodyOpener + '=> {'.length;
  return [content.slice(0, splitIndex), content.slice(splitIndex)];
};

/**
 * Update a client file when the paired server file is deleted
 * Preserves user's main function code while:
 * - Inlining clientInput types
 * - Removing serverOutput from SyncParams and main function params
 */
/* eslint-disable @typescript-eslint/require-await -- async signature keeps the public interface awaitable for future I/O expansion */
export const updateClientFileForDeletedServer = async (
  clientFilePath: string,
  clientInputTypes: string
): Promise<boolean> => {
  try {
    let content = fs.readFileSync(clientFilePath, 'utf8');

    // Order matters: replace type references BEFORE removing imports/aliases.
    content = inlineClientInputType(content, clientInputTypes);
    // Scope serverOutput removal to the header (interface + main's params) so
    // it can never corrupt user body code that mentions `serverOutput`.
    const [header, body] = splitAtMainBody(content);
    const cleanedHeader = removeServerOutputFromDestructuring(removeServerOutputFromParams(header));
    content = `${cleanedHeader}${body}`;
    content = removeGeneratedTypeImports(content);
    content = removeTypeAliases(content);

    // Collapse runs of 3+ blank lines left by the removals.
    content = content.replaceAll(/\n{3,}/g, '\n\n');

    fs.writeFileSync(clientFilePath, content, 'utf8');
    console.log(`[TemplateInjector] Updated client file for deleted server (preserved code): ${clientFilePath}`);
    return true;
  } catch (error) {
    console.error(`[TemplateInjector] Failed to update client file: ${clientFilePath}`, error);
    return false;
  }
};
/* eslint-enable @typescript-eslint/require-await */

/**
 * Inject server template with pre-filled clientInput types (from existing client file)
 */
export const injectServerTemplateWithClientInput = async (
  serverFilePath: string,
  clientInputTypes: string
): Promise<boolean> => {
  try {
    await ensureConsumerTemplateConfigLoaded();
    const relPath = calculateRelativePath(serverFilePath);

    //? Honor consumer overrides for the sync_server kind here too (consumer
    //? file -> registered override -> bundled), then fill in the clientInput.
    let content = resolveTemplateContent('sync_server');
    if (content === null) {
      console.error(`[TemplateInjector] No sync_server template content available for: ${serverFilePath}`);
      return false;
    }

    //? Replace placeholders — same pragma union + literal-fallback pattern
    //? as `getTemplate` above. Keep these two regexes in sync.
    const pragmaPattern = /\/\/\s*@ts-(?:ignore|expect-error).*\r?\n(.*)\{\{REL_PATH\}\}/g;
    content = content.replaceAll(pragmaPattern, (_, prefix) => {
      return `${prefix}${relPath}`;
    });
    content = content.replaceAll('{{REL_PATH}}', relPath);

    // Replace the empty clientInput with the provided types.
    // Use a replacer function so `$`-sequences in `clientInputTypes`
    // (Prisma `$Enums.Role`, template-literal `${...}` types) are spliced
    // verbatim instead of being re-interpreted as backreferences.
    content = content.replace(
      /clientInput:\s*\{[^}]*\}/s,
      (_match) => `clientInput: ${clientInputTypes}`
    );

    fs.writeFileSync(serverFilePath, content, 'utf8');
    console.log(`[TemplateInjector] Injected server template with clientInput: ${serverFilePath}`);
    return true;
  } catch (error) {
    console.error(`[TemplateInjector] Failed to inject server template: ${serverFilePath}`, error);
    return false;
  }
};
