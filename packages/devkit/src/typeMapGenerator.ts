import { findAllApiFiles, findAllSyncClientFiles, findAllSyncServerFiles } from './typeMap/discovery';
import { extractApiName, extractApiVersion, extractPagePath, extractSyncName, extractSyncPagePath, extractSyncVersion } from './typeMap/routeMeta';
import { extractAuth, extractDocsMeta, extractHttpMethod, extractRateLimit } from './typeMap/apiMeta';
import { buildTypeMapArtifacts, writeTypeMapArtifacts, ApiTypeEntry, SyncTypeEntry } from './typeMap/emitterArtifacts';
import {
  getApiStreamPayloadTypeDetailsFromFile,
  getInputTypeDetailsFromFile,
  getOutputTypeDetailsFromFile,
  getSyncClientDataTypeDetailsFromFile,
  getSyncClientOutputTypeDetailsFromFile,
  getSyncClientStreamPayloadTypeDetailsFromFile,
  getSyncServerOutputTypeDetailsFromFile,
  getSyncServerStreamPayloadTypeDetailsFromFile,
} from './typeMap/extractors';
import { generateServerFunctions } from './typeMap/functionsMeta';
import { invalidateProgramCache } from './typeMap/tsProgram';
import { getSrcDir } from '@luckystack/core';
import { assertNoDuplicateNormalizedRouteKeys, assertNoDuplicatePageRoutes, assertValidRouteNaming } from './routeNamingValidation';
import { getOrInit } from './internal/mapUtils';

// Collect required imports for the Functions interface only.
// API/Sync types are now fully expanded by the TypeChecker and need no imports.
const namedImports = new Map<string, Set<string>>();
const defaultImports = new Map<string, string>();

interface GenerateTypeMapOptions {
  quiet?: boolean;
}

//? Per-page map of versioned API entries, keyed by `pagePath -> `${name}@${version}``.
type TypesByPage = Map<string, Map<string, ApiTypeEntry>>;
//? Per-page map of versioned sync entries, keyed by `pagePath -> `${name}@${version}``.
type SyncTypesByPage = Map<string, Map<string, SyncTypeEntry>>;

//? Shared mutable collectors threaded through both collection passes. Holding
//? the import maps + unresolved-alias set by reference (rather than returning +
//? merging) preserves the EXACT population order the inline loops had: API
//? symbols are registered before sync symbols, in file-discovery order.
interface TypeMapCollectors {
  namedImports: Map<string, Set<string>>;
  unresolvedTypeAliases: Set<string>;
  quiet: boolean;
}

//? Walks every discovered `_api/` file, runs the TypeChecker-backed extractors,
//? registers unresolved import symbols into the shared collectors, and returns
//? the per-page API type map. Side-effects (console logging, `namedImports` /
//? `unresolvedTypeAliases` mutation) occur in the same order as the original
//? inline loop — this is a pure code-motion extraction, not a behavior change.
const collectApiTypes = (apiFiles: string[], collectors: TypeMapCollectors): TypesByPage => {
  const { namedImports, unresolvedTypeAliases, quiet } = collectors;
  const typesByPage: TypesByPage = new Map();

  if (!quiet) {
    console.log(' ═══════════════════════════════════════════════════════════════════════════');
    console.log(' ═══════════════════════════════════════════════════════════════════════════');
    console.log(`[TypeMapGenerator] Found ${apiFiles.length} API files`, 'cyan');
  }

  for (const filePath of apiFiles) {
    const pagePath = extractPagePath(filePath);
    const apiName = extractApiName(filePath);
    const apiVersion = extractApiVersion(filePath);

    if (!pagePath || !apiName) continue;

    // TypeChecker-based extractors return fully-expanded inline types.
    // No import collection or sanitization is needed for API types.
    const inputTypeResult = getInputTypeDetailsFromFile(filePath);
    const outputTypeResult = getOutputTypeDetailsFromFile(filePath);
    const streamTypeResult = getApiStreamPayloadTypeDetailsFromFile(filePath);
    const inputType = inputTypeResult.text;
    const outputType = outputTypeResult.text;
    const streamType = streamTypeResult.text;
    const httpMethod = extractHttpMethod(filePath, apiName);
    const rateLimit = extractRateLimit(filePath);
    const auth = extractAuth(filePath);
    const meta = extractDocsMeta(filePath);

    for (const symbol of [...inputTypeResult.unresolvedSymbols, ...outputTypeResult.unresolvedSymbols, ...streamTypeResult.unresolvedSymbols]) {
      if (!symbol.importPath) {
        unresolvedTypeAliases.add(symbol.name);
        console.error(`[TypeMapGenerator] Unresolved API type (${pagePath}/${apiName}/${apiVersion}): ${symbol.name}`);
        continue;
      }
      getOrInit(namedImports, symbol.importPath, () => new Set<string>()).add(symbol.name);
    }

    if (!quiet) {
      console.log(`[TypeMapGenerator] API: ${pagePath}/${apiName}/${apiVersion} (${httpMethod}${rateLimit === undefined ? '' : `, rateLimit: ${rateLimit}`})`);
    }

    getOrInit(typesByPage, pagePath, () => new Map()).set(`${apiName}@${apiVersion}`, { input: inputType, output: outputType, stream: streamType, method: httpMethod, rateLimit, auth, version: apiVersion, ...(meta ? { meta } : {}) });
  }

  return typesByPage;
};

