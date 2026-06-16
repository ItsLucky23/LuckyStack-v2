/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT_DIR, getGeneratedSocketTypesPath, getSrcDir, validatePagePath } from '@luckystack/core';
import {
  ROUTE_NAMING_EXAMPLES,
  ROUTE_NAMING_RULES,
  isVersionedApiFileName,
  isVersionedSyncClientFileName,
  isVersionedSyncFileName,
  isVersionedSyncServerFileName,
} from './routeConventions';
import { getRoutingRules, isRouteTestFile } from './routingRules';
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
  return normalized.includes('/_api/') && filePath.endsWith('.ts') && !isRouteTestFile(filePath);
};

export const isInSyncFolder = (filePath: string): boolean => {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.includes('/_sync/') && filePath.endsWith('.ts') && !isRouteTestFile(filePath);
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
  return path.basename(filePath.replace(/\\/g, '/'));
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
  const normalized = filePath.replace(/\\/g, '/');
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
  const validationMessage = getRouteFilenameValidationMessage(filePath) || 'Invalid route filename.';
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

    return content.substring(startIndex, endIndex + 1);
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

    const extracted = content.substring(braceStart, endIndex + 1);
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

const getTemplate = (filePath: string): string | null => {
  //? Classify the file structurally; the registered selection RULES then decide
  //? the kind (consumer-editable via `.luckystack/templates/templateRules.ts`).
  let fileKind: TemplateMatchContext['fileKind'];
  let hasPairedServer = false;
  let srcRelativePath: string | null = null;

  if (isInApiFolder(filePath)) {
    fileKind = 'api';
  } else if (isInSyncFolder(filePath)) {
    if (isSyncServerFile(filePath)) {
      fileKind = 'sync_server';
    } else if (isSyncClientFile(filePath)) {
      fileKind = 'sync_client';
      hasPairedServer = hasPairedFile(filePath);
    } else {
      console.log(`[TemplateInjector] Unknown sync file type: ${filePath}`);
      return null;
    }
  } else if (isPageFile(filePath)) {
    fileKind = 'page';
    //? Validate placement BEFORE rule selection. A page inside a reserved
    //? framework folder (`_api`, `_sync`, ...) or with no URL segment left
    //? after stripping invisible-parent folders is silently un-routed — so we
    //? emit a commented diagnostic instead of a dead plain/dashboard skeleton.
    srcRelativePath = computeSrcRelativePath(filePath);
    if (srcRelativePath !== null) {
      const placement = validatePagePath(srcRelativePath);
      if (!placement.valid) {
        return getInvalidPagePlacementMessage(filePath, placement.reason ?? 'invalid placement', srcRelativePath);
      }
    }
  } else {
    return null;
  }

  const ctx: TemplateMatchContext = { filePath, fileKind, hasPairedServer, srcRelativePath };
  const templateKind = resolveTemplateKind(ctx);
  if (!templateKind) {
    console.log(`[TemplateInjector] No template rule matched for ${filePath} (fileKind=${fileKind})`);
    return null;
  }

  let content = resolveTemplateContent(templateKind);
  if (content === null) return null;

  //? Replace path placeholders. Matches BOTH `//@ts-ignore` and
  //? `// @ts-expect-error` pragma lines (templates use either); the pragma + the
  //? import line's `{{REL_PATH}}` are replaced together so the result is valid
  //? TS without the pragma. A literal fallback covers consumer templates that
  //? omit the pragma.
  const relPath = calculateRelativePath(filePath);
  const pragmaPattern = /\/\/\s*@ts-(?:ignore|expect-error).*\r?\n(.*)\{\{REL_PATH\}\}/g;
  content = content.replaceAll(pragmaPattern, (_, prefix) => `${prefix}${relPath}`);
  content = content.replaceAll('{{REL_PATH}}', relPath);

  //? Sync templates may carry PAGE_PATH / SYNC_NAME placeholders (paired client
  //? + server). Substitute for any sync file — a no-op when the placeholders
  //? are absent (e.g. standalone client).
  if (fileKind === 'sync_client' || fileKind === 'sync_server') {
    const pagePath = extractSyncPagePath(filePath);
    const syncName = extractSyncName(filePath);
    content = content.replaceAll('{{PAGE_PATH}}', pagePath);
    content = content.replaceAll('{{SYNC_NAME}}', syncName);
  }

  return content;
};

export const injectTemplate = async (filePath: string): Promise<boolean> => {
  await ensureConsumerTemplateConfigLoaded();

  if (getRouteFilenameValidationMessage(filePath)) {
    fs.writeFileSync(filePath, getInvalidVersionMessage(filePath), 'utf-8');
    console.log(`[TemplateInjector] Invalid route filename, injected guidance: ${filePath}`);
    return true;
  }

  const template = getTemplate(filePath);

  if (!template) {
    return false;
  }

  try {
    fs.writeFileSync(filePath, template, 'utf-8');
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
  if (disableTemplateInjection && disableTemplateInjection(filePath)) {
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

/**
 * Update a client file to use the paired template (imports types from generated file)
 * Called when a _server.ts is created and _client.ts already exists
 * PRESERVES user's main function code!
 */
export const updateClientFileForPairedServer = async (clientFilePath: string): Promise<boolean> => {
  try {
    const pagePath = extractSyncPagePath(clientFilePath);
    const syncName = extractSyncName(clientFilePath);

    // Read the existing client file (preserve user's code)
    let content = fs.readFileSync(clientFilePath, 'utf8');

    // Update imports: add SyncClientInput, SyncServerOutput if not present
    if (!content.includes('SyncClientInput')) {
      content = content.replace(
        /import \{([^}]+)\} from ['"]([^'"]*apiTypes\.generated)['"]/,
        (_match, imports: string, importPath: string) => {
          return `import {${imports}, SyncClientInput, SyncServerOutput } from '${importPath}'`;
        }
      );
    }

    //? Safety net for the import-merge above: the single-line `import { ... }`
    //? regex misses multi-line, `type`-only, or namespace imports of the
    //? generated file. When it misses, `clientInput`/`serverOutput` are still
    //? rewritten below to reference `SyncClientInput`/`SyncServerOutput`,
    //? injecting an unresolved-symbol COMPILE ERROR into the user's source. If
    //? the symbols are STILL absent, prepend a fresh import so the rewritten
    //? references always resolve (same target as the sync_client template's
    //? `{{REL_PATH}}src/_sockets/apiTypes.generated` import).
    if (!content.includes('SyncClientInput')) {
      const relPath = calculateRelativePath(clientFilePath);
      content = `import { SyncClientInput, SyncServerOutput } from '${relPath}src/_sockets/apiTypes.generated';\n` + content;
    }

    // Add type aliases after imports if not present
    if (!content.includes('type PagePath')) {
      const importEndMatch = content.match(/import .+?;[\r\n]+/g);
      if (importEndMatch) {
        const lastImport = importEndMatch.at(-1);
        if (!lastImport) {
          return false;
        }

        const lastImportEnd = content.lastIndexOf(lastImport) + lastImport.length;
        const typeAliases = `\n// Types are imported from the generated file based on the _server.ts definition\ntype PagePath = '${pagePath}';\ntype SyncName = '${syncName}';\n`;
        content = content.slice(0, lastImportEnd) + typeAliases + content.slice(lastImportEnd);
      }
    }

    // Replace clientInput type with imported type (preserve indentation)
    content = content.replace(
      /^(\s*)clientInput:\s*\{[^}]*\}/m,
      '$1clientInput: SyncClientInput<PagePath, SyncName>'
    );

    // Add serverOutput if not present (after clientInput in SyncParams, with matching indentation)
    if (!content.includes('serverOutput:')) {
      content = content.replace(
        /^(\s*)(clientInput:\s*SyncClientInput<PagePath, SyncName>);?\s*$/m,
        '$1$2;\n$1serverOutput: SyncServerOutput<PagePath, SyncName>;'
      );
    }

    // Add serverOutput to main function destructuring if not present
    if (content.includes('main') && !/\{\s*[^}]*serverOutput[^}]*\}\s*:\s*SyncParams/.test(content)) {
      content = content.replace(
        /\{\s*([^}]*?clientInput)([^}]*)\}\s*:\s*SyncParams/,
        '{ $1, serverOutput$2 }: SyncParams'
      );
    }

    fs.writeFileSync(clientFilePath, content, 'utf-8');
    console.log(`[TemplateInjector] Updated client file to use paired types (preserved code): ${clientFilePath}`);
    return true;
  } catch (error) {
    console.error(`[TemplateInjector] Failed to update client file: ${clientFilePath}`, error);
    return false;
  }
};

