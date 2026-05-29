import { findAllApiFiles, findAllSyncClientFiles, findAllSyncServerFiles } from './typeMap/discovery';
import { extractApiName, extractApiVersion, extractPagePath, extractSyncName, extractSyncPagePath, extractSyncVersion } from './typeMap/routeMeta';
import { extractAuth, extractDocsMeta, extractHttpMethod, extractRateLimit, HttpMethod } from './typeMap/apiMeta';
import { buildTypeMapArtifacts, writeTypeMapArtifacts } from './typeMap/emitterArtifacts';
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Collect API Types
  // ═══════════════════════════════════════════════════════════════════════════
  const apiFiles = findAllApiFiles(getSrcDir());
  const typesByPage = new Map<string, Map<string, { input: string; output: string; stream: string; method: HttpMethod; rateLimit: number | false | undefined; auth: unknown; version: string; description?: string; meta?: { owner?: string; tags?: string[]; deprecated?: string | true } }>>();
  const unresolvedTypeAliases = new Set<string>();

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

  // ═══════════════════════════════════════════════════════════════════════════
  // Collect Sync Types
  // ═══════════════════════════════════════════════════════════════════════════
  const syncServerFiles = findAllSyncServerFiles(getSrcDir());
  const syncClientFiles = findAllSyncClientFiles(getSrcDir());
  const syncTypesByPage = new Map<string, Map<string, { clientInput: string; serverOutput: string; clientOutput: string; serverStream: string; clientStream: string; version: string; meta?: { owner?: string; tags?: string[]; deprecated?: string | true } }>>();

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