//? Pairs `_sync/` server + client files into one entry per route, runs the
//? TypeChecker-backed extractors for each present side, registers unresolved
//? import symbols into the shared collectors, and returns the per-page sync
//? type map. The `allSyncs` Map keeps insertion order (servers first, then
//? clients) so the downstream iteration + logging order is identical to the
//? original inline loop. Pure code-motion extraction — no behavior change.
const collectSyncTypes = (
  syncServerFiles: string[],
  syncClientFiles: string[],
  collectors: TypeMapCollectors,
): SyncTypesByPage => {
  const { namedImports, unresolvedTypeAliases, quiet } = collectors;
  const syncTypesByPage: SyncTypesByPage = new Map();

  if (!quiet) {
    console.log(' ═══════════════════════════════════════════════════════════════════════════');
    console.log(' ═══════════════════════════════════════════════════════════════════════════');
    console.log(`[TypeMapGenerator] Found ${syncServerFiles.length} Sync server files, ${syncClientFiles.length} Sync client files`, 'cyan');
  }

  const allSyncs = new Map<string, {
    pagePath: string;
    syncName: string;
    serverFile?: string;
    clientFile?: string;
  }>();

  for (const serverFile of syncServerFiles) {
    const pagePath = extractSyncPagePath(serverFile);
    const syncName = extractSyncName(serverFile);
    const syncVersion = extractSyncVersion(serverFile);
    if (!pagePath || !syncName) continue;

    const key = `${pagePath}/${syncName}/${syncVersion}`;
    const existing = allSyncs.get(key) ?? { pagePath, syncName };
    existing.serverFile = serverFile;
    allSyncs.set(key, existing);
  }

  for (const clientFile of syncClientFiles) {
    const pagePath = extractSyncPagePath(clientFile);
    const syncName = extractSyncName(clientFile);
    const syncVersion = extractSyncVersion(clientFile);
    if (!pagePath || !syncName) continue;

    const key = `${pagePath}/${syncName}/${syncVersion}`;
    const existing = allSyncs.get(key) ?? { pagePath, syncName };
    existing.clientFile = clientFile;
    allSyncs.set(key, existing);
  }

  for (const [, { pagePath, syncName, serverFile, clientFile }] of allSyncs) {
    const syncVersion = extractSyncVersion(serverFile ?? clientFile ?? '');

    const clientInputTypeResult = serverFile
      ? getSyncClientDataTypeDetailsFromFile(serverFile)
      : (clientFile
        ? getSyncClientDataTypeDetailsFromFile(clientFile)
        : { text: '{ }', unresolvedSymbols: [] });

    const serverOutputTypeResult = serverFile
      ? getSyncServerOutputTypeDetailsFromFile(serverFile)
      : { text: '{ }', unresolvedSymbols: [] };
    const clientOutputTypeResult = clientFile
      ? getSyncClientOutputTypeDetailsFromFile(clientFile)
      : { text: '{ }', unresolvedSymbols: [] };
    const serverStreamTypeResult = serverFile
      ? getSyncServerStreamPayloadTypeDetailsFromFile(serverFile)
      : { text: 'never', unresolvedSymbols: [] };
    const clientStreamTypeResult = clientFile
      ? getSyncClientStreamPayloadTypeDetailsFromFile(clientFile)
      : { text: 'never', unresolvedSymbols: [] };

    const clientInputType = clientInputTypeResult.text;
    const serverOutputType = serverOutputTypeResult.text;
    const clientOutputType = clientOutputTypeResult.text;
    const serverStreamType = serverStreamTypeResult.text;
    const clientStreamType = clientStreamTypeResult.text;

    const allSyncUnresolvedSymbols = [
      ...clientInputTypeResult.unresolvedSymbols,
      ...serverOutputTypeResult.unresolvedSymbols,
      ...clientOutputTypeResult.unresolvedSymbols,
      ...serverStreamTypeResult.unresolvedSymbols,
      ...clientStreamTypeResult.unresolvedSymbols,
    ];

    for (const symbol of allSyncUnresolvedSymbols) {
      if (!symbol.importPath) {
        unresolvedTypeAliases.add(symbol.name);
        console.error(`[TypeMapGenerator] Unresolved Sync type (${pagePath}/${syncName}/${syncVersion}): ${symbol.name}`);
        continue;
      }
      getOrInit(namedImports, symbol.importPath, () => new Set<string>()).add(symbol.name);
    }

    if (!quiet) {
      console.log(`[TypeMapGenerator] Sync: ${pagePath}/${syncName}/${syncVersion} (server: ${!!serverFile}, client: ${!!clientFile})`);
    }

    //? Prefer @docs metadata from the server file; fall back to client file.
    //? Server is the canonical "owns the route" file when both exist.
    const syncMeta = serverFile ? extractDocsMeta(serverFile) : (clientFile ? extractDocsMeta(clientFile) : undefined);

    getOrInit(syncTypesByPage, pagePath, () => new Map()).set(`${syncName}@${syncVersion}`, {
      clientInput: clientInputType,
      serverOutput: serverOutputType,
      clientOutput: clientOutputType,
      serverStream: serverStreamType,
      clientStream: clientStreamType,
      version: syncVersion,
      ...(syncMeta ? { meta: syncMeta } : {}),
    });
  }

  return syncTypesByPage;
};