/**
 * Update a client file when the paired server file is deleted
 * Preserves user's main function code while:
 * - Inlining clientInput types
 * - Removing serverOutput from SyncParams and main function params
 */
export const updateClientFileForDeletedServer = async (
  clientFilePath: string,
  clientInputTypes: string
): Promise<boolean> => {
  try {
    // Read the existing client file (preserve user's code)
    let content = fs.readFileSync(clientFilePath, 'utf8');

    // STEP 1: Replace clientInput type declaration FIRST (before removing imports)
    // Pattern matches: clientInput: SyncClientInput<...> or clientInput: { ... }
    // Preserve leading indentation. Use a REPLACER FUNCTION (not a replacement
    // string) so `$`-sequences in `clientInputTypes` — Prisma `$Enums.Role`,
    // template-literal `${...}` types — are spliced VERBATIM instead of being
    // re-interpreted by `String.replace` as `$1`/`$&` backreferences.
    content = content.replace(
      /^(\s*)clientInput:\s*SyncClientInput<[^>]+>/m,
      (_match, indent: string) => `${indent}clientInput: ${clientInputTypes}`
    );
    content = content.replace(
      /^(\s*)clientInput:\s*\{[^}]*\}/m,
      (_match, indent: string) => `${indent}clientInput: ${clientInputTypes}`
    );

    // STEP 2: Remove serverOutput line from SyncParams interface FIRST
    // Pattern: serverOutput: SyncServerOutput<...>; or serverOutput: { ... };
    // Remove entire line including its indentation
    content = content.replace(
      /^[ \t]*serverOutput:\s*SyncServerOutput<[^>]+>;?\s*\r?\n?/m,
      ''
    );
    content = content.replace(
      /^[ \t]*serverOutput:\s*\{[^}]*\};?\s*\r?\n?/m,
      ''
    );

    // STEP 3: Remove serverOutput from main function destructuring
    content = content.replaceAll(/,\s*serverOutput(?=\s*[,}])/g, '');
    content = content.replaceAll(/serverOutput\s*,\s*/g, '');

    // STEP 4: NOW clean up imports (after type declarations are replaced)
    content = content.replaceAll(/,\s*SyncClientInput(?=\s*[,}])/g, '');
    content = content.replaceAll(/,\s*SyncServerOutput(?=\s*[,}])/g, '');

    // STEP 5: Remove type aliases if present
    content = content.replaceAll(/\/\/\s*Types are imported.*\n?/g, '');
    content = content.replaceAll(/type PagePath = '[^']*';\s*\n?/g, '');
    content = content.replaceAll(/type SyncName = '[^']*';\s*\n?/g, '');

    // Clean up any double newlines
    content = content.replaceAll(/\n{3,}/g, '\n\n');

    fs.writeFileSync(clientFilePath, content, 'utf-8');
    console.log(`[TemplateInjector] Updated client file for deleted server (preserved code): ${clientFilePath}`);
    return true;
  } catch (error) {
    console.error(`[TemplateInjector] Failed to update client file: ${clientFilePath}`, error);
    return false;
  }
};

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

    // Replace the empty clientInput with the provided types
    content = content.replace(
      /clientInput:\s*\{[^}]*\}/s,
      `clientInput: ${clientInputTypes}`
    );

    fs.writeFileSync(serverFilePath, content, 'utf-8');
    console.log(`[TemplateInjector] Injected server template with clientInput: ${serverFilePath}`);
    return true;
  } catch (error) {
    console.error(`[TemplateInjector] Failed to inject server template: ${serverFilePath}`, error);
    return false;
  }
};