export const generateTypeMapFile = (options: GenerateTypeMapOptions = {}): void => {
  const { quiet = false } = options;
  assertValidRouteNaming({
    srcDir: getSrcDir(),
    context: 'generating API/sync type maps',
  });
  assertNoDuplicateNormalizedRouteKeys({
    srcDir: getSrcDir(),
    context: 'generating API/sync type maps',
  });
  //? Hard-fail on duplicate page routes at build time. Dev startup only
  //? warns (so a misplaced file doesn't block the entire dev server);
  //? builds throw so collisions can never ship to production.
  assertNoDuplicatePageRoutes({
    srcDir: getSrcDir(),
    context: 'generating API/sync type maps',
  });

  // Rebuild the TypeScript Program on each generation to pick up file changes.
  invalidateProgramCache();
  namedImports.clear();
  defaultImports.clear();

  const unresolvedTypeAliases = new Set<string>();
  const collectors: TypeMapCollectors = { namedImports, unresolvedTypeAliases, quiet };

  // ═══════════════════════════════════════════════════════════════════════════
  // Collect API Types
  // ═══════════════════════════════════════════════════════════════════════════
  const apiFiles = findAllApiFiles(getSrcDir());
  const typesByPage = collectApiTypes(apiFiles, collectors);

  // ═══════════════════════════════════════════════════════════════════════════
  // Collect Sync Types
  // ═══════════════════════════════════════════════════════════════════════════
  const syncServerFiles = findAllSyncServerFiles(getSrcDir());
  const syncClientFiles = findAllSyncClientFiles(getSrcDir());
  const syncTypesByPage = collectSyncTypes(syncServerFiles, syncClientFiles, collectors);

  const functionsInterface = generateServerFunctions({ namedImports, defaultImports });

  if (unresolvedTypeAliases.size > 0) {
    const unresolvedList = [...unresolvedTypeAliases].toSorted().join(', ');
    throw new Error(`[TypeMapGenerator] Aborting generation because unresolved type symbols were found: ${unresolvedList}`);
  }

  const { content, docsData, schemasContent } = buildTypeMapArtifacts({
    typesByPage,
    syncTypesByPage,
    namedImports,
    defaultImports,
    functionsInterface,
  });

  writeTypeMapArtifacts({ content, docsData, schemasContent });
};
